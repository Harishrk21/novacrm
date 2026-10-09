import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronDown,
  Filter,
  Package,
  Phone,
  Search,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { CatalogMachinePick } from '@/components/contacts/CatalogMachinePick'
import { PageHeader } from '@/components/layout/PageHeader'
import { CustomerImportPanel } from '@/components/contacts/CustomerImportPanel'
import {
  ContactFilterSidebar,
  loadFilterWidth,
  type ContactFilterState,
  type SystemFilterId,
} from '@/components/contacts/ContactFilterSidebar'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { useRowSelection } from '@/hooks/useRowSelection'
import { useConfirmLeave, useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useUnsavedStore } from '@/store/unsavedStore'
import { api, ApiClientError } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS } from '@/lib/assetOrigin'
import {
  machineTypeRequiresStamping,
  productRequiresStamping,
} from '@/lib/productCatalog'
import { hmsSoldCoverage, isWeighingMachine } from '@/lib/hmsCoverage'
import { firstError, validateContactForm, type FieldErrors } from '@/lib/formValidation'
import { formatPhone } from '@/lib/utils'
import { toStoredIndianMobile } from '@/lib/phoneIndia'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { canAssignTickets, canCreateTickets, isServiceDesk } from '@/lib/roles'
import { TableSkeleton } from '@/components/ui/Skeleton'

type ContactRow = {
  id: string
  customerCode?: string | null
  customerNo?: number | null
  name: string
  email?: string | null
  phone?: string | null
  mobile?: string | null
  whatsapp?: string | null
  title?: string | null
  department?: string | null
  street?: string | null
  doorNo?: string | null
  area?: string | null
  pincode?: string | null
  location?: string | null
  city?: string | null
  state?: string | null
  accountId?: string | null
  accountName?: string | null
  ownerUserId?: string | null
  ownerName?: string | null
  machineCount?: number
  openJobCount?: number
  lastServiceAt?: string | null
  lastServiceStatus?: string | null
  createdAt?: string
}

const emptyForm = {
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
  ownerUserId: '',
  country: 'IN',
  phone: '',
  description: '',
  accountId: '',
  tags: '',
}

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

const emptyMachine = {
  skip: false,
  catalogProductId: '',
  stockType: '',
  brandId: '',
  machineType: 'WEIGHING',
  name: '',
  capacity: '',
  serialNo: '',
  model: '',
  origin: 'SOLD_BY_US',
  servicePlan: 'GC',
  amcStartDate: '',
  amcEndDate: '',
  nextServiceDate: '',
  stampingDate: '',
  stampingValidity: '',
  remindersEnabled: true,
}

type CatalogProduct = {
  id: string
  name: string
  sku: string
  attributes?: Record<string, unknown> | null
}

function addOneYear(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr.slice(0, 10))
  if (Number.isNaN(d.getTime())) return ''
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

