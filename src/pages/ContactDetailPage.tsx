import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarClock,
  Clock,
  CircleDollarSign,
  Download,
  Edit3,
  Eye,
  FileText,
  Loader2,
  Mail,
  Package,
  Phone,
  ShoppingBag,
  Sparkles,
  Stamp,
  TicketCheck,
  TicketPlus,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { machineSourceTagsFromCf } from '@/lib/assetOrigin'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { formatServiceId } from '@/lib/serviceId'
import { Input } from '@/components/ui/Input'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { SparePartsPanel } from '@/components/contacts/SparePartsPanel'
import {
  ContactTimeline,
  buildContactTimelineEvents,
} from '@/components/contacts/ContactTimeline'
import { AiAssistCard } from '@/components/ai/AiAssistCard'
import { Select } from '@/components/ui/Select'
import { CatalogMachinePick } from '@/components/contacts/CatalogMachinePick'
import { Switch } from '@/components/ui/Switch'
import { api, ApiClientError, num } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS, isThirdPartyOrigin } from '@/lib/assetOrigin'
import {
  GC_MONTH_OPTIONS,
  addMonths,
  amcDueInfo,
  canEnrollAmc,
  coverageChargeHints,
  effectiveServicePlan,
  defaultAmcEndFromStart,
  defaultNextAmcService,
  defaultWarrantyEndFromToday,
  hmsSoldCoverage,
  isWeighingMachine,
  stampQuarterOf,
} from '@/lib/hmsCoverage'
import { formatCurrency, formatDate, formatPhone, cn } from '@/lib/utils'
import { indianMobileLocal, toStoredIndianMobile } from '@/lib/phoneIndia'
import { firstError, validateContactForm } from '@/lib/formValidation'
import { useUIStore } from '@/store/uiStore'
import { DetailSkeleton } from '@/components/ui/Skeleton'

type Tab =
  | 'Overview'
  | 'Timeline'
  | 'Machines'
  | 'AMC due'
  | 'Service'
  | 'Spare parts'
  | 'Stamping'
  | 'Rentals'
  | 'Notes'

