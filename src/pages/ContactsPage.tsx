import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Building2,
  MapPin,
  Phone,
  Search,
  Users,
  UserPlus,
  Filter,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
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
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { PageHeader } from '@/components/layout/PageHeader'
import { SparePartsPanel } from '@/components/contacts/SparePartsPanel'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS } from '@/lib/assetOrigin'
import {
  machineTypeRequiresStamping,
  productAttrs,
  productRequiresStamping,
} from '@/lib/productCatalog'
import { firstError, validateContactForm, type FieldErrors } from '@/lib/formValidation'
import { cn, formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { canAssignTickets, isServiceDesk } from '@/lib/roles'

type ContactRow = {
  id: string
  customerCode?: string | null
  customerNo?: number | null
  name: string
  email?: string | null
  phone?: string | null
  mobile?: string | null
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
  machineType: 'WEIGHING',
  name: '',
  capacity: '',
  serialNo: '',
  model: '',
  origin: 'SOLD_BY_US',
  servicePlan: 'NON_AMC',
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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [linkFilter, setLinkFilter] = useState('') // '' | linked | unlinked
  const [phone, setPhone] = useState('')
  const [phoneResult, setPhoneResult] = useState<string | null>(null)
  const [phoneNotFound, setPhoneNotFound] = useState(false)
  const [tab, setTab] = useState<'list' | 'create' | 'spare'>('list')
  const [createStep, setCreateStep] = useState<'customer' | 'product'>('customer')
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [machine, setMachine] = useState(emptyMachine)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const ids = useMemo(() => items.map((i) => String(i.id)), [items])
  const selection = useRowSelection(ids)

  const overview = useMemo(() => {
    const withPhone = items.filter((c) => Boolean(c.phone || c.mobile)).length
    const linked = items.filter((c) => Boolean(c.accountId)).length
    const cities = new Set(items.map((c) => (c.city || '').trim()).filter(Boolean)).size
    return { total: items.length, withPhone, linked, cities }
  }, [items])

  const filtersActive = Boolean(accountFilter || ownerFilter || linkFilter || cityFilter || search)

  useEffect(() => {
    const open = searchParams.get('open') === '1'
    if (!open) return
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
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [contactsRes, lookups, productPage] = await Promise.all([
        api.contacts({
          limit: 100,
          search: search || undefined,
          accountId: accountFilter || undefined,
          ownerUserId: ownerFilter || undefined,
          city: cityFilter || undefined,
          hasAccount: linkFilter === 'linked' ? '1' : linkFilter === 'unlinked' ? '0' : undefined,
        }),
        api.lookups(),
        api.products({ limit: 500 }),
      ])
      setItems((contactsRes.items ?? []) as ContactRow[])
      setAccounts(lookups.accounts)
      setUsers(lookups.users)
      setCatalogProducts(
        (productPage.items ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name ?? ''),
          sku: String(p.sku ?? ''),
          attributes: (p.attributes as Record<string, unknown> | null) ?? null,
        })),
      )
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
  }, [addToast, search, accountFilter, ownerFilter, cityFilter, linkFilter])

  useEffect(() => {
    void load()
  }, [load])

  async function handlePhoneLookup(event: FormEvent) {
    event.preventDefault()
    setPhoneNotFound(false)
    if (!phone.trim()) {
      setPhoneResult('Enter a phone number or Customer ID (CUS-#####).')
      return
    }
    try {
      const q = phone.trim()
      if (/^CUS-/i.test(q)) {
        const res = await api.contacts({ limit: 5, search: q.toUpperCase() })
        const hits = (res.items ?? []) as ContactRow[]
        const exact = hits.find((c) => String(c.customerCode).toUpperCase() === q.toUpperCase())
        if (exact) {
          navigate(`/contacts/${exact.id}`)
          return
        }
        setPhoneResult('No customer found with that Customer ID.')
        setPhoneNotFound(true)
        return
      }
      const hits = (await api.contactsLookup(q)) as ContactRow[]
      if (hits?.length) {
        navigate(`/contacts/${hits[0].id}`)
        return
      }
      setPhoneResult('No customer found with this phone number.')
      setPhoneNotFound(true)
    } catch (err) {
      setPhoneResult(err instanceof ApiClientError ? err.message : 'Lookup failed')
      setPhoneNotFound(false)
    }
  }

  function addCustomerFromLookup() {
    const q = phone.trim()
    const digits = q.replace(/\D/g, '')
    const looksPhone = digits.length >= 7 && !/^CUS-/i.test(q)
    setTab('create')
    setCreateStep('customer')
    setReturnTo(null)
    setForm({
      ...emptyForm,
      phone: looksPhone ? q : '',
      mobile: looksPhone ? q : '',
      landline: '',
    })
    setPhoneResult(null)
    setPhoneNotFound(false)
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

  const catalogProductsForType = useMemo(
    () =>
      catalogProducts.filter(
        (p) => String(productAttrs(p).catalogKind ?? '') === machine.machineType,
      ),
    [catalogProducts, machine.machineType],
  )

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
    const saveProduct = !machine.skip && machine.name.trim()
    setSaving(true)
    try {
      const customFields = {
        building_name: form.buildingName.trim() || null,
        landline: form.landline.trim() || null,
        mobile_2: form.mobile2.trim() || null,
        mobile_3: form.mobile3.trim() || null,
        whatsapp: form.whatsapp.trim() || form.mobile.trim() || null,
        gps_location: form.gpsLocation.trim() || null,
      }
      const primaryPhone = form.mobile.trim() || form.landline.trim() || form.whatsapp.trim()
      const created = await api.createContact({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.landline.trim() || primaryPhone || null,
        mobile: form.mobile.trim() || null,
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
        await api.createAsset({
          contactId: String(created.id),
          machineType: machine.machineType,
          name: machine.name.trim(),
          capacity: machine.capacity || null,
          serialNo: machine.serialNo || null,
          model: machine.model || null,
          origin: machine.origin,
          servicePlan: machine.servicePlan,
          amcStartDate: machine.servicePlan === 'AMC' ? machine.amcStartDate || null : null,
          amcEndDate: machine.servicePlan === 'AMC' ? machine.amcEndDate || null : null,
          nextDueDate:
            machine.servicePlan === 'AMC'
              ? showStampingFields
                ? machine.stampingValidity || null
                : null
              : machine.nextServiceDate || null,
          stampingDate: showStampingFields ? machine.stampingDate || null : null,
          remindersEnabled: machine.remindersEnabled,
          customFields: machine.catalogProductId
            ? { catalogProductId: machine.catalogProductId }
            : undefined,
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
        title="Customers"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Customers' }]}
        actions={
          tab === 'list' ? (
            <Button
              onClick={() => {
                setForm(emptyForm)
                setMachine(emptyMachine)
                setCreateStep('customer')
                setErrors({})
                setTab('create')
              }}
            >
              <UserPlus size={16} /> Add customer
            </Button>
          ) : null
        }
      />

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create' | 'spare')
          if (id === 'create') {
            setForm(emptyForm)
            setMachine(emptyMachine)
            setCreateStep('customer')
            setErrors({})
          }
        }}
        tabs={[
          { id: 'list', label: 'Directory', count: items.length },
          { id: 'spare', label: 'Spare parts' },
          { id: 'create', label: 'Add customer' },
        ]}
      />

      {tab === 'spare' ? <SparePartsPanel /> : null}

      {tab === 'list' ? (
        <>
          {/* Overview strip */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Total customers',
                value: overview.total,
                icon: Users,
                tint: 'from-sky-500/15 to-transparent text-sky-700 dark:text-sky-300',
              },
              {
                label: 'With phone',
                value: overview.withPhone,
                icon: Phone,
                tint: 'from-emerald-500/15 to-transparent text-emerald-700 dark:text-emerald-300',
              },
              {
                label: 'Linked accounts',
                value: overview.linked,
                icon: Building2,
                tint: 'from-indigo-500/15 to-transparent text-indigo-700 dark:text-indigo-300',
              },
              {
                label: 'Cities covered',
                value: overview.cities,
                icon: MapPin,
                tint: 'from-amber-500/15 to-transparent text-amber-800 dark:text-amber-300',
              },
            ].map((stat) => {
              const Icon = stat.icon
              return (
                <div
                  key={stat.label}
                  className={cn(
                    'relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]',
                    'bg-gradient-to-br',
                    stat.tint,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                        {stat.label}
                      </p>
                      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
                        {loading ? '—' : stat.value}
                      </p>
                    </div>
                    <div className="flex size-10 items-center justify-center rounded-xl bg-card/80 ring-1 ring-border/60">
                      <Icon size={18} className="opacity-80" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Quick lookup */}
          <Card className="overflow-hidden border-border/80 p-0 shadow-[var(--shadow-card)]">
            <div className="border-b border-border bg-gradient-to-r from-[var(--color-panel-from)] via-card to-[var(--color-panel-to)] px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Quick lookup</h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Jump to a customer by mobile or Customer ID (CUS-#####).
                  </p>
                </div>
              </div>
              <form onSubmit={handlePhoneLookup} className="mt-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary"
                      size={17}
                    />
                    <Input
                      id="phone-lookup"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value)
                        setPhoneResult(null)
                        setPhoneNotFound(false)
                      }}
                      placeholder="+91 98xxx xxxxx or CUS-00042"
                      className="h-11 rounded-xl border-border/80 bg-card pl-10 shadow-sm"
                    />
                  </div>
                  <Button type="submit" className="h-11 rounded-xl px-5 sm:w-auto">
                    Lookup
                  </Button>
                </div>
                {phoneResult ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-3.5 py-2.5">
                    <p className="text-sm text-text-secondary">{phoneResult}</p>
                    {phoneNotFound ? (
                      <Button type="button" size="sm" variant="outline" onClick={addCustomerFromLookup}>
                        <UserPlus size={14} /> Add customer
                        {phone.trim() ? (
                          <span className="font-normal opacity-80">— “{phone.trim()}”</span>
                        ) : null}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </form>
            </div>

            {/* Filters + table */}
            <div className="border-b border-border px-5 py-3.5">
              <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">
                <Filter size={13} /> Directory filters
              </div>
              <div className="flex flex-wrap gap-2.5">
                <div className="relative min-w-[220px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                    size={15}
                  />
                  <Input
                    placeholder="Search ID, name, email, phone…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="rounded-lg pl-9"
                  />
                </div>
                <Select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  className="w-44"
                  options={[
                    { value: '', label: 'All accounts' },
                    ...accounts.map((a) => ({ value: a.id, label: a.name })),
                  ]}
                />
                {canAssign ? (
                  <Select
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                    className="w-40"
                    options={[
                      { value: '', label: 'All owners' },
                      ...users.map((u) => ({ value: u.id, label: u.name })),
                    ]}
                  />
                ) : null}
                <Select
                  value={linkFilter}
                  onChange={(e) => setLinkFilter(e.target.value)}
                  className="w-40"
                  options={[
                    { value: '', label: 'Linked / any' },
                    { value: 'linked', label: 'Has account' },
                    { value: 'unlinked', label: 'No account' },
                  ]}
                />
                <Input
                  placeholder="City"
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="w-32"
                />
                {filtersActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setAccountFilter('')
                      setOwnerFilter('')
                      setLinkFilter('')
                      setCityFilter('')
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            {loading ? (
              <div className="space-y-3 p-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/70" />
                ))}
              </div>
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
                actionLabel="Add customer"
                onAction={() => {
                  setCreateStep('customer')
                  setTab('create')
                }}
              />
            ) : (
              <div className="p-4 pt-3">
                {selection.someSelected ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="customer"
                    busy={busyDelete}
                    onClear={selection.clear}
                    onDelete={() => setConfirm({ ids: selection.selectedIds })}
                  />
                ) : null}
                <div className="overflow-hidden rounded-xl border border-border/80">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-sm">
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
                            'Customer',
                            'Contact',
                            'Location',
                            'Account',
                            'Added',
                            'Actions',
                          ].map((h) => (
                            <th key={h} className="px-4 py-3 font-semibold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((c) => {
                          const phoneDisplay = formatPhone(c.phone || c.mobile || '') || '—'
                          const place = [c.area, c.location].filter(Boolean).join(' · ')
                          const cityLine = [c.city, c.state].filter(Boolean).join(', ')
                          return (
                            <tr
                              key={c.id}
                              className="group cursor-pointer border-t border-border/70 transition-colors hover:bg-accent-soft/40"
                              onClick={() => navigate(`/contacts/${c.id}`)}
                            >
                              <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                                <SelectCheckbox
                                  checked={selection.isSelected(c.id)}
                                  onChange={() => selection.toggle(c.id)}
                                  aria-label={`Select ${c.name}`}
                                />
                              </td>
                              <td className="px-4 py-3.5">
                                <Link
                                  to={`/contacts/${c.id}`}
                                  className="flex items-center gap-3"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Avatar name={c.name} size="sm" />
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-text-primary group-hover:text-accent-blue">
                                      {c.name}
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] font-medium text-accent-blue/90">
                                      {c.customerCode ?? 'No ID'}
                                    </div>
                                  </div>
                                </Link>
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="font-medium tabular-nums text-text-primary">{phoneDisplay}</div>
                                {c.email ? (
                                  <div className="mt-0.5 truncate text-xs text-text-secondary">{c.email}</div>
                                ) : null}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="text-text-primary">{place || '—'}</div>
                                <div className="mt-0.5 text-xs text-text-secondary">{cityLine || '—'}</div>
                              </td>
                              <td className="px-4 py-3.5">
                                {c.accountId ? (
                                  <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                                    Linked
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-text-secondary ring-1 ring-border">
                                    No account
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3.5 text-text-secondary">
                                {c.createdAt ? formatDate(String(c.createdAt)) : '—'}
                              </td>
                              <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
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
                  Showing {items.length} customer{items.length === 1 ? '' : 's'}
                  {filtersActive ? ' · filters applied' : ''}
                </p>
              </div>
            )}
          </Card>
        </>
      ) : tab === 'create' ? (
        <FormPanel
          open
          accent="theme"
          eyebrow="Customers"
          title={createStep === 'customer' ? 'Add customer' : 'Add product / machine'}
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
                onClick={() => {
                  if (createStep === 'product') {
                    setCreateStep('customer')
                    return
                  }
                  setTab('list')
                  setForm(emptyForm)
                  setMachine(emptyMachine)
                  setErrors({})
                  setReturnTo(null)
                }}
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
                  error={errors.phone}
                  onChange={(e) =>
                    setForm({ ...form, landline: e.target.value, phone: e.target.value })
                  }
                />
                <Input
                  label="Mobile number 1 *"
                  value={form.mobile}
                  error={errors.mobile || errors.phone}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  placeholder="+91 98xxx xxxxx"
                />
                <Input
                  label="Mobile number 2"
                  value={form.mobile2}
                  onChange={(e) => setForm({ ...form, mobile2: e.target.value })}
                />
                <Input
                  label="Mobile number 3"
                  value={form.mobile3}
                  onChange={(e) => setForm({ ...form, mobile3: e.target.value })}
                />
                <Input
                  id="whatsapp-number"
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <WhatsAppIcon size={14} />
                      <span style={{ color: WA_GREEN }}>WhatsApp number</span>
                    </span>
                  }
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  placeholder="Defaults to mobile 1 if empty"
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
                        onChange={(e) => patchMachine({ origin: e.target.value })}
                        options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        {ASSET_ORIGIN_OPTIONS.find((o) => o.value === machine.origin)?.hint}
                      </p>
                    </div>
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
                    {catalogProductsForType.length > 0 ? (
                      <Select
                        label="Catalog product"
                        className="lg:col-span-2"
                        value={machine.catalogProductId}
                        onChange={(e) => patchMachine({ catalogProductId: e.target.value })}
                        options={[
                          { value: '', label: 'Select from catalog (optional)…' },
                          ...catalogProductsForType.map((p) => ({
                            value: p.id,
                            label: p.name,
                          })),
                        ]}
                      />
                    ) : null}
                    <Input
                      label="Product / machine name"
                      className="lg:col-span-2"
                      value={machine.name}
                      onChange={(e) => patchMachine({ name: e.target.value })}
                    />
                    <Input label="Capacity" value={machine.capacity} onChange={(e) => patchMachine({ capacity: e.target.value })} />
                    <Input label="Model" value={machine.model} onChange={(e) => patchMachine({ model: e.target.value })} />
                    <Input label="Serial number" value={machine.serialNo} onChange={(e) => patchMachine({ serialNo: e.target.value })} />
                    <Select
                      label="Service plan"
                      value={machine.servicePlan}
                      onChange={(e) => patchMachine({ servicePlan: e.target.value })}
                      options={[
                        { value: 'NON_AMC', label: 'Non-AMC' },
                        { value: 'AMC', label: 'AMC' },
                      ]}
                    />
                    {machine.origin === 'THIRD_PARTY' ? (
                      <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                        Outside / repair-only machines can also take AMC — choose AMC and set dates.
                      </p>
                    ) : null}
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
