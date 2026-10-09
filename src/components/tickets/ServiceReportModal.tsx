import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { formatPhone } from '@/lib/utils'

const CHANGE_TYPES = [
  { value: 'REPLACED', label: 'Replaced' },
  { value: 'INSTALLED', label: 'Installed' },
  { value: 'REMOVED', label: 'Removed' },
  { value: 'REPAIRED', label: 'Repaired' },
  { value: 'ADJUSTED', label: 'Adjusted' },
] as const

type SpareLine = {
  key: string
  partName: string
  partCode: string
  changeType: string
  quantity: string
  oldSerialNo: string
  newSerialNo: string
  chargeAmount: string
  underWarranty: boolean
  notes: string
}

function emptyLine(): SpareLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    partName: '',
    partCode: '',
    changeType: 'REPLACED',
    quantity: '1',
    oldSerialNo: '',
    newSerialNo: '',
    chargeAmount: '',
    underWarranty: false,
    notes: '',
  }
}

export type ServiceReportTicket = {
  id: string
  subject?: unknown
  description?: unknown
  contactId?: unknown
  assetId?: unknown
  customFields?: unknown
  contact?: {
    id?: string
    name?: string
    phone?: string | null
    mobile?: string | null
    customerCode?: string | null
    area?: string | null
    city?: string | null
  } | null
  asset?: {
    id?: string
    name?: string
    serialNo?: string | null
    machineType?: string | null
    model?: string | null
  } | null
}

type Props = {
  open: boolean
  ticket: ServiceReportTicket | null
  onClose: () => void
  /** Called after report + spare parts are saved */
  onSaved: () => void
}

/**
 * Post-close service report: customer autofill, issue notes, spare parts
 * changes saved on the machine under the customer.
 */
