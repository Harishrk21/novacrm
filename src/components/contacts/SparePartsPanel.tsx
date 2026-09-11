import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Plus, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { DeleteIconButton, EditIconButton } from '@/components/ui/BulkSelect'
import { ConfirmModal } from '@/components/ui/Modal'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const CHANGE_TYPES = [
  { value: 'REPLACED', label: 'Replaced' },
  { value: 'INSTALLED', label: 'Installed' },
  { value: 'REMOVED', label: 'Removed' },
  { value: 'REPAIRED', label: 'Repaired' },
  { value: 'ADJUSTED', label: 'Adjusted' },
] as const

const emptyForm = {
  contactId: '',
  assetId: '',
  ticketId: '',
  partName: '',
  partCode: '',
  changeType: 'REPLACED',
  quantity: '1',
  oldSerialNo: '',
  newSerialNo: '',
  changedAt: new Date().toISOString().slice(0, 10),
  performedByUserId: '',
  chargeAmount: '',
  underWarranty: false,
  notes: '',
}

type Props = {
  /** When set, customer is fixed (customer detail page) */
  contactId?: string
  contactName?: string
  /** When set, spare changes link to this service job */
  ticketId?: string
  /** Pre-select machine on create */
  fixedAssetId?: string
  /** Display label when machine is locked from ticket */
  fixedAssetLabel?: string
  /** Called after spare parts change (e.g. refresh ticket payment total) */
  onTicketUpdated?: () => void
  /** Render as accordion; body starts closed unless defaultOpen */
  collapsible?: boolean
  /** Initial open state when collapsible (default false) */
  defaultOpen?: boolean
  /** Engineer / admin can add & edit; others see history only */
  canEdit?: boolean
  /** Compact read-only list (customer products) */
  readOnly?: boolean
  /** Optional title override */
  title?: string
}

