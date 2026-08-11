import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  MessageCircle,
  Package,
  Building2,
  UserRound,
  Play,
  Wallet,
  Send,
} from 'lucide-react'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { openPrintableJobSheet } from '@/lib/jobSheetPrint'
import { formatCurrency, formatDate, formatDateTime, formatPhone } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const tenantName = useAuthStore((s) => s.user?.tenantName)
  const [ticket, setTicket] = useState<Record<string, unknown> | null>(null)
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeStatus, setCompleteStatus] = useState<'RESOLVED' | 'CLOSED'>('RESOLVED')
  const [payDraft, setPayDraft] = useState({ paymentTotal: '', advanceAmount: '', odAmount: '' })
  const [lastInvoice, setLastInvoice] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups] = await Promise.all([api.getTicket(id), api.lookups()])
      setTicket(row)
      setUsers(lookups.users)
      setPayDraft({
        paymentTotal: String(num(row.paymentTotal) || ''),
        advanceAmount: String(num(row.advanceAmount) || ''),
        odAmount: String(num(row.odAmount) || ''),
      })
    } catch (err) {
      setTicket(null)
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not open this service job',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, id])

  useEffect(() => {
    void load()
  }, [load])

  function handleWhatsappResult(
    whatsapp?: {
      notified?: boolean
      reason?: string
      fallbackWaLink?: string | null
    } | null,
    kind: 'paid' | 'due' | 'complete' | 'invoice' | 'generic' = 'generic',
  ) {
    if (whatsapp?.reason === 'no_phone' || whatsapp?.reason === 'no_contact') {
      addToast({
        type: 'warning',
        message: 'No customer phone on file — WhatsApp message not sent',
      })
      return
    }
    const copy: Record<typeof kind, string> = {
      paid: 'WhatsApp message sent to customer — payment received in full',
      due: 'WhatsApp message sent to customer — payment due reminder',
      complete: 'WhatsApp message sent to customer — service completed',
      invoice: 'WhatsApp message sent to customer — invoice / receipt details',
      generic: 'WhatsApp message sent to customer',
    }
    // No wa.me redirect — toast confirms send (live AskMeister or queued mock)
    addToast({ type: 'success', message: copy[kind] })
  }

  async function patchTicket(body: Record<string, unknown>, successMsg?: string) {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.updateTicket(id, body)
      setTicket((prev) => ({ ...(prev ?? {}), ...updated }))
      if (successMsg) addToast({ type: 'success', message: successMsg })
      if (updated.whatsapp) handleWhatsappResult(updated.whatsapp, 'complete')
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Update failed' })
    } finally {
      setBusy(false)
    }
  }

  function askComplete(nextStatus: 'RESOLVED' | 'CLOSED' = 'RESOLVED') {
    setCompleteStatus(nextStatus)
    setCompleteOpen(true)
  }

  async function confirmComplete() {
    setCompleteOpen(false)
    await patchTicket(
      { status: completeStatus },
      completeStatus === 'CLOSED' ? 'Ticket closed' : 'Service marked complete',
    )
  }

  async function markPaidFully() {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.markTicketPaid(id)
      setTicket((prev) => ({ ...(prev ?? {}), ...updated }))
      if (updated.invoice) setLastInvoice(updated.invoice as Record<string, unknown>)
      addToast({
        type: 'success',
        message: updated.invoice
          ? `Paid in full · invoice ${String((updated.invoice as { invoiceNumber?: string }).invoiceNumber ?? '')}`
          : 'Marked paid in full',
      })
      if (updated.invoiceError) {
        addToast({ type: 'warning', message: String(updated.invoiceError) })
      }
      handleWhatsappResult(updated.whatsapp, 'paid')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not mark paid',
      })
    } finally {
      setBusy(false)
    }
  }

  async function sendPaymentDue() {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.sendTicketPaymentDue(id)
      handleWhatsappResult(updated.whatsapp, 'due')
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not send payment due',
      })
    } finally {
      setBusy(false)
    }
  }

  async function sendPaidWhatsApp() {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.createTicketInvoice(id)
      if (updated.invoice) setLastInvoice(updated.invoice as Record<string, unknown>)
      handleWhatsappResult(updated.whatsapp, 'paid')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not send WhatsApp',
      })
    } finally {
      setBusy(false)
    }
  }

  async function invoicePdfAndSend() {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.createTicketInvoice(id)
      if (updated.invoice) setLastInvoice(updated.invoice as Record<string, unknown>)
      addToast({
        type: 'success',
        message: `Invoice ${String((updated.invoice as { invoiceNumber?: string })?.invoiceNumber ?? '')} ready`,
      })
      handleWhatsappResult(updated.whatsapp, 'invoice')
      downloadJobSheet({ ...ticket, ...updated })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create invoice',
      })
    } finally {
      setBusy(false)
    }
  }

  async function savePayments() {
    await patchTicket(
      {
        paymentTotal: Number(payDraft.paymentTotal) || 0,
        advanceAmount: Number(payDraft.advanceAmount) || 0,
        odAmount: Number(payDraft.odAmount) || 0,
      },
      'Payment amounts updated',
    )
  }

  function downloadJobSheet(row?: Record<string, unknown> | null) {
    const t = row ?? ticket
    if (!t) return
    try {
      const contact = (t.contact as {
        name?: string
        phone?: string | null
        customerCode?: string | null
        street?: string | null
        doorNo?: string | null
        area?: string | null
        pincode?: string | null
        location?: string | null
      } | null) ?? null
      const asset = (t.asset as Record<string, unknown> | null) ?? null
      const address = [contact?.doorNo, contact?.street, contact?.area, contact?.location, contact?.pincode]
        .filter(Boolean)
        .join(', ')
      const cf = (t.customFields as Record<string, unknown>) ?? {}
      const invNo =
        lastInvoice?.invoiceNumber ||
        (t.invoice as { invoiceNumber?: string } | undefined)?.invoiceNumber ||
        ''
      const ok = openPrintableJobSheet({
        companyName: tenantName || 'NovaCRM',
        ticketNo: String(t.ticketNo ?? ''),
        subject: String(t.subject ?? ''),
        status: String(t.status ?? ''),
        paymentStatus: String(t.paymentStatus ?? 'UNPAID'),
        createdAt: t.createdAt ? formatDate(String(t.createdAt)) : undefined,
        completedAt: t.resolvedAt
          ? formatDate(String(t.resolvedAt))
          : t.closedAt
            ? formatDate(String(t.closedAt))
            : undefined,
        paidAt: t.paidAt ? formatDateTime(String(t.paidAt)) : null,
        customerName: contact?.name || '—',
        customerCode: contact?.customerCode,
        customerPhone: contact?.phone ? formatPhone(String(contact.phone)) : null,
        customerAddress: address || undefined,
        machineName: asset?.name ? String(asset.name) : undefined,
        machineType: asset?.machineType ? String(asset.machineType) : undefined,
        serialNo: asset?.serialNo ? String(asset.serialNo) : null,
        capacity: asset?.capacity ? String(asset.capacity) : null,
        servicePlan: asset?.servicePlan ? String(asset.servicePlan) : null,
        amcEndDate: asset?.amcEndDate ? formatDate(String(asset.amcEndDate)) : null,
        stampingDate: t.stampingDate ? formatDate(String(t.stampingDate)) : null,
        nextDueDate: t.nextDueDate ? formatDate(String(t.nextDueDate)) : null,
        odAmount: num(t.odAmount),
        paymentTotal: num(t.paymentTotal),
        advanceAmount: num(t.advanceAmount),
        balanceDue: num(t.balanceDue),
        receivedBy:
          t.receivedBy && typeof t.receivedBy === 'object' && 'name' in (t.receivedBy as object)
            ? String((t.receivedBy as { name: string }).name)
            : null,
        deliveredBy:
          t.deliveredBy && typeof t.deliveredBy === 'object' && 'name' in (t.deliveredBy as object)
            ? String((t.deliveredBy as { name: string }).name)
            : null,
        assignee:
          t.assignee && typeof t.assignee === 'object' && 'name' in (t.assignee as object)
            ? String((t.assignee as { name: string }).name)
            : null,
        workNotes: String(t.description || ''),
        category: cf.category ? String(cf.category) : undefined,
        channel: cf.channel ? String(cf.channel) : undefined,
      })
      if (!ok) {
        addToast({ type: 'error', message: 'Allow pop-ups to open the receipt PDF' })
      } else if (invNo) {
        addToast({ type: 'success', message: `Receipt PDF opened · invoice ${String(invNo)}` })
      } else {
        addToast({ type: 'success', message: 'Receipt PDF opened — use Print / Save as PDF' })
      }
    } catch {
      addToast({ type: 'error', message: 'Could not open receipt PDF' })
    }
  }

  async function sendMessage() {
    if (!id || !message.trim()) return
    try {
      await api.addTicketMessage(id, { content: message.trim() })
      setMessage('')
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Message failed' })
    }
  }

  if (loading) return <Card className="p-6 text-sm text-text-secondary">Loading ticket…</Card>
  if (!ticket) {
    return (
      <EmptyState
        title="Ticket not found"
        subtitle="It may have been deleted."
        actionLabel="Back"
        onAction={() => navigate('/tickets')}
      />
    )
  }

  const messages = (ticket.messages as Array<Record<string, unknown>>) ?? []
  const cf = (ticket.customFields as Record<string, unknown>) ?? {}
  const product = ticket.product as { id: string; name: string; sku: string } | null | undefined
  const contact = ticket.contact as {
    id: string
    name: string
    phone?: string | null
    customerCode?: string | null
  } | null | undefined
  const account = ticket.account as { id: string; name: string } | null | undefined
  const asset = ticket.asset as Record<string, unknown> | null | undefined
  const status = String(ticket.status)
  const paymentStatus = String(ticket.paymentStatus ?? 'UNPAID')
  const isOpen = ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(status)
  const isDone = status === 'RESOLVED' || status === 'CLOSED'
  const isPaid = paymentStatus === 'PAID'
  const canDownloadDocs = isDone || isPaid
  const breached = Boolean(ticket.slaBreached)
  const balance = num(ticket.balanceDue)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" onClick={() => navigate('/tickets')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">
              #{String(ticket.ticketNo)} — {String(ticket.subject)}
            </h1>
            <Badge color={breached ? 'red' : ticketStatusColor[status] ?? 'gray'}>{labelize(status)}</Badge>
            <Badge color={isPaid ? 'green' : paymentStatus === 'PARTIAL' ? 'amber' : 'gray'}>
              {labelize(paymentStatus)}
            </Badge>
            {breached ? <Badge color="red">SLA overdue</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {[contact?.name, account?.name, cf.category, cf.channel].filter(Boolean).map(String).join(' · ') ||
              'Service ticket'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOpen && status === 'OPEN' ? (
            <Button disabled={busy} onClick={() => void patchTicket({ status: 'IN_PROGRESS' }, 'Work started')}>
              <Play size={16} /> Start
            </Button>
          ) : null}
          {isOpen && status !== 'PENDING' ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void patchTicket({ status: 'PENDING' }, 'Marked waiting')}
            >
              <Clock3 size={16} /> Waiting
            </Button>
          ) : null}
          {isOpen ? (
            <Button disabled={busy} onClick={() => askComplete('RESOLVED')}>
              <CheckCircle2 size={16} /> Complete
            </Button>
          ) : null}
          {canDownloadDocs ? (
            <Button variant="outline" onClick={() => downloadJobSheet()}>
              <Download size={16} /> PDF
            </Button>
          ) : null}
        </div>
      </div>

      {/* Customer + machine — top facts */}
      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Customer</div>
            {contact ? (
              <Link className="mt-1 block font-medium text-accent-blue hover:underline" to={`/contacts/${contact.id}`}>
                {contact.customerCode ? <span className="mr-1 font-mono text-xs">{contact.customerCode}</span> : null}
                {contact.name}
              </Link>
            ) : (
              <div className="mt-1 text-sm text-text-secondary">—</div>
            )}
            {contact?.phone ? (
              <div className="mt-0.5 text-xs text-text-secondary">{formatPhone(String(contact.phone))}</div>
            ) : null}
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Machine</div>
            <div className="mt-1 font-medium text-text-primary">{asset?.name ? String(asset.name) : '—'}</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {asset?.servicePlan === 'AMC' ? 'AMC' : asset?.servicePlan ? 'Non-AMC' : ''}
              {asset?.amcEndDate ? ` · ends ${formatDate(String(asset.amcEndDate))}` : ''}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Stamping / Next due</div>
            <div className="mt-1 text-sm font-medium">
              {ticket.stampingDate ? formatDate(String(ticket.stampingDate)) : '—'}
              {' → '}
              {ticket.nextDueDate ? formatDate(String(ticket.nextDueDate)) : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Links</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {account ? (
                <Link className="inline-flex items-center gap-1 text-accent-blue hover:underline" to={`/accounts/${account.id}`}>
                  <Building2 size={13} /> {account.name}
                </Link>
              ) : null}
              {product ? (
                <Link
                  className="inline-flex items-center gap-1 text-accent-blue hover:underline"
                  to={`/erp/products/${product.id}`}
                >
                  <Package size={13} /> {product.name}
                </Link>
              ) : null}
              {!account && !product ? <span className="text-text-secondary">—</span> : null}
            </div>
          </div>
        </div>
      </Card>

      {/* Work + payment — main actions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold text-text-primary">Work</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                const next = e.target.value
                if (next === 'RESOLVED' || next === 'CLOSED') {
                  askComplete(next)
                  return
                }
                void patchTicket({ status: next }, 'Status updated')
              }}
              options={['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'].map((v) => ({
                value: v,
                label: labelize(v),
              }))}
            />
            <Select
              label="Priority"
              value={String(ticket.priority)}
              onChange={(e) => void patchTicket({ priority: e.target.value }, 'Priority updated')}
              options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) }))}
            />
            <Select
              label="Assignee"
              value={String(ticket.assignedToId ?? '')}
              onChange={(e) => void patchTicket({ assignedToId: e.target.value || null }, 'Assignee updated')}
              options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            />
            <Select
              label="Received by"
              value={String(ticket.receivedByUserId ?? '')}
              onChange={(e) =>
                void patchTicket({ receivedByUserId: e.target.value || null }, 'Received-by updated')
              }
              options={[{ value: '', label: '—' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            />
            <div className="sm:col-span-2">
              <Select
                label="Delivered by"
                value={String(ticket.deliveredByUserId ?? '')}
                onChange={(e) =>
                  void patchTicket({ deliveredByUserId: e.target.value || null }, 'Delivered-by updated')
                }
                options={[
                  { value: '', label: 'Fill after delivery' },
                  ...users.map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
              <p className="mt-1 text-xs text-text-secondary">Optional at create — set after delivery.</p>
            </div>
            <div className="sm:col-span-2 text-xs text-text-secondary">
              SLA due:{' '}
              <span className={breached ? 'font-medium text-accent-red' : 'font-medium text-text-primary'}>
                {ticket.slaDueAt ? formatDateTime(String(ticket.slaDueAt)) : '—'}
                {breached ? ' (breached)' : ''}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">Payment & invoice</h2>
            <Badge color={isPaid ? 'green' : paymentStatus === 'PARTIAL' ? 'amber' : 'gray'}>
              {labelize(paymentStatus)}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="OD ₹"
              type="number"
              value={payDraft.odAmount}
              onChange={(e) => setPayDraft({ ...payDraft, odAmount: e.target.value })}
            />
            <Input
              label="Total ₹"
              type="number"
              value={payDraft.paymentTotal}
              onChange={(e) => setPayDraft({ ...payDraft, paymentTotal: e.target.value })}
            />
            <Input
              label="Advance ₹"
              type="number"
              value={payDraft.advanceAmount}
              onChange={(e) => setPayDraft({ ...payDraft, advanceAmount: e.target.value })}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-border bg-surface px-3 py-2 text-sm">
            <span className="text-text-secondary">Balance due</span>
            <span className="text-lg font-semibold text-accent-amber">{formatCurrency(balance)}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button variant="outline" disabled={busy} onClick={() => void savePayments()}>
              Save amounts
            </Button>
            {!isPaid ? (
              <Button disabled={busy} onClick={() => void markPaidFully()}>
                <Wallet size={16} /> Mark paid fully
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => downloadJobSheet()}>
                <Download size={16} /> Receipt PDF
              </Button>
            )}
            {!isPaid ? (
              <Button variant="outline" disabled={busy || balance <= 0} onClick={() => void sendPaymentDue()}>
                <Send size={16} /> WhatsApp payment due
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => void sendPaidWhatsApp()}>
                <MessageCircle size={16} /> WhatsApp paid / invoice
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={() => void invoicePdfAndSend()}>
              <FileText size={16} /> {isPaid ? 'Invoice PDF + send' : 'Create invoice + due'}
            </Button>
          </div>
          {lastInvoice?.invoiceNumber ? (
            <p className="mt-2 text-xs text-accent-green">
              Invoice {String(lastInvoice.invoiceNumber)}
              {lastInvoice.id ? (
                <>
                  {' · '}
                  <Link className="underline" to="/erp/invoices">
                    Open invoices
                  </Link>
                </>
              ) : null}
            </p>
          ) : isPaid ? (
            <p className="mt-2 text-xs text-text-secondary">
              Paid{ticket.paidAt ? ` · ${formatDateTime(String(ticket.paidAt))}` : ''}. PDF + WhatsApp receipt available.
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              Send payment due anytime. After full payment, invoice PDF opens and WhatsApp receipt goes to the customer.
            </p>
          )}
        </Card>
      </div>

      {/* Issue + notes */}
      <Card className="p-4 sm:p-5">
        <h2 className="mb-2 text-sm font-semibold text-text-primary">Issue / work notes</h2>
        <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
          {String(ticket.description)}
        </p>
        <h2 className="mb-2 text-sm font-semibold text-text-secondary">Internal conversation</h2>
        <ul className="mb-3 max-h-64 space-y-2 overflow-y-auto">
          {messages.length === 0 ? (
            <li className="rounded-[8px] border border-dashed border-border px-3 py-4 text-center text-sm text-text-secondary">
              No notes yet
            </li>
          ) : (
            messages.map((m) => (
              <li key={String(m.id)} className="rounded-[8px] border border-border bg-card px-3 py-2.5 text-sm">
                <div className="mb-1 flex justify-between gap-2 text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">{String(m.authorName)}</span>
                  <span>{m.createdAt ? formatDate(String(m.createdAt)) : ''}</span>
                </div>
                <p className="leading-relaxed">{String(m.content)}</p>
              </li>
            ))
          )}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            className="flex-1"
            placeholder="Add a note…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendMessage()
            }}
          />
          <Button onClick={() => void sendMessage()}>Send</Button>
        </div>
      </Card>

      <Modal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title={completeStatus === 'CLOSED' ? 'Close service ticket?' : 'Complete service?'}
        subtitle={`Ticket #${String(ticket.ticketNo)} — ${String(ticket.subject)}`}
        size="sm"
        accent="emerald"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void confirmComplete()} disabled={busy}>
              <CheckCircle2 size={16} />
              {busy ? 'Saving…' : completeStatus === 'CLOSED' ? 'Close ticket' : 'Mark complete'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          Completes the job and WhatsApps the customer when possible. Then use <strong>Mark paid fully</strong> to
          create the invoice PDF and send payment confirmation.
        </p>
        {contact ? (
          <div className="mt-4 rounded-[10px] border border-border bg-surface px-3 py-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-text-primary">
              <UserRound size={14} /> {contact.name}
            </div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {[contact.customerCode, contact.phone ? formatPhone(String(contact.phone)) : null]
                .filter(Boolean)
                .join(' · ') || 'No phone on file'}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

export default TicketDetailPage
