import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { Badge, leadStatusColor } from '@/components/ui/Badge'
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
import { PhoneInput } from '@/components/ui/PhoneInput'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { useRowSelection } from '@/hooks/useRowSelection'
import { useConfirmLeave } from '@/hooks/useDiscardGuard'
import { api, ApiClientError, num } from '@/lib/api'
import { firstError, validateLeadForm, type FieldErrors } from '@/lib/formValidation'
import { formatCurrency, formatDate, formatPhone, cn } from '@/lib/utils'
import { MissingBanner, sectionErrorClass } from '@/components/ui/MissingField'
import { indianMobileLocal, toStoredIndianMobile } from '@/lib/phoneIndia'
import { productRequiresStamping } from '@/lib/productCatalog'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin, isSalesExecutive, isServiceDesk, isWarehouse, filterSalesExecutives, type LookupUser } from '@/lib/roles'
import { can } from '@/lib/permissions'
import { RequisitionsPanel } from '@/components/sales/RequisitionsPanel'
import {
  HMS_FAMILY_OPTIONS,
  industryOptions,
  productCatalogMeta,
} from '@/lib/hmsCatalog'
import { productAttrs } from '@/lib/productCatalog'
import { formatEnquiryId } from '@/lib/serviceId'
import { TableSkeleton } from '@/components/ui/Skeleton'
import {
  HMS_LEAD_PIPELINE,
  HMS_SERVICE_TYPES,
  HMS_WAY_OF_ENQUIRIES,
  leadOrderedProducts,
  leadPipelineLabel,
  matchEnquirySourceId,
  type HmsServiceType,
} from '@/lib/hmsLead'
import { saleIsCompleted } from '@/lib/salesFlow'
import { OrderedProductsList } from '@/components/sales/OrderedProductsList'

/** Desk statuses — aligned with Zoho-style pipeline */
const STATUS_OPTIONS = HMS_LEAD_PIPELINE.map((s) => ({
  value: s.value,
  label: s.label,
}))

const ALL_STATUS_VALUES = STATUS_OPTIONS.map((s) => s.value)

function statusLabel(code: string) {
  return leadPipelineLabel(code)
}

function statusStripe(code: string): string {
  switch (code) {
    case 'NEW':
      return 'border-l-indigo-500'
    case 'CONTACTED':
      return 'border-l-cyan-500'
    case 'QUALIFIED':
      return 'border-l-teal-500'
    case 'DEMO':
      return 'border-l-amber-500'
    case 'CONVERTED':
      return 'border-l-emerald-500'
    case 'LOST':
      return 'border-l-slate-400'
    case 'UNQUALIFIED':
      return 'border-l-rose-500'
    default:
      return 'border-l-border'
  }
}

const emptyForm = {
  contactId: '',
  name: '',
  email: '',
  phone: '',
  company: '',
  website: '',
  city: '',
  state: '',
  country: 'IN',
  sourceId: '',
  enquiryWay: '',
  status: 'NEW',
  score: '40',
  assignedToId: '',
  description: '',
  productInterest: '',
  productId: '',
  productIds: [] as string[],
  productSearch: '',
  familyCode: '',
  industryCode: '',
  demoSerialId: '',
  budget: '',
  /** Sale payment — total / advance; due is auto */
  paymentTotal: '',
  advanceAmount: '',
  enquiryDate: new Date().toISOString().slice(0, 10),
  followUpDate: '',
  reminderAt: '',
  timeline: '',
  tags: '',
  customerType: 'NEW' as 'NEW' | 'EXISTING',
  serviceType: 'SALES' as HmsServiceType,
  area: '',
  machineName: '',
  machineType: '',
  machineIssue: '',
  clientCalledDate: new Date().toISOString().slice(0, 10),
}

