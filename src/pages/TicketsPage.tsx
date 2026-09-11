import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS, assetOriginLabel, assetOriginShort } from '@/lib/assetOrigin'
import {
  familyByCode,
  HMS_FAMILY_OPTIONS,
  industryOptions,
  machineOptions,
} from '@/lib/hmsCatalog'
import { assetRequiresStamping } from '@/lib/productCatalog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { isCompanyAdmin, isScopedEmployee, isServiceDesk, canAssignTickets, canCreateTickets, filterServiceEngineers, type LookupUser } from '@/lib/roles'
import { WhatsAppSendConfirm, type WhatsAppConfirmPayload } from '@/components/whatsapp/WhatsAppSendConfirm'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { formatServiceId } from '@/lib/serviceId'
import { MissingBanner, focusFirstMissing, sectionErrorClass } from '@/components/ui/MissingField'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

const ADD_NEW_MACHINE = '__add_new__'

const emptyJob = {
  contactId: '',
  assetId: '',
  newMachine: false,
  familyCode: 'WEIGHING_SCALES',
  industryCode: '',
  machineSku: '',
  machineType: 'WEIGHING',
  machineName: '',
  capacity: '',
  accuracy: '',
  platformSize: '',
  model: '',
  serialNo: '',
  origin: 'SOLD_BY_US',
  servicePlan: 'NON_AMC',
  amcStartDate: '',
  amcEndDate: '',
  warrantyType: 'GC',
  warrantyUntil: '',
  remindersEnabled: true,
  stampingDate: '',
  nextDueDate: '',
  vcNumber: '',
  stampingQuarter: '',
  plateNo: '',
  verificationClass: '',
  odAmount: '',
  paymentTotal: '',
  advanceAmount: '',
  receivedByUserId: '',
  deliveredByUserId: '',
  description: '',
  priority: 'MEDIUM',
  category: 'Breakdown',
  channel: 'Walk-in',
  slaHours: '24',
}

