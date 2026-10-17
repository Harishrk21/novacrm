import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { CatalogMachinePick } from '@/components/contacts/CatalogMachinePick'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { indianMobileLocal, toStoredIndianMobile } from '@/lib/phoneIndia'
import { validateContactForm } from '@/lib/formValidation'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  DownloadIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { APP_NAME } from '@/lib/branding'
import {
  openPrintableServiceReport,
  serviceReportOptsFromTicket,
} from '@/lib/serviceReportPrint'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { useConfirmLeave, useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import {
  ASSET_ORIGIN_OPTIONS,
  assetOriginLabel,
  assetOriginShort,
  machineSourceTagsFromCf,
} from '@/lib/assetOrigin'
import {
  familyByCode,
  HMS_FAMILY_OPTIONS,
  industryOptions,
  machineOptions,
} from '@/lib/hmsCatalog'
import { assetRequiresStamping } from '@/lib/productCatalog'
import {
  hmsSoldCoverage,
  isWeighingMachine,
  stampQuarterFromDate,
  STAMP_QUARTERS,
} from '@/lib/hmsCoverage'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { isCompanyAdmin, isScopedEmployee, isServiceDesk, isServiceEngineer, canAssignTickets, canCreateTickets, filterServiceEngineers, type LookupUser } from '@/lib/roles'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { formatServiceId } from '@/lib/serviceId'
import { FlowStepBar } from '@/components/ui/FlowStepBar'
import { MissingBanner, focusFirstMissing, sectionErrorClass } from '@/components/ui/MissingField'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useFieldShell } from '@/hooks/useFieldShell'

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

const ADD_NEW_MACHINE = '__add_new__'

/** First step on create: Service / Stamping (Rental goes to /rentals). */
type CreateJobKind = '' | 'SERVICE' | 'STAMPING'

const QUICK_MACHINE_TYPES = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing machine' },
  { value: 'CCM', label: 'CCM' },
  { value: 'CCTV', label: 'CCTV' },
  { value: 'BIOMETRIC', label: 'Biometric' },
  { value: 'PAPER_SHREDDER', label: 'Paper shredder' },
  { value: 'PAPER_ROLL', label: 'Paper roll' },
  { value: 'OTHER', label: 'Other' },
]

const emptyQuickCustomer = {
  name: '',
  doorNo: '',
  street: '',
  buildingName: '',
  area: '',
  city: '',
  state: '',
  pincode: '',
  landmark: '',
  landline: '',
  mobile: '',
  mobile2: '',
  mobile3: '',
  whatsapp: '',
  email: '',
  gpsLocation: '',
  country: 'IN',
  description: '',
}

const emptyQuickMachine = {
  catalogProductId: '',
  stockType: '',
  brandId: '',
  machineType: 'WEIGHING',
  name: '',
  capacity: '',
  serialNo: '',
  model: '',
  origin: '' as '' | 'SOLD_BY_US' | 'THIRD_PARTY',
  servicePlan: 'GC',
  amcStartDate: '',
  amcEndDate: '',
  remindersEnabled: true,
}

/** Create-form sections — keeps the long drawer readable. */
type TicketFormTab = 'details' | 'customer' | 'machine' | 'payment' | 'assign'

const TICKET_SECTION_TAB: Record<string, TicketFormTab> = {
  'section-ticket-customer': 'customer',
  // Machine lives on the same wizard step as customer
  'section-ticket-machine': 'customer',
  'section-ticket-assign': 'assign',
}

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
  /** Set only after user picks Sold by us / Outside on add-new-machine */
  origin: '' as string,
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
  /** Stamping visit may also replace spare parts (logged on ticket after create). */
  alsoSpareParts: false,
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