export function LeadsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isSales = isSalesExecutive(authUser?.role)
  const isAdmin = isCompanyAdmin(authUser?.role)
  const isDesk = isServiceDesk(authUser?.role)
  const isWh = isWarehouse(authUser?.role)
  const canApproveReq = can(authUser?.role, 'requisitions:approve')
  const canCreateLead = !isWh && can(authUser?.role, 'leads:write')
  const tip = DEFAULT_TIPS['crm.leads'] ?? {
    title: isDesk ? 'Service intake' : 'My leads',
    body: isDesk
      ? 'Log today’s calls, filter by area, mark NQ / closed, or create a service ticket and break it down.'
      : 'Your sale leads — pick an existing customer or add a new one, then track demo units and conversion.',
    tipType: 'TIP' as const,
  }

  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<LookupUser[]>([])
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; salePrice?: number; taxPercent?: number; attributes?: Record<string, unknown> | null }>
  >([])
  const [createDemoUnits, setCreateDemoUnits] = useState<Array<{ id: string; serialNo: string; stampingDate?: string | null }>>([])
  const [, setStampingGateOpen] = useState(false)
  const [, setPendingStampUnitId] = useState('')
  const [convertBusy, setConvertBusy] = useState(false)
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [search, setSearch] = useState('')
  const initialStatus = searchParams.get('status') ?? ''
  const [status, setStatus] = useState(
    ALL_STATUS_VALUES.includes(initialStatus as (typeof ALL_STATUS_VALUES)[number]) ? initialStatus : '',
  )
  const [ownerFilter, setOwnerFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('type') ?? '')
  const [areaFilter, setAreaFilter] = useState(searchParams.get('area') ?? '')
  const [todayOnly, setTodayOnly] = useState(
    searchParams.get('today') === '1' || isServiceDesk(authUser?.role),
  )
  const [triageBusy, setTriageBusy] = useState<string | null>(null)
  const [pageTab, setPageTab] = useState<'list' | 'create' | 'demo-updates' | 'requisitions'>(() =>
    searchParams.get('queue') === 'requisitions'
      ? 'requisitions'
      : searchParams.get('queue') === 'demo-updates'
        ? 'demo-updates'
      : searchParams.get('open') === '1' && !isWarehouse(authUser?.role)
        ? 'create'
        : 'list',
  )
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    assignedToId: '',
  }))
  const [dailyNote, setDailyNote] = useState('')
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().slice(0, 10))
  const [, setDailySaving] = useState(false)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertStageId, setConvertStageId] = useState('')
  const [, setDemoOpen] = useState(false)
  const [demoUnits, setDemoUnits] = useState<
    Array<{
      id: string
      serialNo: string
      productId?: string
      stampingDate?: string | null
      notes?: string | null
      product?: {
        name?: string
        sku?: string
        salePrice?: number
        purchasePrice?: number
        unit?: string
        productType?: string
        attributes?: Record<string, unknown> | null
      } | null
      warehouse?: { name?: string } | null
    }>
  >([])
  const [demoUnitId, setDemoUnitId] = useState('')
  const [demoProductFilter, setDemoProductFilter] = useState('')
  const [demoFamilyCode, setDemoFamilyCode] = useState('')
  const [demoIndustryCode, setDemoIndustryCode] = useState('')
  const [, setDemoSaving] = useState(false)
  const [, setDemoReturning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  useEffect(() => {
    setDailyNote('')
    setDailyDate(new Date().toISOString().slice(0, 10))
  }, [selected?.id])

  const visibleItems = useMemo(() => {
    if (status === 'COMPLETED') return items.filter((l) => saleIsCompleted(l))
    if (status) return items.filter((l) => String(l.status) === status && !saleIsCompleted(l))
    return items.filter((l) => !saleIsCompleted(l))
  }, [items, status])
  const ids = useMemo(() => visibleItems.map((i) => String(i.id)), [visibleItems])
  const selection = useRowSelection(ids)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // Leads + lookups only. Do NOT call /products here — sales roles lack products:view
      // and a failed Promise.all used to blank the whole "My enquiries" tab.
      // Product catalog for the enquiry form already comes from lookups.products.
      const [leads, lookups] = await Promise.all([
        api.leads({
          limit: 200,
          search: search || undefined,
          // Status / Completed filtered client-side so chips stay accurate
          ...(typeFilter ? { serviceType: typeFilter } : {}),
          ...(areaFilter.trim() ? { area: areaFilter.trim() } : {}),
          ...(todayOnly ? { today: '1' } : {}),
          ...(isSales && authUser?.id
            ? { assignedToId: authUser.id }
            : ownerFilter && ownerFilter !== 'unassigned'
              ? { assignedToId: ownerFilter }
              : {}),
        }),
        api.lookups(),
      ])
      let rows = leads.items ?? []
      if (!isSales && ownerFilter === 'unassigned') {
        rows = rows.filter((l) => !l.assignedToId)
      }
      setItems(
        [...rows].sort((a, b) => {
          // createdAt desc client — newest enquiries on top
          const ta = new Date(String(a.createdAt ?? 0)).getTime()
          const tb = new Date(String(b.createdAt ?? 0)).getTime()
          return tb - ta
        }),
      )
      setSources(lookups.sources)
      setUsers(lookups.users)
      setStages(lookups.stages)
      const byId = new Map(
        (lookups.products ?? []).map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            sku: p.sku,
            salePrice: num(p.salePrice),
            taxPercent: num(p.taxPercent),
            attributes: (p.attributes as Record<string, unknown> | null) ?? null,
          },
        ]),
      )
      // Optional richer catalog for roles that can read /products (admin / warehouse)
      try {
        const productPage = await api.products({ limit: 200 })
        for (const p of productPage.items ?? []) {
          const id = String(p.id)
          byId.set(id, {
            id,
            name: String(p.name ?? ''),
            sku: String(p.sku ?? ''),
            salePrice: p.salePrice != null ? num(p.salePrice) : undefined,
            taxPercent: p.taxPercent != null ? num(p.taxPercent) : undefined,
            attributes: (p.attributes as Record<string, unknown> | null) ?? null,
          })
        }
      } catch {
        /* sales executive: lookups catalog is enough */
      }
      setProducts([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)))
      if (!convertStageId && lookups.stages[0]) setConvertStageId(lookups.stages[0].id)
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to load leads'
      setLoadError(message)
      addToast({ type: 'error', message })
    } finally {
      setLoading(false)
    }
  }, [addToast, areaFilter, authUser?.id, convertStageId, isSales, ownerFilter, search, todayOnly, typeFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const next = searchParams.get('status') ?? ''
    if (
      next === '' ||
      next === 'COMPLETED' ||
      ALL_STATUS_VALUES.includes(next as (typeof ALL_STATUS_VALUES)[number])
    ) {
      setStatus(next)
    }
  }, [searchParams])

  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users])
  const salesExecs = useMemo(() => filterSalesExecutives(users), [users])
  /** Admins see everyone; sales execs only themselves (locked owner). */
  const salesOptions = useMemo(() => {
    const list =
      isSales && authUser?.id
        ? salesExecs.filter((u) => u.id === authUser.id)
        : salesExecs
    const opts = list.map((u) => ({
      value: u.id,
      label: u.phone ? `${u.name} · ${u.phone}` : u.name,
    }))
    // If lookups lag, still show the logged-in executive by name.
    if (isSales && authUser?.id && !opts.some((o) => o.value === authUser.id)) {
      opts.push({
        value: authUser.id,
        label: authUser.name || 'You (sales executive)',
      })
    }
    return opts
  }, [salesExecs, isSales, authUser?.id, authUser?.name])

  function openCreateEnquiry() {
    setPageTab('create')
    setForm({
      ...emptyForm,
      assignedToId: isSales && authUser?.id ? authUser.id : '',
      serviceType: isDesk ? 'SERVICE' : 'SALES',
    })
    setPickedContact(null)
    setErrors({})
    setCreateDemoUnits([])
  }

  async function triageMark(id: string, next: 'UNQUALIFIED' | 'LOST') {
    setTriageBusy(id)
    try {
      await api.statusLead(id, next)
      addToast({
        type: 'success',
        message: next === 'UNQUALIFIED' ? 'Marked not qualified for service' : 'Marked closed / not interested',
      })
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Update failed' })
    } finally {
      setTriageBusy(null)
    }
  }

  async function triageHandoff(lead: Record<string, unknown>) {
    const id = String(lead.id)
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
    const stype = String(cf.serviceType ?? 'SERVICE').toUpperCase()
    if (stype === 'RENTAL' && cf.rentalAgreementId) {
      navigate('/rentals')
      return
    }
    if (cf.serviceTicketId) {
      navigate(`/tickets/${String(cf.serviceTicketId)}`)
      return
    }
    setTriageBusy(id)
    try {
      const area = String(lead.area ?? cf.area ?? '').trim() || null
      const res = await api.prepareLeadHandoff(id, { area })
      addToast({
        type: 'success',
        message:
          res.serviceType === 'RENTAL'
            ? `${res.enquiryId ?? formatEnquiryId(lead)} → issue rental serial`
            : res.serviceType === 'STAMPING'
              ? `${res.enquiryId ?? formatEnquiryId(lead)} → stamping job (pick machine)`
              : `${res.enquiryId ?? formatEnquiryId(lead)} → service job (pick machine)`,
      })
      await load()
      if (res.href) navigate(res.href)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not start handoff',
      })
    } finally {
      setTriageBusy(null)
    }
  }
  const productName = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )
  const productsForDemo = useMemo(() => {
    return products.filter((p) => {
      const meta = productCatalogMeta(productAttrs(p))
      if (form.familyCode) {
        if (meta.familyCode) {
          if (meta.familyCode !== form.familyCode) return false
        } else if (form.familyCode === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        }
      }
      if (form.industryCode && meta.industryCode !== form.industryCode) return false
      return true
    })
  }, [products, form.familyCode, form.industryCode])

  const demoUpdateFeed = useMemo(() => {
    const rows: Array<{
      leadId: string
      leadName: string
      company?: string
      serial?: string
      product?: string
      dcNo?: string
      executive?: string
      status?: string
      update: Record<string, unknown>
    }> = []
    for (const lead of items) {
      const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
      const updates = Array.isArray(cf.demoDailyUpdates)
        ? (cf.demoDailyUpdates as Array<Record<string, unknown>>)
        : []
      if (!updates.length) continue
      for (const u of updates) {
        rows.push({
          leadId: String(lead.id),
          leadName: String(lead.name ?? ''),
          company: lead.company ? String(lead.company) : undefined,
          serial: cf.demoSerialNo ? String(cf.demoSerialNo) : undefined,
          product: cf.demoProductName ? String(cf.demoProductName) : undefined,
          dcNo: cf.demoDcNo ? String(cf.demoDcNo) : undefined,
          executive: cf.demoExecutiveName
            ? String(cf.demoExecutiveName)
            : userName[String(lead.assignedToId ?? '')],
          status: String(lead.status ?? ''),
          update: u,
        })
      }
    }
    return rows.sort(
      (a, b) =>
        new Date(String(b.update.at ?? b.update.updateDate ?? 0)).getTime() -
        new Date(String(a.update.at ?? a.update.updateDate ?? 0)).getTime(),
    )
  }, [items, userName])

  async function saveDailyUpdate() {
    if (!selected || !dailyNote.trim()) {
      addToast({ type: 'error', message: 'Write today’s demo update' })
      return
    }
    setDailySaving(true)
    try {
      const updated = await api.addLeadDemoUpdate(String(selected.id), {
        note: dailyNote.trim(),
        updateDate: dailyDate,
      })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      setDailyNote('')
      addToast({ type: 'success', message: 'Daily demo update saved — visible to admin' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save update',
      })
    } finally {
      setDailySaving(false)
    }
  }

  const productOptions = useMemo(
    () =>
      (form.status === 'DEMO' ? productsForDemo : products).map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: p.sku,
      })),
    [products, productsForDemo, form.status],
  )

  const selectedDemoUnit = useMemo(
    () => demoUnits.find((u) => u.id === demoUnitId) ?? null,
    [demoUnits, demoUnitId],
  )

  const filteredDemoUnits = useMemo(() => {
    return demoUnits.filter((u) => {
      if (demoProductFilter && u.productId !== demoProductFilter) return false
      if (!demoFamilyCode && !demoIndustryCode) return true
      const meta = productCatalogMeta(productAttrs(u.product))
      if (demoFamilyCode) {
        if (meta.familyCode) {
          if (meta.familyCode !== demoFamilyCode) return false
        } else if (demoFamilyCode === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        }
      }
      if (demoIndustryCode && meta.industryCode !== demoIndustryCode) return false
      return true
    })
  }, [demoUnits, demoProductFilter, demoFamilyCode, demoIndustryCode])

  const demoPickerProductOptions = useMemo(() => {
    const matching = demoUnits.filter((u) => {
      if (!demoFamilyCode && !demoIndustryCode) return true
      const meta = productCatalogMeta(productAttrs(u.product))
      if (demoFamilyCode) {
        if (meta.familyCode) {
          if (meta.familyCode !== demoFamilyCode) return false
        } else if (demoFamilyCode === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        }
      }
      if (demoIndustryCode && meta.industryCode !== demoIndustryCode) return false
      return true
    })
    const ids = new Set(matching.map((u) => u.productId).filter(Boolean) as string[])
    return products
      .filter((p) => ids.has(p.id))
      .map((p) => ({ value: p.id, label: p.name, sublabel: p.sku }))
  }, [demoUnits, products, demoFamilyCode, demoIndustryCode])

  const statusCounts = useMemo(() => {
    const counts = {
      NEW: 0,
      CONTACTED: 0,
      QUALIFIED: 0,
      DEMO: 0,
      CONVERTED: 0,
      LOST: 0,
      COMPLETED: 0,
    }
    for (const l of items) {
      if (saleIsCompleted(l)) {
        counts.COMPLETED += 1
        continue
      }
      const s = String(l.status)
      if (s in counts) counts[s as keyof typeof counts] += 1
    }
    return counts
  }, [items])

  useEffect(() => {
    if (form.status !== 'DEMO' || !form.productId) {
      setCreateDemoUnits([])
      return
    }
    let cancelled = false
    void api
      .stockUnits({ status: 'IN_STOCK', productId: form.productId, limit: 200 })
      .then((rows) => {
        if (cancelled) return
        setCreateDemoUnits(
          (rows as Array<Record<string, unknown>>).map((u) => ({
            id: String(u.id),
            serialNo: String(u.serialNo),
            stampingDate: (u.stampingDate as string | null) ?? null,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setCreateDemoUnits([])
      })
    return () => {
      cancelled = true
    }
  }, [form.status, form.productId])

  const onPickContact = useCallback((c: ContactPick | null) => {
    setPickedContact(c)
    if (c) {
      setForm((f) => ({
        ...f,
        contactId: c.id,
        customerType: 'EXISTING',
        name: c.name || f.name,
        phone: indianMobileLocal(c.phone || c.mobile || f.phone),
        email: c.email || f.email,
        company: f.company || c.name,
      }))
    } else {
      setForm((f) => ({ ...f, contactId: '', customerType: 'NEW' }))
    }
  }, [])

  function closeCreateForm() {
    setPageTab('list')
    setForm({
      ...emptyForm,
      assignedToId: isSales && authUser?.id ? authUser.id : '',
    })
    setPickedContact(null)
    setErrors({})
    setCreateDemoUnits([])
    if (searchParams.get('open') || searchParams.get('contactId')) {
      setSearchParams({}, { replace: true })
    }
  }

  const createOpen = pageTab === 'create'
  const { requestLeave: requestLeaveCreate, dialog: leaveCreateDialog } = useConfirmLeave(
    createOpen,
    'Lead form is open. Leave and discard your changes?',
  )

  useEffect(() => {
    const queue = searchParams.get('queue')
    if (queue === 'requisitions' && canApproveReq) {
      setPageTab('requisitions')
      return
    }
    if (queue === 'demo-updates' && isAdmin) {
      setPageTab('demo-updates')
      return
    }
    const shouldOpen = searchParams.get('open') === '1' && canCreateLead
    const contactId = searchParams.get('contactId')
    if (shouldOpen) {
      setPageTab('create')
      setForm((f) => ({
        ...f,
        assignedToId: isSales && authUser?.id ? authUser.id : f.assignedToId,
        ...(contactId ? { contactId, customerType: 'EXISTING' as const } : {}),
      }))
    } else if (contactId) {
      setForm((f) => ({ ...f, contactId, customerType: 'EXISTING' }))
    }
  }, [searchParams, setSearchParams, isSales, authUser?.id, canApproveReq, isAdmin, canCreateLead])

  // Keep sales executive locked to self whenever the create form is open.
  useEffect(() => {
    if (pageTab !== 'create' || !isSales || !authUser?.id) return
    setForm((f) => (f.assignedToId === authUser.id ? f : { ...f, assignedToId: authUser.id }))
  }, [pageTab, isSales, authUser?.id])

  function clearFieldError(key: string) {
    setErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function createLead(e: FormEvent) {
    e.preventDefault()
    const nextErrors = validateLeadForm(form)

    if (!form.enquiryWay) nextErrors.enquiryWay = 'Select way of enquiries'
    if (!form.enquiryDate) nextErrors.enquiryDate = 'Enquiry date is required'
    if (!form.name.trim()) nextErrors.name = 'Customer name is required'
    if (!form.phone.trim()) nextErrors.phone = 'Phone is required'
    if (!form.area.trim()) nextErrors.area = 'Area is required'

    if (form.serviceType === 'SALES') {
      if (form.productIds.length === 0 && !form.productId) {
        nextErrors.productIds = 'Select at least one interested product'
      }
      if (!form.assignedToId && !isSales) {
        nextErrors.assignedToId = 'Assign a sales executive'
      }
    } else {
      if (!form.machineName.trim()) nextErrors.machineName = 'Machine name is required'
      if (!form.machineType.trim()) nextErrors.machineType = 'Machine type is required'
      if (!form.machineIssue.trim()) nextErrors.machineIssue = 'Machine issue / complaint is required'
      if (!form.clientCalledDate) nextErrors.clientCalledDate = 'Date client called is required'
    }

    if (form.status === 'DEMO') {
      if (!form.familyCode) nextErrors.familyCode = 'Select product family'
      if (form.familyCode === 'WEIGHING_SCALES' && !form.industryCode) {
        nextErrors.industryCode = 'Select industry'
      }
      if (!form.productId) nextErrors.productId = 'Select the demo product / machine'
      if (!form.demoSerialId) nextErrors.demoSerialId = 'Select the serial number going out on demo'
      if (!form.assignedToId && !isSales) nextErrors.assignedToId = 'Assign an executive for the demo unit'
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      const count = Object.keys(nextErrors).length
      addToast({
        type: 'error',
        message: `Missing ${count} required field${count > 1 ? 's' : ''} — ${firstError(nextErrors)}`,
      })
      const firstKey = Object.keys(nextErrors)[0]!
      const sectionId =
        firstKey === 'enquiryWay' || firstKey === 'enquiryDate' || firstKey === 'serviceType'
          ? 'lead-section-source'
          : firstKey === 'name' ||
              firstKey === 'phone' ||
              firstKey === 'area' ||
              firstKey === 'email' ||
              firstKey === 'contactId'
            ? 'lead-section-customer'
            : firstKey === 'productIds' ||
                firstKey === 'productId' ||
                firstKey === 'machineName' ||
                firstKey === 'machineType' ||
                firstKey === 'machineIssue' ||
                firstKey === 'clientCalledDate'
              ? 'lead-section-opportunity'
              : firstKey === 'familyCode' ||
                  firstKey === 'industryCode' ||
                  firstKey === 'demoSerialId'
                ? 'lead-section-demo'
                : firstKey === 'assignedToId'
                  ? 'lead-section-ownership'
                  : 'lead-field-' + firstKey
      const el =
        document.getElementById(`lead-field-${firstKey}`) ||
        document.getElementById(sectionId) ||
        document.getElementById('add-lead')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el) {
        el.classList.add('ring-2', 'ring-red-500', 'ring-offset-2')
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2')
        }, 2600)
      }
      return
    }
    // WhatsApp disabled for now — save enquiry / service handoff directly
    void doCreateLead()
  }

  async function doCreateLead() {
    setSaving(true)
    try {
      const customFields: Record<string, unknown> = {}
      if (form.contactId) customFields.contact_id = form.contactId
      if (form.enquiryDate) customFields.enquiry_date = form.enquiryDate
      if (form.productIds.length) {
        const selected = form.productIds.map((id) => ({
          id,
          name: productName[id] ?? id,
        }))
        customFields.interested_products = selected
        customFields.interested_product_id = selected[0]!.id
        customFields.interested_product_name = selected.map((p) => p.name).join(', ')
      } else if (form.productId) {
        customFields.interested_product_id = form.productId
        customFields.interested_product_name = productName[form.productId] ?? form.productInterest
      }
      const isServiceHandoff = form.serviceType !== 'SALES'
      const serviceRequirement = isServiceHandoff
        ? [
            `Machine: ${form.machineName.trim()}`,
            `Type: ${form.machineType.trim()}`,
            `Issue: ${form.machineIssue.trim()}`,
            `Client called: ${form.clientCalledDate}`,
            form.productInterest.trim() ? `Notes: ${form.productInterest.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : form.productInterest.trim()

      if (form.productInterest && !isServiceHandoff) {
        customFields.product_interest = form.productInterest
      }
      if (isServiceHandoff) {
        customFields.machineName = form.machineName.trim()
        customFields.machineType = form.machineType.trim()
        customFields.machineIssue = form.machineIssue.trim()
        customFields.clientCalledDate = form.clientCalledDate
        customFields.product_interest = serviceRequirement
        customFields.requirement = serviceRequirement
      }
      const saleTotal = Number(form.paymentTotal || form.budget) || 0
      const saleAdvance = Number(form.advanceAmount) || 0
      if (saleTotal > 0) {
        customFields.salePaymentTotal = saleTotal
        customFields.budget = saleTotal
      } else if (form.budget) {
        customFields.budget = Number(form.budget)
      }
      if (saleAdvance > 0) customFields.saleAdvanceAmount = saleAdvance
      if (saleTotal > 0 || saleAdvance > 0) {
        customFields.saleDueAmount = Math.max(0, saleTotal - saleAdvance)
      }
      if (form.timeline) customFields.timeline = form.timeline
      customFields.customer_type =
        form.contactId || form.customerType === 'EXISTING' ? 'Existing customer' : 'New customer'
      if (form.enquiryWay) customFields.enquiry_way = form.enquiryWay
      if (form.followUpDate && !isServiceHandoff) customFields.follow_up_date = form.followUpDate
      if (form.reminderAt && !isServiceHandoff) customFields.reminder_at = form.reminderAt
      customFields.leadUpdates = []
      customFields.timelineHistory = [
        {
          type: 'created',
          message: isServiceHandoff
            ? `Service intake · ${form.serviceType} · forwarded to desk · called ${form.clientCalledDate}`
            : `Lead created · ${form.serviceType} · ${
                HMS_WAY_OF_ENQUIRIES.find((w) => w.code === form.enquiryWay)?.label ?? 'Enquiry'
              }`,
          at: new Date().toISOString(),
          by: authUser?.name ?? 'User',
        },
      ]

      let website = form.website.trim()
      if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`

      const sourceId =
        form.sourceId ||
        (form.enquiryWay ? matchEnquirySourceId(sources, form.enquiryWay) : '') ||
        null

      const created = await api.createLead({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() ? toStoredIndianMobile(form.phone) : null,
        company: form.company.trim() || null,
        website: isServiceHandoff ? null : website || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country || 'IN',
        area: form.area.trim() || null,
        sourceId,
        status: isServiceHandoff ? 'NEW' : form.status === 'DEMO' ? 'NEW' : form.status,
        score: Number(form.score) || 0,
        assignedToId: isSales && authUser?.id ? authUser.id : form.assignedToId || null,
        description: isServiceHandoff
          ? serviceRequirement
          : form.description.trim() || null,
        tags: isServiceHandoff
          ? []
          : form.tags
            ? form.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
        customFields,
        serviceType: form.serviceType,
        ...(isServiceHandoff && serviceRequirement
          ? { requirement: serviceRequirement }
          : {}),
        ...(form.status === 'DEMO' && form.demoSerialId && !isServiceHandoff
          ? { demoStockUnitId: form.demoSerialId }
          : {}),
        sendWhatsApp: false,
      })

      const leadId = String(created.id ?? '')
      if (!leadId) throw new Error('Lead saved but id missing — refresh and open from list')

      const handoff = (created as { serviceHandoff?: { notified?: number } | null }).serviceHandoff
      const enq = formatEnquiryId(created)
      addToast({
        type: 'success',
        message:
          form.serviceType !== 'SALES'
            ? `${enq} saved — service desk notified${
                handoff?.notified ? ` (${handoff.notified})` : ''
              }`
            : form.status === 'DEMO' && form.demoSerialId
              ? `${enq} demo saved — delivery challan & serial in Demo inventory`
              : `${enq} saved (prospect only — not in customer list until convert)`,
      })

      closeCreateForm()
      await load()
      navigate(`/sale-tracking/${leadId}`)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    } finally {
      setSaving(false)
    }
  }

  async function beginConvert() {
    if (!selected) return
    const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
    const unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : ''
    if (unitId) {
      try {
        const unit = await api.getStockUnit(unitId)
        const product = unit.product as Record<string, unknown> | null
        const needsStamp = productRequiresStamping(product)
        if (needsStamp && !unit.stampingDate) {
          setPendingStampUnitId(unitId)
          setStampingGateOpen(true)
          return
        }
      } catch {
        /* proceed if unit lookup fails */
      }
    }
    setConvertOpen(true)
  }

  async function convert() {
    if (!selected) return
    void doConvert()
  }

  async function doConvert() {
    if (!selected) return
    setConvertBusy(true)
    try {
      const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
      const result = await api.convertLead(String(selected.id), {
        stageId: convertStageId,
        dealName: `${selected.company || selected.name} — Sale`,
        amount: num(cf.budget),
        createAccount: true,
        sendWhatsApp: false,
      })
      const leadId = String(selected.id)
      const reqErr = String((result as { requisitionError?: string | null }).requisitionError ?? '')
      setConvertOpen(false)
      setSelected(null)
      addToast({
        type: reqErr ? 'warning' : 'success',
        message: reqErr
          ? `Converted — ${reqErr}. Open the lead to submit requisition.`
          : 'Sale converted — sales requisition ready for admin sign-off',
      })
      navigate(`/sale-tracking/${encodeURIComponent(leadId)}`)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Convert failed' })
    } finally {
      setConvertBusy(false)
    }
  }

  async function reassignLead(assignedToId: string) {
    if (!selected) return
    try {
      const updated = await api.updateLead(String(selected.id), {
        assignedToId: assignedToId || null,
      })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      addToast({
        type: 'success',
        message: assignedToId
          ? `Assigned to ${userName[assignedToId] ?? 'employee'} — follow-up task created`
          : 'Lead unassigned',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update owner',
      })
    }
  }

  async function openDemoPicker() {
    if (!selected) return
    try {
      const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
      const interestedProductId = String(cf.interested_product_id ?? cf.demoProductId ?? '')
      const units = await api.stockUnits({ status: 'IN_STOCK', limit: 300 })
      const mapped = (units as Array<Record<string, unknown>>).map((u) => {
        const product = (u.product as Record<string, unknown> | null) ?? null
        return {
          id: String(u.id),
          serialNo: String(u.serialNo),
          productId: String(u.productId ?? ''),
          stampingDate: (u.stampingDate as string | null) ?? null,
          notes: u.notes ? String(u.notes) : null,
          product: product
            ? {
                name: product.name ? String(product.name) : undefined,
                sku: product.sku ? String(product.sku) : undefined,
                salePrice: product.salePrice != null ? num(product.salePrice) : undefined,
                purchasePrice: product.purchasePrice != null ? num(product.purchasePrice) : undefined,
                unit: product.unit ? String(product.unit) : undefined,
                productType: product.productType ? String(product.productType) : undefined,
                attributes: (product.attributes as Record<string, unknown> | null) ?? null,
              }
            : null,
          warehouse: (u.warehouse as { name?: string } | null) ?? null,
        }
      })
      setDemoUnits(mapped)
      const interested = mapped.find((u) => u.productId === interestedProductId)
      const meta = interested ? productCatalogMeta(productAttrs(interested.product)) : null
      setDemoFamilyCode(meta?.familyCode ?? '')
      setDemoIndustryCode(meta?.industryCode ?? '')
      setDemoProductFilter(interestedProductId)
      setDemoUnitId('')
      setDemoOpen(true)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load stock units',
      })
    }
  }

  async function returnDemoFromLead() {
    if (!selected) return
    setDemoReturning(true)
    try {
      const result = await api.returnLeadDemo(String(selected.id))
      const lead = (result as { lead?: Record<string, unknown> }).lead ?? result
      setSelected(lead as Record<string, unknown>)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...lead } : l)),
      )
      addToast({
        type: 'success',
        message: 'Demo unit returned — stock restored in inventory',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not return demo unit',
      })
    } finally {
      setDemoReturning(false)
    }
  }

  async function confirmDemoIssue() {
    if (!selected || !demoUnitId) {
      addToast({ type: 'error', message: 'Select a serial number for the demo' })
      return
    }
    setDemoSaving(true)
    try {
      const result = await api.issueLeadDemo(String(selected.id), demoUnitId)
      const lead = (result as { lead?: Record<string, unknown> }).lead ?? result
      setSelected(lead as Record<string, unknown>)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...lead } : l)),
      )
      setDemoOpen(false)
      addToast({
        type: 'success',
        message: 'Demo issued — serial reserved / stock reduced',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not issue demo unit',
      })
    } finally {
      setDemoSaving(false)
    }
  }

  async function updateLeadStatus(nextStatus: string) {
    if (!selected) return
    if (nextStatus === 'CONVERTED') {
      await beginConvert()
      return
    }
    if (nextStatus === 'DEMO') {
      const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
      if (cf.demoStockUnitId || selected.status === 'DEMO') {
        try {
          const updated = await api.updateLead(String(selected.id), { status: 'DEMO' })
          setSelected(updated)
          setItems((prev) =>
            prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
          )
          addToast({ type: 'success', message: 'Status → Demo' })
        } catch (err) {
          addToast({
            type: 'error',
            message: err instanceof ApiClientError ? err.message : 'Could not update status',
          })
        }
        return
      }
      await openDemoPicker()
      return
    }
    if (nextStatus === 'LOST' && String(selected.status) === 'DEMO') {
      const hadDemo = cfHasDemo(selected)
      try {
        const updated = await api.updateLead(String(selected.id), { status: nextStatus })
        setSelected(updated)
        setItems((prev) =>
          prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
        )
        addToast({
          type: 'success',
          message: hadDemo
            ? 'Not interested — demo unit returned to Main warehouse'
            : `Status → ${statusLabel(nextStatus)}`,
        })
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Could not update status',
        })
      }
      return
    }
    try {
      const updated = await api.updateLead(String(selected.id), { status: nextStatus })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      addToast({ type: 'success', message: `Status → ${statusLabel(nextStatus)}` })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update status',
      })
    }
  }

  function cfHasDemo(lead: Record<string, unknown>) {
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
    return Boolean(cf.demoStockUnitId)
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteLead(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      if (selected && deleteIds.includes(String(selected.id))) setSelected(null)
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

  // Keep helpers referenced so noUnusedLocals does not strip future UI wiring
  void saveDailyUpdate
  void selectedDemoUnit
  void filteredDemoUnits
  void demoPickerProductOptions
  void reassignLead
  void returnDemoFromLead
  void confirmDemoIssue
  void updateLeadStatus

  return (
    <div className="min-w-0 max-w-full">
      <PageHeader
        title="My leads"
        count={pageTab === 'list' ? items.length : undefined}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'My leads', to: '/sale-tracking' },
          ...(pageTab === 'create' ? [{ label: 'New lead' }] : []),
        ]}
        actions={
          pageTab === 'list' && canCreateLead ? (
            <Button onClick={() => openCreateEnquiry()} className="w-full sm:w-auto">
              <Plus size={16} /> New lead
            </Button>
          ) : undefined
        }
      />

      {leaveCreateDialog}
      <PageTabs
        accent="theme"
        active={pageTab}
        onChange={(id) => {
          if (id === 'create') {
            openCreateEnquiry()
            return
          }
          const go = () => {
            setPageTab(id as 'list' | 'demo-updates' | 'requisitions')
            setForm({
              ...emptyForm,
              assignedToId: isSales && authUser?.id ? authUser.id : '',
            })
            setPickedContact(null)
            setErrors({})
          }
          if (createOpen) requestLeaveCreate(go)
          else go()
        }}
        tabs={[
          { id: 'list', label: isSales ? 'My leads' : 'All leads', count: items.filter((l) => !saleIsCompleted(l)).length },
          ...(isAdmin
            ? [{ id: 'demo-updates', label: 'Daily updates', count: demoUpdateFeed.length }]
            : []),
          ...(canApproveReq
            ? [{ id: 'requisitions', label: 'Requisitions' }]
            : []),
          ...(canCreateLead ? [{ id: 'create', label: 'New lead' }] : []),
        ]}
      />

      {pageTab === 'requisitions' && canApproveReq ? (
        <RequisitionsPanel defaultQueue="pending" />
      ) : null}

      {pageTab === 'demo-updates' && isAdmin ? (
        <Card padding={false} className="mb-4">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold text-text-primary">Day-wise lead updates</h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              Every day update posted by sales on open leads appears here — status changes also notify you.
            </p>
          </div>
          {demoUpdateFeed.length === 0 ? (
            <EmptyState
              title="No day updates yet"
              subtitle="When executives post day-wise notes on My leads, they show up in this board."
            />
          ) : (
            <ul className="divide-y divide-border">
              {demoUpdateFeed.map((row) => (
                <li key={`${row.leadId}-${String(row.update.id ?? row.update.at)}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between"
                    onClick={() => navigate(`/sale-tracking/${row.leadId}`)}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary">
                        {row.leadName}
                        {row.company ? ` · ${row.company}` : ''}
                      </div>
                      <div className="text-sm text-text-secondary">
                        {[
                          row.update.dayNumber != null ? `Day ${row.update.dayNumber}` : null,
                          row.status ? statusLabel(row.status) : null,
                          row.product,
                          row.serial ? `S/No ${row.serial}` : null,
                          row.dcNo,
                          row.executive,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <p className="mt-1 text-sm text-text-primary">{String(row.update.note ?? '')}</p>
                    </div>
                    <div className="shrink-0 text-xs text-text-secondary">
                      {String(row.update.updateDate ?? '').slice(0, 10) ||
                        formatDate(String(row.update.at ?? ''))}
                      <div className="mt-0.5">{String(row.update.authorName ?? row.executive ?? '')}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {pageTab === 'create' ? (
        <>
          <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />
          <FormPanel
            open
            accent="sky"
            eyebrow="My leads"
            title="New lead"
            width={720}
            storageKey="nova.drawer.leads.create"
            subtitle={
              form.serviceType === 'SALES'
                ? 'Sales: customer → products → follow-up. You own this until Won / Sales closed.'
                : 'Service intake: customer + machine + issue + call date — auto-forwards to the service desk.'
            }
            onClose={closeCreateForm}
            footer={
              <>
                <FormPanelCancel disabled={saving} />
                <Button
                  type="submit"
                  form="add-lead"
                  disabled={saving}
                  onClick={(e) => {
                    // Footer sits outside <form> — force submit if browser skips form=""
                    const formEl = document.getElementById('add-lead') as HTMLFormElement | null
                    if (!formEl) {
                      e.preventDefault()
                      void createLead(e as unknown as FormEvent)
                      return
                    }
                    if (typeof formEl.requestSubmit === 'function') {
                      e.preventDefault()
                      formEl.requestSubmit()
                    }
                  }}
                >
                  {saving
                    ? 'Saving…'
                    : form.serviceType === 'SALES'
                      ? 'Save lead'
                      : 'Save & notify service desk'}
                </Button>
              </>
            }
          >
        <form id="add-lead" onSubmit={createLead} className="space-y-5" noValidate>
          {Object.keys(errors).length > 0 ? (
            <MissingBanner
              message={`${Object.keys(errors).length} required field${Object.keys(errors).length > 1 ? 's' : ''} — highlighted in red below. ${firstError(errors)}`}
            />
          ) : null}

          {/* 1. Classification */}
          <section
            id="lead-section-source"
            className={cn(
              'scroll-mt-24 rounded-xl border border-border bg-muted/15 p-4',
              sectionErrorClass(Boolean(errors.enquiryWay || errors.enquiryDate)),
            )}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-text-primary">1. Service &amp; enquiry source</h3>
              <p className="text-xs text-text-secondary">What kind of work is this, and how did the enquiry arrive?</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Select service *"
                value={form.serviceType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    serviceType: e.target.value as HmsServiceType,
                  })
                }
                options={HMS_SERVICE_TYPES.map((t) => ({
                  value: t.value,
                  label: `${t.label} — ${t.hint}`,
                }))}
              />
              <Select
                id="lead-field-enquiryWay"
                label="Way of enquiries *"
                value={form.enquiryWay}
                error={errors.enquiryWay}
                onChange={(e) => {
                  const code = e.target.value
                  clearFieldError('enquiryWay')
                  setForm({
                    ...form,
                    enquiryWay: code,
                    sourceId: code ? matchEnquirySourceId(sources, code) : '',
                  })
                }}
                options={[
                  { value: '', label: 'Select way of enquiry…' },
                  ...HMS_WAY_OF_ENQUIRIES.map((w) => ({ value: w.code, label: w.label })),
                ]}
              />
              <Input
                id="lead-field-enquiryDate"
                label="Enquiry date *"
                type="date"
                value={form.enquiryDate}
                error={errors.enquiryDate}
                onChange={(e) => {
                  clearFieldError('enquiryDate')
                  setForm({ ...form, enquiryDate: e.target.value })
                }}
              />
            </div>
            {form.enquiryWay === 'WEBSITE_CALLS' ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Website calls are often from other states — capture phone &amp; city carefully.
              </p>
            ) : null}
            {form.serviceType === 'RENTAL' ? (
              <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
                Saving notifies the <strong>service desk</strong> (chat + notification). Then issue the
                machine from{' '}
                <a href="/rentals" className="font-semibold underline">
                  Service → Rentals
                </a>{' '}
                so stock is reduced.
              </p>
            ) : form.serviceType !== 'SALES' ? (
              <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                You collect the customer details here. On save, the <strong>service team</strong> is
                notified automatically in <strong>#service</strong> chat and their notification
                inbox — they handle the ticket / stamping / renewal.
              </p>
            ) : null}
          </section>

          {/* 2. Customer */}
          <section
            id="lead-section-customer"
            className={cn(
              'scroll-mt-24 rounded-xl border border-border bg-muted/15 p-4',
              sectionErrorClass(
                Boolean(errors.name || errors.phone || errors.area || errors.email),
              ),
            )}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-text-primary">2. Customer details</h3>
              <p className="text-xs text-text-secondary">
                Search by name / phone / CUS-ID. If not found, choose <strong>Add new customer</strong> in
                the dropdown — or type details below.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ContactPicker
                className="sm:col-span-2 lg:col-span-3"
                label="Search customer *"
                valueId={form.contactId}
                selected={pickedContact}
                onSelect={onPickContact}
                returnTo="/sale-tracking?open=1"
                prospectMode={form.serviceType === 'SALES'}
              />
              <Input
                id="lead-field-name"
                label="Customer name *"
                placeholder="e.g. Meena Krishnan"
                value={form.name}
                error={errors.name}
                onChange={(e) => {
                  clearFieldError('name')
                  setForm({ ...form, name: e.target.value })
                }}
              />
              <Input
                label="Company / shop"
                placeholder="e.g. Harbour Traders"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
              <Input
                id="lead-field-email"
                label="Email"
                type="email"
                placeholder="name@company.in"
                value={form.email}
                error={errors.email}
                onChange={(e) => {
                  clearFieldError('email')
                  setForm({ ...form, email: e.target.value })
                }}
              />
              <PhoneInput
                id="lead-field-phone"
                label="Phone *"
                value={form.phone}
                error={errors.phone}
                onChange={(phone) => {
                  clearFieldError('phone')
                  setForm({ ...form, phone })
                }}
                hint="India (+91) — 10 digits"
              />
              <Input
                label="City"
                placeholder="Chennai"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <Input
                id="lead-field-area"
                label="Area *"
                placeholder="e.g. Anna Nagar, T. Nagar"
                value={form.area}
                error={errors.area}
                onChange={(e) => {
                  clearFieldError('area')
                  setForm({ ...form, area: e.target.value })
                }}
              />
              {form.serviceType !== 'SALES' ? (
                <p className="-mt-2 text-xs text-text-secondary sm:col-span-2 lg:col-span-3">
                  Area helps the service desk assign the right engineer.
                </p>
              ) : null}
              <Input
                label="State"
                placeholder="Tamil Nadu"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
          </section>

          {/* 3. Opportunity / requirement */}
          <section
            id="lead-section-opportunity"
            className={cn(
              'scroll-mt-24 rounded-xl border border-border bg-muted/15 p-4',
              sectionErrorClass(
                Boolean(
                  errors.productIds ||
                    errors.productId ||
                    errors.machineName ||
                    errors.machineType ||
                    errors.machineIssue ||
                    errors.clientCalledDate,
                ),
              ),
            )}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-text-primary">
                3.{' '}
                {form.serviceType === 'SALES'
                  ? 'Opportunity (products & pricing)'
                  : form.serviceType === 'RENTAL'
                    ? 'Rental requirement'
                    : form.serviceType === 'STAMPING'
                      ? 'Stamping requirement'
                      : 'Service requirement'}
              </h3>
              <p className="text-xs text-text-secondary">
                {form.serviceType === 'SALES'
                  ? 'What they want to buy, quoted price, and buy timeline.'
                  : 'Describe the machine / period / complaint so the handler knows the job.'}
              </p>
            </div>
            {form.serviceType === 'SALES' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  id="lead-field-productIds"
                  className={cn(
                    'sm:col-span-2 lg:col-span-3 rounded-xl border bg-card p-4',
                    errors.productIds
                      ? 'border-red-500 ring-2 ring-red-400/40'
                      : 'border-border',
                  )}
                >
                  <h4 className="text-sm font-semibold">Interested products *</h4>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Tick one or more. Primary product is used for demo stock.
                  </p>
                  {errors.productIds ? (
                    <p className="mt-1 text-xs font-medium text-red-600">Missing — {errors.productIds}</p>
                  ) : null}
                  <Input
                    className="mt-3"
                    label="Search catalog"
                    value={form.productSearch}
                    onChange={(e) => setForm({ ...form, productSearch: e.target.value })}
                    placeholder="Type product name or SKU…"
                  />
                  <div className="mt-3 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-2">
                    {products
                      .filter((p) => {
                        const q = form.productSearch.trim().toLowerCase()
                        if (!q) return true
                        return (
                          p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
                        )
                      })
                      .slice(0, 80)
                      .map((p) => {
                        const checked = form.productIds.includes(p.id)
                        return (
                          <label
                            key={p.id}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                              checked ? 'bg-violet-500/10' : 'hover:bg-muted/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? form.productIds.filter((id) => id !== p.id)
                                  : [...form.productIds, p.id]
                                clearFieldError('productIds')
                                clearFieldError('productId')
                                setForm({
                                  ...form,
                                  productIds: next,
                                  productId: next[0] ?? '',
                                  productInterest:
                                    next.map((id) => productName[id]).filter(Boolean).join(', ') ||
                                    form.productInterest,
                                })
                              }}
                            />
                            <span className="min-w-0">
                              <span className="block font-medium">{p.name}</span>
                              <span className="block text-[11px] text-text-secondary">{p.sku}</span>
                            </span>
                          </label>
                        )
                      })}
                  </div>
                  {form.productIds.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {form.productIds.map((id) => (
                        <Badge key={id} color="purple">
                          {productName[id] ?? id}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-amber-700">
                      Select at least one interested product for Sales.
                    </p>
                  )}
                </div>
                <Input
                  label="Product notes"
                  placeholder="Variant / capacity extras"
                  value={form.productInterest}
                  onChange={(e) => setForm({ ...form, productInterest: e.target.value })}
                />
                <Input
                  label="Buy timeline"
                  value={form.timeline}
                  onChange={(e) => setForm({ ...form, timeline: e.target.value })}
                  placeholder="This month / Q2"
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Input
                  id="lead-field-machineName"
                  label="Machine name *"
                  value={form.machineName}
                  error={errors.machineName}
                  onChange={(e) => {
                    clearFieldError('machineName')
                    setForm({ ...form, machineName: e.target.value })
                  }}
                  placeholder="e.g. Platform scale / Counting scale"
                />
                <Input
                  id="lead-field-machineType"
                  label="Machine type *"
                  value={form.machineType}
                  error={errors.machineType}
                  onChange={(e) => {
                    clearFieldError('machineType')
                    setForm({ ...form, machineType: e.target.value })
                  }}
                  placeholder={
                    form.serviceType === 'STAMPING'
                      ? 'Stamping / verification class…'
                      : form.serviceType === 'RENTAL'
                        ? 'Rental machine type…'
                        : 'Weighing / Platform / Table-top…'
                  }
                />
                <Input
                  id="lead-field-clientCalledDate"
                  label="Date client called *"
                  type="date"
                  value={form.clientCalledDate}
                  error={errors.clientCalledDate}
                  onChange={(e) => {
                    clearFieldError('clientCalledDate')
                    setForm({ ...form, clientCalledDate: e.target.value })
                  }}
                />
                <label className="block text-sm sm:col-span-2 lg:col-span-3">
                  <span className="mb-1 block font-medium text-text-secondary">Machine issue *</span>
                  <textarea
                    id="lead-field-machineIssue"
                    className={cn(
                      'min-h-24 w-full rounded-[6px] border bg-card p-3 text-sm outline-none focus:border-accent-blue',
                      errors.machineIssue
                        ? 'border-red-500 ring-2 ring-red-400/40'
                        : 'border-border',
                    )}
                    placeholder="What is wrong / what the customer asked for…"
                    value={form.machineIssue}
                    onChange={(e) => {
                      clearFieldError('machineIssue')
                      setForm({ ...form, machineIssue: e.target.value })
                    }}
                  />
                  {errors.machineIssue ? (
                    <p className="mt-1 text-xs font-medium text-red-600">
                      Missing — {errors.machineIssue}
                    </p>
                  ) : null}
                </label>
                <Input
                  className="sm:col-span-2 lg:col-span-3"
                  label="Extra notes (optional)"
                  value={form.productInterest}
                  onChange={(e) => setForm({ ...form, productInterest: e.target.value })}
                  placeholder="Serial no, site access, urgency…"
                />
              </div>
            )}
          </section>

          {/* 4. Sales payment — follows through sale → requisition → PI */}
          {form.serviceType === 'SALES' ? (
            <section className="rounded-xl border border-border bg-muted/15 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-text-primary">4. Payment</h3>
                <p className="text-xs text-text-secondary">
                  Total, advance and due stay on this sale overview and carry into requisition / PI.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Total ₹"
                  type="number"
                  placeholder="185000"
                  value={form.paymentTotal || form.budget}
                  error={errors.budget}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      paymentTotal: e.target.value,
                      budget: e.target.value,
                    })
                  }
                />
                <Input
                  label="Advance ₹"
                  type="number"
                  placeholder="0"
                  value={form.advanceAmount}
                  onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })}
                />
                <div className="rounded-[8px] border border-border bg-card px-3 py-2">
                  <div className="text-xs text-text-secondary">Due (auto)</div>
                  <div className="text-lg font-bold text-accent-amber">
                    {formatCurrency(
                      Math.max(
                        0,
                        (Number(form.paymentTotal || form.budget) || 0) -
                          (Number(form.advanceAmount) || 0),
                      ),
                    )}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {/* 5–7. Sales-only: follow-up, ownership/stage, notes */}
          {form.serviceType === 'SALES' ? (
            <section className="rounded-xl border border-border bg-muted/15 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-text-primary">5. Follow-up schedule</h3>
                <p className="text-xs text-text-secondary">
                  Creates a task on the assignee’s Workqueue and a bell notification. Reminder time
                  wins if both are set; otherwise the follow-up date is used (10:00).
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Next follow-up date"
                  type="date"
                  value={form.followUpDate}
                  onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                  hint="Day you plan to call back"
                />
                <Input
                  label="Reminder (date & time)"
                  type="datetime-local"
                  value={form.reminderAt}
                  onChange={(e) => setForm({ ...form, reminderAt: e.target.value })}
                  hint="Exact ping time · Workqueue + notifications"
                />
              </div>
            </section>
          ) : null}

          {form.serviceType === 'SALES' ? (
          <section
            id="lead-section-ownership"
            className={cn(
              'scroll-mt-24 rounded-xl border border-border bg-muted/15 p-4',
              sectionErrorClass(Boolean(errors.assignedToId)),
            )}
          >
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-text-primary">6. Ownership &amp; stage</h3>
              <p className="text-xs text-text-secondary">
                Who owns this sale and where it is — including Won and Sales closed.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="lead-field-assignedToId"
                label={isSales ? 'Sales executive' : 'Sales executive *'}
                value={form.assignedToId}
                error={errors.assignedToId}
                onChange={(e) => {
                  clearFieldError('assignedToId')
                  setForm({ ...form, assignedToId: e.target.value })
                }}
                options={
                  isSales
                    ? salesOptions
                    : [
                        {
                          value: '',
                          label: salesOptions.length
                            ? 'Select executive…'
                            : 'No sales executives — add in Users & Roles',
                        },
                        ...salesOptions,
                      ]
                }
                disabled={isSales}
              />
              <Select
                label="Lead stage / status"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value,
                    demoSerialId: e.target.value === 'DEMO' ? form.demoSerialId : '',
                    familyCode: e.target.value === 'DEMO' ? form.familyCode : '',
                    industryCode: e.target.value === 'DEMO' ? form.industryCode : '',
                  })
                }
                options={STATUS_OPTIONS.map((s) => ({
                  value: s.value,
                  label: s.label,
                }))}
              />
            </div>
            {isSales ? (
              <p className="mt-2 text-xs text-text-secondary">
                This lead is assigned to you — you cannot assign it to another executive.
              </p>
            ) : null}
          </section>
          ) : null}

          {/* Demo unit */}
          {form.status === 'DEMO' && form.serviceType === 'SALES' ? (
            <section
              id="lead-section-demo"
              className={cn(
                'scroll-mt-24 rounded-xl border bg-amber-50/50 p-4 dark:bg-amber-950/30',
                errors.familyCode ||
                  errors.industryCode ||
                  errors.productId ||
                  errors.demoSerialId
                  ? 'border-red-500 ring-2 ring-red-400/40 dark:border-red-500'
                  : 'border-amber-200 dark:border-amber-800/50',
              )}
            >
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-text-primary">Demo unit — from inventory</h3>
                <p className="text-xs text-text-secondary">
                  Family → industry (weighing) → machine → serial. Stock drops and the unit appears in{' '}
                  <strong>Inventory → Demo inventory</strong>.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  id="lead-field-familyCode"
                  label="1. Product family *"
                  value={form.familyCode}
                  onChange={(e) => {
                    clearFieldError('familyCode')
                    setForm({
                      ...form,
                      familyCode: e.target.value,
                      industryCode: '',
                      productId: '',
                      demoSerialId: '',
                      productInterest: '',
                    })
                  }}
                  options={[{ value: '', label: 'Select product…' }, ...HMS_FAMILY_OPTIONS]}
                  error={errors.familyCode}
                />
                {form.familyCode === 'WEIGHING_SCALES' ? (
                  <Select
                    id="lead-field-industryCode"
                    label="2. Industry *"
                    value={form.industryCode}
                    onChange={(e) => {
                      clearFieldError('industryCode')
                      setForm({
                        ...form,
                        industryCode: e.target.value,
                        productId: '',
                        demoSerialId: '',
                        productInterest: '',
                      })
                    }}
                    options={[
                      { value: '', label: 'Select industry…' },
                      ...industryOptions('WEIGHING_SCALES'),
                    ]}
                    error={errors.industryCode}
                  />
                ) : null}
                <SearchableSelect
                  label={form.familyCode === 'WEIGHING_SCALES' ? '3. Machine *' : '2. Machine *'}
                  value={form.productId}
                  options={productOptions}
                  onChange={(productId) => {
                    const name = productName[productId] ?? ''
                    clearFieldError('productId')
                    setForm({
                      ...form,
                      productId,
                      productInterest: name || form.productInterest,
                      demoSerialId: '',
                    })
                  }}
                  placeholder={
                    !form.familyCode
                      ? 'Select product family first…'
                      : form.familyCode === 'WEIGHING_SCALES' && !form.industryCode
                        ? 'Select industry first…'
                        : 'Select machine…'
                  }
                  error={errors.productId}
                />
                <Select
                  id="lead-field-demoSerialId"
                  label={form.familyCode === 'WEIGHING_SCALES' ? '4. Serial number *' : '3. Serial number *'}
                  value={form.demoSerialId}
                  error={errors.demoSerialId}
                  onChange={(e) => {
                    clearFieldError('demoSerialId')
                    setForm({ ...form, demoSerialId: e.target.value })
                  }}
                  options={[
                    {
                      value: '',
                      label: createDemoUnits.length
                        ? 'Select in-stock serial'
                        : form.productId
                          ? 'No stock — add serial in Inventory first'
                          : 'Select machine first',
                    },
                    ...createDemoUnits.map((u) => ({
                      value: u.id,
                      label: `${u.serialNo}${u.stampingDate ? ` · stamped ${formatDate(u.stampingDate)}` : ''}`,
                    })),
                  ]}
                />
              </div>
            </section>
          ) : null}

          {form.serviceType === 'SALES' ? (
            <section className="rounded-xl border border-border bg-muted/15 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-text-primary">7. Notes &amp; extras</h3>
                <p className="text-xs text-text-secondary">
                  Optional tags, website, and first comment for your follow-up.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Website"
                  value={form.website}
                  error={errors.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://company.in"
                />
                <Input
                  label="Tags"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="hot, exhibition"
                />
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium text-text-secondary">Updates / comments</span>
                  <textarea
                    className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
                    placeholder="First note on this lead…"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </label>
              </div>
            </section>
          ) : null}
        </form>
          </FormPanel>
        </>
      ) : pageTab === 'list' ? (
        <>
          {/* Compact pipeline + KPIs */}
          <div className="st-enter mb-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    Sales
                  </span>
                  <span className="text-sm font-semibold text-text-primary">
                    Lead → Demo → Convert → Proforma
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">
                  {isWh
                    ? 'Read-only sales list — same leads sales created. Open a row for products, then release from Approved releases.'
                    : 'Open / pending only — completed sales leave this list (Completed chip). You own lead & demo · convert notifies billing · warehouse/admin raise CRM proforma · GST invoice in Tally'}
                </p>
              </div>
              {canCreateLead ? (
                <Button size="sm" className="shrink-0" onClick={() => openCreateEnquiry()}>
                  <Plus size={14} /> New lead
                </Button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
              {[
                {
                  label: 'New',
                  value: statusCounts.NEW,
                  filter: 'NEW',
                  activeCls: 'bg-indigo-600 text-white',
                },
                {
                  label: 'Contacted',
                  value: statusCounts.CONTACTED,
                  filter: 'CONTACTED',
                  activeCls: 'bg-sky-600 text-white',
                },
                {
                  label: 'Qualified',
                  value: statusCounts.QUALIFIED,
                  filter: 'QUALIFIED',
                  activeCls: 'bg-violet-600 text-white',
                },
                {
                  label: 'On demo',
                  value: statusCounts.DEMO,
                  filter: 'DEMO',
                  activeCls: 'bg-amber-500 text-white',
                },
                {
                  label: 'Converted',
                  value: statusCounts.CONVERTED,
                  filter: 'CONVERTED',
                  activeCls: 'bg-emerald-600 text-white',
                },
                {
                  label: 'Completed',
                  value: statusCounts.COMPLETED,
                  filter: 'COMPLETED',
                  activeCls: 'bg-emerald-700 text-white',
                },
                {
                  label: 'Closed / lost',
                  value: statusCounts.LOST,
                  filter: 'LOST',
                  activeCls: 'bg-slate-600 text-white',
                },
              ].map((s) => {
                const active = status === s.filter
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setStatus(active ? '' : s.filter)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? `${s.activeCls} border-transparent`
                        : 'border-border bg-muted/40 text-text-secondary hover:bg-muted'
                    }`}
                  >
                    <span className="tabular-nums font-bold">{s.value}</span>
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          <Card className="st-enter st-delay-3 mb-3 flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                size={16}
              />
              <Input
                className="pl-9"
                placeholder={isDesk ? 'Search ENQ / name / phone / area…' : 'Search leads…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: '', label: 'Open / pending' },
                ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label })),
                { value: 'COMPLETED', label: 'Completed (payment done)' },
              ]}
              className="w-full sm:w-44"
            />
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full sm:w-40"
              options={[
                { value: '', label: 'All types' },
                ...HMS_SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label })),
              ]}
            />
            <Input
              className="w-full sm:w-40"
              placeholder="Area filter"
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={todayOnly}
                onChange={(e) => setTodayOnly(e.target.checked)}
              />
              Today’s calls
            </label>
            {!isSales && !isDesk && (
              <Select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="w-full sm:w-44"
                options={[
                  { value: '', label: 'All owners' },
                  { value: 'unassigned', label: 'Unassigned' },
                  ...salesOptions,
                ]}
              />
            )}
          </Card>

          <Card padding={false} className="st-enter st-delay-4 overflow-hidden">
            {loading ? (
              <TableSkeleton rows={8} />
            ) : loadError && items.length === 0 ? (
              <EmptyState
                title="Could not load leads"
                subtitle={loadError}
                actionLabel="Retry"
                onAction={() => void load()}
              />
            ) : visibleItems.length === 0 ? (
              <EmptyState
                title={status === 'COMPLETED' ? 'No completed sales' : 'No open leads'}
                subtitle={
                  status === 'COMPLETED'
                    ? 'Mark sale complete on the lead after payment — they appear here.'
                    : 'Completed sales leave this list. Open the Completed chip to find them.'
                }
                actionLabel={status === 'COMPLETED' || !canCreateLead ? undefined : 'Add lead'}
                onAction={
                  status === 'COMPLETED' || !canCreateLead ? undefined : () => openCreateEnquiry()
                }
              />
            ) : (
              <div className="overflow-x-auto">
                {isAdmin && selection.someSelected ? (
                  <div className="px-4 pt-3">
                    <BulkActionBar
                      count={selection.selectedCount}
                      noun="lead"
                      busy={busyDelete}
                      onClear={selection.clear}
                      onDelete={() => setConfirm({ ids: selection.selectedIds })}
                    />
                  </div>
                ) : null}
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="sticky top-0 z-[1] border-b border-border bg-muted/95 text-[11px] uppercase tracking-wide text-text-secondary backdrop-blur">
                    <tr>
                      <th className="w-10 px-4 py-3">
                        <SelectCheckbox
                          checked={selection.allSelected}
                          indeterminate={selection.someSelected && !selection.allSelected}
                          onChange={selection.toggleAll}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-3 py-3 font-medium">Enquiry</th>
                      <th className="min-w-[200px] px-3 py-3 font-medium">Customer</th>
                      <th className="min-w-[240px] px-3 py-3 font-medium">Customer ordered</th>
                      <th className="whitespace-nowrap px-3 py-3 font-medium">Quote</th>
                      <th className="px-3 py-3 font-medium">Owner</th>
                      <th className="px-3 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((lead, rowIdx) => {
                      const id = String(lead.id)
                      const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
                      const ordered = leadOrderedProducts(cf)
                      const quoteTotal = Number(cf.salePaymentTotal ?? cf.budget ?? 0)
                      const quoteAdvance = Number(cf.saleAdvanceAmount ?? 0)
                      const enquiryDate = cf.enquiry_date
                        ? formatDate(String(cf.enquiry_date))
                        : lead.createdAt
                          ? formatDate(String(lead.createdAt))
                          : '—'
                      const enquiryId = formatEnquiryId(lead)
                      const areaLabel = String(lead.area ?? cf.area ?? '').trim()
                      const stype = String(cf.serviceType ?? 'SALES')
                      const st = String(lead.status)
                      const canTriage =
                        (isDesk || isAdmin) &&
                        stype !== 'SALES' &&
                        !['LOST', 'UNQUALIFIED', 'CONVERTED'].includes(st) &&
                        !cf.serviceTicketId &&
                        !cf.rentalAgreementId
                      const busy = triageBusy === id
                      const stripe = statusStripe(st)
                      const handoffLabel =
                        stype === 'RENTAL'
                          ? 'Issue rental'
                          : stype === 'STAMPING'
                            ? 'Stamping'
                            : 'Service job'
                      return (
                        <tr
                          key={id}
                          className={`st-row st-enter cursor-pointer border-b border-border border-l-4 last:border-b-0 ${stripe} hover:bg-muted/35`}
                          style={{ animationDelay: `${Math.min(rowIdx, 12) * 35}ms` }}
                          onClick={() => navigate(`/sale-tracking/${id}`)}
                        >
                          <td
                            className="px-4 py-3.5 align-top"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SelectCheckbox
                              checked={selection.isSelected(id)}
                              onChange={() => selection.toggle(id)}
                              aria-label={`Select ${String(lead.name)}`}
                            />
                          </td>
                          <td className="px-3 py-3.5 align-top">
                            <div className="font-mono text-xs font-bold text-accent-blue">
                              {enquiryId}
                            </div>
                            <div className="mt-1">
                              {stype !== 'SALES' ? (
                                <Badge color="blue">{stype.replaceAll('_', ' ')}</Badge>
                              ) : (
                                <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                                  Sale
                                </span>
                              )}
                            </div>
                            <div className="mt-1 whitespace-nowrap text-[11px] text-text-secondary">
                              {enquiryDate}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 align-top">
                            <div className="font-semibold leading-snug text-text-primary">
                              {String(lead.name)}
                            </div>
                            {lead.company ? (
                              <div className="mt-0.5 text-xs text-text-secondary">
                                {String(lead.company)}
                              </div>
                            ) : null}
                            <div className="mt-1 tabular-nums text-xs text-text-secondary">
                              {formatPhone(String(lead.phone || '')) || '—'}
                            </div>
                            {areaLabel ? (
                              <div className="mt-1 text-[11px] text-text-secondary">
                                Area · {areaLabel}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3.5 align-top">
                            <OrderedProductsList products={ordered} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 align-top">
                            {quoteTotal > 0 ? (
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                                  Total
                                </div>
                                <div className="tabular-nums text-sm font-semibold text-text-primary">
                                  {formatCurrency(quoteTotal)}
                                </div>
                                {quoteAdvance > 0 ? (
                                  <div className="mt-1 text-[11px] text-text-secondary">
                                    Adv {formatCurrency(quoteAdvance)}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-xs text-text-secondary">No quote</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 align-top text-sm">
                            {lead.assignedToId ? (
                              <span className="font-medium text-text-primary">
                                {userName[String(lead.assignedToId)] ?? '—'}
                              </span>
                            ) : (
                              <span className="text-xs text-text-secondary">Unassigned</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 align-top">
                            <div className="flex flex-col items-start gap-1">
                              {cf.saleCompletedAt ? (
                                <Badge color="green" solid>
                                  Completed
                                </Badge>
                              ) : (
                                <Badge color={leadStatusColor[st] ?? 'gray'} solid>
                                  {statusLabel(st)}
                                </Badge>
                              )}
                              {cf.verified === false && !cf.saleCompletedAt ? (
                                <Badge color="amber">Unverified</Badge>
                              ) : null}
                              {cf.serviceTicketId ? <Badge color="green">Ticket</Badge> : null}
                              {cf.rentalAgreementId ? <Badge color="blue">Rental</Badge> : null}
                              {cf.serviceCompletedAt ? <Badge color="green">Job done</Badge> : null}
                            </div>
                          </td>
                          <td
                            className="px-4 py-3.5 align-top"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <ViewIconButton onClick={() => navigate(`/sale-tracking/${id}`)} />
                              {canTriage ? (
                                <>
                                  <Button
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => void triageHandoff(lead)}
                                  >
                                    {handoffLabel}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void triageMark(id, 'UNQUALIFIED')}
                                  >
                                    NQ
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => void triageMark(id, 'LOST')}
                                  >
                                    Close
                                  </Button>
                                </>
                              ) : cf.rentalAgreementId ? (
                                <Button size="sm" variant="outline" onClick={() => navigate('/rentals')}>
                                  Open rentals
                                </Button>
                              ) : cf.serviceTicketId ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => navigate(`/tickets/${String(cf.serviceTicketId)}`)}
                                >
                                  Open ticket
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
          )}
        </Card>
        </>
      ) : null}

      <FormPanel
        open={convertOpen}
        accent="theme"
        eyebrow="Leads"
        title="Convert sale"
        subtitle="Creates customer + deal. Demo serial is marked sold. Admin/warehouse raise CRM proforma next — final GST invoice stays in Tally."
        onClose={() => setConvertOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setConvertOpen(false)} />
            <Button onClick={() => void convert()} disabled={convertBusy}>
              {convertBusy ? 'Converting…' : 'Confirm conversion'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Deal stage"
            value={convertStageId}
            onChange={(e) => setConvertStageId(e.target.value)}
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
          />
          <p className="text-sm text-text-secondary sm:col-span-2 lg:col-span-2">
            Marks enquiry as Converted, links customer & deal, and finalises the demo serial as sold when applicable.
          </p>
        </div>
      </FormPanel>

      {/* Lead detail opens at /sale-tracking/:id */}




      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete lead?' : `Delete ${confirm?.ids.length ?? 0} leads?`}
        body={
          confirm?.ids.length === 1
            ? 'This lead will be permanently removed.'
            : 'Selected leads will be permanently removed.'
        }
      />

    </div>
  )
}
