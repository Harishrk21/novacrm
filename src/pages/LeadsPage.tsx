import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { firstError, validateLeadForm, type FieldErrors } from '@/lib/formValidation'
import { formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST', 'CONVERTED'] as const

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  company: '',
  website: '',
  city: '',
  state: '',
  country: 'IN',
  sourceId: '',
  status: 'NEW',
  score: '40',
  assignedToId: '',
  description: '',
  productInterest: '',
  budget: '',
  timeline: '',
  tags: '',
}

export function LeadsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isAgent = authUser?.role === 'AGENT'
  const tip = DEFAULT_TIPS['crm.leads'] ?? {
    title: 'Leads',
    body: 'Capture every enquiry with full detail, then convert when ready.',
    tipType: 'TIP' as const,
  }

  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [search, setSearch] = useState('')
  const initialStatus = searchParams.get('status') ?? ''
  const [status, setStatus] = useState(
    STATUSES.includes(initialStatus as (typeof STATUSES)[number]) ? initialStatus : '',
  )
  const [ownerFilter, setOwnerFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertStageId, setConvertStageId] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [leads, lookups] = await Promise.all([
        api.leads({
          limit: 100,
          search: search || undefined,
          status: status || undefined,
          ...(isAgent && authUser?.id
            ? { assignedToId: authUser.id }
            : ownerFilter && ownerFilter !== 'unassigned'
              ? { assignedToId: ownerFilter }
              : {}),
        }),
        api.lookups(),
      ])
      let rows = leads.items ?? []
      if (!isAgent && ownerFilter === 'unassigned') {
        rows = rows.filter((l) => !l.assignedToId)
      }
      setItems(rows)
      setSources(lookups.sources)
      setUsers(lookups.users)
      setStages(lookups.stages)
      if (!convertStageId && lookups.stages[0]) setConvertStageId(lookups.stages[0].id)
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to load leads'
      setLoadError(message)
      addToast({ type: 'error', message })
    } finally {
      setLoading(false)
    }
  }, [addToast, authUser?.id, convertStageId, isAgent, ownerFilter, search, status])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const next = searchParams.get('status') ?? ''
    if (next === '' || STATUSES.includes(next as (typeof STATUSES)[number])) {
      setStatus(next)
    }
  }, [searchParams])

  const sourceName = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.name])),
    [sources],
  )
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users])

  async function createLead(e: FormEvent) {
    e.preventDefault()
    const nextErrors = validateLeadForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      return
    }
    setSaving(true)
    try {
      const customFields: Record<string, unknown> = {}
      if (form.productInterest) customFields.product_interest = form.productInterest
      if (form.budget) customFields.budget = Number(form.budget)
      if (form.timeline) customFields.timeline = form.timeline

      let website = form.website.trim()
      if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`

      await api.createLead({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        website: website || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country || 'IN',
        sourceId: form.sourceId || null,
        status: form.status,
        score: Number(form.score) || 0,
        assignedToId: form.assignedToId || null,
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
      addToast({ type: 'success', message: 'Lead saved — follow-up task assigned to owner' })
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    } finally {
      setSaving(false)
    }
  }

  async function convert() {
    if (!selected) return
    try {
      const result = await api.convertLead(String(selected.id), {
        stageId: convertStageId,
        dealName: `${selected.company || selected.name} — Deal`,
        amount: num((selected.customFields as Record<string, unknown>)?.budget),
        createAccount: true,
      })
      const dealId = String((result as { deal?: { id?: string } }).deal?.id ?? '')
      setConvertOpen(false)
      setSelected(null)
      addToast({
        type: 'success',
        message: 'Lead converted — opening deal',
      })
      if (dealId) {
        navigate(`/deals/${dealId}`)
      } else {
        await load()
        navigate('/deals')
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Convert failed' })
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

  async function updateLeadStatus(nextStatus: string) {
    if (!selected) return
    try {
      const updated = await api.updateLead(String(selected.id), { status: nextStatus })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      addToast({ type: 'success', message: `Status → ${nextStatus}` })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update status',
      })
    }
  }

  return (
    <div>
      <PageHeader
        title="Leads"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Leads' }]}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Add lead
          </Button>
        }
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <Card className="mb-4 flex flex-wrap gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={16} />
          <Input className="pl-9" placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
          className="w-44"
        />
        {!isAgent && (
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="w-44"
            options={[
              { value: '', label: 'All owners' },
              { value: 'unassigned', label: 'Unassigned' },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        )}
      </Card>

      <Card padding={false}>
        {loading ? (
          <p className="p-6 text-sm text-text-secondary">Loading leads from database…</p>
        ) : loadError && items.length === 0 ? (
          <EmptyState
            title="Could not load leads"
            subtitle={loadError}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : items.length === 0 ? (
          <EmptyState title="No leads" subtitle="Add your first enquiry with full buyer details." actionLabel="Add lead" onAction={() => setOpen(true)} />
        ) : (
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-muted text-xs text-text-secondary">
              <tr>
                {['Name', 'Company', 'Phone', 'Source', 'Status', 'Score', 'Owner', 'City'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <tr
                  key={String(lead.id)}
                  className="cursor-pointer border-t border-border hover:bg-surface"
                  onClick={() => setSelected(lead)}
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-medium">
                      <Avatar name={String(lead.name)} size="sm" />
                      {String(lead.name)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{String(lead.company || '—')}</td>
                  <td className="px-4 py-3">{formatPhone(String(lead.phone || '')) || '—'}</td>
                  <td className="px-4 py-3">{sourceName[String(lead.sourceId)] ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge color="blue">{String(lead.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">{num(lead.score)}</td>
                  <td className="px-4 py-3">
                    {lead.assignedToId ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={userName[String(lead.assignedToId)] ?? '?'} size="sm" />
                        <span>{userName[String(lead.assignedToId)] ?? '—'}</span>
                      </span>
                    ) : (
                      <span className="text-text-secondary">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {[lead.city, lead.state].filter(Boolean).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? String(selected.name) : 'Lead'}
      >
        {selected && (
          <div className="space-y-4 p-1">
            <div className="rounded-[8px] border border-accent-blue/30 bg-blue-50/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Assigned owner
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Avatar
                  name={userName[String(selected.assignedToId)] ?? 'Unassigned'}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-text-primary">
                    {userName[String(selected.assignedToId)] ?? 'Unassigned'}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {selected.assignedToId
                      ? 'This employee sees the lead on My Work / Leads'
                      : 'No owner yet — assign someone below'}
                  </div>
                </div>
              </div>
              {!isAgent && (
                <div className="mt-3">
                  <Select
                    label="Reassign to"
                    value={String(selected.assignedToId ?? '')}
                    onChange={(e) => void reassignLead(e.target.value)}
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...users.map((u) => ({ value: u.id, label: u.name })),
                    ]}
                  />
                </div>
              )}
            </div>

            <div>
              <Select
                label="Status"
                value={String(selected.status ?? 'NEW')}
                onChange={(e) => void updateLeadStatus(e.target.value)}
                options={STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </div>

            <dl className="grid gap-2 text-sm">
              {[
                ['Company', selected.company],
                ['Email', selected.email],
                ['Phone', selected.phone],
                ['Website', selected.website],
                ['Source', sourceName[String(selected.sourceId)] ?? selected.sourceId],
                ['Location', [selected.city, selected.state, selected.country].filter(Boolean).join(', ')],
                ['Score', selected.score],
                ['Created', selected.createdAt ? formatDate(String(selected.createdAt)) : '—'],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-4 border-b border-border py-2">
                  <dt className="text-text-secondary">{String(k)}</dt>
                  <dd className="text-right font-medium">{String(v ?? '—')}</dd>
                </div>
              ))}
            </dl>

            {selected.description ? (
              <p className="rounded-lg bg-muted p-3 text-sm">{String(selected.description)}</p>
            ) : null}

            {selected.customFields && typeof selected.customFields === 'object' ? (
              <div className="rounded-lg border border-border p-3 text-sm">
                <div className="mb-2 text-xs font-semibold uppercase text-text-secondary">Interest</div>
                <dl className="space-y-1">
                  {Object.entries(selected.customFields as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-text-secondary">{k.replaceAll('_', ' ')}</dt>
                      <dd className="font-medium">{String(v ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() =>
                  navigate(`/activities?leadId=${String(selected.id)}&open=1`)
                }
              >
                Log activity
              </Button>
              {selected.phone ? (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate(`/whatsapp`)}
                >
                  WhatsApp
                </Button>
              ) : null}
            </div>

            {selected.convertedContactId ||
            selected.convertedAccountId ||
            selected.convertedDealId ? (
              <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-accent-green">
                  Converted records
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  {selected.convertedContactId ? (
                    <button
                      type="button"
                      className="text-left font-medium text-accent-blue hover:underline"
                      onClick={() => navigate(`/contacts/${String(selected.convertedContactId)}`)}
                    >
                      Open contact →
                    </button>
                  ) : null}
                  {selected.convertedAccountId ? (
                    <button
                      type="button"
                      className="text-left font-medium text-accent-blue hover:underline"
                      onClick={() => navigate(`/accounts/${String(selected.convertedAccountId)}`)}
                    >
                      Open account →
                    </button>
                  ) : null}
                  {selected.convertedDealId ? (
                    <button
                      type="button"
                      className="text-left font-medium text-accent-blue hover:underline"
                      onClick={() => navigate(`/deals/${String(selected.convertedDealId)}`)}
                    >
                      Open deal →
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {selected.status !== 'CONVERTED' && (
              <Button className="w-full" onClick={() => setConvertOpen(true)}>
                Convert lead → Contact + Account + Deal
              </Button>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add lead"
        subtitle="Capture the full enquiry — company, budget, interest and owner."
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-lead" disabled={saving}>
              {saving ? 'Saving…' : 'Save lead'}
            </Button>
          </>
        }
      >
        <form id="add-lead" onSubmit={createLead} className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <Input label="Full name *" placeholder="e.g. Meena Krishnan" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Company" placeholder="e.g. Harbour Traders" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <Input label="Email" type="email" placeholder="name@company.in" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" placeholder="+91 98400 10001" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Website" value={form.website} error={errors.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://company.in" />
          <Select
            label="Source"
            value={form.sourceId}
            onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
            options={[{ value: '', label: 'Select source' }, ...sources.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={STATUSES.filter((s) => s !== 'CONVERTED').map((s) => ({ value: s, label: s }))}
          />
          <Select
            label="Assigned to"
            value={form.assignedToId}
            onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
            options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Input label="City" placeholder="Chennai" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" placeholder="Tamil Nadu" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="Score (0–100) *" type="number" placeholder="55" value={form.score} error={errors.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
          <Input label="Product interest" placeholder="Truck scale / Platform 1T" value={form.productInterest} onChange={(e) => setForm({ ...form, productInterest: e.target.value })} />
          <Input label="Budget ₹" type="number" placeholder="185000" value={form.budget} error={errors.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
          <Input label="Buy timeline" value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="This month / Q2" />
          <Input label="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="hot, exhibition" />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder="Enquiry notes, how they found you…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="Convert lead"
        subtitle="Creates a contact, account and deal — you’ll land on the new deal page."
        footer={
          <>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void convert()}>Convert</Button>
          </>
        }
      >
        <Select
          label="Deal stage"
          value={convertStageId}
          onChange={(e) => setConvertStageId(e.target.value)}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
        />
        <p className="mt-3 text-sm text-text-secondary">
          Creates Contact + Account + Deal and marks the lead CONVERTED.
        </p>
      </Modal>
    </div>
  )
}