function addOneYearIso(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function jobKindFromParams(params: URLSearchParams): CreateJobKind {
  const category = params.get('category')
  const job = params.get('job')
  if (category === 'Stamping' || job === 'stamping') return 'STAMPING'
  if (job === 'service' || (category && category !== 'Stamping')) return 'SERVICE'
  return ''
}

type TicketQueueId = 'all' | 'awaiting' | 'progress' | 'approval' | 'closed'

function parseTicketQueue(raw: string | null): TicketQueueId {
  if (raw === 'awaiting' || raw === 'progress' || raw === 'approval' || raw === 'closed') {
    return raw
  }
  return 'all'
}

export function TicketsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const fieldShell = useFieldShell()
  const isAdmin = isCompanyAdmin(authUser?.role)
  const isAgent = isScopedEmployee(authUser?.role)
  const isDesk = isServiceDesk(authUser?.role)
  const isEngineer = isServiceEngineer(authUser?.role)
  const canAssign = canAssignTickets(authUser?.role)
  const canCreate = canCreateTickets(authUser?.role)

  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [assets, setAssets] = useState<Record<string, unknown>[]>([])
  const [users, setUsers] = useState<LookupUser[]>([])
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [areaFilter, setAreaFilter] = useState(searchParams.get('area') ?? '')
  const [queue, setQueue] = useState<TicketQueueId>(() =>
    parseTicketQueue(searchParams.get('queue')),
  )
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [jobKind, setJobKind] = useState<CreateJobKind>(() => jobKindFromParams(searchParams))
  const [assignModal, setAssignModal] = useState<{ id: string; ticketNo?: string } | null>(null)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignBusy, setAssignBusy] = useState(false)
  const [form, setForm] = useState(emptyJob)
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  /** Soft in-form notice (no top-right toast) for validation / save issues */
  const [formGuide, setFormGuide] = useState<{ title: string; message: string } | null>(null)
  /** Existing machine on file vs add new under this customer */
  const [machinePath, setMachinePath] = useState<'' | 'existing' | 'new'>('')
  /** New-machine fields open in a popup (keeps ticket wizard uncluttered). */
  const [newMachineModalOpen, setNewMachineModalOpen] = useState(false)
  const [formTab, setFormTab] = useState<TicketFormTab>('details')
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false)
  const [quickCustomerBusy, setQuickCustomerBusy] = useState(false)
  const [quickCustomer, setQuickCustomer] = useState(emptyQuickCustomer)
  const [quickMachine, setQuickMachine] = useState(emptyQuickMachine)
  const [quickCustomerErrors, setQuickCustomerErrors] = useState<Record<string, string>>({})
  const [quickMachineError, setQuickMachineError] = useState('')
  const [catalogProducts, setCatalogProducts] = useState<
    Array<{ id: string; name: string; sku?: string; attributes?: Record<string, unknown> | null }>
  >([])
  const [catalogBrands, setCatalogBrands] = useState<Array<{ id: string; name: string }>>([])

  function friendlyTicketCreateError(err: unknown): { title: string; message: string } {
    if (err instanceof ApiClientError) {
      const m = err.message.toLowerCase()
      if (m.includes('contact')) {
        return {
          title: 'Customer needed',
          message: 'Please choose a customer from the list, or add a new one first.',
        }
      }
      if (m.includes('asset') || m.includes('machine')) {
        return {
          title: 'Machine needed',
          message: 'Please pick an existing machine or add a new one for this customer.',
        }
      }
      if (m.includes('assign') || m.includes('engineer') || m.includes('user')) {
        return {
          title: 'Engineer needed',
          message: 'Please assign a service engineer before saving.',
        }
      }
      if (m.includes('403') || m.includes('permission') || m.includes('forbidden')) {
        return {
          title: 'Not allowed',
          message: 'You don’t have permission to create this ticket. Ask an admin if you need access.',
        }
      }
      if (
        m.includes('prisma') ||
        m.includes('sql') ||
        m.includes('econn') ||
        m.includes('500') ||
        m.includes('internal') ||
        m.includes('timeout')
      ) {
        return {
          title: 'Couldn’t save just now',
          message: 'Something went wrong on our side. Please try again in a moment.',
        }
      }
      // Prefer short plain language over raw API dumps
      const clean = err.message.replace(/^Error:\s*/i, '').trim()
      if (clean.length > 0 && clean.length < 160 && !/[{\[]/.test(clean)) {
        return { title: 'Please check the form', message: clean }
      }
    }
    return {
      title: 'Couldn’t create the ticket',
      message: 'Please review the steps below and try again.',
    }
  }

  const engineers = useMemo(() => filterServiceEngineers(users), [users])

  const load = useCallback(async () => {
    try {
      const [res, lookups] = await Promise.all([
        api.tickets({
          limit: 100,
          sort: 'newest',
          status: status || undefined,
          area: areaFilter.trim() || undefined,
          contactId: searchParams.get('contactId') || undefined,
          slaBreached: searchParams.get('slaBreached') || undefined,
          ...(isAgent ? { mine: 1, ...(isServiceEngineer(authUser?.role) ? { claimable: 1 } : {}) } : {}),
        }),
        api.lookups({ scope: 'core' }),
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
  }, [addToast, authUser?.id, authUser?.role, areaFilter, isAdmin, isAgent, searchParams, status])

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
        // No machines on file → open add-machine popup (origin + product)
        if (items.length === 0) {
          setMachinePath('new')
          setNewMachineModalOpen(true)
          setForm((f) =>
            f.contactId === contactId && !f.assetId
              ? {
                  ...f,
                  newMachine: true,
                  origin: '',
                  servicePlan: 'NON_AMC',
                }
              : f,
          )
        } else {
          // Customer has machines — default to picking an existing one
          setMachinePath((prev) => (prev === 'new' ? 'new' : 'existing'))
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

  // Keep queue chips in sync with Sidebar / bookmark URLs (?queue=…)
  useEffect(() => {
    setQueue(parseTicketQueue(searchParams.get('queue')))
  }, [searchParams])

  function selectQueue(id: TicketQueueId) {
    setQueue(id)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id === 'all') next.delete('queue')
        else next.set('queue', id)
        return next
      },
      { replace: true },
    )
  }

  // Admin / desk / engineer: quiet list poll so Mark complete shows up for desk
  useEffect(() => {
    if ((!isAdmin && !isDesk && !isServiceEngineer(authUser?.role)) || tab !== 'list') return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load()
    }, 45_000)
    return () => window.clearInterval(id)
  }, [isAdmin, isDesk, authUser?.role, tab, load])

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
    const useQueue = isAdmin || isDesk
    const rows =
      !useQueue || queue === 'all'
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
  }, [tickets, queue, isAdmin, isDesk])

  const ticketIds = useMemo(() => displayedTickets.map((t) => String(t.id)), [displayedTickets])
  const selection = useRowSelection(ticketIds)

  async function quickAssign() {
    if (!assignModal || !assignUserId) return
    setAssignBusy(true)
    try {
      const eng = engineers.find((u) => u.id === assignUserId)
      // WhatsApp assign notify off for now
      await api.updateTicket(assignModal.id, {
        assignedToId: assignUserId,
        receivedByUserId: assignUserId,
        status: 'IN_PROGRESS',
        sendWhatsApp: false,
      })
      addToast({
        type: 'success',
        message: `Assigned ${eng?.name ?? 'engineer'} — status In progress`,
      })
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
    // Stamping visit: never copy historical stamp dates into "this visit" fields
    const stampingVisit =
      jobKind === 'STAMPING' || form.category === 'Stamping'
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
      stampingDate: stampingVisit
        ? ''
        : a.stampingDate
          ? String(a.stampingDate).slice(0, 10)
          : '',
      nextDueDate: stampingVisit
        ? ''
        : a.nextDueDate
          ? String(a.nextDueDate).slice(0, 10)
          : '',
      servicePlan: a.servicePlan ? String(a.servicePlan) : 'NON_AMC',
      amcStartDate: a.amcStartDate ? String(a.amcStartDate).slice(0, 10) : '',
      amcEndDate: a.amcEndDate ? String(a.amcEndDate).slice(0, 10) : '',
      origin,
      remindersEnabled: a.remindersEnabled !== false,
      warrantyType: cf.warrantyType ? String(cf.warrantyType) : f.warrantyType || 'NGC',
      warrantyUntil: cf.warrantyUntil ? String(cf.warrantyUntil).slice(0, 10) : '',
      vcNumber: cf.vcNumber ? String(cf.vcNumber) : '',
      stampingQuarter: stampingVisit
        ? ''
        : cf.stampingQuarter
          ? String(cf.stampingQuarter)
          : a.stampingDate || a.nextDueDate
            ? stampQuarterFromDate(
                a.stampingDate
                  ? String(a.stampingDate)
                  : a.nextDueDate
                    ? String(a.nextDueDate)
                    : null,
              )
            : '',
      plateNo: cf.plateNo ? String(cf.plateNo) : '',
      verificationClass: cf.verificationClass ? String(cf.verificationClass) : '',
      alsoSpareParts: false,
    }))
  }

  useEffect(() => {
    const contactId = searchParams.get('contactId')
    const assetId = searchParams.get('assetId')
    const category = searchParams.get('category')
    const machine = searchParams.get('machine')
    const leadId = searchParams.get('leadId')
    const shouldOpen = searchParams.get('open') === '1'
    const kind = jobKindFromParams(searchParams)
    if (kind) setJobKind(kind)
    if (machine === 'new') {
      setMachinePath('new')
      setNewMachineModalOpen(true)
      setForm((f) => ({ ...f, newMachine: true, origin: '', assetId: '' }))
    } else if (machine === 'existing' || assetId) {
      setMachinePath('existing')
      setNewMachineModalOpen(false)
      setForm((f) => ({ ...f, newMachine: false }))
    }
    if (contactId) {
      setForm((f) => ({
        ...f,
        contactId,
        assetId: assetId || f.assetId,
        ...(category ? { category } : kind === 'STAMPING' ? { category: 'Stamping' } : {}),
        ...(kind === 'STAMPING' && !f.description.trim()
          ? {
              description: leadId
                ? 'From intake — government stamping / verification.'
                : 'Customer walk-in for government stamping / verification.',
            }
          : kind === 'SERVICE' && leadId && !f.description.trim()
            ? { description: 'From intake — service job. Log the customer complaint below.' }
            : {}),
      }))
      void loadAssets(contactId)
      void api
        .getContact(contactId)
        .then((c) => {
          setPickedContact({
            id: String(c.id),
            name: String(c.name ?? ''),
            phone: c.phone ? String(c.phone) : null,
            email: c.email ? String(c.email) : null,
            customerCode: c.customerCode ? String(c.customerCode) : null,
          } as ContactPick)
        })
        .catch(() => {
          /* ignore */
        })
    } else if (category) {
      setForm((f) => ({ ...f, category }))
    } else if (kind === 'STAMPING') {
      setForm((f) => ({
        ...f,
        category: 'Stamping',
        ...(f.description.trim()
          ? {}
          : { description: 'Customer walk-in for government stamping / verification.' }),
      }))
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
      setMachinePath('')
      setNewMachineModalOpen(false)
      setFormGuide(null)
      setFieldErrors((fe) => {
        const next = { ...fe }
        delete next.contactId
        return next
      })
      setForm((f) => ({
        ...f,
        contactId: c?.id ?? '',
        assetId: '',
        newMachine: false,
        familyCode: 'WEIGHING_SCALES',
        industryCode: '',
        machineSku: '',
        machineName: '',
        ...(jobKind === 'STAMPING' && !f.description.trim()
          ? { description: 'Customer walk-in for government stamping / verification.' }
          : {}),
      }))
      if (c?.id) void loadAssets(c.id)
      else setAssets([])
    },
    [jobKind, loadAssets],
  )

  function chooseMachinePath(path: 'existing' | 'new') {
    setMachinePath(path)
    setFormGuide(null)
    if (path === 'new') {
      const switchingIn = machinePath !== 'new'
      setForm((f) => ({
        ...f,
        newMachine: true,
        assetId: '',
        // Drop any stamp / product fields copied from a previously selected existing machine
        ...(switchingIn
          ? {
              origin: '',
              servicePlan: 'NON_AMC',
              machineName: '',
              serialNo: '',
              familyCode: 'WEIGHING_SCALES',
              industryCode: '',
              machineSku: '',
              capacity: '',
              accuracy: '',
              platformSize: '',
              model: '',
              stampingDate: '',
              nextDueDate: '',
              stampingQuarter: '',
              vcNumber: '',
              plateNo: '',
              verificationClass: '',
              alsoSpareParts: false,
            }
          : {}),
      }))
      setNewMachineModalOpen(true)
    } else {
      setNewMachineModalOpen(false)
      setForm((f) => ({
        ...f,
        newMachine: false,
        assetId: '',
        machineName: '',
        origin: '',
        stampingDate: '',
        nextDueDate: '',
        stampingQuarter: '',
        vcNumber: '',
        plateNo: '',
        alsoSpareParts: false,
      }))
    }
    setFieldErrors((fe) => {
      const next = { ...fe }
      delete next.assetId
      return next
    })
  }

  function confirmNewMachineDraft() {
    if (form.origin !== 'SOLD_BY_US' && form.origin !== 'THIRD_PARTY') {
      setFormGuide({
        title: 'Machine origin needed',
        message: 'Choose Sold by us or Outside in the form.',
      })
      return
    }
    if (!form.machineName.trim()) {
      setFormGuide({
        title: 'Machine name needed',
        message: 'Enter the machine / product name before continuing.',
      })
      return
    }
    if (newMachineNeedsIndustry && !form.industryCode) {
      setFormGuide({
        title: 'Industry needed',
        message: 'Pick the industry, then the machine model.',
      })
      return
    }
    setFormGuide(null)
    setFieldErrors((fe) => {
      const next = { ...fe }
      delete next.assetId
      return next
    })
    setNewMachineModalOpen(false)
  }

  function chooseNewMachineOrigin(origin: 'SOLD_BY_US' | 'THIRD_PARTY') {
    setFormGuide(null)
    setForm((f) => ({
      ...f,
      origin,
      servicePlan: origin === 'THIRD_PARTY' ? 'NON_AMC' : f.servicePlan || 'NON_AMC',
      amcStartDate: origin === 'THIRD_PARTY' ? '' : f.amcStartDate,
      amcEndDate: origin === 'THIRD_PARTY' ? '' : f.amcEndDate,
    }))
    setFieldErrors((fe) => {
      const next = { ...fe }
      delete next.assetId
      return next
    })
  }

  function openQuickAddCustomer(query: string) {
    const digits = query.replace(/\D/g, '')
    const looksPhone = digits.length >= 7
    setQuickCustomer({
      ...emptyQuickCustomer,
      name: looksPhone ? '' : query.trim(),
      mobile: looksPhone ? indianMobileLocal(query) : '',
    })
    setQuickMachine({ ...emptyQuickMachine })
    setQuickCustomerErrors({})
    setQuickMachineError('')
    setQuickCustomerOpen(true)
    void (async () => {
      try {
        const [prods, brands] = await Promise.all([
          api.products({ limit: 200 }),
          api.inventoryBrands(),
        ])
        setCatalogProducts(
          (prods.items ?? []).map((p) => ({
            id: String(p.id),
            name: String(p.name ?? ''),
            sku: p.sku ? String(p.sku) : undefined,
            attributes: (p.attributes as Record<string, unknown> | null) ?? null,
          })),
        )
        const brandRows = Array.isArray(brands) ? brands : []
        setCatalogBrands(
          brandRows.map((b) => ({
            id: String(b.id),
            name: String(b.name ?? ''),
          })),
        )
      } catch {
        /* catalog optional for Outside path */
      }
    })()
  }

  function patchQuickMachine(next: Partial<typeof emptyQuickMachine>) {
    setQuickMachine((prev) => ({ ...prev, ...next }))
    setQuickMachineError('')
  }

  async function submitQuickAddCustomer() {
    const nextErrors = validateContactForm({
      name: quickCustomer.name,
      email: quickCustomer.email,
      phone: quickCustomer.landline || quickCustomer.mobile,
      mobile: quickCustomer.mobile,
      mobile2: quickCustomer.mobile2,
      mobile3: quickCustomer.mobile3,
      whatsapp: quickCustomer.whatsapp,
      pincode: quickCustomer.pincode,
      country: quickCustomer.country || 'IN',
    })
    setQuickCustomerErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    if (quickMachine.origin !== 'SOLD_BY_US' && quickMachine.origin !== 'THIRD_PARTY') {
      setQuickMachineError('Choose Sold by us or Outside before saving.')
      return
    }
    if (quickMachine.origin === 'SOLD_BY_US') {
      if (!quickMachine.stockType || !quickMachine.brandId || !quickMachine.catalogProductId) {
        setQuickMachineError('Sold by us — select machine type, brand, and model.')
        return
      }
    } else if (!quickMachine.name.trim()) {
      setQuickMachineError('Enter the machine / product name.')
      return
    }

    setQuickCustomerBusy(true)
    try {
      const mobileStored = toStoredIndianMobile(quickCustomer.mobile)
      const waStored = toStoredIndianMobile(quickCustomer.whatsapp) || mobileStored
      const created = (await api.createContact({
        name: quickCustomer.name.trim(),
        email: quickCustomer.email.trim() || null,
        phone: quickCustomer.landline.trim() || mobileStored || waStored,
        mobile: mobileStored,
        street: quickCustomer.street.trim() || null,
        doorNo: quickCustomer.doorNo.trim() || null,
        area: quickCustomer.area.trim() || null,
        pincode: quickCustomer.pincode.trim() || null,
        location: quickCustomer.landmark.trim() || null,
        city: quickCustomer.city.trim() || null,
        state: quickCustomer.state.trim() || null,
        country: quickCustomer.country.trim() || 'IN',
        description: quickCustomer.description.trim() || null,
        customFields: {
          building_name: quickCustomer.buildingName.trim() || null,
          landline: quickCustomer.landline.trim() || null,
          mobile_2: toStoredIndianMobile(quickCustomer.mobile2),
          mobile_3: toStoredIndianMobile(quickCustomer.mobile3),
          whatsapp: waStored,
          gps_location: quickCustomer.gpsLocation.trim() || null,
        },
      })) as Record<string, unknown>

      const soldByUs = quickMachine.origin === 'SOLD_BY_US'
      const weighing = isWeighingMachine(quickMachine.machineType)
      const coverage = soldByUs ? hmsSoldCoverage(new Date(), weighing) : null
      const stampingNow = jobKind === 'STAMPING' || form.category === 'Stamping'
      const serviceNow = jobKind === 'SERVICE' && !stampingNow
      const machineTags: string[] = []
      if (!soldByUs) machineTags.push('Outside')
      if (stampingNow) machineTags.push('Stamping')
      else if (serviceNow) machineTags.push('Service new')

      const machine = (await api.createAsset({
        contactId: String(created.id),
        machineType: quickMachine.machineType,
        name: quickMachine.name.trim(),
        capacity: quickMachine.capacity || null,
        serialNo: quickMachine.serialNo || null,
        model: quickMachine.model || null,
        origin: quickMachine.origin,
        servicePlan: soldByUs
          ? quickMachine.servicePlan === 'AMC'
            ? 'AMC'
            : 'GC'
          : quickMachine.servicePlan === 'AMC'
            ? 'AMC'
            : 'NON_AMC',
        warrantyEndDate: soldByUs ? coverage?.warrantyEndDate ?? null : null,
        amcStartDate:
          quickMachine.servicePlan === 'AMC' ? quickMachine.amcStartDate || null : null,
        amcEndDate: quickMachine.servicePlan === 'AMC' ? quickMachine.amcEndDate || null : null,
        // Stamping walk-in: do not stamp the register at registration — wait for Save stamp result
        nextDueDate: stampingNow ? null : weighing ? coverage?.nextDueDate || null : null,
        stampingDate: stampingNow ? null : weighing ? coverage?.stampingDate || null : null,
        remindersEnabled: quickMachine.remindersEnabled,
        customFields: {
          ...(quickMachine.catalogProductId
            ? { catalogProductId: quickMachine.catalogProductId }
            : {}),
          ...(quickMachine.brandId
            ? {
                brandId: quickMachine.brandId,
                brandName:
                  catalogBrands.find((b) => b.id === quickMachine.brandId)?.name ?? null,
              }
            : {}),
          ...(quickMachine.stockType ? { catalogFamily: quickMachine.stockType } : {}),
          ...(machineTags.length ? { machineTags } : {}),
          ...(serviceNow ? { serviceNew: true, visitPurpose: 'SERVICE' } : {}),
          ...(stampingNow
            ? {
                visitPurpose: 'STAMPING',
                cameOnlyForStamping: !soldByUs,
              }
            : {}),
          ...(coverage && !stampingNow
            ? {
                soldAt: coverage.soldAt,
                stampingQuarter: coverage.stampingQuarter,
                stampingQuarterYear: coverage.stampingQuarterYear,
              }
            : {}),
          ...(coverage && stampingNow ? { soldAt: coverage.soldAt } : {}),
        },
      })) as Record<string, unknown>

      const pick: ContactPick = {
        id: String(created.id),
        name: String(created.name ?? quickCustomer.name.trim()),
        customerCode: created.customerCode ? String(created.customerCode) : null,
        phone: created.phone ? String(created.phone) : mobileStored,
        mobile: created.mobile ? String(created.mobile) : mobileStored,
        email: created.email ? String(created.email) : quickCustomer.email.trim() || null,
      }

      setQuickCustomerOpen(false)
      setPickedContact(pick)
      setMachinePath('existing')
      setAssets([machine])
      setForm((f) => ({
        ...f,
        contactId: pick.id,
        assetId: String(machine.id),
        newMachine: false,
        ...(jobKind === 'STAMPING' && !f.description.trim()
          ? { description: 'Customer walk-in for government stamping / verification.' }
          : {}),
      }))
      applyAssetToForm(machine)
      setFieldErrors((fe) => {
        const next = { ...fe }
        delete next.contactId
        delete next.assetId
        return next
      })
      setFormGuide({
        title: 'Customer & machine added',
        message: 'They’re selected on this ticket. Continue with the issue log when ready.',
      })
    } catch (err) {
      setQuickCustomerErrors({
        name:
          err instanceof ApiClientError
            ? err.message
            : 'Couldn’t save this customer. Please try again.',
      })
    } finally {
      setQuickCustomerBusy(false)
    }
  }

  const balancePreview = useMemo(() => {
    const pay = Number(form.paymentTotal) || 0
    const adv = Number(form.advanceAmount) || 0
    return Math.max(0, pay - adv)
  }, [form.advanceAmount, form.paymentTotal])

  const isStampingJob = jobKind === 'STAMPING' || form.category === 'Stamping'
  const isServiceJob = jobKind === 'SERVICE' && !isStampingJob
  const ticketFormTabs = useMemo(() => {
    const tabs: Array<{ id: TicketFormTab; label: string }> = [
      { id: 'details', label: isStampingJob ? 'Channel' : 'Details' },
      { id: 'customer', label: 'Customer & machine' },
    ]
    if (!isDesk) tabs.push({ id: 'payment', label: 'Payment' })
    // Assign is off on create — ticket stays OPEN; first engineer to Accept wins
    tabs.push({ id: 'assign', label: 'Issue log' })
    return tabs
  }, [isStampingJob, isDesk])

  const createFlowSteps = useMemo(
    () => [
      ...ticketFormTabs.map((t) => ({
        key: t.id,
        label: t.label,
        hint:
          t.id === 'details'
            ? isStampingJob
              ? 'How it arrived'
              : 'Service type'
            : t.id === 'customer'
              ? 'Shop + machine'
              : t.id === 'payment'
                ? 'Optional now'
                : 'Complaint note',
      })),
      {
        key: 'pool',
        label: 'Open pool',
        hint: 'First Accept wins',
      },
    ],
    [ticketFormTabs, isStampingJob],
  )

  const createFlowDone = useMemo(() => {
    const tabDone = ticketFormTabs.map((t) => {
      if (t.id === 'details') return formTab !== 'details' || Boolean(form.channel)
      if (t.id === 'customer')
        return (
          Boolean(form.contactId) &&
          (Boolean(form.assetId) ||
            (form.newMachine &&
              Boolean(form.machineName.trim()) &&
              (form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY')))
        )
      if (t.id === 'payment') return formTab === 'assign' || Boolean(form.description.trim())
      if (t.id === 'assign') return Boolean(form.description.trim())
      return false
    })
    // Last step (Open pool) completes only after create — always false here
    return [...tabDone, false]
  }, [
    ticketFormTabs,
    formTab,
    form.channel,
    form.contactId,
    form.assetId,
    form.newMachine,
    form.machineName,
    form.origin,
    form.description,
  ])
  const createReturnTo =
    jobKind === 'STAMPING'
      ? '/tickets?open=1&job=stamping&category=Stamping'
      : '/tickets?open=1&job=service'

  const createOpen = tab === 'create'
  const createLeaveReason =
    'You have a new ticket form open. Leaving will discard your changes.'
  useDiscardGuard(createOpen && canCreate, createLeaveReason)
  const { requestLeave: requestLeaveCreate, dialog: createDiscardDialog } = useConfirmLeave(
    createOpen && canCreate,
    createLeaveReason,
  )

  function closeCreateForm() {
    requestLeaveCreate(() => {
      setTab('list')
      resetCreate()
    })
  }

  const createTitle = !jobKind
    ? 'New job — choose type'
    : isStampingJob
      ? 'New stamping job'
      : 'New service ticket'
  const createSubtitle = !jobKind
    ? 'Pick Service, Stamping, or Rental.'
    : isStampingJob
      ? 'Customer → machine → issue. Creates OPEN — first engineer to Accept gets the job.'
      : 'Customer → machine → issue. Creates OPEN — first engineer to Accept gets the job.'
  const createStepIndex = Math.max(
    0,
    ticketFormTabs.findIndex((t) => t.id === formTab),
  )
  const createOnLastStep =
    Boolean(jobKind) && createStepIndex >= ticketFormTabs.length - 1
  const createPrimaryLabel = saving
    ? 'Saving…'
    : isDesk
      ? isStampingJob
        ? 'Create stamping job'
        : 'Create ticket'
      : 'Save job'
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
    setJobKind('')
    setMachinePath('')
    setFormTab('details')
    setForm({ ...emptyJob, receivedByUserId: authUser?.id || '' })
    setPickedContact(null)
    setAssets([])
    setFieldErrors({})
    setFormGuide(null)
  }

  function selectJobKind(kind: CreateJobKind) {
    setJobKind(kind)
    setMachinePath('')
    setFormTab('details')
    setFormGuide(null)
    setFieldErrors({})
    if (kind === 'STAMPING') {
      setForm((f) => ({
        ...f,
        category: 'Stamping',
        origin: '',
        servicePlan: 'NON_AMC',
        amcStartDate: '',
        amcEndDate: '',
        description: f.description.trim()
          ? f.description
          : 'Customer walk-in for government stamping / verification.',
      }))
    } else if (kind === 'SERVICE') {
      setForm((f) => ({
        ...f,
        category: f.category === 'Stamping' ? 'Breakdown' : f.category || 'Breakdown',
        origin: '',
        servicePlan: 'NON_AMC',
      }))
    }
  }

  function pickMachineFromDropdown(value: string) {
    setFormGuide(null)
    if (value === ADD_NEW_MACHINE) {
      setMachinePath('new')
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
        origin: '',
        servicePlan: 'NON_AMC',
        amcStartDate: '',
        amcEndDate: '',
      }))
      return
    }
    setMachinePath('existing')
    setFieldErrors((fe) => {
      const next = { ...fe }
      delete next.assetId
      return next
    })
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
    if (!jobKind) {
      setFormGuide({
        title: 'Choose a job type',
        message: 'Select Service or Stamping to continue. Rentals open in a separate section.',
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const machineOk = form.newMachine
      ? (form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY') &&
        Boolean(form.machineName.trim()) &&
        Boolean(form.familyCode) &&
        (!newMachineNeedsIndustry || Boolean(form.industryCode))
      : Boolean(form.assetId)
    const checks = [
      {
        key: 'contactId',
        sectionId: 'section-ticket-customer',
        ok: Boolean(form.contactId),
        message: 'Search and select the customer (shop) for this job.',
      },
      {
        key: 'assetId',
        sectionId: 'section-ticket-machine',
        ok: Boolean(machinePath) && machineOk,
        message: !machinePath
          ? 'Choose an existing machine on file, or add a new machine for this visit.'
          : form.newMachine
            ? form.origin !== 'SOLD_BY_US' && form.origin !== 'THIRD_PARTY'
              ? 'Choose Sold by us or Outside before adding the machine.'
              : newMachineNeedsIndustry && !form.industryCode
                ? 'Pick the industry, then the machine model / name.'
                : 'Enter the machine product or name so the job can be tracked.'
            : 'Select which machine from the list above.',
      },
      {
        key: 'description',
        sectionId: 'section-ticket-assign',
        ok: Boolean(form.description.trim()),
        message: 'Write a short note on what the customer needs or what’s wrong.',
      },
    ]
    const firstMissing = checks.find((c) => !c.ok)
    if (firstMissing) {
      const tabForErr = TICKET_SECTION_TAB[firstMissing.sectionId]
      if (tabForErr) setFormTab(tabForErr)
    }
    const ok = focusFirstMissing(checks, setFieldErrors, { ring: 'sky' })
    if (!ok) {
      const label =
        firstMissing?.key === 'contactId'
          ? 'Customer'
          : firstMissing?.key === 'assetId'
            ? 'Machine'
            : firstMissing?.key === 'description'
              ? 'Issue log'
            : 'This step'
      setFormGuide({
        title: `${label} still needs a detail`,
        message:
          firstMissing?.message ??
          'Fill in the highlighted step, then try Create again.',
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setFormGuide(null)
    // WhatsApp on create is off for now — create ticket directly
    void doCreateJob(false)
  }

  async function doCreateJob(sendWhatsApp: boolean) {
    setSaving(true)
    try {
      let assetId = form.assetId || null
      // Only create a machine when explicitly adding a new one — never re-create an existing selection
      if (form.newMachine || (!assetId && form.machineName.trim())) {
        if (!form.machineName.trim()) {
          setFormTab('customer')
          setMachinePath('new')
          setNewMachineModalOpen(true)
          setFormGuide({
            title: 'Machine details needed',
            message: 'Enter the machine name in the form, or pick an existing machine.',
          })
          setSaving(false)
          return
        }
        const fam = familyByCode(form.familyCode)
        const ind = fam?.industries?.find((i) => i.code === form.industryCode)
        const originForNew =
          form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY'
            ? form.origin
            : ''
        if (!originForNew) {
          setFormTab('customer')
          setMachinePath('new')
          setNewMachineModalOpen(true)
          setFormGuide({
            title: 'Machine origin needed',
            message: 'Choose Sold by us or Outside in the add-machine form.',
          })
          setSaving(false)
          return
        }
        const machineTags: string[] = []
        if (originForNew === 'THIRD_PARTY') machineTags.push('Outside')
        if (isStampingJob) machineTags.push('Stamping')
        else if (isServiceJob) machineTags.push('Service new')
        const machine = await api.createAsset({
          contactId: form.contactId,
          machineType: form.machineType,
          name: form.machineName.trim(),
          capacity: form.capacity || null,
          accuracy: form.accuracy || null,
          platformSize: form.platformSize || null,
          model: form.model || null,
          serialNo: form.serialNo || null,
          origin: originForNew,
          servicePlan: originForNew === 'THIRD_PARTY' ? 'NON_AMC' : form.servicePlan,
          amcStartDate:
            originForNew !== 'THIRD_PARTY' && form.servicePlan === 'AMC'
              ? form.amcStartDate || null
              : null,
          amcEndDate:
            originForNew !== 'THIRD_PARTY' && form.servicePlan === 'AMC'
              ? form.amcEndDate || null
              : null,
          remindersEnabled: form.remindersEnabled,
          stampingDate: isStampingJob ? form.stampingDate || null : null,
          nextDueDate: isStampingJob
            ? form.nextDueDate ||
              (form.stampingDate ? addOneYearIso(form.stampingDate) : null)
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
            machineTags: [...machineTags],
            serviceNew: isServiceJob,
            ...(isStampingJob
              ? {
                  visitPurpose: 'STAMPING',
                  cameOnlyForStamping: originForNew === 'THIRD_PARTY',
                }
              : {
                  visitPurpose: 'SERVICE',
                }),
          },
        })
        assetId = String(machine.id)
      }

      if (!assetId) {
        setFormTab('customer')
        setFormGuide({
          title: 'Machine needed',
          message: 'Select an existing machine for this customer, or add a new one.',
        })
        setSaving(false)
        return
      }

      // Enrich existing machine — stamping jobs may update stamp date / next due / quarter now
      if (
        assetId &&
        !form.newMachine &&
        (form.vcNumber ||
          form.stampingQuarter ||
          form.plateNo ||
          form.verificationClass ||
          (isStampingJob && (form.stampingDate || form.nextDueDate)))
      ) {
        const existing = assets.find((a) => String(a.id) === assetId)
        const prevCf = (existing?.customFields as Record<string, unknown> | undefined) ?? {}
        const nextDue =
          form.nextDueDate ||
          (form.stampingDate ? addOneYearIso(form.stampingDate) : null)
        await api.updateAsset(assetId, {
          ...(isStampingJob
            ? {
                stampingDate: form.stampingDate || null,
                nextDueDate: nextDue,
              }
            : {}),
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

      const ticketCategory = isStampingJob ? 'Stamping' : form.category
      const subjectPrefix = isStampingJob ? 'Stamping' : 'Service'
      const existingAsset = assets.find((a) => String(a.id) === assetId)
      const originForJob = form.newMachine
        ? form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY'
          ? form.origin
          : 'THIRD_PARTY'
        : existingAsset?.origin
          ? String(existingAsset.origin)
          : 'SOLD_BY_US'

      // Always OPEN + unassigned — first engineer to Accept claims the job
      const created = await api.createTicket({
        subject: `${subjectPrefix} — ${machineLabel}`,
        description: form.description.trim(),
        priority: form.priority,
        status: 'OPEN',
        contactId: form.contactId,
        assetId,
        // Stamping: optional stamp date / next due at create (editable again on ticket)
        stampingDate: isStampingJob ? form.stampingDate || null : null,
        nextDueDate: isStampingJob
          ? form.nextDueDate ||
            (form.stampingDate ? addOneYearIso(form.stampingDate) : null)
          : null,
        odAmount: 0,
        paymentTotal: isDesk ? 0 : Number(form.paymentTotal) || 0,
        advanceAmount: isDesk ? 0 : Number(form.advanceAmount) || 0,
        assignedToId: null,
        receivedByUserId: null,
        deliveredByUserId: null,
        category: ticketCategory,
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
          ...(searchParams.get('leadId')
            ? { fromLeadId: searchParams.get('leadId') }
            : {}),
          ...(isStampingJob
            ? {
                visitPurpose: 'STAMPING',
                machineOrigin: originForJob,
                cameOnlyForStamping: originForJob === 'THIRD_PARTY',
                alsoSpareParts: Boolean(form.alsoSpareParts),
                outsideStamping:
                  originForJob === 'THIRD_PARTY'
                    ? 'Outside machine — customer came only for stamping / verification'
                    : 'Sold by us — renewal / re-stamp visit',
              }
            : { visitPurpose: 'SERVICE' }),
        },
      })

      const intakeLeadId = searchParams.get('leadId')
      if (intakeLeadId && created.id) {
        try {
          await api.linkLeadTicket(intakeLeadId, String(created.id))
        } catch {
          /* ticket still valid — link is best-effort */
        }
      }

      setTab('list')
      resetCreate()
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev)
        n.delete('open')
        n.delete('assetId')
        n.delete('job')
        n.delete('category')
        n.delete('leadId')
        n.delete('contactId')
        n.delete('machine')
        return n
      })
      addToast({
        type: 'success',
        message: isStampingJob
          ? 'Stamping job OPEN — first engineer to Accept gets it.'
          : 'Ticket OPEN — first engineer to Accept gets the job.',
      })
      if (created.id) {
        navigate(`/tickets/${String(created.id)}`)
        return
      }
      await load()
    } catch (err) {
      setFormGuide(friendlyTicketCreateError(err))
      window.scrollTo({ top: 0, behavior: 'smooth' })
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
      {createDiscardDialog}
      <PageHeader
        title={
          tab === 'create'
            ? createTitle
            : isAdmin
              ? 'Service jobs'
              : isDesk
                ? 'Service desk tickets'
                : 'My tickets'
        }
        count={tab === 'list' ? tickets.length : undefined}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          {
            label: isAdmin ? 'Service tickets' : isDesk ? 'Tickets' : 'My tickets',
            to: '/tickets',
          },
          ...(tab === 'create' ? [{ label: 'New ticket' }] : []),
        ]}
        actions={
          tab === 'create' ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => closeCreateForm()}>
                Back to list
              </Button>
              {createOnLastStep ? (
                <Button
                  size="sm"
                  type="submit"
                  form="service-job-form"
                  disabled={saving}
                  onClick={(e) => {
                    const formEl = document.getElementById(
                      'service-job-form',
                    ) as HTMLFormElement | null
                    if (formEl && typeof formEl.requestSubmit === 'function') {
                      e.preventDefault()
                      formEl.requestSubmit()
                    }
                  }}
                >
                  {createPrimaryLabel}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      {tab === 'list' ? (
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
            label: isAdmin || isDesk
              ? 'All tickets'
              : isServiceEngineer(authUser?.role)
                ? 'My jobs & open pool'
                : 'Assigned to me',
            count: tickets.length,
          },
          ...(canCreate ? [{ id: 'create', label: 'New ticket' }] : []),
        ]}
      />
      ) : null}

      {tab === 'list' ? (
        <>
          {isAdmin || isDesk ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {(
                [
                  { id: 'all', label: 'All', count: queueCounts.all },
                  { id: 'awaiting', label: 'Awaiting Accept', count: queueCounts.awaiting },
                  { id: 'progress', label: 'In progress', count: queueCounts.progress },
                  { id: 'approval', label: 'Pending approval', count: queueCounts.approval },
                  { id: 'closed', label: 'Closed', count: queueCounts.closed },
                ] as const
              ).map((q) => (
                <Button
                  key={q.id}
                  size="sm"
                  variant={queue === q.id ? 'primary' : 'outline'}
                  onClick={() => selectQueue(q.id)}
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
            {isAdmin || isDesk ? (
              <Input
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                placeholder="Filter by area…"
                className="w-48"
              />
            ) : null}
          </div>

          <Card padding={false}>
            {displayedTickets.length === 0 ? (
              <EmptyState
                title={
                  isAdmin || isDesk
                    ? queue === 'awaiting'
                      ? 'No tickets awaiting Accept'
                      : queue === 'approval'
                        ? 'No tickets pending approval'
                        : 'No service jobs in this queue'
                    : isServiceEngineer(authUser?.role)
                      ? 'No open jobs in your pool'
                      : 'No jobs assigned to you'
                }
                subtitle={
                  isAdmin || isDesk
                    ? 'Create an OPEN ticket — engineers Accept from the pool. Desk marks complete, collects payment, and closes.'
                    : isServiceEngineer(authUser?.role)
                      ? 'Open jobs appear here and in Workqueue → Open to accept. Tap Accept before another engineer takes it.'
                      : 'When a ticket is assigned to you, it shows up here from the live database.'
                }
                actionLabel={canCreate ? 'New ticket' : undefined}
                onAction={canCreate ? () => setTab('create') : undefined}
              />
            ) : (
              <div className="p-4 pt-3">
                {isAdmin && selection.someSelected && !fieldShell ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="job"
                    busy={busyDelete}
                    onClear={selection.clear}
                    onDelete={() => setConfirm({ ids: selection.selectedIds })}
                  />
                ) : null}
                {fieldShell && isEngineer ? (
                  <div className="space-y-2.5">
                    {displayedTickets.map((ticket) => {
                      const id = String(ticket.id)
                      const contact = ticket.contact as {
                        id?: string
                        name?: string
                        customerCode?: string
                        area?: string
                      } | null
                      const contactId =
                        contact?.id != null
                          ? String(contact.id)
                          : ticket.contactId != null
                            ? String(ticket.contactId)
                            : ''
                      const st = String(ticket.status)
                      const unassigned = !ticket.assignedToId
                      const serviceId = formatServiceId(ticket.ticketNo as number | string)
                      const area =
                        contact?.area ||
                        (ticket.customFields as { serviceArea?: string } | null)?.serviceArea ||
                        ''
                      return (
                        <div
                          key={id}
                          className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[15px] font-semibold text-text-primary">
                                {serviceId} — {String(ticket.subject ?? 'Job')}
                              </div>
                              <div className="mt-1 text-[13px] text-text-secondary">
                                {contactId ? (
                                  <Link
                                    to={`/contacts/${contactId}`}
                                    className="text-accent-blue hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {contact?.name ?? 'Customer'}
                                  </Link>
                                ) : (
                                  (contact?.name ?? 'Customer')
                                )}
                                {area ? ` · ${area}` : ''}
                              </div>
                            </div>
                            <Badge color={st === 'OPEN' ? 'amber' : st === 'RESOLVED' ? 'green' : 'blue'}>
                              {labelize(st)}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-col gap-2">
                            {unassigned && st === 'OPEN' ? (
                              <Button
                                className="min-h-12 w-full text-base"
                                onClick={() => {
                                  void (async () => {
                                    try {
                                      await api.claimTicket(id)
                                      addToast({ type: 'success', message: 'Job accepted' })
                                      navigate(`/tickets/${id}`)
                                    } catch (e) {
                                      addToast({
                                        type: 'error',
                                        message:
                                          e instanceof ApiClientError
                                            ? e.message
                                            : 'Already taken',
                                      })
                                      await load()
                                    }
                                  })()
                                }}
                              >
                                Accept job
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              className="min-h-11 w-full"
                              onClick={() => navigate(`/tickets/${id}`)}
                            >
                              Open job
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
                <div className={cn('overflow-x-auto', fieldShell && isEngineer && 'hidden')}>
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
                          'Created',
                          'Closed',
                          'Customer',
                          'Area',
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
                        const contact = ticket.contact as {
                          id?: string
                          name?: string
                          customerCode?: string
                          area?: string
                        } | null
                        const contactId =
                          contact?.id != null
                            ? String(contact.id)
                            : ticket.contactId != null
                              ? String(ticket.contactId)
                              : ''
                        const asset = ticket.asset as { name?: string; servicePlan?: string } | null
                        const st = String(ticket.status)
                        const paySt = String(ticket.paymentStatus ?? 'UNPAID')
                        const unassigned = !ticket.assignedToId
                        const serviceId = formatServiceId(ticket.ticketNo as number | string)
                        const area =
                          contact?.area ||
                          (ticket.customFields as { serviceArea?: string } | null)?.serviceArea ||
                          ''
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
                            <td className="whitespace-nowrap px-3 py-3 text-xs text-text-secondary">
                              {ticket.createdAt ? formatDate(String(ticket.createdAt)) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-xs text-text-secondary">
                              {ticket.closedAt ? formatDate(String(ticket.closedAt)) : '—'}
                            </td>
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              {contactId ? (
                                <Link
                                  to={`/contacts/${contactId}`}
                                  className="font-medium text-accent-blue hover:underline"
                                >
                                  {contact?.name ?? '—'}
                                </Link>
                              ) : (
                                <div className="font-medium">{contact?.name ?? '—'}</div>
                              )}
                              <div className="font-mono text-[11px] text-text-secondary">
                                {contact?.customerCode ?? ''}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-text-secondary">{area || '—'}</td>
                            <td className="max-w-[160px] px-3 py-3">{asset?.name ?? String(ticket.subject)}</td>
                            <td className="px-3 py-3">
                              {unassigned ? (
                                <Badge color="amber">
                                  {st === 'OPEN' ? 'Open to accept' : 'Unassigned'}
                                </Badge>
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
                              <Badge color={ticketStatusColor[st] ?? 'gray'} solid>
                                {labelize(st)}
                              </Badge>
                            </td>
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                <ViewIconButton onClick={() => navigate(`/tickets/${id}`)} />
                                {st === 'CLOSED' ? (
                                  <DownloadIconButton
                                    label="Download service report"
                                    onClick={() => {
                                      const opts = serviceReportOptsFromTicket(
                                        ticket as Record<string, unknown>,
                                        APP_NAME,
                                      )
                                      if (!opts) {
                                        addToast({
                                          type: 'error',
                                          message:
                                            'No service report on this ticket yet — open it and create the report first.',
                                        })
                                        return
                                      }
                                      const ok = openPrintableServiceReport(opts)
                                      if (!ok) {
                                        addToast({
                                          type: 'error',
                                          message: 'Allow pop-ups to download / print the report',
                                        })
                                      }
                                    }}
                                  />
                                ) : null}
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
                                {isServiceEngineer(authUser?.role) && unassigned && st === 'OPEN' ? (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      void (async () => {
                                        try {
                                          await api.claimTicket(id)
                                          addToast({ type: 'success', message: 'Job accepted' })
                                          await load()
                                          navigate(`/tickets/${id}`)
                                        } catch (e) {
                                          addToast({
                                            type: 'error',
                                            message:
                                              e instanceof ApiClientError
                                                ? e.message
                                                : 'Already taken',
                                          })
                                          await load()
                                        }
                                      })()
                                    }}
                                  >
                                    Accept
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
        <div className="space-y-4">
          <form id="service-job-form" onSubmit={(e) => void createJob(e)} className="space-y-4">
            {formGuide ? (
              <MissingBanner
                tone="guide"
                title={formGuide.title}
                message={formGuide.message}
                className="shadow-sm"
              />
            ) : null}

            {!jobKind ? (
              <Card className="overflow-hidden border-border/80 p-0 shadow-sm">
                <div className="border-b border-border bg-gradient-to-br from-sky-50/80 via-card to-card px-4 py-3.5 sm:px-5 dark:from-sky-950/30">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                    Step 1 · Job type
                  </p>
                  <h2 className="mt-0.5 text-base font-semibold tracking-tight text-text-primary">
                    What kind of job is this?
                  </h2>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-secondary">
                    Service and Stamping stay here; Rental opens Rentals.
                  </p>
                </div>
                <div className="grid gap-2.5 p-3.5 sm:grid-cols-3 sm:p-4">
                  {(
                    [
                      {
                        id: 'SERVICE' as const,
                        title: 'Service',
                        body: 'Repair, breakdown, installation, or AMC visit.',
                      },
                      {
                        id: 'STAMPING' as const,
                        title: 'Stamping',
                        body: 'Same as service + stamp date, next due, quarter; spares optional.',
                      },
                      {
                        id: 'RENTAL' as const,
                        title: 'Rental',
                        body: 'Opens Rentals (not a service ticket).',
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        if (opt.id === 'RENTAL') {
                          resetCreate()
                          setTab('list')
                          navigate('/rentals?open=1')
                          return
                        }
                        selectJobKind(opt.id)
                      }}
                      className="group rounded-xl border border-border bg-card px-3.5 py-3 text-left transition hover:border-accent-blue/50 hover:bg-muted/20"
                    >
                      <div className="text-sm font-semibold text-text-primary group-hover:text-accent-blue">
                        {opt.title}
                      </div>
                      <p className="mt-1 text-xs leading-snug text-text-secondary">{opt.body}</p>
                    </button>
                  ))}
                </div>
              </Card>
            ) : (
              <>
                <Card className="overflow-hidden border-border/80 p-0 shadow-sm">
                  <div
                    className={cn(
                      'border-b border-border px-4 py-3.5 sm:px-5',
                      isStampingJob
                        ? 'bg-gradient-to-br from-violet-50/90 via-card to-card dark:from-violet-950/25'
                        : 'bg-gradient-to-br from-sky-50/90 via-card to-card dark:from-sky-950/25',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                          {isStampingJob ? 'Stamping job' : 'Service ticket'} · Step{' '}
                          {createStepIndex + 1} of {ticketFormTabs.length}
                        </p>
                        <h2 className="mt-0.5 text-base font-semibold tracking-tight text-text-primary">
                          {ticketFormTabs.find((t) => t.id === formTab)?.label ?? 'Details'}
                        </h2>
                        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-text-secondary">
                          {createSubtitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-[11px] font-medium text-accent-blue hover:underline"
                        onClick={() => {
                          setJobKind('')
                          setFieldErrors({})
                          setFormGuide(null)
                        }}
                      >
                        Change type
                      </button>
                    </div>

                    <div className="mt-3 rounded-xl border border-border/70 bg-card/80 px-2 py-2.5">
                      <FlowStepBar
                        steps={createFlowSteps}
                        doneFlags={createFlowDone}
                        onStepClick={(index, step) => {
                          if (step.key === 'pool') {
                            setFormTab('assign')
                            setFormGuide(null)
                            return
                          }
                          if (ticketFormTabs.some((t) => t.id === step.key)) {
                            setFormTab(step.key as TicketFormTab)
                            setFormGuide(null)
                          }
                        }}
                      />
                      <p className="mt-2 px-1 text-center text-[11px] text-text-secondary">
                        After create → <strong className="text-text-primary">OPEN pool</strong> ·
                        first engineer to <strong className="text-text-primary">Accept</strong> gets
                        the job
                      </p>
                    </div>
                  </div>

                  <div className="px-4 py-4 sm:px-5">

            {formTab === 'details' ? (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <p className="sm:col-span-2 lg:col-span-3 text-xs text-text-secondary">
                {isStampingJob
                  ? 'How did this stamping request arrive?'
                  : 'What kind of service visit is this?'}
              </p>
              {isServiceJob ? (
                <Select
                  label="Service type *"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  options={[
                    { value: 'Breakdown', label: 'Breakdown / repair' },
                    { value: 'Installation', label: 'Installation' },
                    { value: 'AMC visit', label: 'AMC visit' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />
              ) : (
                <div className="rounded-[8px] border border-violet-200/80 bg-violet-50/80 px-3 py-2 text-xs text-violet-950 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-100 sm:col-span-2 lg:col-span-3">
                  Stamping job — same flow as service (customer → machine → payment → issue). On the
                  next step you can edit <strong>stamp date</strong>, <strong>next due</strong>, and{' '}
                  <strong>quarter</strong>, and mark if spare parts are also needed.
                </div>
              )}
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
            </section>
            ) : null}

            {formTab === 'customer' || formTab === 'machine' ? (
            <>
            <section
              id="section-ticket-customer"
              className={`scroll-mt-24 space-y-3 rounded-xl border border-emerald-200/70 bg-emerald-50/20 p-3.5 sm:p-4 dark:border-emerald-900/40 dark:bg-emerald-950/15 ${sectionErrorClass(Boolean(fieldErrors.contactId), 'guide')}`}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-200">
                  1 · Customer
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Find the shop first. Machine choice opens in its own step below.
                </p>
              </div>
              {fieldErrors.contactId ? (
                <MissingBanner tone="guide" title="Customer" message={fieldErrors.contactId} />
              ) : null}
              <ContactPicker
                label="Search customer / shop *"
                valueId={form.contactId}
                selected={pickedContact}
                onSelect={onPickContact}
                returnTo={createReturnTo}
                onAddNew={({ query }) => openQuickAddCustomer(query)}
              />
              <p className="-mt-1 text-[11px] text-text-secondary">
                Not listed? Use <strong>Add new customer</strong> in the dropdown.
              </p>
              {pickedContact && form.contactId ? (
                <div className="rounded-lg border border-emerald-200/80 bg-card px-2.5 py-2 text-xs text-emerald-950 dark:border-emerald-900/40 dark:text-emerald-100">
                  <span className="font-semibold">{pickedContact.name}</span>
                  {pickedContact.customerCode ? (
                    <span className="ml-2 font-mono text-[11px] opacity-80">
                      {pickedContact.customerCode}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-[11px] opacity-80">
                    {assets.length > 0
                      ? `${assets.length} machine${assets.length === 1 ? '' : 's'} on file — choose in step 2.`
                      : 'No machines on file — add one in step 2.'}
                  </span>
                </div>
              ) : null}
            </section>

            {form.contactId ? (
            <section
              id="section-ticket-machine"
              className={`scroll-mt-24 mt-4 grid gap-3 rounded-xl border p-3.5 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 ${
                isStampingJob
                  ? 'border-violet-200/80 bg-violet-50/25 dark:border-violet-900/45 dark:bg-violet-950/20'
                  : 'border-sky-200/80 bg-sky-50/25 dark:border-sky-900/45 dark:bg-sky-950/20'
              } ${sectionErrorClass(Boolean(fieldErrors.assetId), 'guide')}`}
            >
              {fieldErrors.assetId ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <MissingBanner tone="guide" title="Machine" message={fieldErrors.assetId} />
                </div>
              ) : null}
              <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p
                      className={cn(
                        'text-[11px] font-semibold uppercase tracking-[0.12em]',
                        isStampingJob
                          ? 'text-violet-800 dark:text-violet-200'
                          : 'text-sky-800 dark:text-sky-200',
                      )}
                    >
                      2 · Machine
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      Pick an existing unit, or open the add-machine form (popup).
                    </p>
                  </div>
                  {machinePath ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        machinePath === 'new'
                          ? 'bg-violet-600 text-white'
                          : 'bg-sky-600 text-white',
                      )}
                    >
                      <span aria-hidden>✓</span>
                      You chose:{' '}
                      {machinePath === 'existing'
                        ? 'Existing machine'
                        : isStampingJob
                          ? 'New machine for stamping'
                          : 'Add new machine'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      Tap one option below
                    </span>
                  )}
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3 grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => chooseMachinePath('existing')}
                  disabled={assets.length === 0}
                  aria-pressed={machinePath === 'existing'}
                  className={cn(
                    'relative rounded-xl border-2 px-3.5 py-3 text-left transition',
                    machinePath === 'existing'
                      ? 'border-sky-500 bg-sky-50 shadow-sm ring-2 ring-sky-500/25 dark:bg-sky-950/40'
                      : assets.length === 0
                        ? 'cursor-not-allowed border-border bg-muted/40 opacity-55'
                        : 'border-border bg-card hover:border-sky-400/60',
                    machinePath && machinePath !== 'existing' && 'opacity-55',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                        machinePath === 'existing'
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-border bg-card text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">
                          Existing machine
                        </span>
                        {machinePath === 'existing' ? (
                          <Badge color="blue" solid>
                            Selected
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-secondary">
                        {assets.length > 0
                          ? `${assets.length} on file — pick from the list below.`
                          : 'None saved for this customer yet.'}
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => chooseMachinePath('new')}
                  aria-pressed={machinePath === 'new'}
                  className={cn(
                    'relative rounded-xl border-2 px-3.5 py-3 text-left transition',
                    machinePath === 'new'
                      ? 'border-violet-500 bg-violet-50 shadow-sm ring-2 ring-violet-500/30 dark:bg-violet-950/40'
                      : 'border-border bg-card hover:border-violet-400/60',
                    machinePath && machinePath !== 'new' && 'opacity-55',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                        machinePath === 'new'
                          ? 'border-violet-600 bg-violet-600 text-white'
                          : 'border-border bg-card text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">
                          {isStampingJob ? 'New machine for stamping' : 'Add new machine'}
                        </span>
                        {machinePath === 'new' ? (
                          <Badge color="purple" solid>
                            Selected
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-secondary">
                        Opens a form popup — origin, product, then use on this ticket.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
              {machinePath === 'existing' ? (
                <>
                  {assets.length > 0 ? (
                    <div className="sm:col-span-2 lg:col-span-3 grid gap-2 sm:grid-cols-2">
                      {assets.map((a, index) => {
                        const id = String(a.id)
                        const selected = form.assetId === id && !form.newMachine
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => pickMachineFromDropdown(id)}
                            className={`rounded-lg border px-3 py-2.5 text-left transition ${
                              selected
                                ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/25'
                                : 'border-border bg-card hover:border-accent-blue/40'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className={cn(
                                  'mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold tabular-nums',
                                  selected
                                    ? 'bg-accent-blue text-white'
                                    : 'bg-muted text-text-secondary',
                                )}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-text-primary">
                                  {index + 1}. {String(a.name)}
                                </div>
                                <p className="mt-0.5 text-[11px] text-text-secondary">
                                  {[
                                    a.serialNo ? `S/N ${String(a.serialNo)}` : null,
                                    assetOriginShort(a.origin ? String(a.origin) : null),
                                    a.servicePlan === 'AMC' ? 'AMC' : null,
                                    a.nextDueDate
                                      ? `valid till ${formatDate(String(a.nextDueDate).slice(0, 10))}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="sm:col-span-2 lg:col-span-3 text-xs text-amber-800 dark:text-amber-200">
                      This customer has no machines yet. Choose <strong>Add new machine</strong>.
                    </p>
                  )}
                </>
              ) : null}

              {machinePath === 'new' ? (
                <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-dashed border-violet-300/80 bg-card p-3.5 dark:border-violet-800/50">
                  {(form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY') &&
                  form.machineName.trim() ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                          New machine ready for this ticket
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-text-primary">
                            {form.machineName.trim()}
                          </span>
                          <Badge color={form.origin === 'THIRD_PARTY' ? 'amber' : 'blue'} solid>
                            {assetOriginShort(form.origin)}
                          </Badge>
                          {isStampingJob ? <Badge color="purple">Stamping</Badge> : null}
                          {isServiceJob ? <Badge color="orange">Service new</Badge> : null}
                        </div>
                        <p className="text-[11px] text-text-secondary">
                          {[
                            form.serialNo ? `S/N ${form.serialNo}` : null,
                            form.model || null,
                            form.capacity || null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Saved on this customer when you create the ticket.'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setNewMachineModalOpen(true)}
                      >
                        Edit in form
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-text-primary">
                          Add machine details in the form
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-secondary">
                          Origin (Sold by us / Outside) and product fields open in a popup — not
                          mixed into this step.
                        </p>
                      </div>
                      <Button type="button" size="sm" onClick={() => setNewMachineModalOpen(true)}>
                        Open add-machine form
                      </Button>
                    </div>
                  )}
                </div>
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
                      {machineSourceTagsFromCf(
                        (selectedAsset.customFields as Record<string, unknown> | undefined) ?? null,
                      ).map((tag) => (
                        <Badge
                          key={tag}
                          color={tag === 'Service new' ? 'orange' : tag === 'Stamping' ? 'purple' : 'amber'}
                        >
                          {tag}
                        </Badge>
                      ))}
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
            ) : (
              <p className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-5 text-center text-sm text-text-secondary">
                Search and select a customer above — their machines will show here so you can pick
                one or add a new machine for this visit.
              </p>
            )}

            {isStampingJob &&
            form.contactId &&
            ((machinePath === 'existing' && Boolean(form.assetId) && !form.newMachine) ||
              (machinePath === 'new' &&
                form.newMachine &&
                !newMachineModalOpen &&
                (form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY') &&
                Boolean(form.machineName.trim()))) ? (
              <section className="mt-4 grid gap-3 rounded-xl border border-violet-200/70 bg-violet-50/40 p-3 dark:border-violet-900/40 dark:bg-violet-950/20 sm:grid-cols-2 sm:p-3.5 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                  <h3 className="text-sm font-semibold text-text-primary">
                    Stamping date · next due · quarter
                  </h3>
                  <p className="text-xs text-text-secondary">
                    {form.newMachine
                      ? `For the new machine “${form.machineName.trim()}”. Optional now — can fill after verification on the ticket.`
                      : 'For the existing machine selected above. Leave blank to fill after verification on the ticket.'}
                  </p>
                </div>
                {form.newMachine && form.origin === 'THIRD_PARTY' ? (
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <strong>Outside machine</strong> — came only for stamping / verification (not sold
                    by HMS). Will be saved under this customer when you create the ticket.
                  </div>
                ) : form.newMachine && form.origin === 'SOLD_BY_US' ? (
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                    <strong>Sold by us</strong> — new unit registered for this stamping visit.
                  </div>
                ) : !form.newMachine && selectedAssetOrigin === 'THIRD_PARTY' ? (
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <strong>Outside machine</strong> — came only for stamping / verification (not sold
                    by HMS).
                  </div>
                ) : !form.newMachine && selectedAssetOrigin === 'SOLD_BY_US' ? (
                  <div className="sm:col-span-2 lg:col-span-3 rounded-[8px] border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                    <strong>Sold by us</strong> — renewal / re-stamp
                    {selectedAssetLastStamp
                      ? ` · last stamp ${formatDate(selectedAssetLastStamp)}`
                      : ''}
                    {selectedAssetNextDue
                      ? ` · valid till was ${formatDate(selectedAssetNextDue)}`
                      : ''}
                  </div>
                ) : null}
                <Input
                  label="Stamping date (this visit)"
                  type="date"
                  value={form.stampingDate}
                  onChange={(e) => {
                    const stampingDate = e.target.value
                    setForm((f) => ({
                      ...f,
                      stampingDate,
                      nextDueDate: stampingDate
                        ? f.nextDueDate || addOneYearIso(stampingDate)
                        : f.nextDueDate,
                      stampingQuarter: stampingDate
                        ? f.stampingQuarter || stampQuarterFromDate(stampingDate)
                        : f.stampingQuarter,
                    }))
                  }}
                />
                <Input
                  label="Next due / valid till"
                  type="date"
                  value={form.nextDueDate}
                  onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))}
                />
                <Select
                  label="Quarter stamped now"
                  value={form.stampingQuarter}
                  onChange={(e) => setForm((f) => ({ ...f, stampingQuarter: e.target.value }))}
                  options={[
                    { value: '', label: 'Select quarter…' },
                    ...STAMP_QUARTERS.map((q) => ({
                      value: q.code,
                      label: `Quarter ${q.code} · ${q.months}`,
                    })),
                  ]}
                />
                <Input
                  label="VC number"
                  value={form.vcNumber}
                  onChange={(e) => setForm((f) => ({ ...f, vcNumber: e.target.value }))}
                  placeholder="Verification certificate"
                />
                <Input
                  label="Plate no."
                  value={form.plateNo}
                  onChange={(e) => setForm((f) => ({ ...f, plateNo: e.target.value }))}
                />
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 sm:col-span-2 lg:col-span-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border"
                    checked={Boolean(form.alsoSpareParts)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, alsoSpareParts: e.target.checked }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-text-primary">
                      Also spare parts on this visit (2-in-1)
                    </span>
                    <span className="mt-0.5 block text-[11px] text-text-secondary">
                      Same ticket — log spare part changes on the job after create (Spares panel).
                      Payment stays on this ticket.
                    </span>
                  </span>
                </label>
              </section>
            ) : null}

            {formRequiresStamping && form.contactId && (form.newMachine || form.assetId) ? (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2 lg:col-span-4 space-y-1">
                  <h3 className="text-sm font-semibold text-text-primary">
                    Weighing — stamp validity (optional)
                  </h3>
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
            </>
            ) : null}

            {formTab === 'payment' && !isDesk ? (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <h3 className="sm:col-span-2 lg:col-span-4 text-sm font-semibold text-text-primary">
                  Payment
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

            {formTab === 'assign' ? (
            <section
              id="section-ticket-assign"
              className={`scroll-mt-24 grid gap-3 rounded-xl border border-border/80 bg-muted/10 p-3 sm:grid-cols-2 sm:p-3.5 lg:grid-cols-3 ${sectionErrorClass(Boolean(fieldErrors.description), 'guide')}`}
            >
              {fieldErrors.description ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <MissingBanner
                    tone="guide"
                    title="Issue log"
                    message={fieldErrors.description}
                  />
                </div>
              ) : null}
              <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                  After create → OPEN pool · first Accept wins
                </p>
                <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-100/80">
                  No engineer is assigned now. The ticket stays <strong>OPEN</strong> until an
                  engineer taps <strong>Accept</strong> (Workqueue / tickets list). Admin can still
                  assign later if needed.
                </p>
                <div className="mt-3 rounded-lg border border-border/60 bg-card/90 px-2 py-2">
                  <FlowStepBar
                    steps={[
                      { key: 'created', label: 'Created', hint: 'OPEN' },
                      { key: 'accept', label: 'Accept', hint: 'First wins' },
                      { key: 'work', label: 'In progress', hint: 'On site' },
                      { key: 'done', label: 'Complete', hint: 'Desk closes' },
                    ]}
                    doneFlags={[false, false, false, false]}
                  />
                </div>
              </div>
              {isStampingJob ? (
                <p className="sm:col-span-2 lg:col-span-3 -mt-1 text-xs text-text-secondary">
                  Suggested issue log: “Customer walk-in for government stamping / verification.”
                </p>
              ) : null}
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
                    fieldErrors.description ? 'border-sky-400' : 'border-border'
                  }`}
                  value={form.description}
                  onChange={(e) => {
                    setForm({ ...form, description: e.target.value })
                    setFormGuide(null)
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
            ) : null}

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5">
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        disabled={createStepIndex <= 0}
                        onClick={() => {
                          if (createStepIndex > 0) {
                            setFormTab(ticketFormTabs[createStepIndex - 1]!.id)
                            setFormGuide(null)
                          }
                        }}
                      >
                        Back
                      </Button>
                      {!createOnLastStep ? (
                        <Button
                          size="sm"
                          type="button"
                          onClick={() => {
                            if (createStepIndex < ticketFormTabs.length - 1) {
                              setFormTab(ticketFormTabs[createStepIndex + 1]!.id)
                              setFormGuide(null)
                            }
                          }}
                        >
                          Next
                        </Button>
                      ) : (
                        <Button size="sm" type="submit" disabled={saving}>
                          {createPrimaryLabel}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </>
            )}
          </form>
        </div>
      )}


      <Modal
        open={newMachineModalOpen}
        onClose={() => setNewMachineModalOpen(false)}
        accent={isStampingJob ? 'violet' : 'sky'}
        size="xl"
        title={isStampingJob ? 'Add machine for stamping' : 'Add new machine'}
        subtitle="Step 1: origin · Step 2: product details. Used on this ticket and saved under the customer."
        footer={
          <>
            <Button variant="outline" onClick={() => setNewMachineModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => confirmNewMachineDraft()}>
              Use machine on ticket
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                1 · Machine origin *
              </p>
              {form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY' ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white',
                    form.origin === 'THIRD_PARTY' ? 'bg-amber-600' : 'bg-sky-600',
                  )}
                >
                  You chose: {assetOriginLabel(form.origin)}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Required
                </span>
              )}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {ASSET_ORIGIN_OPTIONS.map((opt) => {
                const selected = form.origin === opt.value
                const outside = opt.value === 'THIRD_PARTY'
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => chooseNewMachineOrigin(opt.value)}
                    aria-pressed={selected}
                    className={cn(
                      'rounded-xl border-2 px-3.5 py-3 text-left transition',
                      selected &&
                        outside &&
                        'border-amber-500 bg-amber-50 shadow-sm ring-2 ring-amber-500/30 dark:bg-amber-950/40',
                      selected &&
                        !outside &&
                        'border-sky-500 bg-sky-50 shadow-sm ring-2 ring-sky-500/25 dark:bg-sky-950/40',
                      !selected && 'border-border bg-card hover:border-sky-400/50',
                      form.origin && !selected && 'opacity-55',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold',
                          selected && outside && 'border-amber-600 bg-amber-600 text-white',
                          selected && !outside && 'border-sky-600 bg-sky-600 text-white',
                          !selected && 'border-border bg-card text-transparent',
                        )}
                      >
                        ✓
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-text-primary">{opt.label}</span>
                          {selected ? (
                            <Badge color={outside ? 'amber' : 'blue'} solid>
                              Selected
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{opt.hint}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {form.origin === 'SOLD_BY_US' || form.origin === 'THIRD_PARTY' ? (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                  2 · Product details
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Fill model and name. Saved on this customer when you create the ticket.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
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
                  className={newMachineNeedsIndustry ? undefined : 'sm:col-span-2'}
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
                  className="sm:col-span-2"
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
                  className="sm:col-span-2"
                />
                {form.origin === 'SOLD_BY_US' ? (
                  <>
                    <Select
                      label="Service plan"
                      value={form.servicePlan}
                      onChange={(e) => setForm({ ...form, servicePlan: e.target.value })}
                      options={[
                        { value: 'NON_AMC', label: 'GC / NGC (no AMC)' },
                        ...(isWeighingMachine(form.machineType)
                          ? [{ value: 'AMC', label: 'AMC — weighing only' }]
                          : []),
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
                  <p className="sm:col-span-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
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
              </div>
            </section>
          ) : (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-text-secondary">
              Choose <strong>Sold by us</strong> or <strong>Outside</strong> above to unlock product
              fields.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={quickCustomerOpen}
        onClose={() => !quickCustomerBusy && setQuickCustomerOpen(false)}
        accent="theme"
        size="2xl"
        title="Add customer + machine"
        subtitle="Same fields as New customer — shop details and machine (Sold by us / Outside). Saved and selected on this ticket."
        footer={
          <>
            <Button
              variant="outline"
              disabled={quickCustomerBusy}
              onClick={() => setQuickCustomerOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={quickCustomerBusy} onClick={() => void submitQuickAddCustomer()}>
              {quickCustomerBusy ? 'Saving…' : 'Save & use on ticket'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {Object.keys(quickCustomerErrors).length > 0 || quickMachineError ? (
            <MissingBanner
              tone="guide"
              title="Please check"
              message={
                quickMachineError ||
                quickCustomerErrors.mobile ||
                quickCustomerErrors.phone ||
                quickCustomerErrors.name ||
                quickCustomerErrors.email ||
                quickCustomerErrors.pincode ||
                'Fill the required customer and machine fields.'
              }
            />
          ) : null}

          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
              1. Customer / shop
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="Company / shop / customer name *"
                value={quickCustomer.name}
                error={quickCustomerErrors.name}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, name: e.target.value }))}
                placeholder="HMS ENTERPRISES"
                className="sm:col-span-2 lg:col-span-3"
                autoFocus
              />
              <Input
                label="Door number"
                value={quickCustomer.doorNo}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, doorNo: e.target.value }))}
              />
              <Input
                label="Street"
                value={quickCustomer.street}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, street: e.target.value }))}
              />
              <Input
                label="Building name"
                value={quickCustomer.buildingName}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, buildingName: e.target.value }))}
              />
              <Input
                label="Area"
                value={quickCustomer.area}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, area: e.target.value }))}
              />
              <Input
                label="City"
                value={quickCustomer.city}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, city: e.target.value }))}
              />
              <Input
                label="State"
                value={quickCustomer.state}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, state: e.target.value }))}
              />
              <Input
                label="PIN code"
                value={quickCustomer.pincode}
                error={quickCustomerErrors.pincode}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, pincode: e.target.value }))}
              />
              <Input
                label="Landmark"
                value={quickCustomer.landmark}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, landmark: e.target.value }))}
                className="sm:col-span-2"
              />
              <Input
                label="Landline number"
                value={quickCustomer.landline}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, landline: e.target.value }))}
                placeholder="Optional landline"
              />
              <PhoneInput
                label="Mobile number 1"
                required
                value={quickCustomer.mobile}
                error={quickCustomerErrors.mobile || quickCustomerErrors.phone}
                onChange={(mobile) => setQuickCustomer((f) => ({ ...f, mobile }))}
                hint="India (+91) — enter 10 digits only"
              />
              <PhoneInput
                label="Mobile number 2"
                value={quickCustomer.mobile2}
                error={quickCustomerErrors.mobile2}
                onChange={(mobile2) => setQuickCustomer((f) => ({ ...f, mobile2 }))}
              />
              <PhoneInput
                label="Mobile number 3"
                value={quickCustomer.mobile3}
                error={quickCustomerErrors.mobile3}
                onChange={(mobile3) => setQuickCustomer((f) => ({ ...f, mobile3 }))}
              />
              <PhoneInput
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <WhatsAppIcon size={14} />
                    <span style={{ color: WA_GREEN }}>WhatsApp number</span>
                  </span>
                }
                value={quickCustomer.whatsapp}
                error={quickCustomerErrors.whatsapp}
                onChange={(whatsapp) => setQuickCustomer((f) => ({ ...f, whatsapp }))}
                hint="Defaults to mobile 1 if empty"
              />
              <Input
                label="Email ID"
                type="email"
                value={quickCustomer.email}
                error={quickCustomerErrors.email}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, email: e.target.value }))}
              />
              <Input
                label="GPS location"
                value={quickCustomer.gpsLocation}
                onChange={(e) => setQuickCustomer((f) => ({ ...f, gpsLocation: e.target.value }))}
                placeholder="Maps link or lat,long"
                className="sm:col-span-2 lg:col-span-3"
              />
              <label className="block text-sm sm:col-span-2 lg:col-span-3">
                <span className="mb-1 block font-medium text-text-secondary">Notes</span>
                <textarea
                  className="min-h-20 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  value={quickCustomer.description}
                  onChange={(e) =>
                    setQuickCustomer((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
              2. Machine / product
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ASSET_ORIGIN_OPTIONS.map((opt) => {
                const selected = quickMachine.origin === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      patchQuickMachine({
                        origin: opt.value,
                        servicePlan:
                          opt.value === 'SOLD_BY_US'
                            ? quickMachine.servicePlan === 'NON_AMC'
                              ? 'GC'
                              : quickMachine.servicePlan || 'GC'
                            : quickMachine.servicePlan === 'GC'
                              ? 'NON_AMC'
                              : quickMachine.servicePlan || 'NON_AMC',
                      })
                    }
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left transition',
                      selected
                        ? opt.value === 'THIRD_PARTY'
                          ? 'border-amber-500 bg-amber-50/80 ring-1 ring-amber-400/40 dark:bg-amber-950/30'
                          : 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                        : 'border-border bg-card hover:border-accent-blue/40',
                    )}
                  >
                    <div className="text-sm font-semibold text-text-primary">{opt.label}</div>
                    <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{opt.hint}</p>
                  </button>
                )
              })}
            </div>

            {quickMachine.origin === 'SOLD_BY_US' || quickMachine.origin === 'THIRD_PARTY' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {quickMachine.origin === 'SOLD_BY_US' ? (
                  <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-3">
                    <CatalogMachinePick
                      products={catalogProducts}
                      brands={catalogBrands}
                      stockType={quickMachine.stockType}
                      brandId={quickMachine.brandId}
                      productId={quickMachine.catalogProductId}
                      onChange={(next) =>
                        patchQuickMachine({
                          stockType: next.stockType,
                          brandId: next.brandId,
                          catalogProductId: next.productId,
                          name: next.name,
                          model: next.model,
                          machineType: next.machineType,
                          capacity: next.capacity || quickMachine.capacity,
                        })
                      }
                    />
                    {quickMachine.name ? (
                      <p className="sm:col-span-2 lg:col-span-3 -mt-1 text-xs text-text-secondary">
                        Selected: <strong className="text-text-primary">{quickMachine.name}</strong>
                        {quickMachine.model ? ` · ${quickMachine.model}` : ''}
                      </p>
                    ) : (
                      <p className="sm:col-span-2 lg:col-span-3 -mt-1 text-xs text-text-secondary">
                        Same as inventory: type → brand → model from catalog.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <Select
                      label="Type"
                      value={quickMachine.machineType}
                      onChange={(e) =>
                        patchQuickMachine({
                          machineType: e.target.value,
                          catalogProductId: '',
                        })
                      }
                      options={QUICK_MACHINE_TYPES}
                    />
                    <Input
                      label="Product / machine name *"
                      className="lg:col-span-2"
                      value={quickMachine.name}
                      onChange={(e) => patchQuickMachine({ name: e.target.value })}
                    />
                    <Input
                      label="Model"
                      value={quickMachine.model}
                      onChange={(e) => patchQuickMachine({ model: e.target.value })}
                    />
                    <Input
                      label="Capacity"
                      value={quickMachine.capacity}
                      onChange={(e) => patchQuickMachine({ capacity: e.target.value })}
                    />
                  </>
                )}
                <Input
                  label="Serial number"
                  value={quickMachine.serialNo}
                  onChange={(e) => patchQuickMachine({ serialNo: e.target.value })}
                />
                <Select
                  label="Service plan"
                  value={quickMachine.servicePlan}
                  onChange={(e) => patchQuickMachine({ servicePlan: e.target.value })}
                  options={
                    quickMachine.origin === 'SOLD_BY_US'
                      ? [
                          { value: 'GC', label: 'GC — 1 year from sale' },
                          ...(isWeighingMachine(quickMachine.machineType)
                            ? [
                                {
                                  value: 'AMC',
                                  label: 'AMC — weighing only (after GC / existing)',
                                },
                              ]
                            : []),
                        ]
                      : [
                          { value: 'NON_AMC', label: 'NGC / Non-AMC' },
                          ...(isWeighingMachine(quickMachine.machineType)
                            ? [{ value: 'AMC', label: 'AMC — weighing only' }]
                            : []),
                        ]
                  }
                />
                {quickMachine.servicePlan === 'AMC' ? (
                  <>
                    <Input
                      label="AMC start date"
                      type="date"
                      value={quickMachine.amcStartDate}
                      onChange={(e) => patchQuickMachine({ amcStartDate: e.target.value })}
                    />
                    <Input
                      label="AMC end date"
                      type="date"
                      value={quickMachine.amcEndDate}
                      onChange={(e) => patchQuickMachine({ amcEndDate: e.target.value })}
                    />
                  </>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-text-secondary">
                Select <strong>Sold by us</strong> or <strong>Outside</strong> to enter machine
                details.
              </p>
            )}
          </section>
        </div>
      </Modal>

      <Modal
        open={Boolean(assignModal)}
        onClose={() => {
          setAssignModal(null)
          setAssignUserId('')
        }}
        accent="theme"
        size="sm"
        title={assignModal?.ticketNo ? `Assign ${assignModal.ticketNo}` : 'Assign engineer'}
        subtitle="Select a service engineer. Job moves to In progress. WhatsApp notify is off for now."
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
              disabled={assignBusy || !assignUserId}
              onClick={() => void quickAssign()}
            >
              {assignBusy ? 'Assigning…' : 'Assign engineer'}
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

    </div>
  )
}

export default TicketsPage