const MACHINE_TYPES = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing machine' },
  { value: 'CCM', label: 'CCM' },
  { value: 'CCTV', label: 'CCTV' },
  { value: 'BIOMETRIC', label: 'Biometric' },
  { value: 'PAPER_SHREDDER', label: 'Paper shredder' },
  { value: 'PAPER_ROLL', label: 'Paper roll' },
  { value: 'OTHER', label: 'Other' },
]

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<Tab>('Overview')
  const [highlightAssetId, setHighlightAssetId] = useState<string | null>(null)
  const [machineOriginTab, setMachineOriginTab] = useState<'sold' | 'outside'>('sold')
  const [loading, setLoading] = useState(true)
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [savingMachine, setSavingMachine] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyResult, setHistoryResult] = useState<Record<string, unknown> | null>(null)
  const [rentals, setRentals] = useState<Array<Record<string, unknown>>>([])
  const [timelineExtras, setTimelineExtras] = useState<{
    activities: Array<Record<string, unknown>>
    spares: Array<Record<string, unknown>>
  }>({ activities: [], spares: [] })
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [relatedWidth, setRelatedWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem('nova.contact.relatedWidth'))
      if (Number.isFinite(n) && n >= 160 && n <= 320) return n
    } catch {
      /* ignore */
    }
    return 208
  })
  const relatedDrag = useRef<{ startX: number; startW: number } | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    mobile2: '',
    mobile3: '',
    whatsapp: '',
    landline: '',
    buildingName: '',
    street: '',
    doorNo: '',
    area: '',
    pincode: '',
    landmark: '',
    gpsLocation: '',
    city: '',
    state: '',
    accountId: '',
    ownerUserId: '',
    description: '',
  })
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [catalogProducts, setCatalogProducts] = useState<
    Array<{ id: string; name: string; sku?: string; attributes?: Record<string, unknown> | null }>
  >([])
  const [catalogBrands, setCatalogBrands] = useState<Array<{ id: string; name: string }>>([])
  const emptyMachineForm = {
    machineType: 'WEIGHING',
    stockType: '',
    brandId: '',
    catalogProductId: '',
    name: '',
    capacity: '',
    accuracy: '',
    platformSize: '',
    model: '',
    serialNo: '',
    origin: 'SOLD_BY_US',
    gcEnabled: true,
    amcEnabled: false,
    warrantyEndDate: defaultWarrantyEndFromToday(),
    amcStartDate: '',
    amcEndDate: '',
    nextServiceDueDate: '',
    remindersEnabled: true,
    stampingDate: new Date().toISOString().slice(0, 10),
    nextDueDate: addMonths(new Date().toISOString().slice(0, 10), 12),
    notes: '',
  }
  const [machineForm, setMachineForm] = useState(emptyMachineForm)

  function openAddMachine() {
    setEditingMachineId(null)
    setMachineForm({ ...emptyMachineForm })
    setMachineOpen(true)
  }

  function openEditMachine(a: Record<string, unknown>) {
    setEditingMachineId(String(a.id))
    const plan = String(a.servicePlan ?? 'NON_AMC')
    const gcOn = plan === 'GC' || Boolean(a.warrantyEndDate && plan !== 'AMC')
    const amcOn = plan === 'AMC'
    const acf =
      a.customFields && typeof a.customFields === 'object'
        ? (a.customFields as Record<string, unknown>)
        : {}
    setMachineForm({
      machineType: String(a.machineType ?? 'WEIGHING'),
      stockType: String(acf.catalogFamily ?? ''),
      brandId: String(acf.brandId ?? ''),
      catalogProductId: String(acf.catalogProductId ?? ''),
      name: String(a.name ?? ''),
      capacity: String(a.capacity ?? ''),
      accuracy: String(a.accuracy ?? ''),
      platformSize: String(a.platformSize ?? ''),
      model: String(a.model ?? ''),
      serialNo: String(a.serialNo ?? ''),
      origin: String(a.origin ?? 'SOLD_BY_US'),
      gcEnabled: gcOn && !amcOn ? true : plan === 'GC',
      amcEnabled: amcOn,
      warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate).slice(0, 10) : '',
      amcStartDate: a.amcStartDate ? String(a.amcStartDate).slice(0, 10) : '',
      amcEndDate: a.amcEndDate ? String(a.amcEndDate).slice(0, 10) : '',
      nextServiceDueDate: a.nextServiceDueDate ? String(a.nextServiceDueDate).slice(0, 10) : '',
      remindersEnabled: a.remindersEnabled !== false,
      stampingDate: a.stampingDate ? String(a.stampingDate).slice(0, 10) : '',
      nextDueDate: a.nextDueDate ? String(a.nextDueDate).slice(0, 10) : '',
      notes: String(a.notes ?? ''),
    })
    setMachineOpen(true)
  }

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups, rentalRows] = await Promise.all([
        api.getContact(id),
        api.lookups(),
        api.rentals({ contactId: id }).catch(() => [] as Array<Record<string, unknown>>),
      ])
      setContact(row)
      setRentals(Array.isArray(rentalRows) ? rentalRows : [])
      setAccounts(lookups.accounts)
      setUsers(lookups.users)
      setCatalogProducts(
        (lookups.products ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name ?? ''),
          sku: String(p.sku ?? ''),
          attributes: (p.attributes as Record<string, unknown> | null) ?? null,
        })),
      )
      try {
        const [productPage, brandRows] = await Promise.all([
          api.products({ limit: 200 }),
          api.inventoryBrands(),
        ])
        if (productPage.items?.length) {
          setCatalogProducts(
            productPage.items.map((p) => ({
              id: String(p.id),
              name: String(p.name ?? ''),
              sku: String(p.sku ?? ''),
              attributes: (p.attributes as Record<string, unknown> | null) ?? null,
            })),
          )
        }
        setCatalogBrands(
          (brandRows ?? []).map((b) => ({ id: String(b.id), name: String(b.name ?? '') })),
        )
      } catch {
        /* catalog from lookups is enough */
      }
      const custom = (row.customFields as Record<string, unknown> | null) ?? {}
      setForm({
        name: String(row.name ?? ''),
        email: String(row.email ?? ''),
        phone: String(row.phone ?? ''),
        mobile: indianMobileLocal(String(row.mobile ?? row.phone ?? '')),
        mobile2: indianMobileLocal(String(custom.mobile_2 ?? '')),
        mobile3: indianMobileLocal(String(custom.mobile_3 ?? '')),
        whatsapp: indianMobileLocal(String(custom.whatsapp ?? '')),
        landline: String(custom.landline ?? ''),
        buildingName: String(custom.building_name ?? ''),
        street: String(row.street ?? ''),
        doorNo: String(row.doorNo ?? ''),
        area: String(row.area ?? ''),
        pincode: String(row.pincode ?? ''),
        landmark: String(row.location ?? ''),
        gpsLocation: String(custom.gps_location ?? ''),
        city: String(row.city ?? ''),
        state: String(row.state ?? ''),
        accountId: String(row.accountId ?? ''),
        ownerUserId: String(row.ownerUserId ?? ''),
        description: String(row.description ?? ''),
      })
      // Timeline extras (activities + spares) — non-blocking
      setTimelineLoading(true)
      void Promise.all([
        api.activities({ contactId: id, limit: 100 }).catch(() => ({ items: [] })),
        api.spareParts({ contactId: id, limit: 100 }).catch(() => ({ items: [] })),
      ]).then(([acts, spares]) => {
        setTimelineExtras({
          activities: (acts.items ?? []) as Array<Record<string, unknown>>,
          spares: (spares.items ?? []) as Array<Record<string, unknown>>,
        })
      }).finally(() => setTimelineLoading(false))
    } catch {
      setContact(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Deep-link from service report / tickets: ?tab=spares|machines&assetId=
  useEffect(() => {
    const raw = (searchParams.get('tab') || '').toLowerCase()
    const assetId = searchParams.get('assetId') || searchParams.get('machineId') || ''
    if (!raw && !assetId) return

    let nextTab: Tab | null = null
    if (raw === 'spares' || raw === 'spare' || raw === 'spare-parts' || raw === 'spare parts') {
      nextTab = 'Spare parts'
    } else if (raw === 'machines' || raw === 'machine') {
      nextTab = 'Machines'
    } else if (raw === 'overview' || raw === 'timeline' || raw === 'service' || raw === 'stamping' || raw === 'rentals' || raw === 'notes' || raw === 'amc due' || raw === 'amc') {
      const map: Record<string, Tab> = {
        overview: 'Overview',
        timeline: 'Timeline',
        service: 'Service',
        stamping: 'Stamping',
        rentals: 'Rentals',
        notes: 'Notes',
        'amc due': 'AMC due',
        amc: 'AMC due',
      }
      nextTab = map[raw] ?? null
    }

    if (assetId) {
      setHighlightAssetId(assetId)
      if (!nextTab) nextTab = 'Machines'
    }
    if (nextTab) setTab(nextTab)

    const cleaned = new URLSearchParams(searchParams)
    cleaned.delete('tab')
    cleaned.delete('assetId')
    cleaned.delete('machineId')
    setSearchParams(cleaned, { replace: true })
  }, [searchParams, setSearchParams])

  async function saveEdit() {
    if (!id) return
    const nextErrors = validateContactForm({
      name: form.name,
      email: form.email,
      phone: form.phone,
      mobile: form.mobile,
      country: 'IN',
      landline: form.landline,
      whatsapp: form.whatsapp,
      mobile2: form.mobile2,
      mobile3: form.mobile3,
    })
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      return
    }
    try {
      const prevCustom =
        contact?.customFields && typeof contact.customFields === 'object'
          ? (contact.customFields as Record<string, unknown>)
          : {}
      const mobileStored = toStoredIndianMobile(form.mobile)
      const waStored = toStoredIndianMobile(form.whatsapp) || mobileStored
      const updated = await api.updateContact(id, {
        name: form.name,
        email: form.email || null,
        phone: form.landline.trim() || mobileStored || waStored,
        mobile: mobileStored,
        street: form.street || null,
        doorNo: form.doorNo || null,
        area: form.area || null,
        pincode: form.pincode || null,
        location: form.landmark || null,
        city: form.city || null,
        state: form.state || null,
        accountId: form.accountId || null,
        ownerUserId: form.ownerUserId || null,
        description: form.description || null,
        customFields: {
          ...prevCustom,
          building_name: form.buildingName.trim() || null,
          landline: form.landline.trim() || null,
          mobile_2: toStoredIndianMobile(form.mobile2),
          mobile_3: toStoredIndianMobile(form.mobile3),
          whatsapp: waStored,
          gps_location: form.gpsLocation.trim() || null,
        },
      })
      setContact(updated)
      setEditOpen(false)
      addToast({ type: 'success', message: 'Customer updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    }
  }

  function downloadPurchasesCsv() {
    if (!contact) return
    const invs = (contact.invoices as Array<Record<string, unknown>>) ?? []
    const products = ((contact.purchaseSummary as { productsBought?: Array<Record<string, unknown>> })
      ?.productsBought ?? []) as Array<{
      name?: string
      sku?: string
      qty?: number
      amount?: number
    }>
    const lines = [
      ['Type', 'Reference', 'Date', 'SKU', 'Item', 'Qty', 'Amount', 'Status'].join(','),
      ...products.map((p) =>
        [
          'Product',
          '',
          '',
          csvEscape(String(p.sku ?? '')),
          csvEscape(String(p.name ?? '')),
          String(p.qty ?? 0),
          String(p.amount ?? 0),
          '',
        ].join(','),
      ),
      ...invs.map((inv) =>
        [
          'Invoice',
          csvEscape(String(inv.invoiceNumber ?? '')),
          inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : '',
          '',
          '',
          '',
          String(num(inv.grandTotal)),
          csvEscape(String(inv.status ?? '')),
        ].join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${String(contact.customerCode || contact.name || 'customer').replace(/\s+/g, '_')}_purchases.csv`
    a.click()
    URL.revokeObjectURL(url)
    addToast({ type: 'success', message: 'Purchases CSV downloaded' })
  }

  async function addNote() {
    if (!id || !noteDraft.trim()) return
    setNoteBusy(true)
    try {
      await api.addContactNote(id, noteDraft.trim())
      setNoteDraft('')
      addToast({ type: 'success', message: 'Note added' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not add note',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  async function saveNoteEdit() {
    if (!id || !editingNoteId || !editingNoteText.trim()) return
    setNoteBusy(true)
    try {
      await api.updateContactNote(id, editingNoteId, editingNoteText.trim())
      setEditingNoteId(null)
      setEditingNoteText('')
      addToast({ type: 'success', message: 'Note updated' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update note',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  async function deleteNote(noteId: string) {
    if (!id) return
    setNoteBusy(true)
    try {
      await api.deleteContactNote(id, noteId)
      addToast({ type: 'success', message: 'Note deleted' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete note',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  async function saveMachine() {
    if (!id || !machineForm.name.trim()) {
      addToast({ type: 'error', message: 'Machine name is required' })
      return
    }
    if (
      machineForm.origin === 'SOLD_BY_US' &&
      !editingMachineId &&
      (!machineForm.stockType || !machineForm.brandId || !machineForm.catalogProductId)
    ) {
      addToast({ type: 'error', message: 'Sold by us — select machine type, brand, and model' })
      return
    }
    if (machineForm.amcEnabled && !isWeighingMachine(machineForm.machineType)) {
      addToast({
        type: 'error',
        message: 'AMC is only for weighing machines — billing and other machines stay on GC/NGC',
      })
      return
    }
    if (machineForm.gcEnabled && !machineForm.warrantyEndDate) {
      addToast({ type: 'error', message: 'Set GC end date' })
      return
    }
    if (machineForm.amcEnabled && !machineForm.amcEndDate) {
      addToast({ type: 'error', message: 'Set AMC end date' })
      return
    }
    if (
      machineForm.amcEnabled &&
      machineForm.amcStartDate &&
      machineForm.amcEndDate &&
      machineForm.amcEndDate < machineForm.amcStartDate
    ) {
      addToast({ type: 'error', message: 'AMC end date must be on or after start date' })
      return
    }
    const soldByUs = machineForm.origin === 'SOLD_BY_US'
    const weighing = isWeighingMachine(machineForm.machineType)
    const coverage = soldByUs ? hmsSoldCoverage(new Date(), weighing) : null
    const servicePlan = machineForm.amcEnabled
      ? 'AMC'
      : machineForm.gcEnabled || soldByUs
        ? 'GC'
        : 'NGC'
    setSavingMachine(true)
    try {
      const editingAsset = ((contact?.assets as Array<Record<string, unknown>>) ?? []).find(
        (a) => String(a.id) === editingMachineId,
      )
      const prevCf =
        editingAsset?.customFields && typeof editingAsset.customFields === 'object'
          ? (editingAsset.customFields as Record<string, unknown>)
          : {}
      const amcStart =
        servicePlan === 'AMC'
          ? machineForm.amcStartDate || new Date().toISOString().slice(0, 10)
          : null
      const body = {
        contactId: id,
        machineType: machineForm.machineType,
        name: machineForm.name.trim(),
        capacity: machineForm.capacity || null,
        accuracy: machineForm.accuracy || null,
        platformSize: machineForm.platformSize || null,
        model: machineForm.model || null,
        serialNo: machineForm.serialNo || null,
        origin: machineForm.origin,
        servicePlan,
        warrantyEndDate:
          servicePlan === 'GC'
            ? machineForm.warrantyEndDate || coverage?.warrantyEndDate || defaultWarrantyEndFromToday()
            : machineForm.warrantyEndDate || null,
        amcStartDate: amcStart,
        amcEndDate:
          servicePlan === 'AMC'
            ? machineForm.amcEndDate || defaultAmcEndFromStart(amcStart)
            : null,
        nextServiceDueDate:
          servicePlan === 'AMC'
            ? machineForm.nextServiceDueDate || defaultNextAmcService(amcStart || undefined)
            : null,
        remindersEnabled: machineForm.remindersEnabled,
        stampingDate:
          machineForm.stampingDate || (weighing ? coverage?.stampingDate : null) || null,
        nextDueDate:
          machineForm.nextDueDate || (weighing ? coverage?.nextDueDate : null) || null,
        notes: machineForm.notes || null,
        customFields: {
          ...prevCf,
          ...(machineForm.catalogProductId
            ? { catalogProductId: machineForm.catalogProductId }
            : {}),
          ...(machineForm.brandId
            ? {
                brandId: machineForm.brandId,
                brandName: catalogBrands.find((b) => b.id === machineForm.brandId)?.name ?? null,
              }
            : {}),
          ...(machineForm.stockType ? { catalogFamily: machineForm.stockType } : {}),
          ...(coverage
            ? {
                soldAt: prevCf.soldAt ?? coverage.soldAt,
                stampingQuarter: prevCf.stampingQuarter ?? coverage.stampingQuarter,
                stampingQuarterYear: prevCf.stampingQuarterYear ?? coverage.stampingQuarterYear,
              }
            : {}),
        },
      }
      if (editingMachineId) {
        await api.updateAsset(editingMachineId, body)
        addToast({ type: 'success', message: 'Machine updated' })
      } else {
        await api.createAsset(body)
        addToast({ type: 'success', message: 'Machine added' })
      }
      setMachineOpen(false)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save machine',
      })
    } finally {
      setSavingMachine(false)
    }
  }

  async function runCustomerHistorySummary() {
    if (!contact?.id && !id) return
    const contactId = String(contact?.id ?? id)
    setHistoryOpen(true)
    setHistoryBusy(true)
    setHistoryResult(null)
    try {
      const data = await api.aiCustomerAssist({ contactId, action: 'summarize' })
      setHistoryResult(data)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load AI history summary',
      })
      setHistoryOpen(false)
    } finally {
      setHistoryBusy(false)
    }
  }

  if (loading) {
    return <DetailSkeleton />
  }

  if (!contact) {
    return (
      <Card>
        <EmptyState
          icon={<UserRound size={26} />}
          title="Contact not found"
          subtitle="This contact may have been removed or the link is incorrect."
          actionLabel="Back to contacts"
          onAction={() => navigate('/contacts')}
        />
      </Card>
    )
  }

  const account = contact.account as Record<string, unknown> | null | undefined
  const deals = (contact.deals as Array<Record<string, unknown>>) ?? []
  const tickets = (contact.tickets as Array<Record<string, unknown>>) ?? []
  const notes = (contact.notes as Array<Record<string, unknown>>) ?? []
  const invoices = (contact.invoices as Array<Record<string, unknown>>) ?? []
  const purchaseSummary = (contact.purchaseSummary as {
    invoiceCount: number
    totalBilled: number
    totalPaid: number
    productsBought: Array<{ id: string; sku: string; name: string; qty: number; amount: number; imageUrl?: string | null }>
  }) ?? { invoiceCount: 0, totalBilled: 0, totalPaid: 0, productsBought: [] }
  const custom = (contact.customFields as Record<string, unknown> | null) ?? {}

  return (
    <div className="pb-8">
      {/* Zoho-style contact header */}
      <div className="mb-4 flex flex-wrap items-start gap-4 border-b border-border pb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/contacts')}>
          <ArrowLeft size={16} /> Contacts
        </Button>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar name={String(contact.name)} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-text-primary sm:text-2xl">
              {String(contact.name)}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {contact.customerCode ? (
                <span className="font-mono text-xs font-semibold text-text-secondary">
                  {String(contact.customerCode)}
                </span>
              ) : null}
              {account ? (
                <Link
                  to={`/accounts/${account.id}`}
                  className="inline-flex items-center gap-1 font-medium text-accent-blue hover:underline"
                >
                  <Building2 size={13} /> {String(account.name)}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contact.email ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `mailto:${String(contact.email)}`
              }}
            >
              <Mail size={14} /> Send email
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit3 size={14} /> Edit
          </Button>
          <Button
            size="sm"
            onClick={() =>
              navigate(
                `/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1${
                  contact.accountId
                    ? `&accountId=${encodeURIComponent(String(contact.accountId))}`
                    : ''
                }`,
              )
            }
          >
            <TicketPlus size={14} /> New service ticket
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void runCustomerHistorySummary()}>
            <Sparkles size={14} /> AI
          </Button>
        </div>
      </div>

      <div className="mb-4" id="customer-ai">
        <AiAssistCard
          title="Customer AI"
          subtitle="History summary · machines due · visit questions. Verify dates on the profile."
          actions={[
            {
              id: 'summarize',
              label: 'History summary',
              run: () => api.aiCustomerAssist({ contactId: String(contact.id), action: 'summarize' }),
            },
            {
              id: 'machines_due',
              label: 'Machines due / stamping',
              run: () => api.aiCustomerAssist({ contactId: String(contact.id), action: 'machines_due' }),
            },
            {
              id: 'visit_questions',
              label: 'What to ask next visit',
              run: () =>
                api.aiCustomerAssist({ contactId: String(contact.id), action: 'visit_questions' }),
            },
          ]}
        />
      </div>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Customer history summary"
        subtitle={String(contact.name)}
        size="md"
        accent="violet"
        footer={
          <Button variant="outline" onClick={() => setHistoryOpen(false)}>
            Close
          </Button>
        }
      >
        {historyBusy ? (
          <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin" /> Reading tickets, machines, parts & invoices…
          </div>
        ) : historyResult ? (
          <div className="space-y-3 text-sm">
            {typeof historyResult.answer === 'string' ? (
              <p className="whitespace-pre-wrap leading-relaxed text-text-primary">
                {historyResult.answer}
              </p>
            ) : null}
            {Array.isArray(historyResult.bullets) && historyResult.bullets.length ? (
              <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                {(historyResult.bullets as string[]).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {Array.isArray(historyResult.flags) && historyResult.flags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {(historyResult.flags as string[]).map((f) => (
                  <Badge key={f} color="amber">
                    {f}
                  </Badge>
                ))}
              </div>
            ) : null}
            {Array.isArray(historyResult.visitQuestions) && historyResult.visitQuestions.length ? (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-text-secondary">
                  Next visit
                </div>
                <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                  {(historyResult.visitQuestions as string[]).map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {typeof historyResult.disclaimer === 'string' ? (
              <p className="text-xs text-text-secondary">{historyResult.disclaimer}</p>
            ) : null}
          </div>
        ) : (
          <p className="py-6 text-sm text-text-secondary">No summary yet.</p>
        )}
      </Modal>

      <FormPanel
        open={editOpen}
        accent="theme"
        eyebrow="Customers"
        title="Edit customer"
        subtitle="Company, address, phones, WhatsApp, GPS and executive."
        width={560}
        storageKey="nova.drawer.contact.edit"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setEditOpen(false)} />
            <Button type="submit" form="edit-contact-form">
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-contact-form"
          onSubmit={(e) => {
            e.preventDefault()
            void saveEdit()
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Input
            label="Company / shop / customer name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="sm:col-span-2 lg:col-span-3"
          />
          <Input label="Door number" value={form.doorNo} onChange={(e) => setForm({ ...form, doorNo: e.target.value })} />
          <Input label="Street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
          <Input
            label="Building name"
            value={form.buildingName}
            onChange={(e) => setForm({ ...form, buildingName: e.target.value })}
          />
          <Input label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="PIN code" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
          <Input
            label="Landmark"
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
            className="sm:col-span-2"
          />
          <Input
            label="Landline number"
            value={form.landline}
            onChange={(e) => setForm({ ...form, landline: e.target.value, phone: e.target.value })}
            placeholder="Optional landline"
          />
          <PhoneInput
            label="Mobile number 1"
            required
            value={form.mobile}
            onChange={(mobile) => setForm({ ...form, mobile })}
            hint="India (+91) — enter 10 digits only"
          />
          <PhoneInput
            label="Mobile number 2"
            value={form.mobile2}
            onChange={(mobile2) => setForm({ ...form, mobile2 })}
          />
          <PhoneInput
            label="Mobile number 3"
            value={form.mobile3}
            onChange={(mobile3) => setForm({ ...form, mobile3 })}
          />
          <PhoneInput
            id="contact-whatsapp"
            label={
              <span className="inline-flex items-center gap-1.5">
                <WhatsAppIcon size={14} />
                <span style={{ color: WA_GREEN }}>WhatsApp number</span>
              </span>
            }
            value={form.whatsapp}
            onChange={(whatsapp) => setForm({ ...form, whatsapp })}
            hint="Defaults to mobile 1 if empty"
          />
          <Input label="Email ID" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input
            label="GPS location"
            value={form.gpsLocation}
            onChange={(e) => setForm({ ...form, gpsLocation: e.target.value })}
            className="sm:col-span-2 lg:col-span-3"
          />
          <Select
            label="Lead — name of the executive"
            value={form.ownerUserId}
            onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
            options={[{ value: '', label: 'Select executive' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Select
            label="Account (optional)"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'Select account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>
      </FormPanel>

      <Drawer
        open={machineOpen}
        width={560}
        storageKey="nova.drawer.contact.machine"
        onClose={() => {
          setMachineOpen(false)
          setEditingMachineId(null)
        }}
        title={
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Machines
            </div>
            <div className="text-lg font-semibold text-text-primary">
              {editingMachineId ? 'Edit machine' : 'Add machine'}
            </div>
            <p className="mt-0.5 text-sm font-normal text-text-secondary">
              Sold by us or Outside · toggle GC / AMC for dates
            </p>
          </div>
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMachineOpen(false)
                setEditingMachineId(null)
              }}
            >
              Cancel
            </Button>
            <Button disabled={savingMachine} onClick={() => void saveMachine()}>
              {savingMachine ? 'Saving…' : editingMachineId ? 'Save changes' : 'Save machine'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-xs text-text-secondary">
            <strong className="text-text-primary">How to store:</strong> pick origin → identity →
            coverage (GC / NGC / AMC) → stamping dates from engineer after a stamping job.
          </div>
          <div className="sm:col-span-2">
            <Select
              label="1. Machine origin *"
              value={machineForm.origin}
              onChange={(e) => {
                const origin = e.target.value
                const today = new Date().toISOString().slice(0, 10)
                const weighing = isWeighingMachine(machineForm.machineType)
                const coverage = origin === 'SOLD_BY_US' ? hmsSoldCoverage(today, weighing) : null
                setMachineForm({
                  ...machineForm,
                  origin,
                  gcEnabled: origin === 'SOLD_BY_US' ? true : machineForm.gcEnabled,
                  warrantyEndDate:
                    origin === 'SOLD_BY_US'
                      ? machineForm.warrantyEndDate || coverage?.warrantyEndDate || today
                      : machineForm.warrantyEndDate,
                  stampingDate:
                    origin === 'SOLD_BY_US' && weighing
                      ? machineForm.stampingDate || coverage?.stampingDate || today
                      : machineForm.stampingDate,
                  nextDueDate:
                    origin === 'SOLD_BY_US' && weighing
                      ? machineForm.nextDueDate || coverage?.nextDueDate || ''
                      : machineForm.nextDueDate,
                })
              }}
              options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {ASSET_ORIGIN_OPTIONS.find((o) => o.value === machineForm.origin)?.hint}
            </p>
          </div>
          {machineForm.origin === 'SOLD_BY_US' ? (
            <>
              <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
                <CatalogMachinePick
                  products={catalogProducts}
                  brands={catalogBrands}
                  stockType={machineForm.stockType}
                  brandId={machineForm.brandId}
                  productId={machineForm.catalogProductId}
                  onChange={(next) =>
                    setMachineForm({
                      ...machineForm,
                      stockType: next.stockType,
                      brandId: next.brandId,
                      catalogProductId: next.productId,
                      name: next.name,
                      model: next.model,
                      machineType: next.machineType,
                      capacity: next.capacity || machineForm.capacity,
                      amcEnabled:
                        machineForm.amcEnabled && isWeighingMachine(next.machineType)
                          ? true
                          : false,
                    })
                  }
                />
              </div>
              {machineForm.name ? (
                <p className="sm:col-span-2 -mt-2 text-xs text-text-secondary">
                  Selected: <strong className="text-text-primary">{machineForm.name}</strong>
                </p>
              ) : (
                <p className="sm:col-span-2 -mt-2 text-xs text-text-secondary">
                  Same as inventory: type → brand → model.
                </p>
              )}
            </>
          ) : (
            <>
              <Select
                label="2. Machine type"
                value={machineForm.machineType}
                onChange={(e) => {
                  const machineType = e.target.value
                  setMachineForm({
                    ...machineForm,
                    machineType,
                    amcEnabled:
                      machineForm.amcEnabled && isWeighingMachine(machineType) ? true : false,
                  })
                }}
                options={MACHINE_TYPES}
              />
              <Input
                label="Machine name *"
                placeholder="WEIGHING SCALE 20KG"
                value={machineForm.name}
                onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
              />
              <Input
                label="Model"
                value={machineForm.model}
                onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })}
              />
            </>
          )}
          <Input label="Capacity" placeholder="20KG / CAP" value={machineForm.capacity} onChange={(e) => setMachineForm({ ...machineForm, capacity: e.target.value })} />
          <Input label="Accuracy" placeholder="ACC" value={machineForm.accuracy} onChange={(e) => setMachineForm({ ...machineForm, accuracy: e.target.value })} />
          <Input label="Platform size" value={machineForm.platformSize} onChange={(e) => setMachineForm({ ...machineForm, platformSize: e.target.value })} />
          <Input label="Serial number" value={machineForm.serialNo} onChange={(e) => setMachineForm({ ...machineForm, serialNo: e.target.value })} />
          <div className="sm:col-span-2 space-y-3 rounded-[10px] border border-emerald-200/70 bg-emerald-50/50 px-3 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
              3. Coverage — GC / AMC
            </div>
            <p className="text-xs text-text-secondary">
              Turn on GC and/or AMC. Fields appear only when enabled. Off = NGC (chargeable).
            </p>

            <div className="rounded-lg border border-border bg-card/80 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">GC (guarantee)</div>
                  <p className="text-xs text-text-secondary">Parts + service free until GC end date</p>
                </div>
                <Switch
                  label="GC"
                  checked={machineForm.gcEnabled}
                  onChange={(on) => {
                    if (on) {
                      setMachineForm({
                        ...machineForm,
                        gcEnabled: true,
                        amcEnabled: false,
                        warrantyEndDate:
                          machineForm.warrantyEndDate || defaultWarrantyEndFromToday(),
                      })
                    } else {
                      setMachineForm({ ...machineForm, gcEnabled: false })
                    }
                  }}
                />
              </div>
              {machineForm.gcEnabled ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Select
                    label="GC duration"
                    value=""
                    onChange={(e) => {
                      const months = Number(e.target.value)
                      if (!months) return
                      setMachineForm({
                        ...machineForm,
                        warrantyEndDate: addMonths(new Date().toISOString().slice(0, 10), months),
                      })
                    }}
                    options={[
                      { value: '', label: 'Set end date…' },
                      ...GC_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                    ]}
                  />
                  <Input
                    label="GC end date *"
                    type="date"
                    value={machineForm.warrantyEndDate}
                    onChange={(e) =>
                      setMachineForm({ ...machineForm, warrantyEndDate: e.target.value })
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-border bg-card/80 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">AMC</div>
                  <p className="text-xs text-text-secondary">
                    Weighing only — after 1-year GC, or convert an existing weighing customer.
                    2 visits/year · parts charged
                  </p>
                </div>
                <Switch
                  label="AMC"
                  checked={machineForm.amcEnabled}
                  disabled={!isWeighingMachine(machineForm.machineType)}
                  onChange={(on) => {
                    if (on && !isWeighingMachine(machineForm.machineType)) {
                      addToast({ type: 'error', message: 'AMC is only for weighing machines' })
                      return
                    }
                    if (on) {
                      const start =
                        machineForm.amcStartDate || new Date().toISOString().slice(0, 10)
                      setMachineForm({
                        ...machineForm,
                        amcEnabled: true,
                        gcEnabled: false,
                        amcStartDate: start,
                        amcEndDate: machineForm.amcEndDate || defaultAmcEndFromStart(start),
                        nextServiceDueDate:
                          machineForm.nextServiceDueDate || defaultNextAmcService(start),
                      })
                    } else {
                      setMachineForm({ ...machineForm, amcEnabled: false })
                    }
                  }}
                />
              </div>
              {!isWeighingMachine(machineForm.machineType) ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  AMC is not available for this machine type.
                </p>
              ) : null}
              {machineForm.amcEnabled ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="AMC start date"
                    type="date"
                    value={machineForm.amcStartDate}
                    onChange={(e) => {
                      const start = e.target.value
                      setMachineForm({
                        ...machineForm,
                        amcStartDate: start,
                        amcEndDate: defaultAmcEndFromStart(start),
                        nextServiceDueDate: defaultNextAmcService(start),
                      })
                    }}
                  />
                  <Input
                    label="AMC end date *"
                    type="date"
                    value={machineForm.amcEndDate}
                    onChange={(e) =>
                      setMachineForm({ ...machineForm, amcEndDate: e.target.value })
                    }
                  />
                  <Input
                    label="Next free service (6 mo)"
                    type="date"
                    value={machineForm.nextServiceDueDate}
                    onChange={(e) =>
                      setMachineForm({ ...machineForm, nextServiceDueDate: e.target.value })
                    }
                  />
                  <p className="sm:col-span-2 text-xs text-text-secondary">
                    AMC covers service visits only. Spare parts / replacements are charged to the
                    customer.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          {machineForm.machineType === 'WEIGHING' ? (
            <div className="sm:col-span-2 rounded-[10px] border border-violet-200/70 bg-violet-50/50 px-3 py-3 dark:border-violet-900/40 dark:bg-violet-950/20">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                4. Stamping (engineer-owned)
              </div>
              <p className="mb-3 text-xs text-text-secondary">
                After a stamping ticket, the engineer enters stamp date + valid till. Those values
                sync here automatically. Edit only to correct history.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Last stamp date (engineer)"
                  type="date"
                  value={machineForm.stampingDate}
                  onChange={(e) => setMachineForm({ ...machineForm, stampingDate: e.target.value })}
                />
                <Input
                  label="Stamping valid till"
                  type="date"
                  value={machineForm.nextDueDate}
                  onChange={(e) => setMachineForm({ ...machineForm, nextDueDate: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <Input
            label="Notes"
            value={machineForm.notes}
            onChange={(e) => setMachineForm({ ...machineForm, notes: e.target.value })}
            className="sm:col-span-2"
          />
        </div>
      </Drawer>

      {/* Related list + workspace (Zoho-style) */}
      {(() => {
        const assets = (contact.assets as Array<Record<string, unknown>>) ?? []
        const stampCount = assets.filter(
          (a) => a.machineType === 'WEIGHING' || a.stampingDate || a.nextDueDate,
        ).length
        const amcDueCount = assets.filter((a) =>
          Boolean(
            amcDueInfo({
              machineType: a.machineType ? String(a.machineType) : null,
              servicePlan: a.servicePlan ? String(a.servicePlan) : null,
              warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
              amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
              nextServiceDueDate: a.nextServiceDueDate ? String(a.nextServiceDueDate) : null,
            }),
          ),
        ).length
        const openTickets = tickets.filter(
          (t) => !['RESOLVED', 'CLOSED'].includes(String(t.status)),
        )
        const owner = users.find((u) => u.id === String(contact.ownerUserId ?? ''))
        const related: Array<{
          id: Tab
          label: string
          count?: number
          icon: typeof FileText
        }> = [
          { id: 'Overview', label: 'Overview', icon: UserRound },
          { id: 'Timeline', label: 'Timeline', icon: Clock },
          { id: 'Notes', label: 'Notes', count: notes.length, icon: FileText },
          { id: 'Machines', label: 'Machines', count: assets.length, icon: Package },
          { id: 'AMC due', label: 'AMC due', count: amcDueCount, icon: CalendarClock },
          { id: 'Service', label: 'Service', count: tickets.length, icon: TicketCheck },
          { id: 'Spare parts', label: 'Spare parts', icon: Wrench },
          { id: 'Stamping', label: 'Stamping', count: stampCount, icon: Stamp },
          ...(rentals.length
            ? [{ id: 'Rentals' as Tab, label: 'Rentals', count: rentals.length, icon: ShoppingBag }]
            : []),
        ]

        return (
          <div className="flex min-h-[520px] gap-0 overflow-hidden rounded-xl border border-border bg-card">
            <nav
              className="relative hidden shrink-0 border-r border-border bg-muted/20 md:block"
              style={{ width: relatedWidth }}
              aria-label="Related lists"
            >
              <div className="border-b border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                Related list
              </div>
              <ul className="py-1">
                {related.map((item) => {
                  const Icon = item.icon
                  const active = tab === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition',
                          active
                            ? 'border-l-2 border-accent-blue bg-accent-soft font-semibold text-accent-blue'
                            : 'border-l-2 border-transparent text-text-primary hover:bg-muted/60',
                        )}
                      >
                        <Icon size={14} className="shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {typeof item.count === 'number' ? (
                          <span className="tabular-nums text-[11px] text-text-secondary">
                            {item.count}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize related list"
                className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-accent-blue/40 active:bg-accent-blue/60"
                onPointerDown={(e) => {
                  e.preventDefault()
                  relatedDrag.current = { startX: e.clientX, startW: relatedWidth }
                  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  if (!relatedDrag.current) return
                  const next = Math.min(
                    320,
                    Math.max(160, relatedDrag.current.startW + (e.clientX - relatedDrag.current.startX)),
                  )
                  setRelatedWidth(next)
                  try {
                    localStorage.setItem('nova.contact.relatedWidth', String(next))
                  } catch {
                    /* ignore */
                  }
                }}
                onPointerUp={() => {
                  relatedDrag.current = null
                }}
                onPointerCancel={() => {
                  relatedDrag.current = null
                }}
              />
            </nav>

            <div className="min-w-0 flex-1">
              {/* Zoho-style Overview | Timeline strip */}
              <div className="flex items-center gap-1 border-b border-border px-3 pt-2">
                {(['Overview', 'Timeline'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      'relative px-3 py-2 text-sm font-medium transition',
                      tab === id
                        ? 'text-accent-blue after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent-blue'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {id}
                  </button>
                ))}
              </div>

              {/* Mobile related tabs */}
              <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 md:hidden">
                {related
                  .filter((item) => item.id !== 'Overview' && item.id !== 'Timeline')
                  .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium',
                      tab === item.id
                        ? 'bg-accent-blue text-white'
                        : 'bg-muted text-text-secondary',
                    )}
                  >
                    {item.label}
                    {typeof item.count === 'number' ? ` (${item.count})` : ''}
                  </button>
                ))}
              </div>

              <div className="p-4 sm:p-5">
                {tab === 'Overview' ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-text-primary">Overview</h2>
                      <button
                        type="button"
                        className="text-xs font-medium text-accent-blue hover:underline"
                        onClick={() => setDetailsOpen((v) => !v)}
                      >
                        {detailsOpen ? 'Hide details' : 'Show details'}
                      </button>
                    </div>

                    {/* Quick info */}
                    <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                      {(
                        [
                          {
                            label: 'Contact owner',
                            value: owner?.name || 'Unassigned',
                          },
                          {
                            label: 'Email',
                            value: contact.email ? (
                              <a
                                href={`mailto:${String(contact.email)}`}
                                className="text-accent-blue hover:underline"
                              >
                                {String(contact.email)}
                              </a>
                            ) : (
                              '—'
                            ),
                          },
                          {
                            label: 'Phone',
                            value: contact.phone || contact.mobile ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Phone size={12} className="text-accent-green" />
                                {formatPhone(String(contact.phone || contact.mobile))}
                              </span>
                            ) : (
                              '—'
                            ),
                          },
                          {
                            label: 'Mobile',
                            value: contact.mobile
                              ? formatPhone(String(contact.mobile))
                              : '—',
                          },
                          {
                            label: 'WhatsApp',
                            value: custom.whatsapp
                              ? formatPhone(String(custom.whatsapp))
                              : '—',
                          },
                          {
                            label: 'Area / city',
                            value:
                              [contact.area, contact.city].filter(Boolean).join(', ') || '—',
                          },
                        ] as Array<{ label: string; value: ReactNode }>
                      ).map((row) => (
                        <div key={row.label} className="flex gap-3 text-sm">
                          <div className="w-32 shrink-0 text-text-secondary">{row.label}</div>
                          <div className="min-w-0 font-medium text-text-primary">{row.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Next action — open tickets */}
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-text-primary">Next action</h3>
                      {openTickets.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-text-secondary">
                          No open service jobs. Create a ticket when the customer walks in.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {openTickets.slice(0, 5).map((t) => {
                            const due = t.dueAt || t.createdAt
                            const dueLabel = due
                              ? new Date(String(due)).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : '—'
                            return (
                              <li key={String(t.id)}>
                                <Link
                                  to={`/tickets/${t.id}`}
                                  className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/40"
                                >
                                  <span className="inline-flex min-w-[2.75rem] flex-col items-center rounded-sm bg-accent-red px-1 py-1 text-[10px] font-bold uppercase leading-tight text-white">
                                    {dueLabel}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-text-primary">
                                      {String(t.subject)}
                                    </div>
                                    <div className="mt-0.5 text-xs text-text-secondary">
                                      {formatServiceId(
                                        t.ticketNo != null ? String(t.ticketNo) : undefined,
                                      )}{' '}
                                      · {String(t.status).replaceAll('_', ' ')}
                                    </div>
                                  </div>
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    {detailsOpen ? (
                      <div className="space-y-6">
                        <section>
                          <h3 className="mb-3 border-b border-border pb-2 text-sm font-semibold text-text-primary">
                            Contact information
                          </h3>
                          <div className="grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
                            {(
                              [
                                ['Contact owner', owner?.name || 'Unassigned'],
                                [
                                  'Account name',
                                  account ? (
                                    <Link
                                      to={`/accounts/${account.id}`}
                                      className="text-accent-blue hover:underline"
                                    >
                                      {String(account.name)}
                                    </Link>
                                  ) : (
                                    '—'
                                  ),
                                ],
                                [
                                  'Email',
                                  contact.email ? (
                                    <a
                                      href={`mailto:${String(contact.email)}`}
                                      className="text-accent-blue hover:underline"
                                    >
                                      {String(contact.email)}
                                    </a>
                                  ) : (
                                    '—'
                                  ),
                                ],
                                [
                                  'Phone / landline',
                                  contact.phone
                                    ? formatPhone(String(contact.phone))
                                    : custom.landline
                                      ? String(custom.landline)
                                      : '—',
                                ],
                                [
                                  'Mobile',
                                  contact.mobile ? formatPhone(String(contact.mobile)) : '—',
                                ],
                                [
                                  'Mobile 2',
                                  custom.mobile_2 ? formatPhone(String(custom.mobile_2)) : '—',
                                ],
                                [
                                  'Mobile 3',
                                  custom.mobile_3 ? formatPhone(String(custom.mobile_3)) : '—',
                                ],
                                [
                                  'WhatsApp',
                                  custom.whatsapp ? formatPhone(String(custom.whatsapp)) : '—',
                                ],
                                [
                                  'Customer ID',
                                  contact.customerCode ? (
                                    <span className="font-mono">{String(contact.customerCode)}</span>
                                  ) : (
                                    '—'
                                  ),
                                ],
                                [
                                  'Created',
                                  contact.createdAt ? formatDate(String(contact.createdAt)) : '—',
                                ],
                              ] as Array<[string, ReactNode]>
                            ).map(([label, value]) => (
                              <div key={label} className="flex gap-3 text-sm">
                                <div className="w-36 shrink-0 text-text-secondary">{label}</div>
                                <div className="min-w-0 break-words font-medium text-text-primary">
                                  {value}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section>
                          <h3 className="mb-3 border-b border-border pb-2 text-sm font-semibold text-text-primary">
                            Address information
                          </h3>
                          <div className="grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
                            {(
                              [
                                ['Door no', contact.doorNo ? String(contact.doorNo) : '—'],
                                [
                                  'Building',
                                  custom.building_name ? String(custom.building_name) : '—',
                                ],
                                ['Street', contact.street ? String(contact.street) : '—'],
                                ['Area', contact.area ? String(contact.area) : '—'],
                                ['City', contact.city ? String(contact.city) : '—'],
                                ['State', contact.state ? String(contact.state) : '—'],
                                ['Pincode', contact.pincode ? String(contact.pincode) : '—'],
                                [
                                  'Landmark',
                                  contact.location ? String(contact.location) : '—',
                                ],
                                [
                                  'GPS',
                                  custom.gps_location ? String(custom.gps_location) : '—',
                                ],
                              ] as Array<[string, ReactNode]>
                            ).map(([label, value]) => (
                              <div key={label} className="flex gap-3 text-sm">
                                <div className="w-36 shrink-0 text-text-secondary">{label}</div>
                                <div className="min-w-0 break-words font-medium text-text-primary">
                                  {value}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section>
                          <h3 className="mb-3 border-b border-border pb-2 text-sm font-semibold text-text-primary">
                            Service snapshot
                          </h3>
                          <div className="grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
                            {(
                              [
                                ['Machines on file', `${assets.length}`],
                                ['Open service jobs', `${openTickets.length}`],
                                ['Total tickets', `${tickets.length}`],
                                [
                                  'Lifetime billed',
                                  formatCurrency(purchaseSummary.totalBilled),
                                ],
                                [
                                  'Active rentals',
                                  `${rentals.filter((r) => String(r.status) === 'ACTIVE').length}`,
                                ],
                              ] as Array<[string, ReactNode]>
                            ).map(([label, value]) => (
                              <div key={label} className="flex gap-3 text-sm">
                                <div className="w-36 shrink-0 text-text-secondary">{label}</div>
                                <div className="min-w-0 break-words font-medium text-text-primary">
                                  {value}
                                </div>
                              </div>
                            ))}
                          </div>
                          {contact.description ? (
                            <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-sm text-text-secondary">
                              {String(contact.description)}
                            </p>
                          ) : null}
                        </section>
                      </div>
                    ) : null}

                    <ContactAnalytics
                      contact={contact}
                      custom={custom}
                      deals={deals}
                      tickets={tickets}
                      invoices={invoices}
                      productsBought={purchaseSummary.productsBought}
                      totalPaid={purchaseSummary.totalPaid}
                      totalBilled={purchaseSummary.totalBilled}
                    />
                  </div>
                ) : null}

                {tab === 'Timeline' ? (
                  <ContactTimeline
                    loading={timelineLoading && !timelineExtras.activities.length && !timelineExtras.spares.length}
                    events={buildContactTimelineEvents({
                      contact,
                      tickets,
                      notes,
                      invoices,
                      assets,
                      rentals,
                      activities: timelineExtras.activities,
                      spares: timelineExtras.spares,
                      users,
                    })}
                  />
                ) : null}

                {tab === 'Machines' && (
        <>
        <Card className="mb-3 border-border bg-muted/30 p-3">
          <p className="text-xs leading-snug text-text-secondary">
            <strong className="text-text-primary">GC</strong> 1yr from sale → then auto{' '}
            <strong className="text-text-primary">NGC</strong>. Weighing also has 1yr HMS stamping
            (quarters A–D). <strong className="text-text-primary">AMC</strong> is weighing only —
            after that first year, or any existing weighing customer. Other machines stay GC → NGC.
          </p>
        </Card>

        {(() => {
          const all = ((contact.assets as Array<Record<string, unknown>>) ?? [])
          const sold = all.filter((a) => !isThirdPartyOrigin(a.origin ? String(a.origin) : null))
          const outside = all.filter((a) => isThirdPartyOrigin(a.origin ? String(a.origin) : null))
          const daysUntil = (dateStr?: string | null) => {
            if (!dateStr) return null
            const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
            if (Number.isNaN(d.getTime())) return null
            const today = new Date()
            today.setHours(12, 0, 0, 0)
            return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
          }
          const renderMachine = (a: Record<string, unknown>, kind: 'sold' | 'outside') => {
            const validTill = a.nextDueDate ? String(a.nextDueDate).slice(0, 10) : ''
            const lastStamp = a.stampingDate ? String(a.stampingDate).slice(0, 10) : ''
            const dueDays = daysUntil(validTill)
            const amcEndDays = daysUntil(a.amcEndDate ? String(a.amcEndDate) : null)
            const gcDays = daysUntil(a.warrantyEndDate ? String(a.warrantyEndDate) : null)
            const serviceDays = daysUntil(
              a.nextServiceDueDate ? String(a.nextServiceDueDate) : null,
            )
            const hints = coverageChargeHints({
              servicePlan: a.servicePlan ? String(a.servicePlan) : null,
              warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
              amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
            })
            const onAmc = a.servicePlan === 'AMC'
            const plan = effectiveServicePlan({
              servicePlan: a.servicePlan ? String(a.servicePlan) : null,
              warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
              amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
            })
            return (
              <div
                key={String(a.id)}
                className="rounded-[12px] border border-border bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-text-primary">{String(a.name)}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-text-secondary">
                      <Badge color={kind === 'outside' ? 'amber' : 'blue'}>
                        {kind === 'outside' ? 'Outside — repair / stamping' : 'Sold by us'}
                      </Badge>
                      {machineSourceTagsFromCf(
                        (a.customFields as Record<string, unknown> | undefined) ?? null,
                      ).map((tag) => (
                        <Badge
                          key={tag}
                          color={tag === 'Service new' ? 'orange' : tag === 'Stamping' ? 'purple' : 'amber'}
                        >
                          {tag}
                        </Badge>
                      ))}
                      <Badge
                        color={
                          hints.label.startsWith('GC')
                            ? 'green'
                            : onAmc && hints.plan === 'AMC'
                              ? 'green'
                              : 'gray'
                        }
                      >
                        {hints.label}
                      </Badge>
                      <Badge color="gray">{String(a.machineType ?? '').replaceAll('_', ' ')}</Badge>
                      {String(a.machineType) === 'WEIGHING' || a.nextDueDate || a.stampingDate ? (
                        <Badge color="purple">
                          {stampQuarterOf({
                            nextDueDate: a.nextDueDate ? String(a.nextDueDate) : null,
                            stampingDate: a.stampingDate ? String(a.stampingDate) : null,
                            customFields:
                              a.customFields && typeof a.customFields === 'object'
                                ? (a.customFields as Record<string, unknown>)
                                : null,
                          }).label}
                        </Badge>
                      ) : null}
                      {(() => {
                        const acf =
                          a.customFields && typeof a.customFields === 'object'
                            ? (a.customFields as Record<string, unknown>)
                            : {}
                        const serial = a.serialNo ? String(a.serialNo) : ''
                        const hms = acf.hmsUniqId ? String(acf.hmsUniqId) : ''
                        const weighing =
                          String(a.machineType) === 'WEIGHING' || Boolean(acf.weighing)
                        if (weighing) {
                          const id = hms || serial
                          return id ? (
                            <span className="font-mono text-text-primary">HMS {id}</span>
                          ) : null
                        }
                        return (
                          <>
                            {serial ? (
                              <span className="font-mono text-text-primary">S/N {serial}</span>
                            ) : null}
                            {hms && hms !== serial ? (
                              <span className="font-mono text-text-secondary">HMS {hms}</span>
                            ) : null}
                          </>
                        )
                      })()}
                      {a.capacity ? <span>· {String(a.capacity)}</span> : null}
                      {a.model ? <span>· {String(a.model)}</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">{hints.summary}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[10px] border border-violet-200/70 bg-violet-50/40 px-3 py-3 dark:border-violet-900/40 dark:bg-violet-950/20">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                      Stamping (engineer)
                    </div>
                    {String(a.machineType) === 'WEIGHING' || lastStamp || validTill ? (
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">Last stamp</dt>
                          <dd className="font-medium">{lastStamp ? formatDate(lastStamp) : 'Not stamped yet'}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">Valid till</dt>
                          <dd className="font-semibold text-text-primary">
                            {validTill ? formatDate(validTill) : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">HMS quarter</dt>
                          <dd className="font-medium">
                            {
                              stampQuarterOf({
                                nextDueDate: validTill || null,
                                stampingDate: lastStamp || null,
                                customFields:
                                  a.customFields && typeof a.customFields === 'object'
                                    ? (a.customFields as Record<string, unknown>)
                                    : null,
                              }).label
                            }
                          </dd>
                        </div>
                        {dueDays != null ? (
                          <div className="pt-1">
                            {dueDays < 0 ? (
                              <Badge color="red">Overdue {Math.abs(dueDays)}d</Badge>
                            ) : dueDays <= 30 ? (
                              <Badge color="amber">Due in {dueDays}d</Badge>
                            ) : (
                              <Badge color="green">Valid · {dueDays}d left</Badge>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-text-secondary">
                            Opens a stamping job — engineer enters dates after verification.
                          </p>
                        )}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-text-secondary">Not a weighing unit — stamping N/A.</p>
                    )}
                  </div>

                  <div className="rounded-[10px] border border-emerald-200/70 bg-emerald-50/40 px-3 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                      Coverage (GC / NGC / AMC)
                    </div>
                    <dl className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-text-secondary">Plan</dt>
                        <dd>
                          <Badge color={hints.serviceFree ? 'green' : 'gray'}>{plan}</Badge>
                        </dd>
                      </div>
                      {String(a.servicePlan) === 'GC' || a.warrantyEndDate ? (
                        <>
                          <div className="flex justify-between gap-2">
                            <dt className="text-text-secondary">GC ends</dt>
                            <dd className="font-medium">
                              {a.warrantyEndDate ? formatDate(String(a.warrantyEndDate)) : '—'}
                            </dd>
                          </div>
                          {gcDays != null ? (
                            <div className="pt-1">
                              {gcDays < 0 ? (
                                <Badge color="red">GC ended → NGC</Badge>
                              ) : (
                                <Badge color="green">{gcDays}d free left</Badge>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {onAmc ? (
                        <>
                          <div className="flex justify-between gap-2">
                            <dt className="text-text-secondary">AMC end</dt>
                            <dd className="font-medium">
                              {a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-text-secondary">Next free service</dt>
                            <dd className="font-medium">
                              {a.nextServiceDueDate
                                ? formatDate(String(a.nextServiceDueDate))
                                : '—'}
                            </dd>
                          </div>
                          {amcEndDays != null ? (
                            <div className="pt-1">
                              {amcEndDays < 0 ? (
                                <Badge color="red">AMC expired</Badge>
                              ) : amcEndDays <= 60 ? (
                                <Badge color="amber">Renew in {amcEndDays}d</Badge>
                              ) : (
                                <Badge color="green">{amcEndDays}d left</Badge>
                              )}
                            </div>
                          ) : null}
                          {serviceDays != null && serviceDays <= 30 ? (
                            <Badge color={serviceDays < 0 ? 'red' : 'amber'}>
                              Service {serviceDays < 0 ? 'overdue' : `in ${serviceDays}d`}
                            </Badge>
                          ) : null}
                        </>
                      ) : plan === 'NGC' || plan === 'NON_AMC' ? (
                        <p className="mt-1 text-xs text-text-secondary">
                          {isWeighingMachine(String(a.machineType))
                            ? 'Paid service & parts (NGC). Convert this weighing machine to AMC (1 year) — existing customers included.'
                            : 'Paid service & parts (NGC). AMC is only for weighing machines.'}
                        </p>
                      ) : null}
                    </dl>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=Stamping&open=1`,
                      )
                    }
                  >
                    Stamping job
                  </Button>
                  {!onAmc ? (
                    <>
                      {isWeighingMachine(String(a.machineType)) ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigate(
                                `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=${encodeURIComponent('AMC visit')}&open=1`,
                              )
                            }
                          >
                            Inspect for AMC
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEnrollAmc({
                              machineType: String(a.machineType),
                              servicePlan: String(a.servicePlan ?? ''),
                              warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
                              amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
                            }).ok}
                            title={
                              canEnrollAmc({
                                machineType: String(a.machineType),
                                servicePlan: String(a.servicePlan ?? ''),
                                warrantyEndDate: a.warrantyEndDate
                                  ? String(a.warrantyEndDate)
                                  : null,
                                amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
                              }).reason
                            }
                            onClick={() => {
                              const start = new Date().toISOString().slice(0, 10)
                              openEditMachine({
                                ...a,
                                servicePlan: 'AMC',
                                amcStartDate: a.amcStartDate || start,
                                amcEndDate: a.amcEndDate || defaultAmcEndFromStart(start),
                                nextServiceDueDate:
                                  a.nextServiceDueDate || defaultNextAmcService(start),
                              })
                            }}
                          >
                            Enroll AMC (1yr)
                          </Button>
                        </>
                      ) : (
                        <span className="text-[11px] text-text-secondary">
                          AMC N/A — not a weighing machine
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate(
                            `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=${encodeURIComponent('AMC visit')}&open=1`,
                          )
                        }
                      >
                        AMC visit job
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const start = new Date().toISOString().slice(0, 10)
                          openEditMachine({
                            ...a,
                            servicePlan: 'AMC',
                            amcStartDate: start,
                            amcEndDate: defaultAmcEndFromStart(start),
                            nextServiceDueDate: defaultNextAmcService(start),
                          })
                        }}
                      >
                        Renew AMC (1yr)
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&open=1`,
                      )
                    }
                  >
                    Repair job
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEditMachine(a)}>
                    <Edit3 size={14} /> Edit
                  </Button>
                </div>

                <div className="mt-3">
                  <SparePartsPanel
                    contactId={String(contact.id)}
                    contactName={String(contact.name)}
                    fixedAssetId={String(a.id)}
                    fixedAssetLabel={`${String(a.name)}${a.serialNo ? ` · ${String(a.serialNo)}` : ''}`}
                    title="Parts changed on this machine"
                    collapsible
                    defaultOpen={Boolean(highlightAssetId && highlightAssetId === String(a.id))}
                    readOnly
                    defaultUnderWarranty={hints.underWarrantyDefault}
                  />
                </div>
              </div>
            )
          }

          if (all.length === 0) {
            return (
              <Card padding={false}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="text-sm font-semibold">Machines</div>
                  <Button size="sm" onClick={openAddMachine}>
                    Add machine
                  </Button>
                </div>
                <EmptyState
                  icon={<Package size={22} />}
                  title="No machines yet"
                  subtitle="Add machines as Sold by us or Outside (repair / stamping only)."
                  actionLabel="Add machine"
                  onAction={openAddMachine}
                />
              </Card>
            )
          }

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                  {(
                    [
                      { id: 'sold' as const, label: 'Sold by us', count: sold.length },
                      { id: 'outside' as const, label: 'Outside machine', count: outside.length },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMachineOriginTab(t.id)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                        machineOriginTab === t.id
                          ? 'bg-card text-text-primary shadow-sm'
                          : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {t.label}
                      <span className="ml-1.5 tabular-nums text-text-secondary">({t.count})</span>
                    </button>
                  ))}
                </div>
                <Button size="sm" onClick={openAddMachine}>
                  Add machine
                </Button>
              </div>

              {machineOriginTab === 'sold' ? (
                sold.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-secondary">
                    No HMS-sold machines on this customer yet.
                  </p>
                ) : (
                  <div className="space-y-3">{sold.map((a) => renderMachine(a, 'sold'))}</div>
                )
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-text-secondary">
                    Not purchased from HMS — brought for repair or government stamping only. Old
                    weighing units can still enroll AMC (1 year, renewable).
                  </p>
                  {outside.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-secondary">
                      No outside machines on file.
                    </p>
                  ) : (
                    outside.map((a) => renderMachine(a, 'outside'))
                  )}
                </div>
              )}
            </div>
          )
        })()}

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">Purchase / invoice history</p>
            <Button variant="outline" size="sm" onClick={downloadPurchasesCsv}>
              <Download size={14} /> Download CSV
            </Button>
          </div>
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Products from our invoices
            </h2>
            {purchaseSummary.productsBought.length === 0 ? (
              <EmptyState
                icon={<CircleDollarSign size={22} />}
                title="No purchases yet"
                subtitle="Invoices billed to this customer appear here (Sold by us)."
              />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Product', 'SKU', 'Qty', 'Amount'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {purchaseSummary.productsBought.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                      <td className="px-3 py-2">{p.qty}</td>
                      <td className="px-3 py-2">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {invoices.length > 0 ? (
            <Card padding={false}>
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">Invoices</div>
              <div className="divide-y divide-border">
                {invoices.map((inv) => (
                  <div key={String(inv.id)} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono font-semibold">{String(inv.invoiceNumber)}</div>
                        <div className="text-xs text-text-secondary">
                          {inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : '—'} · {String(inv.status)}
                        </div>
                      </div>
                      <div className="text-right font-semibold">{formatCurrency(num(inv.grandTotal))}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
        </>
      )}

      {tab === 'AMC due' && (
        <div className="space-y-3 p-3 sm:p-4">
          <Card className="border-border bg-muted/30 p-3">
            <p className="text-xs leading-snug text-text-secondary">
              <strong className="text-text-primary">Reminder board</strong> — weighing machines only.
              HMS sales get GC (1yr) then move to NGC. AMC is weighing only — after that first
              year, or convert any existing weighing customer. Service free every 6 months; parts
              charged. Other machines have no AMC.
            </p>
          </Card>
          {(() => {
            const assets = (contact.assets as Array<Record<string, unknown>>) ?? []
            const rows = assets
              .map((a) => {
                const due = amcDueInfo({
                  machineType: a.machineType ? String(a.machineType) : null,
                  servicePlan: a.servicePlan ? String(a.servicePlan) : null,
                  warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
                  amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
                  nextServiceDueDate: a.nextServiceDueDate
                    ? String(a.nextServiceDueDate)
                    : null,
                })
                return due ? { asset: a, due } : null
              })
              .filter(Boolean) as Array<{
              asset: Record<string, unknown>
              due: NonNullable<ReturnType<typeof amcDueInfo>>
            }>
            rows.sort((a, b) => {
              const rank = (u: string) => (u === 'overdue' ? 0 : u === 'soon' ? 1 : 2)
              return rank(a.due.urgency) - rank(b.due.urgency)
            })
            if (rows.length === 0) {
              return (
                <EmptyState
                  icon={<CalendarClock size={22} />}
                  title="Nothing due for AMC"
                  subtitle="Weighing machines eligible for enroll / renewal / free service visits appear here."
                />
              )
            }
            return (
              <div className="space-y-2">
                {rows.map(({ asset: a, due }) => (
                  <Card key={String(a.id)} className="p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-text-primary">{String(a.name)}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-text-secondary">
                          {a.serialNo ? (
                            <span className="font-mono">S/N {String(a.serialNo)}</span>
                          ) : null}
                          <Badge
                            color={
                              due.urgency === 'overdue'
                                ? 'red'
                                : due.urgency === 'soon'
                                  ? 'amber'
                                  : 'blue'
                            }
                          >
                            {due.label}
                          </Badge>
                          <Badge color="gray">{String(a.servicePlan ?? '—')}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {due.kind === 'eligible' || due.kind === 'expired' ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              const start = new Date().toISOString().slice(0, 10)
                              openEditMachine({
                                ...a,
                                servicePlan: 'AMC',
                                amcStartDate: start,
                                amcEndDate: defaultAmcEndFromStart(start),
                                nextServiceDueDate: defaultNextAmcService(start),
                              })
                            }}
                          >
                            {due.kind === 'expired' ? 'Renew AMC' : 'Enroll AMC'}
                          </Button>
                        ) : null}
                        {due.kind === 'renewal' ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              const start = new Date().toISOString().slice(0, 10)
                              openEditMachine({
                                ...a,
                                servicePlan: 'AMC',
                                amcStartDate: start,
                                amcEndDate: defaultAmcEndFromStart(start),
                                nextServiceDueDate: defaultNextAmcService(start),
                              })
                            }}
                          >
                            Renew (1yr)
                          </Button>
                        ) : null}
                        {due.kind === 'service' || due.kind === 'renewal' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigate(
                                `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=${encodeURIComponent('AMC visit')}&open=1`,
                              )
                            }
                          >
                            AMC visit
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => openEditMachine(a)}>
                          Edit
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {tab === 'Service' && (
        <div className="space-y-4">
          {(() => {
            const reports = tickets
              .map((t) => {
                const cf =
                  t.customFields && typeof t.customFields === 'object'
                    ? (t.customFields as Record<string, unknown>)
                    : {}
                const sr = cf.serviceReport
                if (!sr || typeof sr !== 'object') return null
                const report = sr as Record<string, unknown>
                return { ticket: t, report }
              })
              .filter(Boolean) as Array<{
              ticket: Record<string, unknown>
              report: Record<string, unknown>
            }>
            reports.sort((a, b) =>
              String(a.report.savedAt ?? '') < String(b.report.savedAt ?? '') ? 1 : -1,
            )
            return (
              <Card padding={false}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div>
                    <div className="font-semibold">Service reports</div>
                    <p className="text-xs text-text-secondary">
                      Filled after Approve & close — notes + spare counts. Parts detail is under Spare
                      parts.
                    </p>
                  </div>
                  <Badge color="blue">{reports.length}</Badge>
                </div>
                {reports.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-text-secondary">
                    No service reports yet for this customer. After a ticket is closed, use Create
                    service report on the ticket.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {reports.map(({ ticket: t, report }) => (
                      <li key={String(t.id)} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                className="font-mono text-sm font-semibold text-accent-blue hover:underline"
                                to={`/tickets/${t.id}`}
                              >
                                {formatServiceId(
                                  t.ticketNo != null ? String(t.ticketNo) : undefined,
                                )}
                              </Link>
                              <Badge color="gray">{String(t.status)}</Badge>
                              {Number(report.sparePartsCount || 0) > 0 ? (
                                <Badge color="purple">
                                  {Number(report.sparePartsCount)} spare
                                  {Number(report.sparePartsCount) === 1 ? '' : 's'}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-sm font-medium text-text-primary">
                              {String(report.machineName || t.subject || 'Service')}
                            </div>
                            {report.issues ? (
                              <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                                Issues: {String(report.issues)}
                              </p>
                            ) : null}
                            {report.workDone ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
                                Work done: {String(report.workDone)}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-text-secondary">
                              {report.savedAt ? formatDate(String(report.savedAt)) : '—'}
                              {report.savedBy ? ` · ${String(report.savedBy)}` : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/tickets/${t.id}`)}
                          >
                            <Eye size={14} /> Open ticket
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })()}

          <Card padding={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <div className="font-semibold">Service tickets</div>
                <p className="text-xs text-text-secondary">
                  Repair / breakdown / AMC visit tickets on this customer&apos;s machines
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  navigate(`/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1`)
                }
              >
                <TicketPlus size={14} /> New ticket
              </Button>
            </div>
            {tickets.length === 0 ? (
              <EmptyState
                icon={<TicketCheck size={22} />}
                title="No service tickets yet"
                subtitle="Walk-in repair or AMC → open a ticket on the machine."
                actionLabel="New service ticket"
                onAction={() =>
                  navigate(`/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1`)
                }
              />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Service ID', 'Subject', 'Priority', 'Status', 'Report', ''].map((h) => (
                      <th key={h || 'a'} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => {
                    const cf =
                      t.customFields && typeof t.customFields === 'object'
                        ? (t.customFields as Record<string, unknown>)
                        : {}
                    const hasReport = Boolean(
                      cf.serviceReport && typeof cf.serviceReport === 'object',
                    )
                    return (
                      <tr key={String(t.id)} className="border-t border-border">
                        <td className="px-4 py-3">
                          <Link
                            className="font-mono text-accent-blue hover:underline"
                            to={`/tickets/${t.id}`}
                          >
                            {formatServiceId(
                              t.ticketNo != null ? String(t.ticketNo) : undefined,
                            )}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{String(t.subject)}</td>
                        <td className="px-4 py-3">
                          <Badge color="amber">{String(t.priority)}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={ticketStatusColor[String(t.status)] ?? 'gray'}>
                            {String(t.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {hasReport ? (
                            <Badge color="blue">Saved</Badge>
                          ) : (
                            <span className="text-xs text-text-secondary">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/tickets/${t.id}`)}
                          >
                            <Eye size={14} /> View detail
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === 'Spare parts' && (
        <SparePartsPanel
          contactId={String(contact.id)}
          contactName={String(contact.name)}
          title="Spare parts history"
          canEdit
        />
      )}

      {tab === 'Stamping' && (
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3">
            <div className="font-semibold">Stamping register</div>
            <p className="text-xs text-text-secondary">
              Govt verification / stamp-only jobs — sold by us and outside machines
            </p>
          </div>
          {(() => {
            const stampAssets = ((contact.assets as Array<Record<string, unknown>>) ?? []).filter(
              (a) => a.machineType === 'WEIGHING' || a.stampingDate || a.nextDueDate,
            )
            if (!stampAssets.length) {
              return (
                <EmptyState
                  icon={<Package size={22} />}
                  title="No stamping machines"
                  subtitle="Add a weighing machine (sold or outside), then open a Stamping job."
                  actionLabel="Add machine"
                  onAction={openAddMachine}
                />
              )
            }
            return (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Machine', 'Origin', 'Last stamp', 'Valid till', ''].map((h) => (
                      <th key={h || 's'} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stampAssets.map((a) => (
                    <tr key={String(a.id)} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium">{String(a.name)}</div>
                        {a.serialNo ? (
                          <div className="font-mono text-xs text-text-secondary">{String(a.serialNo)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={isThirdPartyOrigin(a.origin ? String(a.origin) : null) ? 'amber' : 'blue'}>
                          {isThirdPartyOrigin(a.origin ? String(a.origin) : null)
                            ? 'Outside'
                            : 'Sold by us'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {a.stampingDate ? formatDate(String(a.stampingDate)) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=Stamping&open=1`,
                            )
                          }
                        >
                          Stamping job
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
        </Card>
      )}

      {tab === 'Rentals' && rentals.length > 0 && (
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Rental history</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-text-secondary">
              <tr>
                {['Rental #', 'Product', 'Status', 'Issued', 'Due / returned'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rentals.map((r) => {
                const product = r.product as { name?: string } | null
                return (
                  <tr key={String(r.id)} className="border-t border-border">
                    <td className="px-4 py-3 font-mono">{String(r.rentalNo ?? r.id)}</td>
                    <td className="px-4 py-3">{product?.name ? String(product.name) : '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={String(r.status) === 'ACTIVE' ? 'amber' : 'green'}>
                        {String(r.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {r.issuedAt ? formatDate(String(r.issuedAt)) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {r.returnedAt
                        ? formatDate(String(r.returnedAt))
                        : r.dueAt
                          ? `Due ${formatDate(String(r.dueAt))}`
                          : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'Notes' && (
        <Card className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Add note</label>
            <textarea
              className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
              placeholder="Customer preference, site access, follow-up…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <Button disabled={noteBusy || !noteDraft.trim()} onClick={() => void addNote()}>
                {noteBusy ? 'Saving…' : 'Add note'}
              </Button>
            </div>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-text-secondary">No notes yet — add the first one above.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => {
                const noteId = String(n.id)
                const isEditing = editingNoteId === noteId
                return (
                  <li key={noteId} className="rounded-lg border border-border p-3 text-sm">
                    {isEditing ? (
                      <>
                        <textarea
                          className="min-h-20 w-full rounded-[8px] border border-border bg-card p-2 text-sm outline-none focus:border-accent-blue"
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" disabled={noteBusy} onClick={() => void saveNoteEdit()}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingNoteId(null)
                              setEditingNoteText('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{String(n.content)}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-text-secondary">
                            {n.createdAt ? formatDate(String(n.createdAt)) : ''}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingNoteId(noteId)
                                setEditingNoteText(String(n.content ?? ''))
                              }}
                            >
                              <Edit3 size={14} /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={noteBusy}
                              onClick={() => void deleteNote(noteId)}
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4']

function ContactAnalytics({
  contact,
  custom,
  deals,
  tickets,
  invoices,
  productsBought,
  totalPaid,
  totalBilled,
}: {
  contact: Record<string, unknown>
  custom: Record<string, unknown>
  deals: Array<Record<string, unknown>>
  tickets: Array<Record<string, unknown>>
  invoices: Array<Record<string, unknown>>
  productsBought: Array<{ id: string; sku: string; name: string; qty: number; amount: number }>
  totalPaid: number
  totalBilled: number
}) {
  const spendOverTime = useMemo(() => {
    const map: Record<string, number> = {}
    for (const inv of invoices) {
      const d = inv.invoiceDate ? new Date(String(inv.invoiceDate)) : null
      if (!d || Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map[key] = (map[key] ?? 0) + num(inv.grandTotal)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, spend]) => ({ month, spend }))
  }, [invoices])

  const dealMix = useMemo(() => {
    const open = deals.filter((d) => !d.closedAt).length
    const won = deals.filter((d) => d.closedAt && num(d.probability) >= 100).length
    const closed = deals.filter((d) => d.closedAt).length
    const lost = Math.max(0, closed - won)
    return [
      { name: 'Open', value: open || 0 },
      { name: 'Won', value: won || 0 },
      { name: 'Lost/Other', value: lost || 0 },
    ].filter((x) => x.value > 0)
  }, [deals])

  const productBars = useMemo(
    () =>
      productsBought.slice(0, 6).map((p) => ({
        name: p.name.length > 18 ? `${p.name.slice(0, 16)}…` : p.name,
        qty: p.qty,
        amount: p.amount,
      })),
    [productsBought],
  )

  const ticketStatus = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of tickets) {
      const s = String(t.status ?? 'OPEN')
      map[s] = (map[s] ?? 0) + 1
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [tickets])

  const openPipeline = deals.filter((d) => !d.closedAt).reduce((s, d) => s + num(d.amount), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Lifetime billed', value: formatCurrency(totalBilled), icon: CircleDollarSign, tint: 'bg-blue-50 text-accent-blue' },
          { label: 'Amount paid', value: formatCurrency(totalPaid), icon: ShoppingBag, tint: 'bg-emerald-50 text-accent-green' },
          { label: 'Open pipeline', value: formatCurrency(openPipeline), icon: Briefcase, tint: 'bg-violet-50 text-accent-purple' },
          { label: 'Products bought', value: productsBought.length, icon: Package, tint: 'bg-amber-50 text-accent-amber' },
        ].map((k) => (
          <Card key={k.label}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${k.tint}`}>
                <k.icon size={18} />
              </div>
              <div>
                <div className="text-lg font-semibold">{k.value}</div>
                <div className="text-xs text-text-secondary">{k.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Spend over time</h3>
          {spendOverTime.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spendOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrency(num(v))} />
                  <Line type="monotone" dataKey="spend" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No invoice spend yet</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Deal mix</h3>
          {dealMix.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dealMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {dealMix.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No deals linked</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Purchases by product</h3>
          {productBars.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="qty" fill="#10B981" name="Qty" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No products purchased</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Ticket status</h3>
          {ticketStatus.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ticketStatus} dataKey="value" nameKey="name" outerRadius={75}>
                    {ticketStatus.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No support tickets</p>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Profile</h3>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Full name', contact.name],
            ['Title', contact.title],
            ['Department', contact.department],
            ['Email', contact.email],
            ['Alternate email', custom.alternate_email],
            ['Phone', contact.phone],
            ['Mobile', contact.mobile],
            ['WhatsApp', custom.whatsapp],
            ['LinkedIn', custom.linkedin],
            ['Address', custom.address_line],
            ['City', contact.city],
            ['State', contact.state],
            ['Pincode', custom.pincode],
            ['Country', contact.country],
            ['Created', contact.createdAt ? formatDate(String(contact.createdAt)) : '—'],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-text-secondary">
                {label === 'WhatsApp' ? (
                  <span className="inline-flex items-center gap-1" style={{ color: WA_GREEN }}>
                    <WhatsAppIcon size={12} /> WhatsApp
                  </span>
                ) : (
                  String(label)
                )}
              </dt>
              <dd className="text-sm font-medium text-text-primary">{String(value ?? '—')}</dd>
            </div>
          ))}
        </dl>
        {contact.description ? (
          <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-text-primary">{String(contact.description)}</p>
        ) : null}
      </Card>
    </div>
  )
}
