import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, UserPlus } from 'lucide-react'
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
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS } from '@/lib/assetOrigin'
import { firstError, validateContactForm, type FieldErrors } from '@/lib/formValidation'
import { formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

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
  email: '',
  alternateEmail: '',
  phone: '',
  mobile: '',
  whatsapp: '',
  title: '',
  department: '',
  street: '',
  doorNo: '',
  area: '',
  city: '',
  state: '',
  pincode: '',
  location: '',
  country: 'IN',
  addressLine: '',
  linkedin: '',
  accountId: '',
  ownerUserId: '',
  description: '',
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
  machineType: 'WEIGHING',
  name: '',
  capacity: '',
  serialNo: '',
  model: '',
  origin: 'SOLD_BY_US',
  servicePlan: 'NON_AMC',
  amcStartDate: '',
  amcEndDate: '',
  nextDueDate: '',
  stampingDate: '',
  remindersEnabled: true,
}

export function ContactsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)

  const [items, setItems] = useState<ContactRow[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [linkFilter, setLinkFilter] = useState('') // '' | linked | unlinked
  const [phone, setPhone] = useState('')
  const [phoneResult, setPhoneResult] = useState<string | null>(null)
  const [tab, setTab] = useState<'list' | 'create'>('list')
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
      const [contactsRes, lookups] = await Promise.all([
        api.contacts({
          limit: 100,
          search: search || undefined,
          accountId: accountFilter || undefined,
          ownerUserId: ownerFilter || undefined,
          city: cityFilter || undefined,
          hasAccount: linkFilter === 'linked' ? '1' : linkFilter === 'unlinked' ? '0' : undefined,
        }),
        api.lookups(),
      ])
      setItems((contactsRes.items ?? []) as ContactRow[])
      setAccounts(lookups.accounts)
      setUsers(lookups.users)
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
        return
      }
      const hits = (await api.contactsLookup(q)) as ContactRow[]
      if (hits?.length) {
        navigate(`/contacts/${hits[0].id}`)
        return
      }
      setPhoneResult('No customer found with this phone number.')
    } catch (err) {
      setPhoneResult(err instanceof ApiClientError ? err.message : 'Lookup failed')
    }
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

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (createStep === 'customer') {
      goNextToProduct()
      return
    }
    const nextErrors = validateContactForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      setCreateStep('customer')
      return
    }
    if (!machine.skip && !machine.name.trim()) {
      addToast({ type: 'error', message: 'Enter product/machine name, or skip this step' })
      return
    }
    setSaving(true)
    try {
      const customFields = {
        alternate_email: form.alternateEmail.trim() || null,
        whatsapp: form.whatsapp.trim() || form.mobile.trim() || null,
        address_line: form.addressLine.trim() || form.street.trim() || null,
        linkedin: form.linkedin.trim() || null,
      }
      const created = await api.createContact({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        mobile: form.mobile.trim() || null,
        title: form.title.trim() || null,
        department: form.department.trim() || null,
        street: form.street.trim() || null,
        doorNo: form.doorNo.trim() || null,
        area: form.area.trim() || null,
        pincode: form.pincode.trim() || null,
        location: form.location.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country.trim() || 'IN',
        accountId: form.accountId || null,
        ownerUserId: form.ownerUserId || null,
        description: form.description.trim() || null,
        tags: form.tags
          ? form.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        customFields,
      })
      if (!machine.skip && machine.name.trim()) {
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
          nextDueDate: machine.nextDueDate || null,
          stampingDate: machine.stampingDate || null,
          remindersEnabled: machine.remindersEnabled,
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
    <div>
      <PageHeader
        title="Customers"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Customers' }]}
      />

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create')
          if (id === 'create') {
            setForm(emptyForm)
            setMachine(emptyMachine)
            setCreateStep('customer')
            setErrors({})
          }
        }}
        tabs={[
          { id: 'list', label: 'All customers', count: items.length },
          { id: 'create', label: 'Add customer' },
        ]}
      />

      {tab === 'list' ? (
        <>
          <Card className="mb-5">
            <form onSubmit={handlePhoneLookup}>
              <label htmlFor="phone-lookup" className="mb-2 block text-sm font-semibold text-text-primary">
                Find customer by phone or Customer ID
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                    size={18}
                  />
                  <Input
                    id="phone-lookup"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value)
                      setPhoneResult(null)
                    }}
                    placeholder="+91 98xxx xxxxx or CUS-00042"
                    className="pl-10"
                  />
                </div>
                <Button type="submit">Lookup</Button>
              </div>
              {phoneResult && <p className="mt-2 text-sm text-text-secondary">{phoneResult}</p>}
            </form>
          </Card>

          <Card padding={false}>
            <div className="flex flex-wrap gap-3 border-b border-border p-4">
              <div className="relative min-w-[200px] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                  size={16}
                />
                <Input
                  placeholder="Search Customer ID, name, email, phone..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
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
              <Select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="w-40"
                options={[
                  { value: '', label: 'All owners' },
                  ...users.map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
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
              {(accountFilter || ownerFilter || linkFilter || cityFilter || search) && (
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
              )}
            </div>
            {loading ? (
              <p className="p-6 text-sm text-text-secondary">Loading contacts from database…</p>
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
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="bg-muted text-xs text-text-secondary">
                      <tr>
                        <th className="w-10 px-4 py-3">
                          <SelectCheckbox
                            checked={selection.allSelected}
                            indeterminate={selection.someSelected && !selection.allSelected}
                            onChange={selection.toggleAll}
                            aria-label="Select all"
                          />
                        </th>
                        {['Customer ID', 'Name', 'Phone', 'Area / Location', 'City', 'Added', 'Actions'].map(
                          (h) => (
                            <th key={h} className="px-4 py-3 font-medium">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((c) => (
                        <tr
                          key={c.id}
                          className="cursor-pointer border-t border-border hover:bg-surface"
                          onClick={() => navigate(`/contacts/${c.id}`)}
                        >
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <SelectCheckbox
                              checked={selection.isSelected(c.id)}
                              onChange={() => selection.toggle(c.id)}
                              aria-label={`Select ${c.name}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-accent-blue">
                            {c.customerCode ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/contacts/${c.id}`}
                              className="flex items-center gap-2 font-medium text-accent-blue hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Avatar name={c.name} size="sm" />
                              {c.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{formatPhone(c.phone || c.mobile || '') || '—'}</td>
                          <td className="px-4 py-3 text-text-secondary">
                            {[c.area, c.location].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td className="px-4 py-3">
                            {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-3 text-text-secondary">
                            {c.createdAt ? formatDate(String(c.createdAt)) : '—'}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-0.5">
                              <ViewIconButton onClick={() => navigate(`/contacts/${c.id}`)} />
                              <DeleteIconButton
                                disabled={busyDelete}
                                onClick={() => setConfirm({ ids: [c.id] })}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
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
                <Button type="button" onClick={() => goNextToProduct()}>
                  Next — add product
                </Button>
              ) : (
                <Button type="submit" form="create-contact" disabled={saving}>
                  {saving ? 'Saving…' : machine.skip ? 'Save customer only' : 'Save customer + product'}
                </Button>
              )}
            </>
          }
        >
          <form id="create-contact" onSubmit={(e) => void handleCreate(e)} className="space-y-6">
            {createStep === 'customer' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Input label="Company / shop name *" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HMS ENTERPRISES" />
                <Input label="Phone *" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98xxx xxxxx" />
                <Input label="Mobile / WhatsApp" value={form.mobile} error={errors.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
                <Input label="Street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
                <Input label="Door number" value={form.doorNo} onChange={(e) => setForm({ ...form, doorNo: e.target.value })} />
                <Input label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
                <Input label="Pin code" value={form.pincode} error={errors.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
                <Input label="Location / landmark" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="lg:col-span-2" />
                <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                <Input label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                <Input label="Email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <Select
                  label="Account / company (optional)"
                  value={form.accountId}
                  onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                  options={[{ value: '', label: 'No linked account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
                />
                <Select
                  label="Owner"
                  value={form.ownerUserId}
                  onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
                  options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
                />
                <label className="block text-sm sm:col-span-2 lg:col-span-3">
                  <span className="mb-1 block font-medium text-text-secondary">Notes</span>
                  <textarea
                    className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </label>
              </div>
            ) : (
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
                        onChange={(e) => setMachine({ ...machine, origin: e.target.value })}
                        options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        {ASSET_ORIGIN_OPTIONS.find((o) => o.value === machine.origin)?.hint}
                      </p>
                    </div>
                    <Select
                      label="Type"
                      value={machine.machineType}
                      onChange={(e) => setMachine({ ...machine, machineType: e.target.value })}
                      options={MACHINE_TYPES}
                    />
                    <Input
                      label="Product / machine name *"
                      className="lg:col-span-2"
                      value={machine.name}
                      onChange={(e) => setMachine({ ...machine, name: e.target.value })}
                      placeholder="WEIGHING SCALE 20KG"
                    />
                    <Input label="Capacity" value={machine.capacity} onChange={(e) => setMachine({ ...machine, capacity: e.target.value })} />
                    <Input label="Model" value={machine.model} onChange={(e) => setMachine({ ...machine, model: e.target.value })} />
                    <Input label="Serial number" value={machine.serialNo} onChange={(e) => setMachine({ ...machine, serialNo: e.target.value })} />
                    <Select
                      label="Service plan"
                      value={machine.servicePlan}
                      onChange={(e) => setMachine({ ...machine, servicePlan: e.target.value })}
                      options={[
                        { value: 'NON_AMC', label: 'Non-AMC' },
                        { value: 'AMC', label: 'AMC' },
                      ]}
                    />
                    {machine.origin === 'THIRD_PARTY' ? (
                      <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
                        Repair-only / outside products can also take AMC — choose AMC and set dates.
                      </p>
                    ) : null}
                    {machine.servicePlan === 'AMC' ? (
                      <>
                        <Input
                          label="AMC start"
                          type="date"
                          value={machine.amcStartDate}
                          onChange={(e) => setMachine({ ...machine, amcStartDate: e.target.value })}
                        />
                        <Input
                          label="AMC end"
                          type="date"
                          value={machine.amcEndDate}
                          onChange={(e) => setMachine({ ...machine, amcEndDate: e.target.value })}
                        />
                      </>
                    ) : null}
                    <Input
                      label="Next due"
                      type="date"
                      value={machine.nextDueDate}
                      onChange={(e) => setMachine({ ...machine, nextDueDate: e.target.value })}
                    />
                    <Input
                      label="Stamping date"
                      type="date"
                      value={machine.stampingDate}
                      onChange={(e) => setMachine({ ...machine, stampingDate: e.target.value })}
                    />
                  </>
                ) : null}
              </div>
            )}
          </form>
        </FormPanel>
      )}

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