export function SparePartsPanel({
  contactId: fixedContactId,
  contactName,
  ticketId: fixedTicketId,
  fixedAssetId,
  fixedAssetLabel,
  onTicketUpdated,
  collapsible = false,
  defaultOpen = false,
  canEdit = true,
  readOnly = false,
  title,
}: Props) {
  const addToast = useUIStore((s) => s.addToast)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; customerCode?: string }>>([])
  const [assets, setAssets] = useState<Array<{ id: string; name: string; serialNo?: string | null }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...emptyForm, contactId: fixedContactId ?? '' })
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [sectionOpen, setSectionOpen] = useState(!collapsible || defaultOpen)

  const allowMutate = canEdit && !readOnly
  const machineLocked = Boolean(fixedAssetId)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [parts, lookups, assetRes] = await Promise.all([
        api.spareParts({
          limit: 200,
          contactId: fixedContactId,
          ticketId: fixedTicketId,
          assetId: fixedAssetId || undefined,
          search: search || undefined,
        }),
        allowMutate ? api.lookups() : Promise.resolve({ contacts: [], users: [] } as never),
        fixedContactId && allowMutate && !machineLocked
          ? api.assets({ contactId: fixedContactId, limit: 100 })
          : Promise.resolve({ items: [] }),
      ])
      let items = parts.items ?? []
      if (fixedAssetId && !fixedTicketId) {
        items = items.filter((r) => String(r.assetId ?? '') === fixedAssetId)
      }
      setRows(items)
      if (allowMutate) {
        const lu = lookups as {
          contacts: Array<{ id: string; name: string; customerCode?: string }>
          users: Array<{ id: string; name: string }>
        }
        setContacts(
          (lu.contacts ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            customerCode: c.customerCode,
          })),
        )
        setUsers(lu.users ?? [])
        setAssets(
          (assetRes.items ?? []).map((a) => ({
            id: String(a.id),
            name: String(a.name),
            serialNo: a.serialNo as string | null,
          })),
        )
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load spare parts',
      })
    } finally {
      setLoading(false)
    }
  }, [
    addToast,
    allowMutate,
    fixedAssetId,
    fixedContactId,
    fixedTicketId,
    machineLocked,
    search,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!form.contactId || form.contactId === fixedContactId) return
    void api.assets({ contactId: form.contactId, limit: 100 }).then((res) => {
      setAssets(
        (res.items ?? []).map((a) => ({
          id: String(a.id),
          name: String(a.name),
          serialNo: a.serialNo as string | null,
        })),
      )
    })
  }, [form.contactId, fixedContactId])

  const filtered = useMemo(() => rows, [rows])

  function openAdd() {
    setEditId(null)
    setForm({
      ...emptyForm,
      contactId: fixedContactId ?? '',
      ticketId: fixedTicketId ?? '',
      assetId: fixedAssetId ?? '',
    })
    setFormOpen(true)
  }

  function openEdit(row: Record<string, unknown>) {
    setEditId(String(row.id))
    setForm({
      contactId: String(row.contactId),
      assetId: row.assetId ? String(row.assetId) : '',
      ticketId: row.ticketId ? String(row.ticketId) : fixedTicketId ?? '',
      partName: String(row.partName ?? ''),
      partCode: String(row.partCode ?? ''),
      changeType: String(row.changeType ?? 'REPLACED'),
      quantity: String(row.quantity ?? 1),
      oldSerialNo: String(row.oldSerialNo ?? ''),
      newSerialNo: String(row.newSerialNo ?? ''),
      changedAt: row.changedAt ? String(row.changedAt).slice(0, 10) : emptyForm.changedAt,
      performedByUserId: row.performedByUserId ? String(row.performedByUserId) : '',
      chargeAmount: row.chargeAmount != null ? String(num(row.chargeAmount)) : '',
      underWarranty: Boolean(row.underWarranty),
      notes: String(row.notes ?? ''),
    })
    setFormOpen(true)
  }

  async function save() {
    if (!(form.contactId || fixedContactId)) {
      addToast({ type: 'error', message: 'Select a customer' })
      return
    }
    if (!form.partName.trim()) {
      addToast({ type: 'error', message: 'Part name is required' })
      return
    }
    const qty = Number(form.quantity)
    if (!Number.isFinite(qty) || qty < 1) {
      addToast({ type: 'error', message: 'Quantity must be at least 1' })
      return
    }
    if (form.chargeAmount && Number(form.chargeAmount) < 0) {
      addToast({ type: 'error', message: 'Charge cannot be negative' })
      return
    }
    setSaving(true)
    try {
      const body = {
        contactId: form.contactId || fixedContactId,
        assetId: (machineLocked ? fixedAssetId : form.assetId) || null,
        ticketId: form.ticketId || fixedTicketId || null,
        partName: form.partName.trim(),
        partCode: form.partCode.trim() || null,
        changeType: form.changeType,
        quantity: qty,
        oldSerialNo: form.oldSerialNo.trim() || null,
        newSerialNo: form.newSerialNo.trim() || null,
        changedAt: form.changedAt || null,
        performedByUserId: form.performedByUserId || null,
        chargeAmount: form.chargeAmount ? Number(form.chargeAmount) : null,
        underWarranty: form.underWarranty,
        notes: form.notes.trim() || null,
      }
      if (editId) await api.updateSparePart(editId, body)
      else await api.createSparePart(body)
      addToast({ type: 'success', message: editId ? 'Spare part updated' : 'Spare part recorded' })
      setFormOpen(false)
      await load()
      onTicketUpdated?.()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  async function runDelete(id: string) {
    try {
      await api.deleteSparePart(id)
      addToast({ type: 'success', message: 'Deleted' })
      await load()
      onTicketUpdated?.()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Delete failed',
      })
    } finally {
      setConfirmId(null)
    }
  }

  return (
    <>
      <Card padding={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          {collapsible ? (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              onClick={() => setSectionOpen((o) => !o)}
              aria-expanded={sectionOpen}
            >
              <ChevronDown
                size={18}
                className={`mt-0.5 shrink-0 text-text-secondary transition-transform ${
                  sectionOpen ? 'rotate-0' : '-rotate-90'
                }`}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
                  {title ??
                    (fixedTicketId
                      ? 'Spare parts for this job'
                      : fixedContactId
                        ? `Spare parts — ${contactName ?? 'Customer'}`
                        : 'Spare parts log')}
                  {!loading ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                      {filtered.length}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {sectionOpen
                    ? machineLocked
                      ? `Parts changed on ${fixedAssetLabel ?? 'this machine'} — linked to this ticket.`
                      : 'Record load cells, printer heads, batteries, sensors and other part changes per machine.'
                    : 'Closed by default — click to log spare replacements for this machine / job.'}
                </p>
              </div>
            </button>
          ) : (
            <div>
              <div className="text-sm font-semibold">
                {title ??
                  (fixedContactId
                    ? `Spare parts — ${contactName ?? 'Customer'}`
                    : 'Spare parts log')}
              </div>
              <p className="mt-0.5 text-xs text-text-secondary">
                Record load cells, printer heads, batteries, sensors and other part changes per machine.
              </p>
            </div>
          )}
          {allowMutate && (!collapsible || sectionOpen) ? (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                openAdd()
              }}
            >
              <Plus size={14} /> Add spare part
            </Button>
          ) : null}
        </div>

        {(!collapsible || sectionOpen) && (
          <>
            {!fixedContactId && !readOnly ? (
              <div className="border-b border-border px-4 py-3">
                <Input
                  className="max-w-md"
                  placeholder="Search part, serial, customer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            ) : null}

            {loading ? (
              <p className="p-6 text-sm text-text-secondary">Loading spare parts…</p>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Wrench size={22} />}
                title="No spare parts logged yet"
                subtitle={
                  allowMutate
                    ? machineLocked
                      ? 'Add the part name changed on this machine for this service job.'
                      : 'Log each replacement with part name, serial and technician.'
                    : 'Parts changed on service tickets will appear here.'
                }
                actionLabel={allowMutate ? 'Add spare part' : undefined}
                onAction={allowMutate ? openAdd : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-muted text-xs text-text-secondary">
                    <tr>
                      {[
                        ...(fixedContactId || machineLocked ? [] : ['Customer']),
                        'Date',
                        ...(machineLocked ? [] : ['Machine']),
                        'Part',
                        'Change',
                        'Serial (old → new)',
                        'Technician',
                        'Charge',
                        ...(allowMutate ? ['Actions'] : []),
                      ].map((h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const contact = row.contact as {
                        id?: string
                        name?: string
                        customerCode?: string
                      } | null
                      const asset = row.asset as { name?: string; serialNo?: string } | null
                      const performer = row.performer as { name?: string } | null
                      return (
                        <tr key={String(row.id)} className="border-t border-border">
                          {!fixedContactId && !machineLocked ? (
                            <td className="px-4 py-3">
                              {contact?.id ? (
                                <Link
                                  to={`/contacts/${contact.id}`}
                                  className="font-medium text-accent-blue hover:underline"
                                >
                                  {contact.customerCode ? (
                                    <span className="mr-1 font-mono text-xs">{contact.customerCode}</span>
                                  ) : null}
                                  {contact.name}
                                </Link>
                              ) : (
                                '—'
                              )}
                            </td>
                          ) : null}
                          <td className="px-4 py-3">
                            {row.changedAt ? formatDate(String(row.changedAt)) : '—'}
                          </td>
                          {!machineLocked ? (
                            <td className="px-4 py-3">
                              <div className="font-medium">{asset?.name ?? '—'}</div>
                              {asset?.serialNo ? (
                                <div className="font-mono text-xs text-text-secondary">
                                  {asset.serialNo}
                                </div>
                              ) : null}
                            </td>
                          ) : null}
                          <td className="px-4 py-3">
                            <div className="font-medium">{String(row.partName)}</div>
                            {row.partCode ? (
                              <div className="font-mono text-xs text-text-secondary">
                                {String(row.partCode)}
                              </div>
                            ) : null}
                            {row.underWarranty ? (
                              <Badge color="green" className="mt-1">
                                Warranty
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color="blue">{String(row.changeType).replaceAll('_', ' ')}</Badge>
                            <div className="text-xs text-text-secondary">
                              Qty {String(row.quantity ?? 1)}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {[row.oldSerialNo, row.newSerialNo].filter(Boolean).join(' → ') || '—'}
                          </td>
                          <td className="px-4 py-3">{performer?.name ?? '—'}</td>
                          <td className="px-4 py-3">
                            {row.chargeAmount != null ? formatCurrency(num(row.chargeAmount)) : '—'}
                          </td>
                          {allowMutate ? (
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                <EditIconButton onClick={() => openEdit(row)} />
                                <DeleteIconButton onClick={() => setConfirmId(String(row.id))} />
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {allowMutate ? (
        <FormPanel
          open={formOpen}
          accent="theme"
          eyebrow="Spare parts"
          title={editId ? 'Edit spare part' : 'Add spare part'}
          subtitle={
            machineLocked
              ? `Part changed on ${fixedAssetLabel ?? 'this ticket machine'} — no need to re-enter machine.`
              : 'Which customer, machine, part replaced and who did the work.'
          }
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <FormPanelCancel onClick={() => setFormOpen(false)} />
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save changes' : 'Record'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {!fixedContactId ? (
              <div className="sm:col-span-2">
                <Select
                  label="Customer *"
                  value={form.contactId}
                  onChange={(e) => setForm({ ...form, contactId: e.target.value, assetId: '' })}
                  options={[
                    { value: '', label: 'Select customer' },
                    ...contacts.map((c) => ({
                      value: c.id,
                      label: `${c.customerCode ? `${c.customerCode} · ` : ''}${c.name}`,
                    })),
                  ]}
                />
              </div>
            ) : null}
            {machineLocked ? (
              <div className="sm:col-span-2 rounded-[8px] border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="text-[11px] font-semibold uppercase text-text-secondary">
                  Machine (from ticket)
                </div>
                <div className="mt-0.5 font-medium text-text-primary">
                  {fixedAssetLabel ??
                    assets.find((a) => a.id === fixedAssetId)?.name ??
                    'Ticket machine'}
                </div>
              </div>
            ) : (
              <Select
                label="Machine / product"
                value={form.assetId}
                onChange={(e) => setForm({ ...form, assetId: e.target.value })}
                options={[
                  { value: '', label: 'General (no machine)' },
                  ...assets.map((a) => ({
                    value: a.id,
                    label: `${a.name}${a.serialNo ? ` · ${a.serialNo}` : ''}`,
                  })),
                ]}
              />
            )}
            <Input
              label="Date of change *"
              type="date"
              value={form.changedAt}
              onChange={(e) => setForm({ ...form, changedAt: e.target.value })}
            />
            <Input
              label="Part name *"
              value={form.partName}
              onChange={(e) => setForm({ ...form, partName: e.target.value })}
              placeholder="Load cell / Printer head / Battery"
              className="sm:col-span-2"
            />
            <Input
              label="Part code / SKU"
              value={form.partCode}
              onChange={(e) => setForm({ ...form, partCode: e.target.value })}
            />
            <Select
              label="Change type"
              value={form.changeType}
              onChange={(e) => setForm({ ...form, changeType: e.target.value })}
              options={CHANGE_TYPES.map((o) => ({ value: o.value, label: o.label }))}
            />
            <Input
              label="Quantity"
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <Input
              label="Old serial no."
              value={form.oldSerialNo}
              onChange={(e) => setForm({ ...form, oldSerialNo: e.target.value })}
            />
            <Input
              label="New serial no."
              value={form.newSerialNo}
              onChange={(e) => setForm({ ...form, newSerialNo: e.target.value })}
            />
            <Select
              label="Technician / executive"
              value={form.performedByUserId}
              onChange={(e) => setForm({ ...form, performedByUserId: e.target.value })}
              options={[
                { value: '', label: 'Select' },
                ...users.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
            <Input
              label="Charge amount ₹"
              type="number"
              value={form.chargeAmount}
              onChange={(e) => setForm({ ...form, chargeAmount: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.underWarranty}
                onChange={(e) => setForm({ ...form, underWarranty: e.target.checked })}
              />
              Under warranty (no charge)
            </label>
            <div className="sm:col-span-2">
              <Input
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Reason, condition of old part…"
              />
            </div>
          </div>
        </FormPanel>
      ) : null}

      <ConfirmModal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) void runDelete(confirmId)
        }}
        title="Delete spare part record?"
        body="This change log entry will be removed."
      />
    </>
  )
}