export function TicketsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isAdmin = isCompanyAdmin(authUser?.role)
  const isAgent = isScopedEmployee(authUser?.role)
  const isDesk = isServiceDesk(authUser?.role)
  const canAssign = canAssignTickets(authUser?.role)
  const canCreate = canCreateTickets(authUser?.role)

  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [assets, setAssets] = useState<Record<string, unknown>[]>([])
  const [users, setUsers] = useState<LookupUser[]>([])
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [queue, setQueue] = useState<
    'all' | 'awaiting' | 'progress' | 'approval' | 'closed'
  >((searchParams.get('queue') as 'all' | 'awaiting' | 'progress' | 'approval' | 'closed') || 'all')
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [assignModal, setAssignModal] = useState<{ id: string; ticketNo?: string } | null>(null)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignBusy, setAssignBusy] = useState(false)
  const [form, setForm] = useState(emptyJob)
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [saving, setSaving] = useState(false)
  const [waPending, setWaPending] = useState<{
    payload: WhatsAppConfirmPayload
    execute: (sendWhatsApp: boolean) => Promise<void>
  } | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const engineers = useMemo(() => filterServiceEngineers(users), [users])

  const load = useCallback(async () => {
    try {
      const [res, lookups] = await Promise.all([
        api.tickets({
          limit: 500,
          sort: 'newest',
          status: status || undefined,
          contactId: searchParams.get('contactId') || undefined,
          slaBreached: searchParams.get('slaBreached') || undefined,
          ...(isAgent ? { mine: 1 } : {}),
        }),
        api.lookups(),
      ])
      setTickets(res.items ?? [])
      setUsers(lookups.users)
      setForm((f) => ({
        ...f,
        receivedByUserId: f.receivedByUserId || authUser?.id || '',
      }))
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Failed to load jobs' })
    }
  }, [addToast, authUser?.id, isAdmin, isAgent, searchParams, status])

  const loadAssets = useCallback(
    async (contactId: string) => {
      if (!contactId) {
        setAssets([])
        return
      }
      try {
        const res = await api.assets({ contactId, limit: 100 })
        const items = res.items ?? []
        setAssets(items)
        // No machines on file → open “Add new machine” so desk can register one immediately
        if (items.length === 0) {
          setForm((f) =>
            f.contactId === contactId && !f.assetId
              ? { ...f, newMachine: true }
              : f,
          )
        }
      } catch {
        setAssets([])
      }
    },
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Admin: quiet list poll (no flash) — only when tab is visible
  useEffect(() => {
    if (!isAdmin || tab !== 'list') return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load()
    }, 30000)
    return () => window.clearInterval(id)
  }, [isAdmin, tab, load])

  const queueCounts = useMemo(() => {
    const awaiting = tickets.filter((t) => String(t.status) === 'OPEN' && !t.assignedToId).length
    const progress = tickets.filter((t) =>
      ['IN_PROGRESS', 'PENDING'].includes(String(t.status)),
    ).length
    const approval = tickets.filter((t) => String(t.status) === 'RESOLVED').length
    const closed = tickets.filter((t) => String(t.status) === 'CLOSED').length
    return { awaiting, progress, approval, closed, all: tickets.length }
  }, [tickets])

  const displayedTickets = useMemo(() => {
    const rows =
      !isAdmin || queue === 'all'
        ? [...tickets]
        : tickets.filter((t) => {
            const st = String(t.status)
            if (queue === 'awaiting') return st === 'OPEN' && !t.assignedToId
            if (queue === 'progress') return ['IN_PROGRESS', 'PENDING'].includes(st)
            if (queue === 'approval') return st === 'RESOLVED'
            if (queue === 'closed') return st === 'CLOSED'
            return true
          })
    // Newest service jobs first
    return rows.sort((a, b) => {
      const ta = new Date(String(a.createdAt ?? 0)).getTime()
      const tb = new Date(String(b.createdAt ?? 0)).getTime()
      if (tb !== ta) return tb - ta
      return num(b.ticketNo) - num(a.ticketNo)
    })
  }, [tickets, queue, isAdmin])

  const ticketIds = useMemo(() => displayedTickets.map((t) => String(t.id)), [displayedTickets])
  const selection = useRowSelection(ticketIds)

  async function quickAssign(sendWhatsApp = true) {
    if (!assignModal || !assignUserId) return
    setAssignBusy(true)
    try {
      const eng = engineers.find((u) => u.id === assignUserId)
      const updated = await api.updateTicket(assignModal.id, {
        assignedToId: assignUserId,
        receivedByUserId: assignUserId,
        status: 'IN_PROGRESS',
        sendWhatsApp,
        whatsappNote: 'Engineer assigned — work started',
      })
      const engWa = (updated as { engineerWhatsapp?: { notified?: boolean; reason?: string } })
        .engineerWhatsapp
      if (sendWhatsApp) {
        if (engWa?.notified) {
          const fallbackNote =
            typeof engWa.reason === 'string' && engWa.reason.includes('sent_as_text')
              ? ' (text fallback — approve ticket_assigned_engineer in Meta for reliable alerts)'
              : ''
          addToast({
            type: 'success',
            message: `Assigned ${eng?.name ?? 'engineer'} · WhatsApp sent to engineer${fallbackNote}`,
          })
        } else {
          addToast({
            type: 'warning',
            message: `Assigned, but engineer WhatsApp failed${
              engWa?.reason ? `: ${engWa.reason}` : eng?.phone ? '' : ' (no mobile on user)'
            }. Approve Utility template ticket_assigned_engineer in Meta, and confirm the engineer’s phone under Users & Roles.`,
          })
        }
      } else {
        addToast({ type: 'success', message: 'Engineer assigned (notification skipped)' })
      }
      setAssignModal(null)
      setAssignUserId('')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Assign failed',
      })
    } finally {
      setAssignBusy(false)
    }
  }

  function applyAssetToForm(a: Record<string, unknown>) {
    const cf = (a.customFields as Record<string, unknown> | undefined) ?? {}
    const origin = a.origin ? String(a.origin) : 'SOLD_BY_US'
    setForm((f) => ({
      ...f,
      assetId: String(a.id),
      newMachine: false,
      machineName: a.name ? String(a.name) : '',
      machineType: a.machineType ? String(a.machineType) : f.machineType,
      capacity: a.capacity != null ? String(a.capacity) : '',
      accuracy: a.accuracy != null ? String(a.accuracy) : '',
      platformSize: a.platformSize != null ? String(a.platformSize) : '',
      model: a.model != null ? String(a.model) : '',
      serialNo: a.serialNo != null ? String(a.serialNo) : '',
      stampingDate: a.stampingDate ? String(a.stampingDate).slice(0, 10) : '',
      nextDueDate: a.nextDueDate ? String(a.nextDueDate).slice(0, 10) : '',
      servicePlan: a.servicePlan ? String(a.servicePlan) : 'NON_AMC',
      amcStartDate: a.amcStartDate ? String(a.amcStartDate).slice(0, 10) : '',
      amcEndDate: a.amcEndDate ? String(a.amcEndDate).slice(0, 10) : '',
      origin,
      remindersEnabled: a.remindersEnabled !== false,
      warrantyType: cf.warrantyType ? String(cf.warrantyType) : f.warrantyType || 'NGC',
      warrantyUntil: cf.warrantyUntil ? String(cf.warrantyUntil).slice(0, 10) : '',
      vcNumber: cf.vcNumber ? String(cf.vcNumber) : '',
      stampingQuarter: cf.stampingQuarter ? String(cf.stampingQuarter) : '',
      plateNo: cf.plateNo ? String(cf.plateNo) : '',
      verificationClass: cf.verificationClass ? String(cf.verificationClass) : '',
    }))
  }

  useEffect(() => {
    const contactId = searchParams.get('contactId')
    const assetId = searchParams.get('assetId')
    const category = searchParams.get('category')
    const shouldOpen = searchParams.get('open') === '1'
    if (contactId) {
      setForm((f) => ({
        ...f,
        contactId,
        assetId: assetId || f.assetId,
        ...(category ? { category } : {}),
      }))
      void loadAssets(contactId)
    } else if (category) {
      setForm((f) => ({ ...f, category }))
    }
    if (shouldOpen && canCreate) setTab('create')
  }, [canCreate, loadAssets, searchParams])

  useEffect(() => {
    const assetId = searchParams.get('assetId') || form.assetId
    if (!assetId || assets.length === 0) return
    const a = assets.find((x) => String(x.id) === assetId)
    if (a) applyAssetToForm(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once when assets load for URL assetId
  }, [assets, searchParams.get('assetId')])

  const onPickContact = useCallback(
    (c: ContactPick | null) => {
      setPickedContact(c)
      setForm((f) => ({
        ...f,
        contactId: c?.id ?? '',
        assetId: '',
        newMachine: false,
        familyCode: 'WEIGHING_SCALES',
        industryCode: '',
        machineSku: '',
        machineName: '',
      }))
      if (c?.id) void loadAssets(c.id)
      else setAssets([])
    },
    [loadAssets],
  )

  const balancePreview = useMemo(() => {
    const pay = Number(form.paymentTotal) || 0
    const adv = Number(form.advanceAmount) || 0
    return Math.max(0, pay - adv)
  }, [form.advanceAmount, form.paymentTotal])

  const isStampingJob = form.category === 'Stamping'
  const selectedAssetOrigin = useMemo(() => {
    if (form.newMachine) return form.origin
    const a = assets.find((x) => String(x.id) === form.assetId)
    return a?.origin ? String(a.origin) : ''
  }, [form.newMachine, form.origin, form.assetId, assets])
  const selectedAssetNextDue = useMemo(() => {
    if (form.newMachine) return form.nextDueDate || ''
    const a = assets.find((x) => String(x.id) === form.assetId)
    return a?.nextDueDate ? String(a.nextDueDate).slice(0, 10) : ''
  }, [form.newMachine, form.nextDueDate, form.assetId, assets])
  const selectedAssetLastStamp = useMemo(() => {
    if (form.newMachine) return ''
    const a = assets.find((x) => String(x.id) === form.assetId)
    return a?.stampingDate ? String(a.stampingDate).slice(0, 10) : ''
  }, [form.newMachine, form.assetId, assets])
  const formRequiresStamping = useMemo(() => {
    // Weighing machines still show optional legal fields on non-stamping jobs
    if (isStampingJob) return false
    if (form.assetId && !form.newMachine) {
      const asset = assets.find((a) => String(a.id) === form.assetId)
      if (asset) {
        return assetRequiresStamping({ machineType: String(asset.machineType ?? 'WEIGHING') })
      }
    }
    return form.machineType === 'WEIGHING'
  }, [form.assetId, form.newMachine, form.machineType, isStampingJob, assets])

  const newMachineNeedsIndustry = useMemo(
    () => Boolean(familyByCode(form.familyCode)?.hasIndustry),
    [form.familyCode],
  )

  const catalogMachineChoices = useMemo(() => {
    if (!form.familyCode) return []
    if (newMachineNeedsIndustry && !form.industryCode) return []
    return machineOptions(form.familyCode, form.industryCode || undefined)
  }, [form.familyCode, form.industryCode, newMachineNeedsIndustry])

  const selectedAsset = useMemo(
    () => (form.assetId && !form.newMachine ? assets.find((a) => String(a.id) === form.assetId) : null),
    [form.assetId, form.newMachine, assets],
  )

  function resetCreate() {
    setForm({ ...emptyJob, receivedByUserId: authUser?.id || '' })
    setPickedContact(null)
    setAssets([])
  }

  function pickMachineFromDropdown(value: string) {
    if (value === ADD_NEW_MACHINE) {
      setForm((f) => ({
        ...f,
        newMachine: true,
        assetId: '',
        familyCode: f.familyCode || 'WEIGHING_SCALES',
        industryCode: '',
        machineSku: '',
        machineName: '',
        machineType: 'WEIGHING',
        capacity: '',
        accuracy: '',
        platformSize: '',
        model: '',
        serialNo: '',
        origin: 'SOLD_BY_US',
        servicePlan: 'NON_AMC',
      }))
      return
    }
    const a = assets.find((x) => String(x.id) === value)
    if (a) applyAssetToForm(a)
    else setForm((f) => ({ ...f, assetId: value, newMachine: false }))
  }

  function applyCatalogMachine(sku: string) {
    if (sku === '__custom__') {
      setForm((f) => ({ ...f, machineSku: '__custom__' }))
      return
    }
    const hit = catalogMachineChoices.find((o) => o.value === sku)
    if (!hit?.machine) {
      setForm((f) => ({ ...f, machineSku: sku }))
      return
    }
    setForm((f) => ({
      ...f,
      machineSku: sku,
      machineName: hit.machine.name,
      machineType: hit.machine.catalogKind || f.machineType,
      model: hit.machine.name,
    }))
  }

  async function createJob(e: FormEvent) {
    e.preventDefault()
    const machineOk = form.newMachine
      ? Boolean(form.machineName.trim()) &&
        Boolean(form.familyCode) &&
        (!newMachineNeedsIndustry || Boolean(form.industryCode))
      : Boolean(form.assetId)
    const ok = focusFirstMissing(
      [
        {
          key: 'contactId',
          sectionId: 'section-ticket-customer',
          ok: Boolean(form.contactId),
          message: 'Customer is required.',
        },
        {
          key: 'assetId',
          sectionId: 'section-ticket-machine',
          ok: machineOk,
          message: form.newMachine
            ? newMachineNeedsIndustry && !form.industryCode
              ? 'Select industry, then machine details.'
              : 'Enter machine details (product / name).'
            : 'Select a machine for this customer, or add a new one.',
        },
        {
          key: 'description',
          sectionId: 'section-ticket-assign',
          ok: Boolean(form.description.trim()),
          message: 'Issue log is required — describe the customer complaint or job.',
        },
        {
          key: 'receivedByUserId',
          sectionId: 'section-ticket-assign',
          ok: !canAssign || Boolean(form.receivedByUserId),
          message: 'Assign an engineer for this job.',
        },
      ],
      setFieldErrors,
    )
    if (!ok) {
      addToast({ type: 'error', message: 'Missing required fields — scrolled to the red section.' })
      return
    }
    const engName = engineers.find((u) => u.id === form.receivedByUserId)?.name
    setWaPending({
      payload: {
        title: 'Create ticket & send WhatsApp?',
        lines: [
          'Template ticket_created_customer → customer',
          ...(canAssign && form.receivedByUserId
            ? [`Template ticket_assigned_engineer → ${engName || 'engineer'}`]
            : ['Engineer WhatsApp only after admin assigns']),
        ],
        note: 'Uses customer name, ticket no, company name, machine/issue (+ engineer location fields when assigned).',
      },
      execute: (send) => doCreateJob(send),
    })
  }

  async function doCreateJob(sendWhatsApp: boolean) {
    setSaving(true)
    try {
      let assetId = form.assetId || null
      // Only create a machine when explicitly adding a new one — never re-create an existing selection
      if (form.newMachine || (!assetId && form.machineName.trim())) {
        if (!form.machineName.trim()) {
          addToast({ type: 'error', message: 'Enter machine details or pick an existing machine' })
          setSaving(false)
          return
        }
        const fam = familyByCode(form.familyCode)
        const ind = fam?.industries?.find((i) => i.code === form.industryCode)
        const machine = await api.createAsset({
          contactId: form.contactId,
          machineType: form.machineType,
          name: form.machineName.trim(),
          capacity: form.capacity || null,
          accuracy: form.accuracy || null,
          platformSize: form.platformSize || null,
          model: form.model || null,
          serialNo: form.serialNo || null,
          origin: form.origin,
          servicePlan: form.servicePlan,
          amcStartDate: form.servicePlan === 'AMC' ? form.amcStartDate || null : null,
          amcEndDate: form.servicePlan === 'AMC' ? form.amcEndDate || null : null,
          remindersEnabled: form.remindersEnabled,
          stampingDate: null,
          nextDueDate:
            form.category === 'Stamping'
              ? null
              : formRequiresStamping
                ? form.nextDueDate || null
                : null,
          customFields: {
            warrantyType: form.warrantyType,
            warrantyUntil: form.warrantyUntil || null,
            vcNumber: form.vcNumber || null,
            stampingQuarter: form.stampingQuarter || null,
            plateNo: form.plateNo || null,
            verificationClass: form.verificationClass || null,
            catalogFamily: form.familyCode || null,
            catalogFamilyName: fam?.name ?? null,
            catalogIndustry: form.industryCode || null,
            catalogIndustryName: ind?.name ?? null,
            machineSku:
              form.machineSku && form.machineSku !== '__custom__' ? form.machineSku : null,
            ...(form.category === 'Stamping'
              ? {
                  visitPurpose: 'STAMPING',
                  cameOnlyForStamping: form.origin === 'THIRD_PARTY',
                }
              : {}),
          },
        })
        assetId = String(machine.id)
      }

      if (!assetId) {
        addToast({ type: 'error', message: 'Select an existing machine or add a new one' })
        setSaving(false)
        return
      }

      // Enrich existing machine with optional legal fields (not stamp dates — engineer records those)
      if (
        assetId &&
        !form.newMachine &&
        (form.vcNumber || form.stampingQuarter || form.plateNo || form.verificationClass)
      ) {
        const existing = assets.find((a) => String(a.id) === assetId)
        const prevCf = (existing?.customFields as Record<string, unknown> | undefined) ?? {}
        await api.updateAsset(assetId, {
          customFields: {
            ...prevCf,
            vcNumber: form.vcNumber || prevCf.vcNumber || null,
            stampingQuarter: form.stampingQuarter || prevCf.stampingQuarter || null,
            plateNo: form.plateNo || prevCf.plateNo || null,
            verificationClass: form.verificationClass || prevCf.verificationClass || null,
          },
        })
      }

      const machineLabel =
        form.machineName.trim() ||
        String(assets.find((a) => String(a.id) === form.assetId)?.name ?? 'Service')

      const assigneeId = canAssign ? form.receivedByUserId || null : null
      const subjectPrefix = form.category === 'Stamping' ? 'Stamping' : 'Service'
      const existingAsset = assets.find((a) => String(a.id) === assetId)
      const originForJob = form.newMachine
        ? form.origin
        : existingAsset?.origin
          ? String(existingAsset.origin)
          : 'SOLD_BY_US'

      const created = await api.createTicket({
        subject: `${subjectPrefix} — ${machineLabel}`,
        description: form.description.trim(),
        priority: form.priority,
        status: canAssign && assigneeId ? 'IN_PROGRESS' : 'OPEN',
        contactId: form.contactId,
        assetId,
        // Stamp result dates are entered by engineer after the visit — not at desk create
        stampingDate: null,
        nextDueDate: null,
        odAmount: 0,
        paymentTotal: isDesk ? 0 : Number(form.paymentTotal) || 0,
        advanceAmount: isDesk ? 0 : Number(form.advanceAmount) || 0,
        assignedToId: assigneeId,
        receivedByUserId: assigneeId,
        deliveredByUserId: canAssign ? form.deliveredByUserId || null : null,
        category: form.category,
        channel: form.channel,
        slaHours: Number(form.slaHours) || 24,
        sendWhatsApp,
        customFields: {
          visitLog: [],
          dayNotes: [],
          fieldPhotos: [],
          stampingLegal: {
            vcNumber: form.vcNumber || null,
            stampingQuarter: form.stampingQuarter || null,
            plateNo: form.plateNo || null,
            verificationClass: form.verificationClass || null,
          },
          ...(form.category === 'Stamping'
            ? {
                visitPurpose: 'STAMPING',
                machineOrigin: originForJob,
                cameOnlyForStamping: originForJob === 'THIRD_PARTY',
                outsideStamping:
                  originForJob === 'THIRD_PARTY'
                    ? 'Outside machine — customer came only for stamping / verification'
                    : 'Sold by us — renewal / re-stamp visit',
              }
            : {}),
        },
      })

      setTab('list')
      resetCreate()
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev)
        n.delete('open')
        n.delete('assetId')
        return n
      })
      addToast({
        type: 'success',
        message: isDesk
          ? 'Ticket created — waiting for admin to assign an engineer'
          : 'Service job saved',
      })
      if (created.id) {
        navigate(`/tickets/${String(created.id)}`)
        return
      }
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    } finally {
      setSaving(false)
    }
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteTicket(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      selection.clear()
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete',
      })
    } finally {
      setBusyDelete(false)
      setConfirm(null)
    }
  }

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Service jobs' : isDesk ? 'Service desk tickets' : 'My tickets'}
        count={tickets.length}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: isAdmin ? 'Service tickets' : isDesk ? 'Tickets' : 'My tickets' },
        ]}
      />
      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          if (id === 'create' && !canCreate) return
          setTab(id as 'list' | 'create')
          if (id === 'create') resetCreate()
        }}
        tabs={[
          {
            id: 'list',
            label: isAdmin || isDesk ? 'All tickets' : 'Assigned to me',
            count: tickets.length,
          },
          ...(canCreate ? [{ id: 'create', label: 'New ticket' }] : []),
        ]}
      />

      {tab === 'list' ? (
        <>
          {isAdmin ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {(
                [
                  { id: 'all', label: 'All', count: queueCounts.all },
                  { id: 'awaiting', label: 'Awaiting assignment', count: queueCounts.awaiting },
                  { id: 'progress', label: 'In progress', count: queueCounts.progress },
                  { id: 'approval', label: 'Pending approval', count: queueCounts.approval },
                  { id: 'closed', label: 'Closed', count: queueCounts.closed },
                ] as const
              ).map((q) => (
                <Button
                  key={q.id}
                  size="sm"
                  variant={queue === q.id ? 'primary' : 'outline'}
                  onClick={() => setQueue(q.id)}
                >
                  {q.label}
                  <span className="ml-1.5 rounded-full bg-black/10 px-1.5 text-[11px] tabular-nums dark:bg-white/15">
                    {q.count}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap gap-3">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-44"
              options={[
                { value: '', label: 'All statuses' },
                ...['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'].map((v) => ({
                  value: v,
                  label: labelize(v),
                })),
              ]}
            />
          </div>

          <Card padding={false}>
            {displayedTickets.length === 0 ? (
              <EmptyState
                title={
                  isAdmin
                    ? queue === 'awaiting'
                      ? 'No tickets awaiting assignment'
                      : queue === 'approval'
                        ? 'No tickets pending approval'
                        : 'No service jobs in this queue'
                    : isDesk
                      ? 'No tickets yet'
                      : 'No jobs assigned to you'
                }
                subtitle={
                  isAdmin
                    ? 'New desk tickets appear under Awaiting assignment. Completed jobs need your approval.'
                    : isDesk
                      ? 'Create an OPEN ticket for a customer. Admin will assign the engineer.'
                      : 'When an admin assigns a ticket to you, it shows up here from the live database.'
                }
                actionLabel={canCreate ? 'New ticket' : undefined}
                onAction={canCreate ? () => setTab('create') : undefined}
              />
            ) : (
              <div className="p-4 pt-3">
                {isAdmin && selection.someSelected ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="job"
                    busy={busyDelete}
                    onClear={selection.clear}
                    onDelete={() => setConfirm({ ids: selection.selectedIds })}
                  />
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1400px] text-left text-sm">
                    <thead className="bg-surface text-xs text-text-secondary">
                      <tr className="border-b border-border">
                        <th className="w-10 px-3 py-3">
                          <SelectCheckbox
                            checked={selection.allSelected}
                            indeterminate={selection.someSelected && !selection.allSelected}
                            onChange={selection.toggleAll}
                            aria-label="Select all"
                          />
                        </th>
                        {[
                          'Service ID',
                          'Customer',
                          'Machine',
                          'Engineer',
                          'AMC',
                          'Stamping',
                          'Total payment',
                          'Advance',
                          'Balance',
                          'Pay status',
                          'Next due',
                          'Status',
                          'Actions',
                        ].map((h) => (
                          <th key={h} className="px-3 py-3 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedTickets.map((ticket) => {
                        const id = String(ticket.id)
                        const contact = ticket.contact as { name?: string; customerCode?: string } | null
                        const asset = ticket.asset as { name?: string; servicePlan?: string } | null
                        const st = String(ticket.status)
                        const paySt = String(ticket.paymentStatus ?? 'UNPAID')
                        const unassigned = !ticket.assignedToId
                        const serviceId = formatServiceId(ticket.ticketNo as number | string)
                        return (
                          <tr
                            key={id}
                            className="cursor-pointer border-b border-border last:border-0 hover:bg-surface"
                            onClick={() => navigate(`/tickets/${id}`)}
                          >
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <SelectCheckbox
                                checked={selection.isSelected(id)}
                                onChange={() => selection.toggle(id)}
                                aria-label={`Select ${serviceId}`}
                              />
                            </td>
                            <td className="px-3 py-3 font-semibold">
                              <Link
                                className="font-mono text-accent-blue hover:underline"
                                to={`/tickets/${id}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {serviceId}
                              </Link>
                              {st === 'RESOLVED' ? (
                                <div className="mt-0.5 text-[11px] font-medium text-amber-600">
                                  Pending approval
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-medium">{contact?.name ?? '—'}</div>
                              <div className="font-mono text-[11px] text-text-secondary">
                                {contact?.customerCode ?? ''}
                              </div>
                            </td>
                            <td className="max-w-[160px] px-3 py-3">{asset?.name ?? String(ticket.subject)}</td>
                            <td className="px-3 py-3">
                              {unassigned ? (
                                <Badge color="amber">Unassigned</Badge>
                              ) : (
                                String(ticket.assignedToName ?? ticket.receivedByName ?? '—')
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <Badge color={asset?.servicePlan === 'AMC' ? 'green' : 'gray'}>
                                {asset?.servicePlan === 'AMC' ? 'AMC' : 'Non-AMC'}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              {ticket.stampingDate ? formatDate(String(ticket.stampingDate)) : '—'}
                            </td>
                            <td className="px-3 py-3 font-medium">{formatCurrency(num(ticket.paymentTotal))}</td>
                            <td className="px-3 py-3">{formatCurrency(num(ticket.advanceAmount))}</td>
                            <td className="px-3 py-3 font-semibold text-accent-amber">
                              {formatCurrency(num(ticket.balanceDue))}
                            </td>
                            <td className="px-3 py-3">
                              <Badge color={paySt === 'PAID' ? 'green' : paySt === 'PARTIAL' ? 'amber' : 'gray'}>
                                {labelize(paySt)}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              {ticket.nextDueDate ? formatDate(String(ticket.nextDueDate)) : '—'}
                            </td>
                            <td className="px-3 py-3">
                              <Badge color={ticketStatusColor[st] ?? 'gray'}>{labelize(st)}</Badge>
                            </td>
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                <ViewIconButton onClick={() => navigate(`/tickets/${id}`)} />
                                {canAssign && (unassigned || st === 'OPEN' || st === 'IN_PROGRESS') ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setAssignUserId(String(ticket.assignedToId ?? ''))
                                      setAssignModal({
                                        id,
                                        ticketNo: formatServiceId(ticket.ticketNo as number | string),
                                      })
                                    }}
                                  >
                                    {unassigned ? 'Assign' : 'Reassign'}
                                  </Button>
                                ) : null}
                                {isAdmin ? (
                                  <DeleteIconButton
                                    disabled={busyDelete}
                                    onClick={() => setConfirm({ ids: [id] })}
                                  />
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <FormPanel
          open
          accent="theme"
          eyebrow="SERVICE"
          title={form.category === 'Stamping' ? 'New stamping job' : 'New ticket'}
          subtitle={
            form.category === 'Stamping'
              ? 'Desk opens the job — engineer records the new stamp date after verification, then marks complete.'
              : isDesk
                ? 'Find or add customer, select machine, log the issue. Step 1 creates an OPEN ticket — admin assigns the engineer (Step 2).'
                : 'Customer, machine, issue log, and assign an engineer (Steps 1–2).'
          }
          onClose={() => {
            setTab('list')
            resetCreate()
          }}
          footer={
            <>
              <FormPanelCancel
                onClick={() => {
                  setTab('list')
                  resetCreate()
                }}
              />
              <Button type="submit" form="service-job-form" disabled={saving}>
                {saving ? 'Saving…' : isDesk ? 'Create ticket (OPEN)' : 'Save service job'}
              </Button>
            </>
          }
        >
          <form id="service-job-form" onSubmit={(e) => void createJob(e)} className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">
                1. Job category
              </h3>
              <Select
                label="Category *"
                value={form.category}
                onChange={(e) => {
                  const category = e.target.value
                  setForm((f) => ({
                    ...f,
                    category,
                    // Outside walk-in for stamp is the common case — desk can switch to Sold by us
                    ...(category === 'Stamping' && f.newMachine
                      ? { origin: 'THIRD_PARTY', servicePlan: 'NON_AMC' }
                      : {}),
                  }))
                }}
                options={[
                  { value: 'Breakdown', label: 'Breakdown / repair' },
                  { value: 'Installation', label: 'Installation' },
                  { value: 'Stamping', label: 'Stamping / verification' },
                  { value: 'AMC visit', label: 'AMC visit' },
                  { value: 'Other', label: 'Other' },
                ]}
              />
              <Select
                label="Channel"
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                options={[
                  { value: 'Walk-in', label: 'Walk-in' },
                  { value: 'Phone', label: 'Phone' },
                  { value: 'WhatsApp', label: 'WhatsApp' },
                  { value: 'Field', label: 'Field visit' },
                ]}
              />
              {isStampingJob ? (
                <p className="sm:col-span-2 lg:col-span-3 -mt-1 rounded-[8px] border border-violet-200/80 bg-violet-50/80 px-3 py-2 text-xs text-violet-950 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-100">
                  Stamping job — desk does <strong>not</strong> enter today’s stamp date. After the
                  visit, the <strong>engineer</strong> records stamp date + next due, then marks
                  complete. Machine register updates from that.
                </p>
              ) : null}
            </section>

            <section
              id="section-ticket-customer"
              className={`scroll-mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${sectionErrorClass(Boolean(fieldErrors.contactId))}`}
            >
              <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">2. Customer</h3>
              {fieldErrors.contactId ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <MissingBanner message={fieldErrors.contactId} />
                </div>
              ) : null}
              <ContactPicker
                className="sm:col-span-2 lg:col-span-3"
                label="Customer / shop *"
                valueId={form.contactId}
                selected={pickedContact}
                onSelect={onPickContact}
                returnTo="/tickets?open=1"
              />
              <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                New customer?{' '}
                <Link to="/contacts?open=1&returnTo=/tickets?open=1" className="font-medium text-accent-blue hover:underline">
                  Add customer
                </Link>
                , add their product/machine, then return here and search again.
              </p>
            </section>

            <section
              id="section-ticket-machine"
              className={`scroll-mt-24 grid gap-4 rounded-[12px] border border-border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3 ${sectionErrorClass(Boolean(fieldErrors.assetId))}`}
            >
              <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">
                3. Select machine
              </h3>
              {fieldErrors.assetId ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <MissingBanner message={fieldErrors.assetId} />
                </div>
              ) : null}
              {!form.contactId ? (
                <p className="sm:col-span-2 lg:col-span-3 text-sm text-text-secondary">
                  Select a customer first — their sold and outside/repair machines will appear here.
                </p>
              ) : (
                <>
                  <Select
                    className="sm:col-span-2 lg:col-span-3"
                    label="Machine for this customer *"
                    value={form.newMachine ? ADD_NEW_MACHINE : form.assetId}
                    onChange={(e) => pickMachineFromDropdown(e.target.value)}
                    options={[
                      {
                        value: '',
                        label: assets.length
                          ? 'Select machine…'
                          : 'No machines on file yet — add new below',
                      },
                      ...assets.map((a) => ({
                        value: String(a.id),
                        label: `${String(a.name)}${a.serialNo ? ` · ${String(a.serialNo)}` : ''} · ${assetOriginShort(a.origin ? String(a.origin) : null)}${a.servicePlan === 'AMC' ? ' · AMC' : ''}`,
                      })),
                      { value: ADD_NEW_MACHINE, label: '+ Add new machine' },
                    ]}
                  />
                  {assets.length > 0 && !form.newMachine ? (
                    <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                      Includes machines we sold and outside units previously brought for repair.
                    </p>
                  ) : null}
                </>
              )}

              {form.contactId && form.newMachine ? (
                <>
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-border bg-card/80 px-3 py-2 text-xs text-text-secondary">
                    New machine for this visit — pick product family
                    {newMachineNeedsIndustry ? ', industry (weighing only)' : ''}, then model and
                    details. It will be saved on the customer for next time.
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Select
                      label="Machine origin *"
                      value={form.origin}
                      onChange={(e) => {
                        const origin = e.target.value
                        setForm({
                          ...form,
                          origin,
                          ...(origin === 'THIRD_PARTY'
                            ? { servicePlan: 'NON_AMC', amcStartDate: '', amcEndDate: '' }
                            : {}),
                        })
                      }}
                      options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                    <p className="mt-1 text-xs text-text-secondary">
                      {ASSET_ORIGIN_OPTIONS.find((o) => o.value === form.origin)?.hint}
                    </p>
                  </div>
                  <Select
                    label="Product *"
                    value={form.familyCode}
                    onChange={(e) => {
                      const familyCode = e.target.value
                      const fam = familyByCode(familyCode)
                      const firstKind = fam?.hasIndustry
                        ? 'WEIGHING'
                        : fam?.machines?.[0]?.catalogKind || 'OTHER'
                      setForm({
                        ...form,
                        familyCode,
                        industryCode: '',
                        machineSku: '',
                        machineName: '',
                        machineType: firstKind,
                        model: '',
                      })
                    }}
                    options={HMS_FAMILY_OPTIONS}
                  />
                  {newMachineNeedsIndustry ? (
                    <Select
                      label="Industry *"
                      value={form.industryCode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          industryCode: e.target.value,
                          machineSku: '',
                          machineName: '',
                          model: '',
                        })
                      }
                      options={[
                        { value: '', label: 'Select industry…' },
                        ...industryOptions(form.familyCode),
                      ]}
                    />
                  ) : null}
                  <Select
                    label="Machine model *"
                    className={newMachineNeedsIndustry ? undefined : 'lg:col-span-2'}
                    value={form.machineSku}
                    onChange={(e) => applyCatalogMachine(e.target.value)}
                    disabled={newMachineNeedsIndustry && !form.industryCode}
                    options={[
                      {
                        value: '',
                        label:
                          newMachineNeedsIndustry && !form.industryCode
                            ? 'Select industry first…'
                            : 'Select machine…',
                      },
                      ...catalogMachineChoices.map((m) => ({
                        value: m.value,
                        label: m.label,
                      })),
                      { value: '__custom__', label: 'Other / type name manually' },
                    ]}
                  />
                  <Input
                    label="Machine name *"
                    placeholder="WEIGHING SCALE 20KG"
                    value={form.machineName}
                    onChange={(e) => setForm({ ...form, machineName: e.target.value })}
                    className="lg:col-span-2"
                  />
                  <Input
                    label="Capacity"
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  />
                  <Input
                    label="Accuracy"
                    value={form.accuracy}
                    onChange={(e) => setForm({ ...form, accuracy: e.target.value })}
                  />
                  <Input
                    label="Platform size"
                    value={form.platformSize}
                    onChange={(e) => setForm({ ...form, platformSize: e.target.value })}
                  />
                  <Input
                    label="Model"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  />
                  <Input
                    label="Serial number"
                    value={form.serialNo}
                    onChange={(e) => setForm({ ...form, serialNo: e.target.value })}
                  />
                  {form.origin !== 'THIRD_PARTY' ? (
                    <>
                      <Select
                        label="Service plan"
                        value={form.servicePlan}
                        onChange={(e) => setForm({ ...form, servicePlan: e.target.value })}
                        options={[
                          { value: 'NON_AMC', label: 'Non-AMC' },
                          { value: 'AMC', label: 'AMC' },
                        ]}
                      />
                      {form.servicePlan === 'AMC' ? (
                        <>
                          <Input
                            label="AMC start date"
                            type="date"
                            value={form.amcStartDate}
                            onChange={(e) => setForm({ ...form, amcStartDate: e.target.value })}
                          />
                          <Input
                            label="AMC end date"
                            type="date"
                            value={form.amcEndDate}
                            onChange={(e) => setForm({ ...form, amcEndDate: e.target.value })}
                          />
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                      Outside / repair — enroll AMC later after inspect if needed.
                    </p>
                  )}
                  <Select
                    label="Warranty (GC / NGC)"
                    value={form.warrantyType}
                    onChange={(e) => setForm({ ...form, warrantyType: e.target.value })}
                    options={[
                      { value: 'GC', label: 'GC — under company warranty' },
                      { value: 'NGC', label: 'NGC — chargeable / out of warranty' },
                    ]}
                  />
                  <Input
                    label="Warranty valid until"
                    type="date"
                    value={form.warrantyUntil}
                    onChange={(e) => setForm({ ...form, warrantyUntil: e.target.value })}
                  />
                </>
              ) : null}

              {form.contactId && selectedAsset ? (
                <div className="sm:col-span-2 lg:col-span-3 space-y-3">
                  <div
                    className={`rounded-[10px] border px-3 py-3 ${
                      selectedAssetOrigin === 'THIRD_PARTY'
                        ? 'border-amber-300/80 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/25'
                        : 'border-sky-200/80 bg-sky-50/60 dark:border-sky-900/40 dark:bg-sky-950/20'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-text-primary">
                        {String(selectedAsset.name)}
                      </div>
                      <Badge color={selectedAssetOrigin === 'THIRD_PARTY' ? 'amber' : 'blue'}>
                        {assetOriginLabel(selectedAssetOrigin || null)}
                      </Badge>
                      {selectedAsset.servicePlan === 'AMC' ? (
                        <Badge color="green">AMC</Badge>
                      ) : selectedAssetOrigin !== 'THIRD_PARTY' ? (
                        <Badge color="gray">Non-AMC</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      Stored machine details (read-only on this ticket). Origin comes from the product
                      record — not re-chosen here.
                    </p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <dt className="text-[11px] text-text-secondary">Type</dt>
                        <dd className="font-medium">
                          {selectedAsset.machineType
                            ? String(selectedAsset.machineType).replaceAll('_', ' ')
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Serial</dt>
                        <dd className="font-mono font-medium">
                          {selectedAsset.serialNo ? String(selectedAsset.serialNo) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Model</dt>
                        <dd className="font-medium">
                          {selectedAsset.model ? String(selectedAsset.model) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Capacity</dt>
                        <dd className="font-medium">
                          {selectedAsset.capacity ? String(selectedAsset.capacity) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Accuracy</dt>
                        <dd className="font-medium">
                          {selectedAsset.accuracy ? String(selectedAsset.accuracy) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Platform</dt>
                        <dd className="font-medium">
                          {selectedAsset.platformSize ? String(selectedAsset.platformSize) : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Last stamp</dt>
                        <dd className="font-medium">
                          {selectedAsset.stampingDate
                            ? formatDate(String(selectedAsset.stampingDate))
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] text-text-secondary">Stamping valid till</dt>
                        <dd className="font-semibold">
                          {selectedAsset.nextDueDate
                            ? formatDate(String(selectedAsset.nextDueDate))
                            : '—'}
                        </dd>
                      </div>
                      {selectedAssetOrigin !== 'THIRD_PARTY' ? (
                        <div>
                          <dt className="text-[11px] text-text-secondary">AMC period</dt>
                          <dd className="font-medium">
                            {selectedAsset.servicePlan === 'AMC'
                              ? [
                                  selectedAsset.amcStartDate
                                    ? formatDate(String(selectedAsset.amcStartDate))
                                    : null,
                                  selectedAsset.amcEndDate
                                    ? formatDate(String(selectedAsset.amcEndDate))
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' → ') || 'AMC (dates not set)'
                              : 'Non-AMC'}
                          </dd>
                        </div>
                      ) : (
                        <div className="sm:col-span-2 lg:col-span-3">
                          <p className="rounded-[8px] border border-amber-200/80 bg-card/60 px-2.5 py-1.5 text-xs text-amber-950 dark:border-amber-800 dark:text-amber-100">
                            Outside unit — brought for repair / stamping only (not sold by HMS).
                          </p>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              ) : null}
            </section>

            {isStampingJob && form.contactId && (form.newMachine || form.assetId) ? (
              <section className="grid gap-4 rounded-[12px] border border-violet-200/70 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-950/20 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                  <h3 className="text-sm font-semibold text-text-primary">4. Stamping visit context</h3>
                  <p className="text-xs text-text-secondary">
                    Read-only context for the engineer. New stamp date is entered when they complete
                    the job — not here.
                  </p>
                </div>
                {selectedAssetOrigin === 'THIRD_PARTY' ||
                (form.newMachine && form.origin === 'THIRD_PARTY') ? (
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <strong>Outside machine</strong> — customer came <strong>only for stamping /
                    verification</strong> (not sold by HMS). We stamp this unit and return it; no AMC
                    plan on create.
                  </div>
                ) : (
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                    <strong>Sold by us</strong> — renewal / re-stamp visit on an HMS-installed machine.
                  </div>
                )}
                {!form.newMachine && selectedAssetOrigin !== 'THIRD_PARTY' ? (
                  <div className="rounded-[8px] border border-border bg-card px-3 py-2 sm:col-span-2">
                    <div className="text-xs text-text-secondary">Stamping valid till</div>
                    <div className="text-base font-semibold text-text-primary">
                      {selectedAssetNextDue
                        ? formatDate(selectedAssetNextDue)
                        : 'Not on file — engineer will set next due after this visit'}
                    </div>
                    {selectedAssetLastStamp ? (
                      <div className="mt-1 text-xs text-text-secondary">
                        Last stamp on file: {formatDate(selectedAssetLastStamp)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {form.newMachine ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Select
                      label="Machine origin for this stamping visit *"
                      value={form.origin}
                      onChange={(e) => {
                        const origin = e.target.value
                        setForm({
                          ...form,
                          origin,
                          ...(origin === 'THIRD_PARTY'
                            ? { servicePlan: 'NON_AMC', amcStartDate: '', amcEndDate: '' }
                            : {}),
                        })
                      }}
                      options={[
                        {
                          value: 'THIRD_PARTY',
                          label: 'Outside — came only for stamping',
                        },
                        {
                          value: 'SOLD_BY_US',
                          label: 'Sold by us — renewal / re-stamp',
                        },
                      ]}
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            {formRequiresStamping && form.contactId && (form.newMachine || form.assetId) ? (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2 lg:col-span-4 space-y-1">
                  <h3 className="text-sm font-semibold text-text-primary">4. Weighing — stamp validity (optional)</h3>
                  <p className="text-xs text-text-secondary">
                    For repair/breakdown on weighing machines: show known <strong>valid till</strong>{' '}
                    if on file. Do not invent a new stamp date here unless you are correcting history.
                  </p>
                </div>
                {!form.newMachine && selectedAssetNextDue ? (
                  <div className="rounded-[8px] border border-border bg-card px-3 py-2 sm:col-span-2">
                    <div className="text-xs text-text-secondary">Stamping valid till (on machine)</div>
                    <div className="font-semibold">{formatDate(selectedAssetNextDue)}</div>
                  </div>
                ) : null}
                <Input
                  label="VC number (if known)"
                  value={form.vcNumber}
                  onChange={(e) => setForm({ ...form, vcNumber: e.target.value })}
                  placeholder="Verification certificate"
                />
                <Input
                  label="Plate no."
                  value={form.plateNo}
                  onChange={(e) => setForm({ ...form, plateNo: e.target.value })}
                />
              </section>
            ) : null}

            {!isDesk ? (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <h3 className="sm:col-span-2 lg:col-span-4 text-sm font-semibold text-text-primary">
                  {isStampingJob || formRequiresStamping ? '5. Payment' : '4. Payment'}
                </h3>
                <Input
                  label="Total payment ₹"
                  type="number"
                  value={form.paymentTotal}
                  onChange={(e) => setForm({ ...form, paymentTotal: e.target.value })}
                />
                <Input
                  label="Advance ₹"
                  type="number"
                  value={form.advanceAmount}
                  onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })}
                />
                <div className="rounded-[8px] border border-border bg-card px-3 py-2">
                  <div className="text-xs text-text-secondary">Balance (auto)</div>
                  <div className="text-lg font-bold text-accent-amber">
                    {formatCurrency(balancePreview)}
                  </div>
                </div>
              </section>
            ) : null}

            <section
              id="section-ticket-assign"
              className={`scroll-mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${sectionErrorClass(Boolean(fieldErrors.receivedByUserId || fieldErrors.description))}`}
            >
              <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">
                {isDesk
                  ? isStampingJob || formRequiresStamping
                    ? '5. Issue log'
                    : '4. Issue log'
                  : isStampingJob || formRequiresStamping
                    ? '6. Engineer, issue log & status'
                    : '5. Engineer, issue log & status'}
              </h3>
              {fieldErrors.receivedByUserId ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <MissingBanner message={fieldErrors.receivedByUserId} />
                </div>
              ) : null}
              {fieldErrors.description ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <MissingBanner message={fieldErrors.description} />
                </div>
              ) : null}
              {isStampingJob ? (
                <p className="sm:col-span-2 lg:col-span-3 -mt-1 text-xs text-text-secondary">
                  Suggested issue log: “Customer walk-in for government stamping / verification.”
                </p>
              ) : null}
              {canAssign ? (
                <>
                  <Select
                    label="Assign to (engineer) *"
                    value={form.receivedByUserId}
                    onChange={(e) => setForm({ ...form, receivedByUserId: e.target.value })}
                    options={[
                      {
                        value: '',
                        label: engineers.length
                          ? 'Select engineer'
                          : 'No service engineers — add in Users',
                      },
                      ...engineers.map((u) => ({
                        value: u.id,
                        label: u.phone ? `${u.name} · ${u.phone}` : u.name,
                      })),
                    ]}
                  />
                  <div>
                    <Select
                      label="Executive — delivered"
                      value={form.deliveredByUserId}
                      onChange={(e) => setForm({ ...form, deliveredByUserId: e.target.value })}
                      options={[
                        { value: '', label: 'Fill after delivery' },
                        ...engineers.map((u) => ({
                          value: u.id,
                          label: u.phone ? `${u.name} · ${u.phone}` : u.name,
                        })),
                      ]}
                    />
                    <p className="mt-1 text-xs text-text-secondary">
                      Optional now — set on the job after delivery.
                    </p>
                  </div>
                  <p className="sm:col-span-2 lg:col-span-3 -mt-1 text-xs text-text-secondary">
                    The selected engineer sees this job on Home and My tickets immediately.
                  </p>
                </>
              ) : (
                <p className="sm:col-span-2 lg:col-span-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                  Ticket will be created as <strong>OPEN</strong>. Admin assigns the service engineer
                  next.
                </p>
              )}
              <Select
                label="Priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({
                  value: v,
                  label: labelize(v),
                }))}
              />
              <label className="block text-sm sm:col-span-2 lg:col-span-3">
                <span className="mb-1 block font-medium text-text-secondary">Issue log *</span>
                <textarea
                  className={`min-h-24 w-full rounded-[8px] border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20 ${
                    fieldErrors.description ? 'border-red-500' : 'border-border'
                  }`}
                  value={form.description}
                  onChange={(e) => {
                    setForm({ ...form, description: e.target.value })
                    if (fieldErrors.description) {
                      setFieldErrors((prev) => {
                        const next = { ...prev }
                        delete next.description
                        return next
                      })
                    }
                  }}
                  placeholder="Customer complaint, symptoms, parts needed…"
                  required
                />
              </label>
            </section>
          </form>
        </FormPanel>
      )}

      <Modal
        open={Boolean(assignModal)}
        onClose={() => {
          setAssignModal(null)
          setAssignUserId('')
        }}
        accent="theme"
        size="sm"
        title={assignModal?.ticketNo ? `Assign ${assignModal.ticketNo}` : 'Assign engineer'}
        subtitle="Select a service engineer. Notify sends WhatsApp to the engineer (and updates the customer that work is in progress). Uses the mobile number on Users & Roles."
        icon={<WhatsAppIcon size={24} />}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setAssignModal(null)
                setAssignUserId('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={assignBusy || !assignUserId}
              onClick={() => void quickAssign(false)}
            >
              Assign only
            </Button>
            <Button
              disabled={assignBusy || !assignUserId}
              onClick={() => void quickAssign(true)}
              className="border-transparent text-white"
              style={{ backgroundColor: WA_GREEN }}
            >
              <WhatsAppIcon size={16} color="#fff" />
              {assignBusy ? 'Assigning…' : 'Assign & notify'}
            </Button>
          </>
        }
      >
        <Select
          label="Service engineer *"
          value={assignUserId}
          onChange={(e) => setAssignUserId(e.target.value)}
          options={[
            { value: '', label: engineers.length ? 'Select engineer…' : 'No service engineers — add in Users & Roles' },
            ...engineers.map((u) => ({
              value: u.id,
              label: u.phone ? `${u.name} · ${u.phone}` : u.name,
            })),
          ]}
        />
      </Modal>

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete job?' : `Delete ${confirm?.ids.length ?? 0} jobs?`}
        body={
          confirm?.ids.length === 1
            ? 'This service job will be permanently removed.'
            : 'Selected service jobs will be permanently removed.'
        }
      />

      <WhatsAppSendConfirm
        open={Boolean(waPending)}
        payload={waPending?.payload ?? null}
        busy={saving}
        onCancel={() => setWaPending(null)}
        onConfirmSend={() => {
          const run = waPending?.execute
          setWaPending(null)
          if (run) void run(true)
        }}
        onConfirmSkip={() => {
          const run = waPending?.execute
          setWaPending(null)
          if (run) void run(false)
        }}
      />
    </div>
  )
}

export default TicketsPage
