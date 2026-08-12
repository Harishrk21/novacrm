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
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS, assetOriginShort } from '@/lib/assetOrigin'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

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

const emptyJob = {
  contactId: '',
  assetId: '',
  newMachine: false,
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
  remindersEnabled: true,
  stampingDate: '',
  nextDueDate: '',
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

  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [assets, setAssets] = useState<Record<string, unknown>[]>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [form, setForm] = useState(emptyJob)
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const ticketIds = useMemo(() => tickets.map((t) => String(t.id)), [tickets])
  const selection = useRowSelection(ticketIds)

  const load = useCallback(async () => {
    try {
      const [res, lookups] = await Promise.all([
        api.tickets({
          limit: 100,
          sort: 'sla',
          status: status || undefined,
          contactId: searchParams.get('contactId') || undefined,
          slaBreached: searchParams.get('slaBreached') || undefined,
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
  }, [addToast, authUser?.id, searchParams, status])

  const loadAssets = useCallback(
    async (contactId: string) => {
      if (!contactId) {
        setAssets([])
        return
      }
      try {
        const res = await api.assets({ contactId, limit: 100 })
        setAssets(res.items ?? [])
      } catch {
        setAssets([])
      }
    },
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const contactId = searchParams.get('contactId')
    const assetId = searchParams.get('assetId')
    const shouldOpen = searchParams.get('open') === '1'
    if (contactId) {
      setForm((f) => ({
        ...f,
        contactId,
        assetId: assetId || f.assetId,
      }))
      void loadAssets(contactId)
    }
    if (shouldOpen) setTab('create')
  }, [loadAssets, searchParams])

  const onPickContact = useCallback(
    (c: ContactPick | null) => {
      setPickedContact(c)
      setForm((f) => ({
        ...f,
        contactId: c?.id ?? '',
        assetId: '',
        newMachine: false,
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

  function resetCreate() {
    setForm({ ...emptyJob, receivedByUserId: authUser?.id || '' })
    setPickedContact(null)
    setAssets([])
  }

  async function createJob(e: FormEvent) {
    e.preventDefault()
    if (!form.contactId) {
      addToast({ type: 'error', message: 'Select a customer' })
      return
    }
    setSaving(true)
    try {
      let assetId = form.assetId || null
      if (form.newMachine || !assetId) {
        if (!form.machineName.trim() && !assetId) {
          addToast({ type: 'error', message: 'Enter machine details or pick an existing machine' })
          setSaving(false)
          return
        }
        if (form.machineName.trim()) {
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
            stampingDate: form.stampingDate || null,
            nextDueDate: form.nextDueDate || null,
          })
          assetId = String(machine.id)
        }
      } else if (
        assetId &&
        (form.stampingDate ||
          form.nextDueDate ||
          form.servicePlan ||
          form.amcEndDate ||
          form.amcStartDate ||
          form.origin)
      ) {
        await api.updateAsset(assetId, {
          ...(form.stampingDate ? { stampingDate: form.stampingDate } : {}),
          ...(form.nextDueDate ? { nextDueDate: form.nextDueDate } : {}),
          ...(form.origin ? { origin: form.origin } : {}),
          ...(form.servicePlan ? { servicePlan: form.servicePlan } : {}),
          ...(form.servicePlan === 'AMC'
            ? {
                amcStartDate: form.amcStartDate || null,
                amcEndDate: form.amcEndDate || null,
              }
            : { amcStartDate: null, amcEndDate: null }),
          remindersEnabled: form.remindersEnabled,
        })
      }

      const machineLabel =
        form.machineName.trim() ||
        String(assets.find((a) => String(a.id) === form.assetId)?.name ?? 'Service')

      const created = await api.createTicket({
        subject: `Service — ${machineLabel}`,
        description: form.description.trim() || `Service job for ${machineLabel}`,
        priority: form.priority,
        contactId: form.contactId,
        assetId,
        stampingDate: form.stampingDate || null,
        nextDueDate: form.nextDueDate || null,
        odAmount: Number(form.odAmount) || 0,
        paymentTotal: Number(form.paymentTotal) || 0,
        advanceAmount: Number(form.advanceAmount) || 0,
        receivedByUserId: form.receivedByUserId || null,
        deliveredByUserId: form.deliveredByUserId || null,
        assignedToId: form.receivedByUserId || authUser?.id || null,
        category: form.category,
        channel: form.channel,
        slaHours: Number(form.slaHours) || 24,
      })

      setTab('list')
      resetCreate()
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev)
        n.delete('open')
        n.delete('assetId')
        return n
      })
      addToast({ type: 'success', message: 'Service job saved' })
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
        title="Service jobs"
        count={tickets.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Service tickets' }]}
      />
      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create')
          if (id === 'create') resetCreate()
        }}
        tabs={[
          { id: 'list', label: 'All jobs', count: tickets.length },
          { id: 'create', label: 'New service job' },
        ]}
      />

      {tab === 'list' ? (
        <>
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
            {tickets.length === 0 ? (
              <EmptyState
                title="No service jobs yet"
                subtitle="Create a service job — customer, machine, payment, executives, next due."
                actionLabel="New service job"
                onAction={() => setTab('create')}
              />
            ) : (
              <div className="p-4 pt-3">
                {selection.someSelected ? (
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
                          'Job',
                          'Customer',
                          'Machine',
                          'Stamping',
                          'OD',
                          'Payment',
                          'Advance',
                          'Balance',
                          'Received',
                          'Delivered',
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
                      {tickets.map((ticket) => {
                        const id = String(ticket.id)
                        const contact = ticket.contact as { name?: string; customerCode?: string } | null
                        const asset = ticket.asset as { name?: string } | null
                        const st = String(ticket.status)
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
                                aria-label={`Select job ${String(ticket.ticketNo)}`}
                              />
                            </td>
                            <td className="px-3 py-3 font-semibold">
                              <Link
                                className="text-accent-blue hover:underline"
                                to={`/tickets/${id}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                #{String(ticket.ticketNo)}
                              </Link>
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-medium">{contact?.name ?? '—'}</div>
                              <div className="font-mono text-[11px] text-text-secondary">
                                {contact?.customerCode ?? ''}
                              </div>
                            </td>
                            <td className="max-w-[160px] px-3 py-3">{asset?.name ?? String(ticket.subject)}</td>
                            <td className="px-3 py-3">
                              {ticket.stampingDate ? formatDate(String(ticket.stampingDate)) : '—'}
                            </td>
                            <td className="px-3 py-3">{formatCurrency(num(ticket.odAmount))}</td>
                            <td className="px-3 py-3 font-medium">{formatCurrency(num(ticket.paymentTotal))}</td>
                            <td className="px-3 py-3">{formatCurrency(num(ticket.advanceAmount))}</td>
                            <td className="px-3 py-3 font-semibold text-accent-amber">
                              {formatCurrency(num(ticket.balanceDue))}
                            </td>
                            <td className="px-3 py-3">{String(ticket.receivedByName ?? '—')}</td>
                            <td className="px-3 py-3">{String(ticket.deliveredByName ?? '—')}</td>
                            <td className="px-3 py-3">
                              {ticket.nextDueDate ? formatDate(String(ticket.nextDueDate)) : '—'}
                            </td>
                            <td className="px-3 py-3">
                              <Badge color={ticketStatusColor[st] ?? 'gray'}>{labelize(st)}</Badge>
                            </td>
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                <ViewIconButton onClick={() => navigate(`/tickets/${id}`)} />
                                <DeleteIconButton
                                  disabled={busyDelete}
                                  onClick={() => setConfirm({ ids: [id] })}
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
            )}
          </Card>
        </>
      ) : (
        <FormPanel
          open
          accent="theme"
          eyebrow="SERVICE register"
          title="New service job"
          subtitle="Customer, machine, payment, and executives for this service job."
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
                {saving ? 'Saving…' : 'Save service job'}
              </Button>
            </>
          }
        >
          <form id="service-job-form" onSubmit={(e) => void createJob(e)} className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">1. Customer</h3>
              <ContactPicker
                className="sm:col-span-2 lg:col-span-3"
                label="Customer / shop *"
                valueId={form.contactId}
                selected={pickedContact}
                onSelect={onPickContact}
              />
            </section>

            <section className="grid gap-4 rounded-[12px] border border-border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">2. Machine details</h3>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.newMachine || assets.length === 0}
                    onChange={(e) => setForm({ ...form, newMachine: e.target.checked, assetId: e.target.checked ? '' : form.assetId })}
                  />
                  New machine
                </label>
              </div>
              {!form.newMachine && assets.length > 0 ? (
                <Select
                  className="sm:col-span-2 lg:col-span-3"
                  label="Existing machine"
                  value={form.assetId}
                  onChange={(e) => {
                    const a = assets.find((x) => String(x.id) === e.target.value)
                    setForm({
                      ...form,
                      assetId: e.target.value,
                      stampingDate: a?.stampingDate ? String(a.stampingDate).slice(0, 10) : form.stampingDate,
                      nextDueDate: a?.nextDueDate ? String(a.nextDueDate).slice(0, 10) : form.nextDueDate,
                      servicePlan: a?.servicePlan ? String(a.servicePlan) : form.servicePlan,
                      amcStartDate: a?.amcStartDate ? String(a.amcStartDate).slice(0, 10) : form.amcStartDate,
                      amcEndDate: a?.amcEndDate ? String(a.amcEndDate).slice(0, 10) : form.amcEndDate,
                      origin: a?.origin ? String(a.origin) : form.origin,
                      remindersEnabled: a?.remindersEnabled !== false,
                    })
                  }}
                  options={[
                    { value: '', label: 'Select machine' },
                    ...assets.map((a) => ({
                      value: String(a.id),
                      label: `${String(a.name)}${a.serialNo ? ` · ${String(a.serialNo)}` : ''} · ${assetOriginShort(a.origin ? String(a.origin) : null)}${a.servicePlan === 'AMC' ? ' · AMC' : ''}`,
                    })),
                  ]}
                />
              ) : (
                <>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Select
                      label="Machine origin *"
                      value={form.origin}
                      onChange={(e) => setForm({ ...form, origin: e.target.value })}
                      options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                    <p className="mt-1 text-xs text-text-secondary">
                      {ASSET_ORIGIN_OPTIONS.find((o) => o.value === form.origin)?.hint}
                    </p>
                  </div>
                  <Select
                    label="Type"
                    value={form.machineType}
                    onChange={(e) => setForm({ ...form, machineType: e.target.value })}
                    options={MACHINE_TYPES}
                  />
                  <Input
                    label="Machine name *"
                    placeholder="WEIGHING SCALE 20KG"
                    value={form.machineName}
                    onChange={(e) => setForm({ ...form, machineName: e.target.value })}
                    className="lg:col-span-2"
                  />
                  <Input label="Capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                  <Input label="Accuracy" value={form.accuracy} onChange={(e) => setForm({ ...form, accuracy: e.target.value })} />
                  <Input label="Platform size" value={form.platformSize} onChange={(e) => setForm({ ...form, platformSize: e.target.value })} />
                  <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                  <Input label="Serial number" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} />
                </>
              )}
              {!form.newMachine && assets.length > 0 ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <Select
                    label="Machine origin"
                    value={form.origin}
                    onChange={(e) => setForm({ ...form, origin: e.target.value })}
                    options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                  <p className="mt-1 text-xs text-text-secondary">
                    Change if this unit was sold by us vs brought only for repair.
                  </p>
                </div>
              ) : null}
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
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.remindersEnabled}
                  onChange={(e) => setForm({ ...form, remindersEnabled: e.target.checked })}
                />
                WhatsApp reminders (1 week before due / AMC)
              </label>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <h3 className="sm:col-span-2 lg:col-span-4 text-sm font-semibold text-text-primary">3. Dates & money</h3>
              <Input
                label="Stamping date"
                type="date"
                value={form.stampingDate}
                onChange={(e) => setForm({ ...form, stampingDate: e.target.value })}
              />
              <Input
                label="Next due date"
                type="date"
                value={form.nextDueDate}
                onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
              />
              <Input
                label="OD details ₹"
                type="number"
                value={form.odAmount}
                onChange={(e) => setForm({ ...form, odAmount: e.target.value })}
              />
              <div className="rounded-[8px] border border-border bg-card px-3 py-2">
                <div className="text-xs text-text-secondary">Balance (auto)</div>
                <div className="text-lg font-bold text-accent-amber">{formatCurrency(balancePreview)}</div>
              </div>
              <Input
                label="Payment ₹"
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
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">4. Executives</h3>
              <Select
                label="Executive — received"
                value={form.receivedByUserId}
                onChange={(e) => setForm({ ...form, receivedByUserId: e.target.value })}
                options={[{ value: '', label: 'Select' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
              />
              <div>
                <Select
                  label="Executive — delivered"
                  value={form.deliveredByUserId}
                  onChange={(e) => setForm({ ...form, deliveredByUserId: e.target.value })}
                  options={[
                    { value: '', label: 'Fill after delivery' },
                    ...users.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                />
                <p className="mt-1 text-xs text-text-secondary">Optional now — set on the job after delivery.</p>
              </div>
              <Select
                label="Priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) }))}
              />
              <label className="block text-sm sm:col-span-2 lg:col-span-3">
                <span className="mb-1 block font-medium text-text-secondary">Work notes</span>
                <textarea
                  className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What was done / parts / site notes…"
                />
              </label>
            </section>
          </form>
        </FormPanel>
      )}

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
