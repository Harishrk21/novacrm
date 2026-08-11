import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

export function ContactsPage() {
  const navigate = useNavigate()
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
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const ids = useMemo(() => items.map((i) => String(i.id)), [items])
  const selection = useRowSelection(ids)

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

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    const nextErrors = validateContactForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
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
      setTab('list')
      setForm(emptyForm)
      setErrors({})
      addToast({
        type: 'success',
        message: created.customerCode
          ? `Customer saved — ID ${String(created.customerCode)}`
          : 'Contact saved',
      })
      navigate(`/contacts/${created.id as string}`)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create contact',
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
            setErrors({})
          }
        }}
        tabs={[
          { id: 'list', label: 'All contacts', count: items.length },
          { id: 'create', label: 'Add contact' },
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
                title="Could not load contacts"
                subtitle={loadError}
                actionLabel="Retry"
                onAction={() => void load()}
              />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<UserPlus size={26} />}
                title="No contacts yet"
                subtitle="Add your first customer or convert a qualified lead."
                actionLabel="Add contact"
                onAction={() => setTab('create')}
              />
            ) : (
              <div className="p-4 pt-3">
                {selection.someSelected ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="contact"
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
          title="Add customer"
          subtitle="Shop / company details as in your SERVICE register — address, phone, location."
          onClose={() => {
            setTab('list')
            setForm(emptyForm)
            setErrors({})
          }}
          footer={
            <>
              <FormPanelCancel
                onClick={() => {
                  setTab('list')
                  setForm(emptyForm)
                  setErrors({})
                }}
              />
              <Button type="submit" form="create-contact" disabled={saving}>
                {saving ? 'Saving…' : 'Save customer'}
              </Button>
            </>
          }
        >
          <form id="create-contact" onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </form>
        </FormPanel>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete contact?' : `Delete ${confirm?.ids.length ?? 0} contacts?`}
        body={
          confirm?.ids.length === 1
            ? 'This contact will be permanently removed.'
            : 'Selected contacts will be permanently removed.'
        }
      />
    </div>
  )
}