export function ServiceReportModal({ open, ticket, onClose, onSaved }: Props) {
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const [issues, setIssues] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [lines, setLines] = useState<SpareLine[]>([emptyLine()])
  const [saving, setSaving] = useState(false)

  const contact = ticket?.contact ?? null
  const asset = ticket?.asset ?? null
  const contactId = ticket?.contactId
    ? String(ticket.contactId)
    : contact?.id
      ? String(contact.id)
      : ''
  const assetId = ticket?.assetId
    ? String(ticket.assetId)
    : asset?.id
      ? String(asset.id)
      : ''

  useEffect(() => {
    if (!open || !ticket) return
    const cf =
      ticket.customFields && typeof ticket.customFields === 'object'
        ? (ticket.customFields as Record<string, unknown>)
        : {}
    const existing = cf.serviceReport as Record<string, unknown> | undefined
    setIssues(
      existing?.issues
        ? String(existing.issues)
        : String(ticket.description || ticket.subject || ''),
    )
    setWorkDone(existing?.workDone ? String(existing.workDone) : '')
    setLines([emptyLine()])
  }, [open, ticket])

  function updateLine(key: string, patch: Partial<SpareLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function save() {
    if (!ticket?.id) return
    if (!contactId) {
      addToast({ type: 'error', message: 'Ticket has no customer — cannot save service report' })
      return
    }
    const spareRows = lines.filter((l) => l.partName.trim())
    if (!issues.trim() && spareRows.length === 0) {
      addToast({ type: 'error', message: 'Enter issues / work done, or at least one spare part change' })
      return
    }
    if (spareRows.length > 0 && !assetId) {
      addToast({
        type: 'error',
        message: 'This ticket has no machine linked — spare parts need a machine on the customer',
      })
      return
    }

    setSaving(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      for (const line of spareRows) {
        await api.createSparePart({
          contactId,
          assetId: assetId || null,
          ticketId: String(ticket.id),
          partName: line.partName.trim(),
          partCode: line.partCode.trim() || null,
          changeType: line.changeType,
          quantity: Math.max(1, Number(line.quantity) || 1),
          oldSerialNo: line.oldSerialNo.trim() || null,
          newSerialNo: line.newSerialNo.trim() || null,
          changedAt: today,
          performedByUserId: authUser?.id ?? null,
          chargeAmount: line.chargeAmount.trim() ? Number(line.chargeAmount) : null,
          underWarranty: line.underWarranty,
          notes: line.notes.trim() || null,
          customFields: { fromServiceReport: true },
        })
      }

      const cf =
        ticket.customFields && typeof ticket.customFields === 'object'
          ? (ticket.customFields as Record<string, unknown>)
          : {}
      await api.updateTicket(String(ticket.id), {
        customFields: {
          ...cf,
          serviceReport: {
            issues: issues.trim(),
            workDone: workDone.trim(),
            sparePartsCount: spareRows.length,
            savedAt: new Date().toISOString(),
            savedBy: authUser?.name ?? 'Desk',
            savedById: authUser?.id ?? null,
            customerName: contact?.name ?? null,
            machineName: asset?.name ?? null,
            machineSerial: asset?.serialNo ?? null,
          },
        },
      })

      addToast({
        type: 'success',
        message:
          spareRows.length > 0
            ? `Service report saved — ${spareRows.length} spare part change(s) on customer machine`
            : 'Service report saved',
      })
      onSaved()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save service report',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose()
      }}
      title="Service report"
      subtitle="After the ticket is closed — notes + spare part changes on this customer’s machine."
      size="xl"
      accent="sky"
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Skip for now
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save service report'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Customer (auto-filled)
          </div>
          <div className="mt-1 grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-text-secondary">Name · </span>
              <span className="font-medium">{contact?.name ?? '—'}</span>
              {contact?.customerCode ? (
                <span className="text-text-secondary"> · {contact.customerCode}</span>
              ) : null}
            </div>
            <div>
              <span className="text-text-secondary">Phone · </span>
              <span className="font-medium">
                {contact?.phone || contact?.mobile
                  ? formatPhone(String(contact.phone || contact.mobile))
                  : '—'}
              </span>
            </div>
            <div className="sm:col-span-2">
              <span className="text-text-secondary">Machine · </span>
              <span className="font-medium">
                {asset?.name ?? '—'}
                {asset?.serialNo ? ` · S/No ${asset.serialNo}` : ''}
                {asset?.model ? ` · ${asset.model}` : ''}
              </span>
            </div>
          </div>
        </section>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-text-secondary">Issues / complaint *</span>
          <textarea
            className="min-h-[88px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            placeholder="What the customer reported…"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-text-secondary">Work done / remarks</span>
          <textarea
            className="min-h-[72px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
            value={workDone}
            onChange={(e) => setWorkDone(e.target.value)}
            placeholder="What was done on site…"
          />
        </label>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Spare parts change</h3>
              <p className="text-xs text-text-secondary">
                Saved under this machine on the customer’s contact → Spare parts / Machines.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              <Plus size={14} /> Add part
            </Button>
          </div>

          {!assetId ? (
            <p className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              No machine on this ticket — you can still save the report text. Link a machine to log spare
              parts.
            </p>
          ) : null}

          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div
                key={line.key}
                className="rounded-lg border border-border bg-card p-3 shadow-sm"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-text-secondary">Part {idx + 1}</span>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="rounded p-1 text-text-secondary hover:bg-muted hover:text-accent-red"
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      aria-label="Remove part"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    label="Part name *"
                    value={line.partName}
                    onChange={(e) => updateLine(line.key, { partName: e.target.value })}
                    placeholder="Load cell / printer head…"
                  />
                  <Input
                    label="Part code"
                    value={line.partCode}
                    onChange={(e) => updateLine(line.key, { partCode: e.target.value })}
                  />
                  <Select
                    label="Change type"
                    value={line.changeType}
                    onChange={(e) => updateLine(line.key, { changeType: e.target.value })}
                    options={[...CHANGE_TYPES]}
                  />
                  <Input
                    label="Qty"
                    type="number"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  />
                  <Input
                    label="Old serial"
                    value={line.oldSerialNo}
                    onChange={(e) => updateLine(line.key, { oldSerialNo: e.target.value })}
                  />
                  <Input
                    label="New serial"
                    value={line.newSerialNo}
                    onChange={(e) => updateLine(line.key, { newSerialNo: e.target.value })}
                  />
                  <Input
                    label="Charge ₹"
                    type="number"
                    value={line.chargeAmount}
                    onChange={(e) => updateLine(line.key, { chargeAmount: e.target.value })}
                    disabled={line.underWarranty}
                  />
                  <label className="flex items-end gap-2 pb-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={line.underWarranty}
                      onChange={(e) =>
                        updateLine(line.key, {
                          underWarranty: e.target.checked,
                          chargeAmount: e.target.checked ? '0' : line.chargeAmount,
                        })
                      }
                    />
                    Under warranty / free
                  </label>
                  <Input
                    className="sm:col-span-2 lg:col-span-3"
                    label="Notes"
                    value={line.notes}
                    onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}