export function ContactsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authRole = useAuthStore((s) => s.user?.role)
  const isDesk = isServiceDesk(authRole)
  const canAssign = canAssignTickets(authRole)

  const [items, setItems] = useState<ContactRow[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([])
  const [catalogBrands, setCatalogBrands] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [hasEmailFilter, setHasEmailFilter] = useState(false)
  const [hasWhatsappFilter, setHasWhatsappFilter] = useState(false)
  const [filterOpen, setFilterOpen] = useState(true)
  const [filterWidth, setFilterWidth] = useState(() => loadFilterWidth(280))
  const [tab, setTab] = useState<'list' | 'create' | 'import'>('list')
  const [createStep, setCreateStep] = useState<'customer' | 'product'>('customer')
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [machine, setMachine] = useState(emptyMachine)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [quickFilter, setQuickFilter] = useState<SystemFilterId>('all')
  const [sortBy, setSortBy] = useState<'name' | 'recent' | 'machines' | 'jobs'>('name')
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const createMenuRef = useRef<HTMLDivElement>(null)
  const unsavedDirty = useUnsavedStore((s) => s.dirty)
  const clearUnsaved = useUnsavedStore((s) => s.clear)
  const createDirty =
    tab === 'create' &&
    Boolean(
      form.name.trim() ||
        form.mobile.trim() ||
        form.email.trim() ||
        form.street.trim() ||
        machine.name.trim(),
    )
  const { requestLeave, dialog: leaveDialog } = useConfirmLeave(
    unsavedDirty || createDirty,
    'You have unsaved work. Discard and leave this view?',
  )
  useDiscardGuard(
    createDirty && tab === 'create',
    'Customer form has unsaved fields. Leaving will discard them.',
  )

  const overview = useMemo(() => {
    const withPhone = items.filter((c) => Boolean(c.phone || c.mobile)).length
    const withMachines = items.filter((c) => Number(c.machineCount ?? 0) > 0).length
    const noMachines = items.filter((c) => Number(c.machineCount ?? 0) === 0).length
    const openJobs = items.reduce((sum, c) => sum + Number(c.openJobCount ?? 0), 0)
    const openJobsCustomers = items.filter((c) => Number(c.openJobCount ?? 0) > 0).length
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const recent = items.filter((c) => {
      if (!c.createdAt) return false
      return new Date(c.createdAt).getTime() >= monthStart.getTime()
    }).length
    return {
      total: items.length,
      withPhone,
      withMachines,
      noMachines,
      openJobs,
      openJobsCustomers,
      recent,
    }
  }, [items])

  const displayed = useMemo(() => {
    let rows = items
    if (quickFilter === 'phone') rows = rows.filter((c) => Boolean(c.phone || c.mobile))
    else if (quickFilter === 'machines') rows = rows.filter((c) => Number(c.machineCount ?? 0) > 0)
    else if (quickFilter === 'noMachines')
      rows = rows.filter((c) => Number(c.machineCount ?? 0) === 0)
    else if (quickFilter === 'openJobs')
      rows = rows.filter((c) => Number(c.openJobCount ?? 0) > 0)
    else if (quickFilter === 'recent') {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      rows = rows.filter((c) => c.createdAt && new Date(c.createdAt).getTime() >= monthStart.getTime())
    }
    if (hasEmailFilter) rows = rows.filter((c) => Boolean(c.email?.trim()))
    if (hasWhatsappFilter) rows = rows.filter((c) => Boolean(c.whatsapp?.trim()))
    return rows
  }, [items, quickFilter, hasEmailFilter, hasWhatsappFilter])

  const sortedDisplayed = useMemo(() => {
    const rows = [...displayed]
    rows.sort((a, b) => {
      if (sortBy === 'recent') {
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      }
      if (sortBy === 'machines') {
        return Number(b.machineCount ?? 0) - Number(a.machineCount ?? 0)
      }
      if (sortBy === 'jobs') {
        return Number(b.openJobCount ?? 0) - Number(a.openJobCount ?? 0)
      }
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
    })
    return rows
  }, [displayed, sortBy])

  const ids = useMemo(() => sortedDisplayed.map((i) => String(i.id)), [sortedDisplayed])
  const selection = useRowSelection(ids)

  const filtersActive = Boolean(
    accountFilter ||
      ownerFilter ||
      cityFilter ||
      search ||
      quickFilter !== 'all' ||
      hasEmailFilter ||
      hasWhatsappFilter,
  )

  const sidebarFilters: ContactFilterState = {
    system: quickFilter,
    accountId: accountFilter,
    ownerUserId: ownerFilter,
    city: cityFilter,
    hasEmail: hasEmailFilter,
    hasWhatsapp: hasWhatsappFilter,
  }

  function applySidebarFilters(next: ContactFilterState) {
    setQuickFilter(next.system)
    setAccountFilter(next.accountId)
    setOwnerFilter(next.ownerUserId)
    setCityFilter(next.city)
    setHasEmailFilter(next.hasEmail)
    setHasWhatsappFilter(next.hasWhatsapp)
  }

  useEffect(() => {
    const tabQ = searchParams.get('tab')
    const filterQ = searchParams.get('filter') as SystemFilterId | null
    const open = searchParams.get('open') === '1'

    if (tabQ === 'import') {
      setTab('import')
      setSearchParams({}, { replace: true })
      return
    }
    if (tabQ === 'create' || open) {
      const phoneQ = searchParams.get('phone') ?? ''
      const nameQ = searchParams.get('q') ?? ''
      const back = searchParams.get('returnTo')
      setTab('create')
      setCreateStep('customer')
      setReturnTo(back)
      setForm((prev) => ({
        ...prev,
        phone: phoneQ || prev.phone,
        name: !phoneQ && nameQ && !/^\d/.test(nameQ) ? nameQ : prev.name,
        mobile: phoneQ || prev.mobile,
      }))
      setSearchParams({}, { replace: true })
      return
    }
    if (
      filterQ &&
      ['all', 'phone', 'machines', 'openJobs', 'noMachines', 'recent'].includes(filterQ)
    ) {
      setQuickFilter(filterQ)
      setFilterOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // Lookups already includes products — don't pay a second RDS round-trip via /products.
      const [contactsRes, lookups] = await Promise.all([
        api.contacts({
          limit: 100,
          search: search || undefined,
          accountId: accountFilter || undefined,
          ownerUserId: ownerFilter || undefined,
          city: cityFilter || undefined,
          hasAccount: undefined,
        }),
        api.lookups(),
      ])
      setItems((contactsRes.items ?? []) as ContactRow[])
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
        /* sales without inventory APIs still get lookups catalog */
      }
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to load contacts'
      setLoadError(message)
      addToast({
        type: 'error',
        message,
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, search, accountFilter, ownerFilter, cityFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!createMenuOpen) return
    function onDoc(e: MouseEvent) {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [createMenuOpen])

  function openCreateContact() {
    setCreateMenuOpen(false)
    setForm(emptyForm)
    setMachine(emptyMachine)
    setCreateStep('customer')
    setErrors({})
    setTab('create')
  }

  function openImportContacts() {
    setCreateMenuOpen(false)
    requestLeave(() => {
      clearUnsaved()
      setTab('import')
    })
  }

  function goNextToProduct(event?: FormEvent) {
    event?.preventDefault()
    const nextErrors = validateContactForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      return
    }
    setCreateStep('product')
  }

  const selectedCatalogProduct = useMemo(
    () => catalogProducts.find((p) => p.id === machine.catalogProductId) ?? null,
    [catalogProducts, machine.catalogProductId],
  )

  const machineRequiresStamping = useMemo(() => {
    if (selectedCatalogProduct) return productRequiresStamping(selectedCatalogProduct)
    return machineTypeRequiresStamping(machine.machineType, catalogProducts)
  }, [selectedCatalogProduct, machine.machineType, catalogProducts])

  const showStampingFields =
    !machine.skip && machine.origin === 'SOLD_BY_US' && machineRequiresStamping

  function patchMachine(next: Partial<typeof machine>) {
    setMachine((prev) => {
      const merged = { ...prev, ...next }
      if ('stampingDate' in next && merged.servicePlan === 'AMC' && next.stampingDate) {
        merged.stampingValidity = addOneYear(String(next.stampingDate))
      }
      return merged
    })
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    const nextErrors = validateContactForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      setCreateStep('customer')
      return
    }
    if (!machine.skip && machine.origin === 'SOLD_BY_US') {
      if (!machine.stockType || !machine.brandId || !machine.catalogProductId) {
        addToast({
          type: 'error',
          message: 'Sold by us — select machine type, brand, and model',
        })
        return
      }
    }
    const saveProduct = !machine.skip && machine.name.trim()
    setSaving(true)
    try {
      const mobileStored = toStoredIndianMobile(form.mobile)
      const waStored =
        toStoredIndianMobile(form.whatsapp) || mobileStored
      const customFields = {
        building_name: form.buildingName.trim() || null,
        landline: form.landline.trim() || null,
        mobile_2: toStoredIndianMobile(form.mobile2),
        mobile_3: toStoredIndianMobile(form.mobile3),
        whatsapp: waStored,
        gps_location: form.gpsLocation.trim() || null,
      }
      const created = await api.createContact({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.landline.trim() || mobileStored || waStored,
        mobile: mobileStored,
        street: form.street.trim() || null,
        doorNo: form.doorNo.trim() || null,
        area: form.area.trim() || null,
        pincode: form.pincode.trim() || null,
        location: form.landmark.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country.trim() || 'IN',
        accountId: form.accountId || null,
        ownerUserId: canAssign ? form.ownerUserId || null : null,
        description: form.description.trim() || null,
        tags: form.tags
          ? form.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        customFields,
      })
      if (saveProduct) {
        const soldByUs = machine.origin === 'SOLD_BY_US'
        const weighing =
          showStampingFields || isWeighingMachine(machine.machineType)
        const coverage = soldByUs ? hmsSoldCoverage(new Date(), weighing) : null
        await api.createAsset({
          contactId: String(created.id),
          machineType: machine.machineType,
          name: machine.name.trim(),
          capacity: machine.capacity || null,
          serialNo: machine.serialNo || null,
          model: machine.model || null,
          origin: machine.origin,
          servicePlan: soldByUs
            ? machine.servicePlan === 'AMC'
              ? 'AMC'
              : 'GC'
            : machine.servicePlan,
          warrantyEndDate: soldByUs
            ? coverage?.warrantyEndDate ?? null
            : null,
          amcStartDate: machine.servicePlan === 'AMC' ? machine.amcStartDate || null : null,
          amcEndDate: machine.servicePlan === 'AMC' ? machine.amcEndDate || null : null,
          nextDueDate: weighing
            ? machine.stampingValidity || coverage?.nextDueDate || null
            : machine.servicePlan === 'AMC'
              ? machine.nextServiceDate || null
              : null,
          stampingDate: weighing
            ? machine.stampingDate || coverage?.stampingDate || null
            : null,
          remindersEnabled: machine.remindersEnabled,
          customFields: {
            ...(machine.catalogProductId ? { catalogProductId: machine.catalogProductId } : {}),
            ...(machine.brandId
              ? {
                  brandId: machine.brandId,
                  brandName: catalogBrands.find((b) => b.id === machine.brandId)?.name ?? null,
                }
              : {}),
            ...(machine.stockType ? { catalogFamily: machine.stockType } : {}),
            ...(coverage
              ? {
                  soldAt: coverage.soldAt,
                  stampingQuarter: coverage.stampingQuarter,
                  stampingQuarterYear: coverage.stampingQuarterYear,
                }
              : {}),
          },
        })
      }
      setTab('list')
      setCreateStep('customer')
      setForm(emptyForm)
      setMachine(emptyMachine)
      setErrors({})
      addToast({
        type: 'success',
        message: created.customerCode
          ? `Customer saved — ID ${String(created.customerCode)}`
          : 'Customer saved',
      })
      if (returnTo) {
        const sep = returnTo.includes('?') ? '&' : '?'
        navigate(`${returnTo}${sep}contactId=${encodeURIComponent(String(created.id))}`)
        setReturnTo(null)
      } else {
        navigate(`/contacts/${created.id as string}`)
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create customer',
      })
    } finally {
      setSaving(false)
    }
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteContact(id)))
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
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Contacts"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Contacts' }]}
        actions={
          tab === 'list' ? (
            <div className="relative" ref={createMenuRef}>
              <div className="inline-flex overflow-hidden rounded-[6px] shadow-sm">
                <Button
                  className="rounded-none rounded-l-[6px] shadow-none"
                  onClick={openCreateContact}
                >
                  <UserPlus size={16} /> Create Contact
                </Button>
                <Button
                  className="rounded-none rounded-r-[6px] border-l border-white/25 px-2 shadow-none"
                  aria-label="More create options"
                  aria-expanded={createMenuOpen}
                  onClick={() => setCreateMenuOpen((o) => !o)}
                >
                  <ChevronDown size={16} className={createMenuOpen ? 'rotate-180' : ''} />
                </Button>
              </div>
              {createMenuOpen ? (
                <div className="absolute right-0 z-30 mt-1.5 min-w-[200px] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-[var(--shadow-card)]">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-muted/60"
                    onClick={openCreateContact}
                  >
                    <UserPlus size={14} className="text-accent-blue" />
                    Create Contact
                  </button>
                  {canCreateTickets(authRole) ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-muted/60"
                      onClick={openImportContacts}
                    >
                      <Upload size={14} className="text-accent-blue" />
                      Import Contacts
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null
        }
      />
      {leaveDialog}

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          requestLeave(() => {
            clearUnsaved()
            setTab(id as 'list' | 'create' | 'import')
            if (id === 'create') {
              setForm(emptyForm)
              setMachine(emptyMachine)
              setCreateStep('customer')
              setErrors({})
            }
          })
        }}
        tabs={[
          { id: 'list', label: 'Directory', count: items.length },
          ...(canCreateTickets(authRole) ? [{ id: 'import', label: 'Import Contacts' }] : []),
          { id: 'create', label: 'Create Contact' },
        ]}
      />

      {tab === 'import' ? (
        <CustomerImportPanel
          onCancel={() =>
            requestLeave(() => {
              clearUnsaved()
              setTab('list')
            })
          }
          onImported={() => {
            clearUnsaved()
            void load()
            setTab('list')
          }}
        />
      ) : null}

      {tab === 'list' ? (
        <>
          {/* Zoho-style: filter sidebar + directory */}
          <div
            id="customer-directory"
            className="flex min-h-[560px] overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-card)]"
          >
            <ContactFilterSidebar
              open={filterOpen}
              width={filterWidth}
              onWidthChange={setFilterWidth}
              onClose={() => setFilterOpen(false)}
              filters={sidebarFilters}
              onChange={applySidebarFilters}
              accounts={accounts}
              users={users}
              showOwner={canAssign}
              counts={{
                all: overview.total,
                phone: overview.withPhone,
                machines: overview.withMachines,
                noMachines: overview.noMachines,
                openJobs: overview.openJobsCustomers,
                recent: overview.recent,
              }}
            />

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                <Button
                  type="button"
                  size="sm"
                  variant={filterOpen ? 'secondary' : 'outline'}
                  onClick={() => setFilterOpen((v) => !v)}
                  title="Toggle filters"
                >
                  <Filter size={14} />
                  Filter
                </Button>
                <Select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  options={[
                    { value: 'name', label: 'Sort: Name' },
                    { value: 'recent', label: 'Sort: Newest' },
                    { value: 'machines', label: 'Sort: Machines' },
                    { value: 'jobs', label: 'Sort: Open jobs' },
                  ]}
                  className="h-9 w-[150px]"
                />
                <div className="relative min-w-[200px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                    size={15}
                  />
                  <Input
                    placeholder="Search name, mobile, or CUS-#####…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 rounded-lg pl-9"
                  />
                </div>
                {filtersActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      applySidebarFilters({
                        system: 'all',
                        accountId: '',
                        ownerUserId: '',
                        city: '',
                        hasEmail: false,
                        hasWhatsapp: false,
                      })
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
                <div className="ml-auto text-xs text-text-secondary">
                  Total records{' '}
                  <span className="font-semibold text-text-primary">{sortedDisplayed.length}</span>
                </div>
              </div>

            {loading ? (
              <TableSkeleton rows={6} className="p-6" />
            ) : loadError && items.length === 0 ? (
              <EmptyState
                icon={<UserPlus size={26} />}
                title="Could not load customers"
                subtitle={loadError}
                actionLabel="Retry"
                onAction={() => void load()}
              />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<UserPlus size={26} />}
                title="No customers yet"
                subtitle="Add your first customer shop / contact."
                actionLabel="Create Contact"
                onAction={() => {
                  setCreateStep('customer')
                  setTab('create')
                }}
              />
            ) : displayed.length === 0 ? (
              <EmptyState
                icon={<Users size={26} />}
                title="No customers in this filter"
                subtitle="Try another filter or clear all."
                actionLabel="Show all"
                onAction={() =>
                  applySidebarFilters({
                    system: 'all',
                    accountId: '',
                    ownerUserId: '',
                    city: '',
                    hasEmail: false,
                    hasWhatsapp: false,
                  })
                }
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-3 pt-2">
                {selection.someSelected ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="customer"
                    busy={busyDelete}
                    onClear={selection.clear}
                    onDelete={() => setConfirm({ ids: selection.selectedIds })}
                  />
                ) : null}
                <div className="overflow-hidden rounded-lg border border-border/80">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[880px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-[0.06em] text-text-secondary">
                          <th className="w-10 px-4 py-3">
                            <SelectCheckbox
                              checked={selection.allSelected}
                              indeterminate={selection.someSelected && !selection.allSelected}
                              onChange={selection.toggleAll}
                              aria-label="Select all"
                            />
                          </th>
                          {[
                            'Contact name',
                            'Account name',
                            'Phone',
                            'Machines',
                            'Contact owner',
                            'Actions',
                          ].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDisplayed.map((c) => {
                          const rawPhone = c.phone || c.mobile || ''
                          const phoneDisplay = formatPhone(rawPhone) || '—'
                          const waRaw = c.whatsapp?.trim() || ''
                          const showWa =
                            Boolean(waRaw) &&
                            waRaw.replace(/\D/g, '') !== rawPhone.replace(/\D/g, '')
                          const machines = Number(c.machineCount ?? 0)
                          return (
                            <tr
                              key={c.id}
                              className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-accent-soft/40"
                              onClick={() => navigate(`/contacts/${c.id}`)}
                            >
                              <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                <SelectCheckbox
                                  checked={selection.isSelected(c.id)}
                                  onChange={() => selection.toggle(c.id)}
                                  aria-label={`Select ${c.name}`}
                                />
                              </td>
                              <td className="px-4 py-2.5">
                                <Link
                                  to={`/contacts/${c.id}`}
                                  className="flex min-w-0 items-center gap-2.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Avatar name={c.name} size="sm" />
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-accent-blue hover:underline">
                                      {c.name}
                                    </div>
                                    <div className="font-mono text-[11px] text-text-secondary">
                                      {c.customerCode ?? 'No ID'}
                                    </div>
                                  </div>
                                </Link>
                              </td>
                              <td className="px-4 py-2.5 text-text-primary">
                                {c.accountName ? (
                                  c.accountId ? (
                                    <Link
                                      to={`/accounts/${c.accountId}`}
                                      className="text-accent-blue hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {c.accountName}
                                    </Link>
                                  ) : (
                                    c.accountName
                                  )
                                ) : (
                                  <span className="text-text-secondary">—</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5 font-medium tabular-nums text-text-primary">
                                  {rawPhone ? <Phone size={12} className="text-accent-green" /> : null}
                                  {phoneDisplay}
                                </div>
                                {showWa ? (
                                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-text-secondary">
                                    <WhatsAppIcon size={11} color={WA_GREEN} />
                                    {formatPhone(waRaw) || waRaw}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-4 py-2.5">
                                {machines > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                                    <Package size={12} /> {machines}
                                  </span>
                                ) : (
                                  <span className="text-xs text-text-secondary">—</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-text-secondary">
                                {c.ownerName ?? 'Unassigned'}
                              </td>
                              <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
                                  <ViewIconButton onClick={() => navigate(`/contacts/${c.id}`)} />
                                  <DeleteIconButton
                                    disabled={busyDelete}
                                    onClick={() => setConfirm({ ids: [c.id] })}
                                  />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="mt-3 px-1 text-xs text-text-secondary">
                  Showing {displayed.length} customer{displayed.length === 1 ? '' : 's'}
                  {filtersActive ? ' · filters applied' : ''}
                </p>
              </div>
            )}
            </div>
          </div>
        </>
      ) : tab === 'create' ? (
        <FormPanel
          open
          accent="theme"
          eyebrow="Customers"
          title={createStep === 'customer' ? 'Create Contact' : 'Add product / machine'}
          width={680}
          storageKey="nova.drawer.contacts.create"
          subtitle={
            createStep === 'customer'
              ? 'Shop details first — then Next to add product (Sold by us or Outside).'
              : 'Optional. Mark Sold by us vs Outside / repair only. Skip if you only need the customer.'
          }
          onClose={() => {
            setTab('list')
            setCreateStep('customer')
            setForm(emptyForm)
            setMachine(emptyMachine)
            setErrors({})
            setReturnTo(null)
          }}
          footer={
            <>
              <FormPanelCancel
                skipConfirm={createStep === 'product'}
                onClick={
                  createStep === 'product' ? () => setCreateStep('customer') : undefined
                }
              />
              {createStep === 'customer' ? (
                <Button type="submit" form="customer-step">
                  Next — add product
                </Button>
              ) : (
                <Button type="submit" form="product-step" disabled={saving}>
                  {saving ? 'Saving…' : machine.skip ? 'Save customer only' : 'Save customer + product'}
                </Button>
              )}
            </>
          }
        >
          {createStep === 'customer' ? (
            <form id="customer-step" onSubmit={(e) => goNextToProduct(e)} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Input
                  label="Company / shop / customer name *"
                  value={form.name}
                  error={errors.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="HMS ENTERPRISES"
                  className="sm:col-span-2 lg:col-span-3"
                />
                <Input
                  label="Door number"
                  value={form.doorNo}
                  onChange={(e) => setForm({ ...form, doorNo: e.target.value })}
                />
                <Input
                  label="Street"
                  value={form.street}
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                />
                <Input
                  label="Building name"
                  value={form.buildingName}
                  onChange={(e) => setForm({ ...form, buildingName: e.target.value })}
                />
                <Input
                  label="Area"
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                />
                <Input
                  label="City"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
                <Input
                  label="State"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                />
                <Input
                  label="PIN code"
                  value={form.pincode}
                  error={errors.pincode}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                />
                <Input
                  label="Landmark"
                  value={form.landmark}
                  onChange={(e) => setForm({ ...form, landmark: e.target.value })}
                  className="sm:col-span-2"
                />
                <Input
                  label="Landline number"
                  value={form.landline}
                  onChange={(e) =>
                    setForm({ ...form, landline: e.target.value, phone: e.target.value })
                  }
                  placeholder="Optional landline"
                />
                <PhoneInput
                  label="Mobile number 1"
                  required
                  value={form.mobile}
                  error={errors.mobile || errors.phone}
                  onChange={(mobile) => setForm({ ...form, mobile })}
                  hint="India (+91) — enter 10 digits only"
                />
                <PhoneInput
                  label="Mobile number 2"
                  value={form.mobile2}
                  error={errors.mobile2}
                  onChange={(mobile2) => setForm({ ...form, mobile2 })}
                />
                <PhoneInput
                  label="Mobile number 3"
                  value={form.mobile3}
                  error={errors.mobile3}
                  onChange={(mobile3) => setForm({ ...form, mobile3 })}
                />
                <PhoneInput
                  id="whatsapp-number"
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <WhatsAppIcon size={14} />
                      <span style={{ color: WA_GREEN }}>WhatsApp number</span>
                    </span>
                  }
                  value={form.whatsapp}
                  error={errors.whatsapp}
                  onChange={(whatsapp) => setForm({ ...form, whatsapp })}
                  hint="Defaults to mobile 1 if empty"
                />
                <Input
                  label="Email ID"
                  type="email"
                  value={form.email}
                  error={errors.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <Input
                  label="GPS location"
                  value={form.gpsLocation}
                  onChange={(e) => setForm({ ...form, gpsLocation: e.target.value })}
                  placeholder="Maps link or lat,long"
                  className="sm:col-span-2 lg:col-span-3"
                />
                {canAssign && !isDesk ? (
                <Select
                  label="Lead — name of the executive"
                  value={form.ownerUserId}
                  onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
                  options={[
                    { value: '', label: 'Select executive' },
                    ...users.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                />
                ) : null}
                <label className="block text-sm sm:col-span-2 lg:col-span-3">
                  <span className="mb-1 block font-medium text-text-secondary">Notes</span>
                  <textarea
                    className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </label>
              </div>
            </form>
          ) : (
            <form id="product-step" onSubmit={(e) => void handleSave(e)} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
                  <input
                    type="checkbox"
                    checked={machine.skip}
                    onChange={(e) => setMachine({ ...machine, skip: e.target.checked })}
                  />
                  Skip product for now — save customer only
                </label>
                {!machine.skip ? (
                  <>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Select
                        label="Origin *"
                        value={machine.origin}
                        onChange={(e) =>
                          patchMachine({
                            origin: e.target.value,
                            servicePlan:
                              e.target.value === 'SOLD_BY_US' && machine.servicePlan === 'NON_AMC'
                                ? 'GC'
                                : e.target.value === 'THIRD_PARTY' && machine.servicePlan === 'GC'
                                  ? 'NON_AMC'
                                  : machine.servicePlan,
                          })
                        }
                        options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        {ASSET_ORIGIN_OPTIONS.find((o) => o.value === machine.origin)?.hint}
                      </p>
                    </div>
                    {machine.origin === 'SOLD_BY_US' ? (
                      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-3">
                        <CatalogMachinePick
                          products={catalogProducts}
                          brands={catalogBrands}
                          stockType={machine.stockType}
                          brandId={machine.brandId}
                          productId={machine.catalogProductId}
                          onChange={(next) =>
                            patchMachine({
                              stockType: next.stockType,
                              brandId: next.brandId,
                              catalogProductId: next.productId,
                              name: next.name,
                              model: next.model,
                              machineType: next.machineType,
                              capacity: next.capacity || machine.capacity,
                            })
                          }
                        />
                        {machine.name ? (
                          <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                            Selected: <strong className="text-text-primary">{machine.name}</strong>
                            {machine.model ? ` · ${machine.model}` : ''}
                          </p>
                        ) : (
                          <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                            Same as inventory: type → brand → model from catalog.
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <Select
                          label="Type"
                          value={machine.machineType}
                          onChange={(e) =>
                            patchMachine({
                              machineType: e.target.value,
                              catalogProductId: '',
                            })
                          }
                          options={MACHINE_TYPES}
                        />
                        <Input
                          label="Product / machine name"
                          className="lg:col-span-2"
                          value={machine.name}
                          onChange={(e) => patchMachine({ name: e.target.value })}
                        />
                        <Input
                          label="Model"
                          value={machine.model}
                          onChange={(e) => patchMachine({ model: e.target.value })}
                        />
                        <Input
                          label="Capacity"
                          value={machine.capacity}
                          onChange={(e) => patchMachine({ capacity: e.target.value })}
                        />
                      </>
                    )}
                    <Input label="Serial number" value={machine.serialNo} onChange={(e) => patchMachine({ serialNo: e.target.value })} />
                    <Select
                      label="Service plan"
                      value={machine.servicePlan}
                      onChange={(e) => patchMachine({ servicePlan: e.target.value })}
                      options={
                        machine.origin === 'SOLD_BY_US'
                          ? [
                              { value: 'GC', label: 'GC — 1 year from sale' },
                              ...(isWeighingMachine(machine.machineType)
                                ? [{ value: 'AMC', label: 'AMC — weighing only (after GC / existing)' }]
                                : []),
                            ]
                          : [
                              { value: 'NON_AMC', label: 'NGC / Non-AMC' },
                              ...(isWeighingMachine(machine.machineType)
                                ? [{ value: 'AMC', label: 'AMC — weighing only' }]
                                : []),
                            ]
                      }
                    />
                    {machine.origin === 'SOLD_BY_US' ? (
                      <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                        HMS sale = 1 year GC from today. Weighing also gets 1 year stamping, tagged
                        quarter A–D (Oct is D).
                      </p>
                    ) : (
                      <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                        Outside / repair-only machines can also take AMC — choose AMC and set dates.
                      </p>
                    )}
                    {machine.servicePlan === 'AMC' ? (
                      <>
                        <Input
                          label="AMC start date"
                          type="date"
                          value={machine.amcStartDate}
                          onChange={(e) => patchMachine({ amcStartDate: e.target.value })}
                        />
                        <Input
                          label="AMC end date"
                          type="date"
                          value={machine.amcEndDate}
                          onChange={(e) => patchMachine({ amcEndDate: e.target.value })}
                        />
                        {showStampingFields ? (
                          <>
                            <Input
                              label="Stamping date"
                              type="date"
                              value={machine.stampingDate}
                              onChange={(e) => patchMachine({ stampingDate: e.target.value })}
                            />
                            <Input
                              label="Stamping validity"
                              type="date"
                              value={machine.stampingValidity}
                              onChange={(e) => patchMachine({ stampingValidity: e.target.value })}
                            />
                            <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                              Stamping validity is usually one year from the stamping date (govt. renewal due).
                            </p>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Input
                          label="Next service date"
                          type="date"
                          value={machine.nextServiceDate}
                          onChange={(e) => patchMachine({ nextServiceDate: e.target.value })}
                        />
                        {showStampingFields ? (
                          <Input
                            label="Stamping date"
                            type="date"
                            value={machine.stampingDate}
                            onChange={(e) => patchMachine({ stampingDate: e.target.value })}
                          />
                        ) : null}
                      </>
                    )}
                  </>
                ) : null}
              </div>
            </form>
          )}
        </FormPanel>
      ) : null}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete customer?' : `Delete ${confirm?.ids.length ?? 0} customers?`}
        body={
          confirm?.ids.length === 1
            ? 'This customer will be permanently removed.'
            : 'Selected customers will be permanently removed.'
        }
      />
    </div>
  )
}
