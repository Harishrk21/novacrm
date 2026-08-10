import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, UserPlus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { api, ApiClientError } from '@/lib/api'
import { firstError, validateContactForm, type FieldErrors } from '@/lib/formValidation'
import { formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type ContactRow = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  mobile?: string | null
  title?: string | null
  department?: string | null
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
  city: '',
  state: '',
  pincode: '',
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
  const tip = DEFAULT_TIPS['crm.contacts'] ?? {
    title: 'Contacts',
    body: 'Store every buyer / decision-maker here. Click a row to open the full 360° profile.',
    tipType: 'TIP' as const,
  }

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
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

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

  const accountName = useMemo(() => {
    const map = Object.fromEntries(accounts.map((a) => [a.id, a.name]))
    return (id?: string | null) => (id ? map[id] ?? '—' : '—')
  }, [accounts])

  async function handlePhoneLookup(event: FormEvent) {
    event.preventDefault()
    if (!phone.trim()) {
      setPhoneResult('Enter a phone number to search.')
      return
    }
    try {
      const hits = (await api.contactsLookup(phone.trim())) as ContactRow[]
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
        address_line: form.addressLine.trim() || null,
        pincode: form.pincode.trim() || null,
        linkedin: form.linkedin.trim() || null,
      }
      const created = await api.createContact({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        mobile: form.mobile.trim() || null,
        title: form.title.trim() || null,
        department: form.department.trim() || null,
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
      setOpen(false)
      setForm(emptyForm)
      setErrors({})
      addToast({ type: 'success', message: 'Contact saved' })
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

  return (
    <div>
      <PageHeader
        title="Contacts"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Contacts' }]}
        actions={
          <Button onClick={() => setOpen(true)}>
            <UserPlus size={16} />
            Add contact
          </Button>
        }
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <Card className="mb-5 border-accent-blue/30 bg-blue-50/50">
        <form onSubmit={handlePhoneLookup}>
          <label htmlFor="phone-lookup" className="mb-2 block text-sm font-semibold text-text-primary">
            Find a customer by phone
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
              <Input
                id="phone-lookup"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setPhoneResult(null)
                }}
                placeholder="+91 98xxx xxxxx"
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
              placeholder="Search name, email, phone..."
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
            onAction={() => setOpen(true)}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['Name', 'Title', 'Account', 'Phone', 'Email', 'City', 'Added'].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-t border-border hover:bg-surface"
                    onClick={() => navigate(`/contacts/${c.id}`)}
                  >
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
                    <td className="px-4 py-3 text-text-secondary">{c.title || '—'}</td>
                    <td className="px-4 py-3">{accountName(c.accountId)}</td>
                    <td className="px-4 py-3">{formatPhone(c.phone || c.mobile || '') || '—'}</td>
                    <td className="px-4 py-3">{c.email || '—'}</td>
                    <td className="px-4 py-3">
                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {c.createdAt ? formatDate(String(c.createdAt)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add contact"
        subtitle="Customer / buyer profile with phone, company link and notes. Click a row later for the full 360° view."
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-contact" disabled={saving}>
              {saving ? 'Saving…' : 'Save contact'}
            </Button>
          </>
        }
      >
        <form id="create-contact" onSubmit={handleCreate} className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <Input label="Full name *" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Job title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          <Select
            label="Account / company"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'No account yet' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <Input label="Email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Alternate email" type="email" value={form.alternateEmail} error={errors.alternateEmail} onChange={(e) => setForm({ ...form, alternateEmail: e.target.value })} />
          <Input label="Phone" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Mobile" value={form.mobile} error={errors.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Input label="WhatsApp" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="Same as mobile if blank" />
          <Input label="LinkedIn URL" value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} />
          <Select
            label="Owner"
            value={form.ownerUserId}
            onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
            options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Input label="Address line" value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="Pincode" value={form.pincode} error={errors.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
          <Input label="Country code *" value={form.country} error={errors.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })} />
          <Input
            label="Tags (comma separated)"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="VIP, decision-maker"
          />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Preferences, buying role, follow-up notes…"
            />
          </label>
        </form>
      </Modal>
    </div>
  )
}