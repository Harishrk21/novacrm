import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { assetOriginShort, isThirdPartyOrigin } from '@/lib/assetOrigin'
import { openPrintableInvoice } from '@/lib/invoicePrint'
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
  const [editDraft, setEditDraft] = useState({
    subject: '',
    description: '',
    stampingDate: '',
    nextDueDate: '',
    category: '',
    channel: '',
  })
  const [lastInvoice, setLastInvoice] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups] = await Promise.all([api.getTicket(id), api.lookups()])
      setTicket(row)
      setUsers(lookups.users)
      const cf = (row.customFields as Record<string, unknown>) ?? {}
      setPayDraft({
        paymentTotal: String(num(row.paymentTotal) || ''),
        advanceAmount: String(num(row.advanceAmount) || ''),
        odAmount: String(num(row.odAmount) || ''),
      })
      setEditDraft({
        subject: String(row.subject ?? ''),
        description: String(row.description ?? ''),
        stampingDate: row.stampingDate ? String(row.stampingDate).slice(0, 10) : '',
        nextDueDate: row.nextDueDate ? String(row.nextDueDate).slice(0, 10) : '',
        category: String(cf.category ?? ''),
        channel: String(cf.channel ?? ''),
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

  function openTaxInvoicePdf(inv: Record<string, unknown>, row?: Record<string, unknown> | null) {
    const t = row ?? ticket
    if (!t || !inv) return false
    const contact = (t.contact as {
      name?: string
      phone?: string | null
      street?: string | null
      doorNo?: string | null
      area?: string | null
      pincode?: string | null
      location?: string | null
    } | null) ?? null
    const account = (t.account as { name?: string } | null) ?? null
    const address = [contact?.doorNo, contact?.street, contact?.area, contact?.location, contact?.pincode]
      .filter(Boolean)
      .join(', ')
    const linesRaw = (inv.lines as Array<Record<string, unknown>> | undefined) ?? []
    const lines =
      linesRaw.length > 0
        ? linesRaw.map((l) => ({
            description: String(l.description ?? 'Service'),
            quantity: num(l.quantity) || 1,
            unitPrice: num(l.unitPrice),
            taxPercent: num(l.taxPercent),
            lineTotal: num(l.lineTotal) || num(l.unitPrice) * (num(l.quantity) || 1),
          }))
        : [
            {
              description: `Service — ${String(t.subject ?? '')} (TKT-${String(t.ticketNo).padStart(5, '0')})`,
              quantity: 1,
              unitPrice: num(inv.grandTotal) || num(t.paymentTotal),
              taxPercent: 0,
              lineTotal: num(inv.grandTotal) || num(t.paymentTotal),
            },
          ]
    const grand = num(inv.grandTotal) || lines.reduce((s, l) => s + l.lineTotal, 0)
    const tax = num(inv.taxTotal)
    const sub = num(inv.subtotal) || Math.max(0, grand - tax)
    return openPrintableInvoice({
      invoiceNumber: String(inv.invoiceNumber ?? 'INV'),
      status: String(inv.status ?? 'SENT'),
      invoiceDate: inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : formatDate(new Date().toISOString()),
      dueDate: inv.dueDate ? formatDate(String(inv.dueDate)) : null,
      sellerName: tenantName || 'NovaCRM',
      accountName: account?.name || contact?.name || 'Customer',
      contactName: contact?.name,
      billingAddress: address || undefined,
      notes: inv.notes ? String(inv.notes) : null,
      ticketRef: `TKT-${String(t.ticketNo).padStart(5, '0')}`,
      lines,
      subtotal: sub,
      taxTotal: tax,
      discountTotal: num(inv.discountTotal),
      grandTotal: grand,
      amountPaid: num(inv.amountPaid),
    })
  }

  async function invoicePdfAndSend() {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.createTicketInvoice(id)
      const inv = (updated.invoice as Record<string, unknown> | undefined) ?? null
      if (inv) setLastInvoice(inv)
      addToast({
        type: 'success',
        message: inv?.invoiceNumber
          ? `Tax invoice ${String(inv.invoiceNumber)} ready`
          : 'Tax invoice ready',
      })
      handleWhatsappResult(updated.whatsapp, 'invoice')
      if (inv) {
        const ok = openTaxInvoicePdf(inv, { ...(ticket ?? {}), ...updated })
        if (!ok) addToast({ type: 'error', message: 'Allow pop-ups to open the tax invoice PDF' })
      }
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

  async function saveTicketDetails() {
    if (!editDraft.subject.trim()) {
      addToast({ type: 'error', message: 'Subject is required' })
      return
    }
    await patchTicket(
      {
        subject: editDraft.subject.trim(),
        description: editDraft.description.trim() || 'Service job',
        stampingDate: editDraft.stampingDate || null,
        nextDueDate: editDraft.nextDueDate || null,
        category: editDraft.category || null,
        channel: editDraft.channel || null,
      },
      'Ticket details saved',
    )
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
        assetOrigin: asset?.origin ? String(asset.origin) : null,
        amcStartDate: asset?.amcStartDate ? formatDate(String(asset.amcStartDate)) : null,
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

  const balancePreview = useMemo(() => {
    const pay = Number(payDraft.paymentTotal) || 0
    const adv = Number(payDraft.advanceAmount) || 0
    return Math.max(0, pay - adv)
  }, [payDraft.paymentTotal, payDraft.advanceAmount])

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
  const savedBalance = num(ticket.balanceDue)
  const balanceDirty =
    payDraft.paymentTotal !== String(num(ticket.paymentTotal) || '') ||
    payDraft.advanceAmount !== String(num(ticket.advanceAmount) || '') ||
    payDraft.odAmount !== String(num(ticket.odAmount) || '')
  const balance = balancePreview

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
            <div className="mt-1 flex flex-wrap gap-1.5">
              {asset?.origin || asset?.servicePlan ? (
                <>
                  <Badge color={isThirdPartyOrigin(asset?.origin ? String(asset.origin) : null) ? 'amber' : 'blue'}>
                    {assetOriginShort(asset?.origin ? String(asset.origin) : null)}
                  </Badge>
                  {asset?.servicePlan ? (
                    <Badge color={asset.servicePlan === 'AMC' ? 'green' : 'gray'}>
                      {asset.servicePlan === 'AMC' ? 'AMC' : 'Non-AMC'}
                    </Badge>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {asset?.servicePlan === 'AMC'
                ? [
                    asset?.amcStartDate ? `AMC ${formatDate(String(asset.amcStartDate))}` : null,
                    asset?.amcEndDate ? `→ ${formatDate(String(asset.amcEndDate))}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || 'AMC'
                : ''}
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

      {/* Editable job details — same fields as create */}
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Job details</h2>
          <Button disabled={busy} onClick={() => void saveTicketDetails()}>
            Save job details
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Subject *"
            className="sm:col-span-2 lg:col-span-3"
            value={editDraft.subject}
            onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })}
          />
          <Input
            label="Stamping date"
            type="date"
            value={editDraft.stampingDate}
            onChange={(e) => setEditDraft({ ...editDraft, stampingDate: e.target.value })}
          />
          <Input
            label="Next due date"
            type="date"
            value={editDraft.nextDueDate}
            onChange={(e) => setEditDraft({ ...editDraft, nextDueDate: e.target.value })}
          />
          <Select
            label="Category"
            value={editDraft.category}
            onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
            options={[
              { value: '', label: '—' },
              { value: 'Breakdown', label: 'Breakdown' },
              { value: 'Installation', label: 'Installation' },
              { value: 'Stamping', label: 'Stamping' },
              { value: 'AMC visit', label: 'AMC visit' },
              { value: 'Other', label: 'Other' },
            ]}
          />
          <Select
            label="Channel"
            value={editDraft.channel}
            onChange={(e) => setEditDraft({ ...editDraft, channel: e.target.value })}
            options={[
              { value: '', label: '—' },
              { value: 'Walk-in', label: 'Walk-in' },
              { value: 'Phone', label: 'Phone' },
              { value: 'WhatsApp', label: 'WhatsApp' },
              { value: 'Field', label: 'Field' },
            ]}
          />
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Work notes</span>
            <textarea
              className="min-h-28 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
              value={editDraft.description}
              onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
              placeholder="What was done / parts / site notes…"
            />
          </label>
        </div>
      </Card>

      {/* Work + payment — main actions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold text-text-primary">Work status & executives</h2>
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
              label="Assign to"
              value={String(ticket.assignedToId ?? '')}
              onChange={(e) =>
                void patchTicket(
                  {
                    assignedToId: e.target.value || null,
                    receivedByUserId: e.target.value || null,
                  },
                  e.target.value
                    ? `Assigned to ${users.find((u) => u.id === e.target.value)?.name ?? 'employee'} — they will see it on Home / My Tickets`
                    : 'Unassigned',
                )
              }
              options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
            />
            <p className="sm:col-span-2 -mt-1 text-xs text-text-secondary">
              Current owner:{' '}
              <span className="font-medium text-text-primary">
                {users.find((u) => u.id === String(ticket.assignedToId ?? ''))?.name ??
                  (ticket.assignee as { name?: string } | undefined)?.name ??
                  'Nobody'}
              </span>
              . Pick the employee again and wait for the green confirmation if the list looks wrong.
            </p>
            <Select
              label="Received by"
              value={String(ticket.receivedByUserId ?? ticket.assignedToId ?? '')}
              onChange={(e) =>
                void patchTicket(
                  {
                    receivedByUserId: e.target.value || null,
                    assignedToId: e.target.value || null,
                  },
                  'Received-by / assignee updated',
                )
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
            <h2 className="text-sm font-semibold text-text-primary">Payment & documents</h2>
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
            <span className="text-text-secondary">
              Balance due
              {balanceDirty ? <span className="ml-1 text-xs text-accent-amber">(updates as you type)</span> : null}
            </span>
            <span className="text-lg font-semibold text-accent-amber">{formatCurrency(balance)}</span>
          </div>
          {balanceDirty && savedBalance !== balancePreview ? (
            <p className="mt-1 text-xs text-text-secondary">
              Saved balance: {formatCurrency(savedBalance)} — click Save amounts to store
            </p>
          ) : null}
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
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendPaidWhatsApp()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
                style={{ backgroundColor: '#25D366' }}
              >
                <MessageCircle size={16} fill="currentColor" /> WhatsApp paid / invoice
              </button>
            )}
            <Button variant="outline" disabled={busy} onClick={() => void invoicePdfAndSend()}>
              <FileText size={16} /> {isPaid ? 'Invoice PDF + send' : 'Create invoice + due'}
            </Button>
            {!isPaid && canDownloadDocs ? (
              <Button variant="outline" disabled={busy} onClick={() => downloadJobSheet()}>
                <Download size={16} /> Job sheet PDF
              </Button>
            ) : null}
          </div>
          <ul className="mt-3 space-y-1 text-xs leading-relaxed text-text-secondary">
            <li>
              <strong className="text-text-primary">Save amounts</strong> — stores OD / Total / Advance only (no PDF, no WhatsApp).
            </li>
            <li>
              <strong className="text-text-primary">Receipt PDF</strong> — service job sheet / payment receipt (machine, executives, stamping, amounts). Print → Save as PDF. No WhatsApp.
            </li>
            <li>
              <strong className="text-text-primary">WhatsApp paid / invoice</strong> — WhatsApp message only (green). No PDF window.
            </li>
            <li>
              <strong className="text-text-primary">Invoice PDF + send</strong> — creates/reuses ERP <em>tax invoice</em>, opens that invoice PDF, and WhatsApps the customer. Different layout from Receipt.
            </li>
          </ul>
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
              Paid{ticket.paidAt ? ` · ${formatDateTime(String(ticket.paidAt))}` : ''}. Use Receipt for job sheet; Invoice PDF + send for tax invoice.
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              Save amounts, then WhatsApp payment due or Create invoice + due. Mark paid fully when cash is received.
            </p>
          )}
        </Card>
      </div>

      {/* Internal conversation */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-text-primary">Internal conversation</h2>
          <p className="mt-0.5 text-xs text-text-secondary">Team notes only — not sent to the customer.</p>
        </div>

        {messages.length === 0 ? (
          <p className="px-4 py-2 text-xs text-text-secondary sm:px-5">No notes yet — add the first one below.</p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto px-4 py-3 sm:px-5">
            {messages.map((m) => (
              <li
                key={String(m.id)}
                className="rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm shadow-sm"
              >
                <div className="mb-1 flex justify-between gap-2 text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">{String(m.authorName)}</span>
                  <span>{m.createdAt ? formatDateTime(String(m.createdAt)) : ''}</span>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{String(m.content)}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border bg-surface/60 p-4 sm:p-5">
          <label className="block text-sm font-medium text-text-secondary">Add note</label>
          <textarea
            className="mt-2 min-h-28 w-full resize-y rounded-[10px] border border-border bg-card px-3 py-3 text-sm outline-none transition focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
            placeholder="Parts used, follow-up, site access, payment discussion…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendMessage()
            }}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">Ctrl+Enter to send</span>
            <Button disabled={!message.trim()} onClick={() => void sendMessage()}>
              Send note
            </Button>
          </div>
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
