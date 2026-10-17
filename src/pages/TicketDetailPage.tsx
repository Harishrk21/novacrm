import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  UserRound,
  Play,
  Wallet,
  Send,
  Phone,
  CalendarClock,
  ImagePlus,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { TicketStatusPill } from '@/components/ui/TicketStatusProgress'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { assetOriginShort, isThirdPartyOrigin } from '@/lib/assetOrigin'
import { coverageChargeHints, stampQuarterFromDate } from '@/lib/hmsCoverage'
import { openPrintableInvoice } from '@/lib/invoicePrint'
import { openPrintableJobSheet } from '@/lib/jobSheetPrint'
import {
  openPrintableServiceReport,
  serviceReportOptsFromTicket,
} from '@/lib/serviceReportPrint'
import { APP_NAME } from '@/lib/branding'
import { cn, formatCurrency, formatDate, formatDateTime, formatPhone } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { SparePartsPanel } from '@/components/contacts/SparePartsPanel'
import {
  ServiceReportModal,
  type ServiceReportTicket,
} from '@/components/tickets/ServiceReportModal'
import { formatServiceId } from '@/lib/serviceId'
import { FlowStepBar } from '@/components/ui/FlowStepBar'
import { MissingBanner, focusFirstMissing, sectionErrorClass } from '@/components/ui/MissingField'
import { WhatsAppSendConfirm, type WhatsAppConfirmPayload } from '@/components/whatsapp/WhatsAppSendConfirm'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import {
  canAssignTickets,
  canApproveTickets,
  filterServiceEngineers,
  isCompanyAdmin,
  isServiceDesk,
  isServiceEngineer,
  type LookupUser,
} from '@/lib/roles'
import { AiAssistCard } from '@/components/ai/AiAssistCard'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { useFieldShell } from '@/hooks/useFieldShell'

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI / GPay' },
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
] as const

/** Mirrors backend ticketLifecycle ALLOWED — no OPEN → RESOLVED skip. */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['OPEN', 'IN_PROGRESS', 'PENDING'],
  IN_PROGRESS: ['IN_PROGRESS', 'PENDING', 'OPEN', 'RESOLVED'],
  PENDING: ['PENDING', 'IN_PROGRESS', 'OPEN', 'RESOLVED'],
  RESOLVED: ['RESOLVED', 'CLOSED', 'IN_PROGRESS'],
  CLOSED: ['CLOSED', 'IN_PROGRESS'],
}

const ONLINE_PAY = new Set(['UPI', 'NEFT', 'RTGS', 'CARD'])

/** Collapsible group on ticket full view — chevron open / close */
function TicketDetailGroup({
  title,
  hint,
  defaultOpen = true,
  id,
  children,
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  id?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section
      id={id}
      className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm"
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
            {title}
          </div>
          {hint ? (
            <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{hint}</p>
          ) : null}
        </div>
        <ChevronDown
          size={18}
          className={cn(
            'shrink-0 text-text-secondary transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border px-4 py-4 sm:px-5">{children}</div>
      ) : null}
    </section>
  )
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const tenantName = useAuthStore((s) => s.user?.tenantName)
  const authUser = useAuthStore((s) => s.user)
  const fieldShell = useFieldShell()
  const role = authUser?.role
  const isAdmin = isCompanyAdmin(role) || canAssignTickets(role)
  const isDesk = isServiceDesk(role)
  const isEngineer = isServiceEngineer(role)
  const showAssign = canAssignTickets(role)
  /** Admin, manager, or service desk — mark paid + approve & close */
  const showApprove = canApproveTickets(role)
  /** Advance / total / balance — engineer + anyone who can close */
  const showPayment = isAdmin || isEngineer || isDesk || showApprove
  const [ticket, setTicket] = useState<Record<string, unknown> | null>(null)
  const [users, setUsers] = useState<LookupUser[]>([])
  const [message, setMessage] = useState('')
  const [dayNote, setDayNote] = useState('')
  const [billMenuOpen, setBillMenuOpen] = useState(false)
  const billMenuRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeStatus, setCompleteStatus] = useState<'RESOLVED' | 'CLOSED'>('RESOLVED')
  const [serviceReportOpen, setServiceReportOpen] = useState(false)
  /** After Approve & close — closing the report may continue to invoice / contact */
  const [serviceReportAfterClose, setServiceReportAfterClose] = useState(false)
  const [waPending, setWaPending] = useState<{
    payload: WhatsAppConfirmPayload
    execute: (sendWhatsApp: boolean) => Promise<void>
  } | null>(null)
  const [payDraft, setPayDraft] = useState({
    paymentTotal: '',
    advanceAmount: '',
    paymentMethod: 'CASH',
    paymentReference: '',
    paymentProofUrl: '',
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [editDraft, setEditDraft] = useState({
    subject: '',
    description: '',
    stampingDate: '',
    nextDueDate: '',
    category: '',
    channel: '',
    vcNumber: '',
    stampingQuarter: '',
    plateNo: '',
    verificationClass: '',
  })
  const [lastInvoice, setLastInvoice] = useState<Record<string, unknown> | null>(null)
  const [visitDraft, setVisitDraft] = useState({
    attendedAt: new Date().toISOString().slice(0, 10),
    attendedTime: new Date().toTimeString().slice(0, 5),
    notes: '',
    engineerId: '',
  })
  const [evidenceBusy, setEvidenceBusy] = useState(false)
  /** Stamping: Mark complete unlocks only after Save stamp result */
  const [stampResultSaved, setStampResultSaved] = useState(false)

  const engineers = useMemo(() => filterServiceEngineers(users), [users])
  const engineerOptions = useMemo(
    () =>
      engineers.map((u) => ({
        value: u.id,
        label: u.name,
      })),
    [engineers],
  )

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!id) return
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    try {
      const [row, lookups] = await Promise.all([
        api.getTicket(id),
        api.lookups({ scope: 'core' }),
      ])
      setTicket(row)
      setUsers(lookups.users)
      // On background poll, do not wipe in-progress payment / issue edits
      if (!silent) {
        const cf = (row.customFields as Record<string, unknown>) ?? {}
        const legal = (cf.stampingLegal as Record<string, unknown> | undefined) ?? {}
        setPayDraft({
          paymentTotal: String(num(row.paymentTotal) || ''),
          advanceAmount: String(num(row.advanceAmount) || ''),
          paymentMethod: String(row.paymentMethod || 'CASH'),
          paymentReference: String(row.paymentReference || ''),
          paymentProofUrl: String(row.paymentProofUrl || ''),
        })
        setEditDraft({
          subject: String(row.subject ?? ''),
          description: String(row.description ?? ''),
          stampingDate: row.stampingDate ? String(row.stampingDate).slice(0, 10) : '',
          nextDueDate: row.nextDueDate ? String(row.nextDueDate).slice(0, 10) : '',
          category: String(cf.category ?? ''),
          channel: String(cf.channel ?? ''),
          vcNumber: String(legal.vcNumber ?? ''),
          stampingQuarter: String(legal.stampingQuarter ?? ''),
          plateNo: String(legal.plateNo ?? ''),
          verificationClass: String(legal.verificationClass ?? ''),
        })
        setStampResultSaved(
          Boolean(row.stampingDate) && Boolean(cf.stampResultSavedAt),
        )
      }
    } catch (err) {
      if (!silent) {
        setTicket(null)
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Could not open this service job',
        })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [addToast, id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!billMenuOpen) return
    function onDocClick(e: MouseEvent) {
      if (billMenuRef.current && !billMenuRef.current.contains(e.target as Node)) {
        setBillMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [billMenuOpen])

  // Desk: quiet poll while waiting for admin assign (no full-page loading flash)
  useEffect(() => {
    if (!(isDesk && !isAdmin)) return
    const waiting = String(ticket?.status) === 'OPEN' && !ticket?.assignedToId
    if (!waiting) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load({ silent: true })
    }, 20000)
    const onFocus = () => void load({ silent: true })
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [isDesk, isAdmin, ticket?.status, ticket?.assignedToId, load])

  // Admin: quiet poll for engineer progress — never remount the page
  useEffect(() => {
    if (!isAdmin || !id) return
    const st = String(ticket?.status ?? '')
    if (st === 'CLOSED') return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load({ silent: true })
    }, 30000)
    return () => window.clearInterval(timer)
  }, [isAdmin, id, ticket?.status, load])

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

  /** Paid in full, or free job (₹0). Uses saved ticket amounts only — ignore unsaved draft typing. */
  function paymentSettledForComplete() {
    const total = num(ticket?.paymentTotal)
    const adv = num(ticket?.advanceAmount)
    const bal = num(ticket?.balanceDue)
    const paid = String(ticket?.paymentStatus ?? '') === 'PAID'
    const free = total <= 0 && adv <= 0
    return { ok: paid || free, paid, free, total, adv, bal }
  }

  function askComplete(nextStatus: 'RESOLVED' | 'CLOSED' = 'RESOLVED') {
    const cfEarly = (ticket?.customFields as Record<string, unknown> | undefined) ?? {}
    const catEarly = String(cfEarly.category ?? editDraft.category ?? '')
    const wtEarly = String(cfEarly.workType ?? '')
    const stampingEarly =
      catEarly === 'Stamping' ||
      wtEarly === 'Stamping' ||
      String(cfEarly.visitPurpose ?? '') === 'STAMPING'
    if (nextStatus === 'RESOLVED' && !ticket?.assignedToId) {
      addToast({
        type: 'error',
        message: stampingEarly
          ? 'Take & start this stamping job (or assign an engineer) before marking complete'
          : 'Assign an engineer before marking complete',
      })
      return
    }
    const needsStampResult = stampingEarly
    if (nextStatus === 'RESOLVED' && needsStampResult && !editDraft.stampingDate.trim()) {
      addToast({
        type: 'error',
        message: 'Enter today’s stamping date (and next due / valid till), then Save stamp result',
      })
      document.getElementById('section-stamp-result')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }
    if (nextStatus === 'RESOLVED' && needsStampResult && !stampResultSaved) {
      addToast({
        type: 'error',
        message: 'Save stamp result first — then Mark complete appears at the top',
      })
      document.getElementById('section-stamp-result')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }
    if (nextStatus === 'RESOLVED' && isEngineer && !isAdmin && !needsStampResult) {
      const notes = Array.isArray(
        (ticket?.customFields as Record<string, unknown> | undefined)?.dayNotes,
      )
        ? ((ticket?.customFields as Record<string, unknown>).dayNotes as unknown[])
        : []
      if (notes.length === 0) {
        addToast({
          type: 'error',
          message: 'Add at least one daily tracking note before marking complete',
        })
        document.getElementById('section-day-notes')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
        return
      }
    }
    // Mark complete + Approve & close both require payment confirmed (or free job)
    const pay = paymentSettledForComplete()
    if (!pay.ok) {
      const payStatus = String(ticket?.paymentStatus ?? 'UNPAID')
      focusFirstMissing(
        [
          {
            key: 'paymentTotal',
            sectionId: 'section-payment',
            ok: false,
            message:
              payStatus === 'PARTIAL' || pay.bal > 0
                ? 'Payment incomplete — balance still due. Mark paid fully before Mark complete.'
                : 'Payment missing — enter Total payment, then Mark paid fully (full amount) before Mark complete.',
          },
        ],
        setFieldErrors,
      )
      addToast({
        type: 'error',
        message:
          payStatus === 'PARTIAL' || pay.bal > 0
            ? `Payment incomplete — ₹${pay.bal.toLocaleString('en-IN')} still due. Mark paid fully first.`
            : 'Payment missing — Mark paid fully (full amount) before Mark complete. Scrolled to Payment.',
      })
      return
    }
    setCompleteStatus(nextStatus)
    setCompleteOpen(true)
  }

  function addOneYearIso(dateStr: string) {
    if (!dateStr) return ''
    const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
    if (Number.isNaN(d.getTime())) return ''
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  }

  async function confirmComplete() {
    setCompleteOpen(false)
    if (completeStatus === 'CLOSED') {
      // WhatsApp off for now — close directly
      await approveCompleted(false)
      return
    }
    // Lifecycle: OPEN cannot jump to RESOLVED — start work first if needed
    if (String(ticket?.status) === 'OPEN') {
      if (!id) return
      setBusy(true)
      try {
        const started = await api.updateTicket(id, {
          status: 'IN_PROGRESS',
          sendWhatsApp: false,
        })
        setTicket((prev) => ({ ...(prev ?? {}), ...started }))
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Could not start job before complete',
        })
        setBusy(false)
        return
      } finally {
        setBusy(false)
      }
    }
    const needsStampResult =
      String(cf.category ?? editDraft.category ?? '') === 'Stamping' ||
      String(cf.workType ?? '') === 'Stamping' ||
      String(cf.visitPurpose ?? '') === 'STAMPING'
    const stamp = editDraft.stampingDate.trim()
    const due = editDraft.nextDueDate.trim() || (stamp ? addOneYearIso(stamp) : '')
    const legal = {
      ...((cf.stampingLegal as Record<string, unknown> | undefined) ?? {}),
      vcNumber: editDraft.vcNumber.trim() || null,
      stampingQuarter: editDraft.stampingQuarter.trim() || null,
      plateNo: editDraft.plateNo.trim() || null,
      verificationClass: editDraft.verificationClass.trim() || null,
    }
    await patchTicket(
      {
        status: 'RESOLVED',
        sendWhatsApp: false,
        ...(needsStampResult && stamp
          ? {
              stampingDate: stamp,
              nextDueDate: due || null,
              customFields: {
                ...cf,
                stampingLegal: legal,
                stampedCompletedAt: new Date().toISOString(),
              },
            }
          : {}),
      },
      needsStampResult && stamp
        ? 'Stamping recorded · service marked complete'
        : 'Service marked complete',
    )
  }

  async function markPaidFully() {
    if (!id) return
    const method = payDraft.paymentMethod || 'CASH'
    const total = Number(payDraft.paymentTotal) || 0
    const ok = focusFirstMissing(
      [
        {
          key: 'paymentTotal',
          sectionId: 'section-payment',
          ok: total > 0,
          message: 'Total payment is required (enter the job charge). Close as free job if ₹0.',
        },
        {
          key: 'paymentMethod',
          sectionId: 'section-payment',
          ok: Boolean(method),
          message: 'Select payment method (Cash / UPI / …).',
        },
        {
          key: 'paymentReference',
          sectionId: 'section-payment',
          ok: !ONLINE_PAY.has(method) && method !== 'CHEQUE' ? true : Boolean(payDraft.paymentReference.trim()),
          message: ONLINE_PAY.has(method)
            ? 'UTR / transaction reference is missing for online payment.'
            : 'Cheque number is missing.',
        },
        {
          key: 'paymentProofUrl',
          sectionId: 'section-payment',
          ok: !ONLINE_PAY.has(method) ? true : Boolean(payDraft.paymentProofUrl.trim()),
          message: 'Payment proof screenshot / receipt is missing for online payment.',
        },
      ],
      setFieldErrors,
    )
    if (!ok) {
      addToast({ type: 'error', message: 'Missing payment details — jumped to Payment (highlighted red).' })
      return
    }
    setWaPending({
      payload: {
        title: 'Mark paid & WhatsApp receipt?',
        lines: [
          'Template payment_received_customer → customer',
          `Amount ${formatCurrency(total)} · ticket ${formatServiceId(ticket?.ticketNo != null ? String(ticket.ticketNo) : undefined)}`,
        ],
        note: 'Saves Total payment / Advance / Balance, then marks paid.',
      },
      execute: (send) => doMarkPaid(send),
    })
  }

  async function doMarkPaid(sendWhatsApp: boolean) {
    if (!id) return
    const method = payDraft.paymentMethod || 'CASH'
    setBusy(true)
    try {
      const total = Number(payDraft.paymentTotal) || 0
      const advance = Number(payDraft.advanceAmount) || 0
      const updated = await api.markTicketPaid(id, {
        paymentMethod: method as 'CASH' | 'UPI' | 'NEFT' | 'RTGS' | 'CHEQUE' | 'CARD' | 'OTHER',
        paymentReference: payDraft.paymentReference.trim() || null,
        paymentProofUrl: payDraft.paymentProofUrl.trim() || null,
        paymentTotal: total,
        advanceAmount: advance,
        sendWhatsApp,
      })
      setFieldErrors({})
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
      if (sendWhatsApp) handleWhatsappResult(updated.whatsapp, 'paid')
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

  async function uploadPaymentProof(file?: File | null) {
    if (!file) return
    setEvidenceBusy(true)
    try {
      const uploaded = await api.uploadFile(file)
      setPayDraft((p) => ({ ...p, paymentProofUrl: uploaded.url }))
      addToast({ type: 'success', message: 'Payment proof uploaded' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Upload failed',
      })
    } finally {
      setEvidenceBusy(false)
    }
  }

  async function uploadFieldPhoto(file?: File | null) {
    if (!file || !id || !ticket) return
    setEvidenceBusy(true)
    try {
      const uploaded = await api.uploadImage(file)
      const cf = (ticket.customFields as Record<string, unknown>) ?? {}
      const photos = Array.isArray(cf.fieldPhotos) ? [...(cf.fieldPhotos as Array<Record<string, unknown>>)] : []
      photos.push({
        id: crypto.randomUUID(),
        url: uploaded.url,
        caption: file.name,
        at: new Date().toISOString(),
        byUserId: authUser?.id ?? null,
        byName: authUser?.name ?? null,
      })
      await patchTicket({ customFields: { ...cf, fieldPhotos: photos } }, 'Field photo added')
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Photo upload failed',
      })
    } finally {
      setEvidenceBusy(false)
    }
  }

  async function uploadSignature(file?: File | null) {
    if (!file || !id) return
    setEvidenceBusy(true)
    try {
      const uploaded = await api.uploadImage(file)
      await patchTicket(
        { signatureUrl: uploaded.url },
        'Customer signature saved',
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Signature upload failed',
      })
    } finally {
      setEvidenceBusy(false)
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

  async function sendBillSummaryToCustomer() {
    if (!id) return
    downloadJobSheet()
    setBusy(true)
    try {
      const updated = await api.createTicketInvoice(id)
      if (updated.invoice) setLastInvoice(updated.invoice as Record<string, unknown>)
      handleWhatsappResult(updated.whatsapp, 'invoice')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not send bill to customer',
      })
    } finally {
      setBusy(false)
    }
  }

  function openProformaInvoicePdf(inv: Record<string, unknown>, row?: Record<string, unknown> | null) {
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
      sellerName: tenantName || 'HMS Enterprises',
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
          ? `Proforma ${String(inv.invoiceNumber)} ready`
          : 'Proforma invoice ready',
      })
      handleWhatsappResult(updated.whatsapp, 'invoice')
      if (inv) {
        const ok = openProformaInvoicePdf(inv, { ...(ticket ?? {}), ...updated })
        if (!ok) {
          addToast({
            type: 'error',
            message: 'Allow pop-ups — or check Downloads for the proforma HTML file',
          })
        }
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
    const cf = (ticket?.customFields as Record<string, unknown>) ?? {}
    await patchTicket(
      {
        subject: editDraft.subject.trim(),
        description: editDraft.description.trim() || 'Service job',
        stampingDate: editDraft.stampingDate || null,
        nextDueDate: editDraft.nextDueDate || null,
        category: editDraft.category || null,
        channel: editDraft.channel || null,
        customFields: {
          ...cf,
          stampingLegal: {
            vcNumber: editDraft.vcNumber.trim() || null,
            stampingQuarter: editDraft.stampingQuarter.trim() || null,
            plateNo: editDraft.plateNo.trim() || null,
            verificationClass: editDraft.verificationClass.trim() || null,
          },
        },
      },
      'Ticket details saved',
    )
  }

  function touchStampDraft(
    patch: Partial<typeof editDraft> | ((d: typeof editDraft) => typeof editDraft),
  ) {
    setStampResultSaved(false)
    setEditDraft((d) => (typeof patch === 'function' ? patch(d) : { ...d, ...patch }))
  }

  async function saveStampResult() {
    const stamp = editDraft.stampingDate.trim()
    if (!stamp) {
      addToast({ type: 'error', message: 'Enter stamping date before saving' })
      document.getElementById('section-stamp-result')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }
    const due = editDraft.nextDueDate.trim() || addOneYearIso(stamp)
    const quarter =
      editDraft.stampingQuarter.trim() || stampQuarterFromDate(stamp) || ''
    const cf = (ticket?.customFields as Record<string, unknown>) ?? {}
    const legal = {
      ...((cf.stampingLegal as Record<string, unknown> | undefined) ?? {}),
      vcNumber: editDraft.vcNumber.trim() || null,
      stampingQuarter: quarter || null,
      plateNo: editDraft.plateNo.trim() || null,
      verificationClass: editDraft.verificationClass.trim() || null,
    }
    setEditDraft((d) => ({
      ...d,
      nextDueDate: due,
      stampingQuarter: quarter || d.stampingQuarter,
    }))
    await patchTicket(
      {
        stampingDate: stamp,
        nextDueDate: due || null,
        customFields: {
          ...cf,
          stampingLegal: legal,
          stampResultSavedAt: new Date().toISOString(),
        },
      },
      'Stamp result saved — Mark complete is ready at the top',
    )
    setStampResultSaved(true)
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
        companyName: tenantName || 'HMS Enterprises',
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
        odAmount: 0,
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

  async function addVisitEntry() {
    if (!id || !ticket) return
    const attendedAt =
      visitDraft.attendedAt && visitDraft.attendedTime
        ? `${visitDraft.attendedAt}T${visitDraft.attendedTime}`
        : visitDraft.attendedAt
    const cf = (ticket.customFields as Record<string, unknown>) ?? {}
    const existing = Array.isArray(cf.visitLog) ? cf.visitLog : []
    const entry = {
      id: crypto.randomUUID(),
      attendedAt,
      notes: visitDraft.notes.trim() || 'Site visit',
      engineerId: visitDraft.engineerId || String(ticket.assignedToId ?? '') || null,
    }
    await patchTicket(
      {
        customFields: {
          ...cf,
          visitLog: [...existing, entry],
        },
      },
      'Attending visit logged',
    )
    setVisitDraft((v) => ({ ...v, notes: '' }))
  }

  async function addDayNote() {
    if (!id || !ticket || !dayNote.trim()) return
    const cf = (ticket.customFields as Record<string, unknown>) ?? {}
    const existing = Array.isArray(cf.dayNotes) ? (cf.dayNotes as Array<Record<string, unknown>>) : []
    const entry = {
      id: crypto.randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      at: new Date().toISOString(),
      note: dayNote.trim(),
      byUserId: authUser?.id ?? null,
      byName: authUser?.name ?? 'Engineer',
      day: existing.length + 1,
    }
    await patchTicket(
      {
        customFields: {
          ...cf,
          dayNotes: [...existing, entry],
        },
      },
      `Day ${entry.day} note saved`,
    )
    setDayNote('')
  }

  async function claimJob() {
    if (!id) return
    setBusy(true)
    try {
      const updated = await api.claimTicket(id)
      setTicket(updated)
      addToast({ type: 'success', message: 'Job accepted — assigned to you' })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not accept — maybe already taken',
      })
      try {
        const fresh = await api.getTicket(id)
        setTicket(fresh)
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false)
    }
  }

  async function assignAndStart(userId: string) {
    if (!userId || !id) return
    const prevId = ticket?.assignedToId ? String(ticket.assignedToId) : ''
    const prevName =
      users.find((u) => u.id === prevId)?.name ??
      (ticket?.assignee as { name?: string } | undefined)?.name ??
      'Unassigned'
    const nextName = users.find((u) => u.id === userId)?.name ?? 'engineer'
    setBusy(true)
    try {
      // WhatsApp assign notify off for now — assign + start directly
      const updated = await api.updateTicket(id, {
        assignedToId: userId,
        receivedByUserId: userId,
        status: 'IN_PROGRESS',
        sendWhatsApp: false,
      })
      setTicket((prev) => ({ ...(prev ?? {}), ...updated }))
      addToast({
        type: 'success',
        message:
          prevId && prevId !== userId
            ? `Reassigned ${prevName} → ${nextName}`
            : 'Engineer assigned — status In progress',
      })
      if (prevId && prevId !== userId) {
        try {
          await api.addTicketMessage(id, {
            content: `Reassigned from ${prevName} to ${nextName} by admin.`,
            isInternal: true,
          })
        } catch {
          /* non-blocking */
        }
      }
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not assign engineer',
      })
    } finally {
      setBusy(false)
    }
  }

  async function approveCompleted(sendWhatsApp = false) {
    if (!id) return
    const total = Math.max(num(ticket?.paymentTotal), Number(payDraft.paymentTotal) || 0)
    const adv = Math.max(num(ticket?.advanceAmount), Number(payDraft.advanceAmount) || 0)
    const free = total <= 0 && adv <= 0
    const paid = String(ticket?.paymentStatus ?? '') === 'PAID'
    if (!free && !paid) {
      focusFirstMissing(
        [
          {
            key: 'paymentTotal',
            sectionId: 'section-payment',
            ok: false,
            message: 'Mark paid first (Total payment → Advance → Balance, then Mark paid).',
          },
        ],
        setFieldErrors,
      )
      addToast({
        type: 'error',
        message: 'Missing — mark paid before approving & closing (scrolled to Payment).',
      })
      return
    }
    setBusy(true)
    try {
      const updated = await api.updateTicket(id, { status: 'CLOSED', sendWhatsApp })
      if (sendWhatsApp) handleWhatsappResult(updated.whatsapp, 'complete')
      setTicket((prev) => ({ ...(prev ?? {}), ...updated }))
      addToast({
        type: 'success',
        message: 'Ticket closed — fill the service report (spare parts go on the customer machine)',
      })
      setServiceReportAfterClose(true)
      setServiceReportOpen(true)
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not close ticket',
      })
    } finally {
      setBusy(false)
    }
  }

  function openServiceReport() {
    setServiceReportAfterClose(false)
    setServiceReportOpen(true)
  }

  function finishServiceReport() {
    setServiceReportOpen(false)
    const continueAfter = serviceReportAfterClose
    setServiceReportAfterClose(false)
    if (!continueAfter) {
      void load({ silent: true })
      return
    }
    const contactId = ticket?.contactId ? String(ticket.contactId) : ''
    const assetId = ticket?.assetId ? String(ticket.assetId) : ''
    // Admin/manager can continue to service invoice; desk stays on ticket / contact
    if (isAdmin && id) {
      const params = new URLSearchParams({
        open: 'create',
        type: 'service',
        ticketId: String(id),
      })
      if (contactId) params.set('contactId', contactId)
      navigate(`/erp/invoices?${params.toString()}`)
      return
    }
    if (contactId) {
      const q = new URLSearchParams()
      q.set('tab', 'service')
      if (assetId) q.set('assetId', assetId)
      navigate(`/contacts/${contactId}?${q.toString()}`)
      return
    }
    void load()
  }

  const balancePreview = useMemo(() => {
    const pay = Number(payDraft.paymentTotal) || 0
    const adv = Number(payDraft.advanceAmount) || 0
    return Math.max(0, pay - adv)
  }, [payDraft.paymentTotal, payDraft.advanceAmount])

  async function savePaymentDraft() {
    if (!id) return
    if (String(ticket?.paymentStatus ?? '') === 'PAID') {
      addToast({ type: 'error', message: 'Payment is already marked paid' })
      return
    }
    const total = Number(payDraft.paymentTotal) || 0
    const advance = Number(payDraft.advanceAmount) || 0
    if (advance > 0 && total <= 0) {
      addToast({
        type: 'error',
        message: 'Enter Total payment first (or clear Advance for a free ₹0 job)',
      })
      return
    }
    if (advance > total) {
      addToast({ type: 'error', message: 'Advance cannot be more than total payment' })
      return
    }
    await patchTicket(
      {
        paymentTotal: total,
        advanceAmount: advance,
        paymentMethod: (payDraft.paymentMethod || 'CASH') as
          | 'CASH'
          | 'UPI'
          | 'NEFT'
          | 'RTGS'
          | 'CHEQUE'
          | 'CARD'
          | 'OTHER',
        paymentReference: payDraft.paymentReference.trim() || null,
        paymentProofUrl: payDraft.paymentProofUrl.trim() || null,
      },
      'Payment updated',
    )
  }

  const visitLog = useMemo(() => {
    const ticketCf = (ticket?.customFields as Record<string, unknown>) ?? {}
    return Array.isArray(ticketCf.visitLog) ? (ticketCf.visitLog as Array<Record<string, unknown>>) : []
  }, [ticket])

  const dayNotes = useMemo(() => {
    const ticketCf = (ticket?.customFields as Record<string, unknown>) ?? {}
    return Array.isArray(ticketCf.dayNotes) ? (ticketCf.dayNotes as Array<Record<string, unknown>>) : []
  }, [ticket])

  const progressTimeline = useMemo(() => {
    if (!ticket) return [] as Array<{ at: string; title: string; detail?: string; tone: string }>
    const items: Array<{ at: string; title: string; detail?: string; tone: string }> = []
    items.push({
      at: String(ticket.createdAt ?? ''),
      title: 'Ticket created',
      detail: String(ticket.subject ?? ''),
      tone: 'blue',
    })
    if (ticket.assignedToId) {
      const name =
        users.find((u) => u.id === String(ticket.assignedToId))?.name ??
        (ticket.assignee as { name?: string } | undefined)?.name ??
        'Engineer'
      items.push({
        at: String(ticket.updatedAt ?? ticket.createdAt ?? ''),
        title: 'Engineer assigned',
        detail: name,
        tone: 'purple',
      })
    }
    for (const n of dayNotes) {
      items.push({
        at: String(n.at ?? n.createdAt ?? (n.date ? `${String(n.date)}T12:00:00.000Z` : '')),
        title: `Day ${String(n.day ?? '')} note`,
        detail: String(n.note ?? n.text ?? '').slice(0, 160),
        tone: 'amber',
      })
    }
    for (const v of visitLog) {
      items.push({
        at: String(v.attendedAt ?? v.at ?? ''),
        title: 'Visit logged',
        detail: String(v.notes ?? '').slice(0, 160),
        tone: 'gray',
      })
    }
    if (ticket.resolvedAt || String(ticket.status) === 'RESOLVED' || String(ticket.status) === 'CLOSED') {
      items.push({
        at: String(ticket.resolvedAt ?? ticket.updatedAt ?? ''),
        title: 'Marked complete (pending approval)',
        detail: 'Waiting for admin approval',
        tone: 'amber',
      })
    }
    if (ticket.closedAt || String(ticket.status) === 'CLOSED') {
      items.push({
        at: String(ticket.closedAt ?? ''),
        title: 'Approved & closed',
        detail: 'Job sheet and invoice available',
        tone: 'green',
      })
    }
    return items.filter((i) => i.at).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [ticket, dayNotes, visitLog, users])

  const openDurationLabel = useMemo(() => {
    if (!ticket?.createdAt) return null
    const start = new Date(String(ticket.createdAt)).getTime()
    const end = ticket.closedAt
      ? new Date(String(ticket.closedAt)).getTime()
      : ticket.resolvedAt
        ? new Date(String(ticket.resolvedAt)).getTime()
        : Date.now()
    const hours = Math.max(0, Math.round((end - start) / 3600_000))
    if (hours < 24) return `${hours}h open`
    return `${Math.round(hours / 24)}d ${hours % 24}h open`
  }, [ticket])

  // Keep helpers referenced so noUnusedLocals does not strip future UI wiring
  void uploadFieldPhoto
  void uploadSignature
  void sendPaymentDue
  void addVisitEntry

  if (loading) return <DetailSkeleton />
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
  const contact = ticket.contact as {
    id: string
    name: string
    phone?: string | null
    customerCode?: string | null
  } | null | undefined
  const asset = ticket.asset as Record<string, unknown> | null | undefined
  const assetCf = (asset?.customFields as Record<string, unknown> | undefined) ?? {}
  const status = String(ticket.status)
  const paymentStatus = String(ticket.paymentStatus ?? 'UNPAID')
  const isOpen = ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(status)
  const isDone = status === 'RESOLVED' || status === 'CLOSED'
  const isPaid = paymentStatus === 'PAID'
  /**
   * Mark paid: desk/admin always; assigned engineer can mark paid on their job
   * so payment can settle before Mark complete.
   */
  const showPaymentAdminTools =
    showApprove ||
    (isEngineer &&
      Boolean(ticket.assignedToId) &&
      String(ticket.assignedToId) === String(authUser?.id ?? ''))
  /** Payment is editable as soon as the ticket exists — assignment not required */
  const canEditPayment = showPayment && !isPaid
  const canDownloadDocs = isDone || isPaid
  const breached = Boolean(ticket.slaBreached)
  const ticketLabel = formatServiceId(ticket.ticketNo != null ? String(ticket.ticketNo) : undefined)
  const assigneeName =
    users.find((u) => u.id === String(ticket.assignedToId ?? ''))?.name ??
    (ticket.assignee as { name?: string } | undefined)?.name ??
    null

  const outsideMachine = isThirdPartyOrigin(asset?.origin ? String(asset.origin) : null)
  const isStampingJob =
    String(cf.category ?? '') === 'Stamping' ||
    String(cf.workType ?? '') === 'Stamping' ||
    String(cf.visitPurpose ?? '') === 'STAMPING'
  const cameOnlyForStamping = Boolean(cf.cameOnlyForStamping) || outsideMachine
  const waitingAssign = status === 'OPEN' && !ticket.assignedToId
  const workType = String(cf.workType ?? '')
  const hasServiceReport = Boolean(
    cf.serviceReport && typeof cf.serviceReport === 'object',
  )
  const hasInvoice = Boolean(ticket.serviceInvoiceId)
  const nextAction = (() => {
    if (isDesk && !isAdmin) {
      if (isStampingJob && (waitingAssign || (status === 'OPEN' && !ticket.assignedToId))) {
        return 'Stamping walk-in — click Take & start, then after verification enter stamp date + next due and Mark complete.'
      }
      if (waitingAssign || (status === 'OPEN' && !ticket.assignedToId)) {
        return 'Job is in the OPEN pool — first engineer to Accept gets it. Admin can assign later if needed.'
      }
      if (isStampingJob && (status === 'IN_PROGRESS' || status === 'PENDING')) {
        return stampResultSaved
          ? isPaid || (num(ticket.paymentTotal) <= 0 && num(ticket.advanceAmount) <= 0)
            ? 'Stamp + payment ready — Mark complete at the top, then Approve & close.'
            : 'Stamp saved — Mark paid fully (or leave ₹0 free), then Mark complete.'
          : 'Enter stamping date + next due, then Save stamp result — Mark complete unlocks after save.'
      }
      if (status === 'IN_PROGRESS' || status === 'PENDING') {
        return isPaid || (num(ticket.paymentTotal) <= 0 && num(ticket.advanceAmount) <= 0)
          ? 'Payment settled — Mark complete when work is done, then Approve & close.'
          : 'Collect payment and Mark paid fully (full amount) before Mark complete.'
      }
      if (status === 'RESOLVED') {
        return 'Payment already required before complete — Approve & close to finish and open the service report.'
      }
      if (status === 'CLOSED') {
        return hasInvoice
          ? 'Service complete — invoice linked.'
          : 'Closed. Raise service proforma from admin ERP if needed.'
      }
      return 'Track the job — Mark complete, collect payment, and close when ready.'
    }
    if (isEngineer) {
      if (status === 'OPEN' && ticket.assignedToId) return 'Click Start, then add day notes and spare parts as you work.'
      if (status === 'IN_PROGRESS' || status === 'PENDING') {
        if (!dayNotes.length && !isStampingJob) {
          return 'Required: add today’s Day note (Step 4) — Mark complete stays locked until then.'
        }
        return isPaid || (num(ticket.paymentTotal) <= 0 && num(ticket.advanceAmount) <= 0)
          ? 'Payment settled — Mark complete when work is done.'
          : 'Mark paid fully (full amount) — or leave ₹0 free — then Mark complete.'
      }
      if (status === 'RESOLVED') return 'Waiting for desk/admin to Approve & close the job.'
      if (status === 'CLOSED') return 'Job closed. Desk or admin will raise the service invoice if needed.'
      return 'Review customer history, then start work when ready.'
    }
    if (status === 'OPEN' && !ticket.assignedToId) {
      return 'OPEN pool — first engineer to Accept gets the job. You can assign manually if needed.'
    }
    if (status === 'RESOLVED') {
      return 'Approve & close to finish — payment was confirmed before Mark complete.'
    }
    if (status === 'CLOSED' && !hasInvoice) {
      return 'Step 6 — Create the service proforma (prefilled from this ticket).'
    }
    if (status === 'CLOSED') return 'Service complete — invoice linked. Download job sheet if needed.'
    if (status === 'IN_PROGRESS' || status === 'PENDING') {
      return isPaid || (num(ticket.paymentTotal) <= 0 && num(ticket.advanceAmount) <= 0)
        ? 'Payment settled — Mark complete when work is done, then Approve & close.'
        : 'Collect payment and Mark paid fully before Mark complete, then Approve & close.'
    }
    return 'Monitor progress and reassign if needed.'
  })()

  const machineRows: Array<{ label: string; value: string }> = [
    { label: 'Machine name', value: asset?.name ? String(asset.name) : '—' },
    { label: 'Type', value: asset?.machineType ? labelize(String(asset.machineType)) : '—' },
    { label: 'Model', value: asset?.model ? String(asset.model) : '—' },
    { label: 'Serial no.', value: asset?.serialNo ? String(asset.serialNo) : '—' },
    { label: 'Capacity', value: asset?.capacity ? String(asset.capacity) : '—' },
    { label: 'Accuracy', value: asset?.accuracy ? String(asset.accuracy) : '—' },
    { label: 'Platform size', value: asset?.platformSize ? String(asset.platformSize) : '—' },
    {
      label: 'Origin',
      value: asset?.origin ? (outsideMachine ? 'Outside / repair' : 'Sold by us') : '—',
    },
    // Coverage for machines sold by us — GC / NGC / AMC
    ...(!outsideMachine
      ? [
          {
            label: 'Coverage',
            value: asset?.servicePlan
              ? coverageChargeHints({
                  servicePlan: String(asset.servicePlan),
                  warrantyEndDate: asset.warrantyEndDate ? String(asset.warrantyEndDate) : null,
                  amcEndDate: asset.amcEndDate ? String(asset.amcEndDate) : null,
                }).label
              : '—',
          },
          {
            label: 'Charge rule',
            value: asset?.servicePlan
              ? coverageChargeHints({
                  servicePlan: String(asset.servicePlan),
                  warrantyEndDate: asset.warrantyEndDate ? String(asset.warrantyEndDate) : null,
                  amcEndDate: asset.amcEndDate ? String(asset.amcEndDate) : null,
                }).summary
              : '—',
          },
          {
            label: 'Coverage dates',
            value:
              asset?.servicePlan === 'AMC'
                ? [
                    asset.amcStartDate ? formatDate(String(asset.amcStartDate)) : null,
                    asset.amcEndDate ? formatDate(String(asset.amcEndDate)) : null,
                  ]
                    .filter(Boolean)
                    .join(' → ') || '—'
                : asset?.servicePlan === 'GC' && asset.warrantyEndDate
                  ? `GC until ${formatDate(String(asset.warrantyEndDate))}`
                  : '—',
          },
        ]
      : []),
    {
      label: 'Last stamp date',
      value: asset?.stampingDate
        ? formatDate(String(asset.stampingDate))
        : ticket.stampingDate
          ? formatDate(String(ticket.stampingDate))
          : '—',
    },
    {
      label: 'Stamping valid till',
      value: asset?.nextDueDate
        ? formatDate(String(asset.nextDueDate))
        : ticket.nextDueDate
          ? formatDate(String(ticket.nextDueDate))
          : '—',
    },
    {
      label: 'Warranty',
      value: assetCf.warrantyType
        ? `${String(assetCf.warrantyType)}${assetCf.warrantyUntil ? ` until ${formatDate(String(assetCf.warrantyUntil))}` : ''}`
        : '—',
    },
  ]

  const ticketOverview = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => navigate('/tickets')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
              {ticketLabel}
            </h1>
            <TicketStatusPill status={status} />
            {showPayment ? (
              <Badge color={isPaid ? 'green' : paymentStatus === 'PARTIAL' ? 'amber' : 'gray'}>
                {labelize(paymentStatus)}
              </Badge>
            ) : null}
            {breached ? <Badge color="red">SLA overdue</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-text-secondary">
            {String(ticket.subject)}
            {contact?.name ? ` · ${contact.name}` : ''}
          </p>
          <p className="mt-0.5 text-[11px] text-text-secondary">
            Created{' '}
            <span className="font-medium text-text-primary">
              {ticket.createdAt ? formatDate(String(ticket.createdAt)) : '—'}
            </span>
            {status === 'CLOSED' || ticket.closedAt ? (
              <>
                {' · '}Closed{' '}
                <span className="font-medium text-text-primary">
                  {ticket.closedAt ? formatDate(String(ticket.closedAt)) : '—'}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
          {(isDesk || isAdmin) && (
            <Link to="/tickets?open=1">
              <Button variant="outline">New ticket</Button>
            </Link>
          )}
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-secondary">Status</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <TicketStatusPill status={status} />
              {workType ? (
                <span className="text-xs text-text-secondary">{workType}</span>
              ) : null}
            </div>
          </div>
          <div className="min-w-0 text-right text-sm text-text-secondary">
            <div className="text-xs text-text-secondary">Engineer</div>
            <div className="mt-0.5 font-medium text-text-primary">
              {waitingAssign ? 'Open pool — first Accept' : (assigneeName ?? '—')}
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-2 py-2.5">
          <FlowStepBar
            steps={[
              { key: 'open', label: 'OPEN', hint: 'In pool' },
              { key: 'accept', label: 'Accepted', hint: waitingAssign ? 'First wins' : 'Claimed' },
              { key: 'work', label: 'In progress', hint: 'On site' },
              { key: 'resolved', label: 'Complete', hint: 'Await close' },
              { key: 'closed', label: 'Closed', hint: 'Done' },
            ]}
            doneFlags={[
              true,
              Boolean(ticket.assignedToId) || status !== 'OPEN',
              status === 'IN_PROGRESS' ||
                status === 'PENDING' ||
                status === 'RESOLVED' ||
                status === 'CLOSED',
              status === 'RESOLVED' || status === 'CLOSED',
              status === 'CLOSED',
            ]}
          />
        </div>
        <p className="mt-3 border-t border-border pt-3 text-sm text-text-primary">{nextAction}</p>
        {waitingAssign && isEngineer ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void claimJob()}>
              Accept this job
            </Button>
            <span className="text-xs text-text-secondary">
              First engineer to Accept owns the job.
            </span>
          </div>
        ) : null}
      </Card>

      {isStampingJob ? (
        <Card className="border-violet-200/80 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
            Stamping visit
          </div>
          <p className="mt-1 text-sm text-text-primary">
            {cameOnlyForStamping || outsideMachine
              ? 'Outside machine — customer came only for stamping / verification (not an HMS sale unit).'
              : 'Sold by us — renewal / re-stamp on an HMS machine.'}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Desk can Take &amp; start (or assign an engineer). After verification, enter stamp date +
            next due / valid till, then Mark complete — machine register updates automatically.
            {!outsideMachine && asset?.nextDueDate
              ? ` Current valid till on file: ${formatDate(String(asset.nextDueDate))}.`
              : ''}
          </p>
        </Card>
      ) : null}

      <TicketDetailGroup
        title="Customer & machine"
        hint="Who the job is for · which unit"
        defaultOpen
      >
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-surface/70 px-4 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Customer</h2>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {contact ? (
                <>
                  <div className="sm:col-span-2">
                    <Link
                      to={`/contacts/${contact.id}`}
                      className="text-base font-semibold text-accent-blue hover:underline"
                    >
                      {contact.customerCode ? (
                        <span className="mr-1.5 font-mono text-xs text-text-secondary">{contact.customerCode}</span>
                      ) : null}
                      {contact.name}
                    </Link>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Phone</div>
                    {contact.phone ? (
                      <a
                        href={`tel:${String(contact.phone).replace(/\D/g, '')}`}
                        className="mt-0.5 inline-flex items-center gap-2 text-sm text-text-primary"
                      >
                        <Phone size={14} className="text-text-secondary" />
                        {formatPhone(String(contact.phone))}
                      </a>
                    ) : (
                      <p className="mt-0.5 text-sm text-text-secondary">—</p>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Channel</div>
                    <p className="mt-0.5 text-sm text-text-primary">
                      {cf.channel ? String(cf.channel) : '—'}
                      {cf.category ? ` · ${String(cf.category)}` : ''}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-secondary">No customer linked</p>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/70 px-4 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Machine details</h2>
              <div className="flex flex-wrap gap-1.5">
                {asset?.origin ? (
                  <Badge color={outsideMachine ? 'amber' : 'blue'}>
                    {assetOriginShort(String(asset.origin))}
                  </Badge>
                ) : null}
                {!outsideMachine && asset?.servicePlan ? (
                  <Badge
                    color={
                      coverageChargeHints({
                        servicePlan: String(asset.servicePlan),
                        warrantyEndDate: asset.warrantyEndDate
                          ? String(asset.warrantyEndDate)
                          : null,
                        amcEndDate: asset.amcEndDate ? String(asset.amcEndDate) : null,
                      }).serviceFree
                        ? 'green'
                        : 'gray'
                    }
                  >
                    {
                      coverageChargeHints({
                        servicePlan: String(asset.servicePlan),
                        warrantyEndDate: asset.warrantyEndDate
                          ? String(asset.warrantyEndDate)
                          : null,
                        amcEndDate: asset.amcEndDate ? String(asset.amcEndDate) : null,
                      }).label
                    }
                  </Badge>
                ) : null}
              </div>
            </div>
            {asset ? (
              <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                {machineRows.map((row) => (
                  <div key={row.label} className="bg-card px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      {row.label}
                    </div>
                    <div className="mt-0.5 break-words text-sm font-medium text-text-primary">{row.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-4 text-sm text-text-secondary">No machine linked to this ticket.</p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-start gap-3">
              <CalendarClock size={18} className="mt-0.5 shrink-0 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Timing
                </div>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] text-text-secondary">SLA due</div>
                    <div className={`text-sm font-medium text-text-primary ${breached ? 'text-accent-red' : ''}`}>
                      {ticket.slaDueAt ? formatDateTime(String(ticket.slaDueAt)) : '—'}
                      {breached ? ' · overdue' : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-secondary">Stamping / next due</div>
                    <div className="text-sm font-medium text-text-primary">
                      {ticket.stampingDate || asset?.stampingDate
                        ? formatDate(String(ticket.stampingDate || asset?.stampingDate))
                        : '—'}
                      {ticket.nextDueDate || asset?.nextDueDate
                        ? ` → ${formatDate(String(ticket.nextDueDate || asset?.nextDueDate))}`
                        : ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {isDesk && !isAdmin ? (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-2 xl:col-span-1">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Issue
              </h2>
              <span className="text-[11px] text-text-secondary">What was reported</span>
            </div>
            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Issue log</h2>
                  <p className="text-xs text-text-secondary">Customer complaint / what was reported</p>
                </div>
                <Button disabled={busy} onClick={() => void saveTicketDetails()}>
                  Save
                </Button>
              </div>
              <div className="mb-3 rounded-[8px] border border-border bg-surface px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Subject</div>
                <div className="mt-0.5 text-sm font-medium text-text-primary">{String(ticket.subject)}</div>
              </div>
              <textarea
                className="min-h-[220px] w-full rounded-[10px] border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                value={editDraft.description}
                onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                placeholder="Describe the issue clearly for the engineer…"
              />
            </Card>

            <AiAssistCard
              title="Ticket AI"
              subtitle="Suggest only — never auto-assigns, completes, or marks paid."
              actions={[
                {
                  id: 'triage',
                  label: 'Suggest priority / category',
                  run: () =>
                    api.aiTicketAssist({
                      action: 'triage',
                      ticketId: id,
                      text: editDraft.description || String(ticket?.description ?? ''),
                      contactId: ticket?.contactId ? String(ticket.contactId) : undefined,
                    }),
                },
                {
                  id: 'draft_summary',
                  label: 'Draft summary',
                  run: () =>
                    api.aiTicketAssist({
                      action: 'draft_summary',
                      ticketId: id,
                      text: editDraft.description || String(ticket?.description ?? ''),
                    }),
                },
                {
                  id: 'whatsapp_draft',
                  label: 'Draft WhatsApp',
                  run: () =>
                    api.aiTicketAssist({
                      action: 'whatsapp_draft',
                      ticketId: id,
                      text: visitDraft.notes || editDraft.description,
                    }),
                },
                {
                  id: 'sla_risk',
                  label: 'SLA risk one-liner',
                  run: () => api.aiTicketAssist({ action: 'sla_risk', ticketId: id }),
                },
              ]}
              onApply={(actionId, result) => {
                if (actionId === 'triage') {
                  if (typeof result.priority === 'string') {
                    void patchTicket({ priority: String(result.priority) }, 'Priority suggested by AI')
                  }
                  if (typeof result.category === 'string') {
                    setEditDraft((d) => ({ ...d, category: String(result.category) }))
                  }
                  if (typeof result.summary === 'string') {
                    setEditDraft((d) => ({
                      ...d,
                      description: String(result.summary),
                      subject: typeof result.subject === 'string' ? String(result.subject) : d.subject,
                    }))
                  }
                }
                if (actionId === 'draft_summary' && typeof result.summary === 'string') {
                  setEditDraft((d) => ({
                    ...d,
                    description: String(result.summary),
                    subject: typeof result.subject === 'string' ? String(result.subject) : d.subject,
                  }))
                }
                if (actionId === 'whatsapp_draft' && typeof result.message === 'string') {
                  setMessage(String(result.message))
                }
              }}
            />

            <Card className="overflow-hidden p-0">
              <div className="border-b border-border bg-surface/70 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-text-primary">Team notes</h2>
                <p className="text-xs text-text-secondary">Internal only — not sent to customer</p>
              </div>
              {messages.length === 0 ? (
                <p className="px-4 py-3 text-sm text-text-secondary">No notes yet.</p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto px-4 py-3">
                  {messages.map((m) => (
                    <li key={String(m.id)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <div className="mb-1 flex justify-between gap-2 text-xs text-text-secondary">
                        <span className="font-medium text-text-primary">{String(m.authorName)}</span>
                        <span>{m.createdAt ? formatDateTime(String(m.createdAt)) : ''}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{String(m.content)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-border p-4">
                <textarea
                  className="min-h-[72px] w-full rounded-[8px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  placeholder="Quick note for admin / engineer…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendMessage()
                  }}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-text-secondary">Ctrl+Enter</span>
                  <Button size="sm" disabled={!message.trim()} onClick={() => void sendMessage()}>
                    Send note
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Issue
              </h2>
              <span className="text-[11px] text-text-secondary">What was reported</span>
            </div>
            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Issue log</h2>
                  <p className="text-xs text-text-secondary">Customer complaint / what was reported</p>
                </div>
                <Button disabled={busy} onClick={() => void saveTicketDetails()}>
                  Save
                </Button>
              </div>
              <Input
                label="Subject"
                value={editDraft.subject}
                onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })}
                className="mb-3"
              />
              <textarea
                className="min-h-[180px] w-full rounded-[10px] border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                value={editDraft.description}
                onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                placeholder="Describe the issue clearly…"
              />
            </Card>
          </div>
        )}
      </div>
      </TicketDetailGroup>
    </>
  )

  const ticketDialogs = (
    <>
      <Modal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title={completeStatus === 'CLOSED' ? 'Close service ticket?' : 'Mark complete?'}
        subtitle={`${ticketLabel} — ${String(ticket.subject)}`}
        size="sm"
        accent="emerald"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void confirmComplete()} disabled={busy}>
              <CheckCircle2 size={16} />
              {busy ? 'Saving…' : completeStatus === 'CLOSED' ? 'Close ticket' : 'Confirm mark complete'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          {completeStatus === 'RESOLVED' && isEngineer
            ? 'Confirm: service is done. This sends the job for desk/admin Approve & close. Continue?'
            : completeStatus === 'CLOSED'
              ? 'Final close: locks this ticket as Closed, then opens the service report. This cannot be undone from here. Continue?'
              : 'Confirm: mark this job complete. Desk/admin can then Approve & close. Continue?'}
        </p>
        {(() => {
          const pay = paymentSettledForComplete()
          return (
            <div className="mt-3 rounded-[10px] border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30">
              <div className="font-medium text-text-primary">
                {pay.free
                  ? 'Payment — free job (₹0)'
                  : `Payment confirmed — paid in full ${formatCurrency(pay.total)}`}
              </div>
              {!pay.free ? (
                <div className="mt-0.5 text-xs text-text-secondary">
                  Advance {formatCurrency(pay.adv)} · balance {formatCurrency(0)}
                  {ticket.paymentMethod
                    ? ` · ${labelize(String(ticket.paymentMethod))}`
                    : ''}
                </div>
              ) : null}
            </div>
          )
        })()}
        {contact ? (
          <div className="mt-3 rounded-[10px] border border-border bg-surface px-3 py-3 text-sm">
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

      <WhatsAppSendConfirm
        open={Boolean(waPending)}
        payload={waPending?.payload ?? null}
        busy={busy}
        onCancel={() => setWaPending(null)}
        onConfirmSend={() => {
          const run = waPending?.execute
          setWaPending(null)
          if (run) void run(true)
        }}
        onConfirmSkip={() => {
          const run = waPending?.execute
          setWaPending(null)
          if (run) void run(false)
        }}
      />

      <ServiceReportModal
        open={serviceReportOpen}
        ticket={ticket as ServiceReportTicket | null}
        onClose={() => finishServiceReport()}
        onSaved={() => finishServiceReport()}
      />
    </>
  )

  // Field engineer — full width, Mark complete on top, full ticket details
  if (isEngineer && !isAdmin) {
    const payReady = paymentSettledForComplete().ok
    const canMarkComplete = isStampingJob
      ? stampResultSaved && Boolean(editDraft.stampingDate.trim()) && payReady
      : dayNotes.length > 0 && payReady
    const markCompleteHint =
      isStampingJob && !stampResultSaved
        ? 'Save stamp result below first — then Mark complete unlocks here'
        : !isStampingJob && dayNotes.length === 0
          ? 'Enter at least one daily tracking note (Step 4) before marking complete'
          : !payReady
            ? 'Payment missing — Mark paid fully (full amount) before Mark complete'
            : 'Mark complete when ready'

    const markCompleteBtn = (
      <span
        className="inline-flex"
        title={!canMarkComplete ? markCompleteHint : undefined}
      >
        <Button
          disabled={busy || !canMarkComplete}
          onClick={() => askComplete('RESOLVED')}
        >
          <CheckCircle2 size={16} /> Mark complete
        </Button>
      </span>
    )

    const startBtn = status === 'OPEN' ? (
      <Button
        variant={fieldShell ? 'primary' : 'outline'}
        disabled={busy}
        className={fieldShell ? 'min-h-12 w-full text-base' : undefined}
        onClick={() =>
          setWaPending({
            payload: {
              title: 'Start work & WhatsApp customer?',
              lines: ['Template ticket_status_update → customer (In progress)'],
            },
            execute: (send) =>
              patchTicket(
                {
                  status: 'IN_PROGRESS',
                  sendWhatsApp: send,
                  whatsappNote: 'Engineer started work',
                },
                'Work started',
              ),
          })
        }
      >
        <Play size={18} /> Start work
      </Button>
    ) : null

    const fieldMarkComplete = (
      <span
        className={cn('inline-flex', fieldShell && 'w-full')}
        title={!canMarkComplete ? markCompleteHint : undefined}
      >
        <Button
          disabled={busy || !canMarkComplete}
          onClick={() => askComplete('RESOLVED')}
          className={fieldShell ? 'min-h-12 w-full text-base' : undefined}
        >
          <CheckCircle2 size={18} /> Mark complete
        </Button>
      </span>
    )

    return (
      <div className={cn('w-full space-y-4', fieldShell && 'pb-28')}>
        {fieldShell && isOpen ? (
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-card/95 px-3 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur md:hidden">
            <p className="mb-2 line-clamp-1 text-xs text-text-secondary">
              {waitingAssign
                ? 'Accept this job to start'
                : status === 'OPEN'
                  ? 'Tap Start work, then add a day note'
                  : !canMarkComplete
                    ? isStampingJob && !stampResultSaved
                      ? 'Save stamp result to unlock Mark complete'
                      : !payReady
                        ? 'Payment missing — Mark paid fully first'
                        : 'Add a day note to unlock Mark complete'
                    : nextAction}
            </p>
            <div className="flex flex-col gap-2">
              {waitingAssign ? (
                <Button
                  disabled={busy}
                  className="min-h-12 w-full text-base"
                  onClick={() => void claimJob()}
                >
                  Accept this job
                </Button>
              ) : null}
              {/* OPEN → must Start first; Mark complete only after IN_PROGRESS / PENDING */}
              {!waitingAssign && status === 'OPEN' ? startBtn : null}
              {!waitingAssign && status !== 'OPEN' ? fieldMarkComplete : null}
            </div>
          </div>
        ) : null}

        {isOpen && !fieldShell ? (
          <Card className="border-accent-blue/40 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Your actions
                </div>
                <p className="mt-0.5 text-sm text-text-primary">
                  {status === 'OPEN'
                    ? 'Tap Start work first, then continue the job steps.'
                    : !canMarkComplete
                      ? isStampingJob && !stampResultSaved
                        ? 'Fill stamp dates below, Save stamp result — then Mark complete unlocks here.'
                        : !payReady
                          ? 'Payment missing — Mark paid fully before Mark complete.'
                          : 'Step 4 — add a daily tracking note, then Mark complete unlocks.'
                      : nextAction}
                </p>
                {!canMarkComplete ? (
                  <button
                    type="button"
                    className="mt-1 text-xs font-medium text-accent-blue hover:underline"
                    onClick={() =>
                      document
                        .getElementById(
                          isStampingJob && !stampResultSaved
                            ? 'section-stamp-result'
                            : !payReady
                              ? 'section-payment'
                              : 'section-day-notes',
                        )
                        ?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                    }
                  >
                    {isStampingJob && !stampResultSaved
                      ? 'Go to stamp result →'
                      : !payReady
                        ? 'Go to payment →'
                        : 'Go to daily tracking →'}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {status === 'OPEN' ? startBtn : null}
                {status !== 'OPEN' ? markCompleteBtn : null}
              </div>
            </div>
          </Card>
        ) : null}

        {isOpen && fieldShell ? (
          <Card className="border-accent-blue/30 p-3">
            <p className="text-sm text-text-primary">
              {!canMarkComplete
                ? waitingAssign
                  ? 'Accept from the bar below, then Start and continue the job.'
                  : isStampingJob && !stampResultSaved
                    ? 'Fill stamp dates, Save stamp result — then Mark complete unlocks at the top.'
                    : !payReady
                      ? 'Payment missing — Mark paid fully (full amount) before Mark complete.'
                      : 'Step 4 — add a daily tracking note, then Mark complete unlocks.'
                  : nextAction}
            </p>
            {!canMarkComplete && !waitingAssign ? (
              <button
                type="button"
                className="mt-1 text-xs font-medium text-accent-blue hover:underline"
                onClick={() =>
                  document
                    .getElementById(
                      isStampingJob && !stampResultSaved
                        ? 'section-stamp-result'
                        : !payReady
                          ? 'section-payment'
                          : 'section-day-notes',
                    )
                    ?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    })
                }
              >
                {isStampingJob && !stampResultSaved
                  ? 'Go to stamp result →'
                  : !payReady
                    ? 'Go to payment →'
                    : 'Go to daily tracking →'}
              </button>
            ) : null}
          </Card>
        ) : null}

        {!isOpen ? (
          <Card className="border-emerald-300/50 bg-emerald-50/40 p-4 dark:border-emerald-800/40 dark:bg-emerald-950/25">
            <div className="font-semibold text-text-primary">
              {status === 'RESOLVED' ? 'Waiting for admin approval' : 'Job closed'}
            </div>
            <p className="mt-0.5 text-sm text-text-secondary">
              {status === 'RESOLVED'
                ? 'You marked this complete. Admin will collect payment and close.'
                : 'This ticket is closed. Open My tickets for the next job.'}
            </p>
            {fieldShell ? (
              <Link to="/workqueue" className="mt-3 inline-flex">
                <Button className="min-h-11">Back to queue</Button>
              </Link>
            ) : null}
          </Card>
        ) : null}

        {ticketOverview}

        {isStampingJob && isOpen ? (
          <Card
            id="section-stamp-result"
            className="scroll-mt-24 border-2 border-violet-400/60 bg-violet-50/40 p-4 sm:p-5 dark:border-violet-700/50 dark:bg-violet-950/20"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge color="purple">Stamping result</Badge>
              <h2 className="text-base font-semibold text-text-primary">
                Stamp date · next due · quarter
              </h2>
              {cf.alsoSpareParts ? <Badge color="amber">Also spare parts</Badge> : null}
            </div>
            {cameOnlyForStamping || outsideMachine ? (
              <p className="mb-3 rounded-[8px] border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                <strong>Outside machine</strong> — customer came only for stamping / verification. Enter
                the stamp date HMS completed today; next due usually +1 year.
              </p>
            ) : (
              <p className="mb-3 text-sm text-text-secondary">
                Sold-by-us renewal. Previous valid till:{' '}
                <strong>
                  {asset?.nextDueDate ? formatDate(String(asset.nextDueDate)) : 'not on file'}
                </strong>
                . Enter the new stamp date after verification.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="Stamping date *"
                type="date"
                value={editDraft.stampingDate}
                onChange={(e) => {
                  const stampingDate = e.target.value
                  touchStampDraft((d) => ({
                    ...d,
                    stampingDate,
                    nextDueDate: stampingDate ? addOneYearIso(stampingDate) : '',
                  }))
                }}
              />
              <Input
                label="Next due / valid till *"
                type="date"
                value={editDraft.nextDueDate}
                onChange={(e) => touchStampDraft({ nextDueDate: e.target.value })}
              />
              <Input
                label="VC number"
                value={editDraft.vcNumber}
                onChange={(e) => touchStampDraft({ vcNumber: e.target.value })}
              />
              <Input
                label="Plate no."
                value={editDraft.plateNo}
                onChange={(e) => touchStampDraft({ plateNo: e.target.value })}
              />
              <Select
                label="Stamping quarter"
                value={editDraft.stampingQuarter}
                onChange={(e) => touchStampDraft({ stampingQuarter: e.target.value })}
                options={[
                  { value: '', label: '—' },
                  { value: 'A', label: 'Quarter A · Jan–Mar' },
                  { value: 'B', label: 'Quarter B · Apr–Jun' },
                  { value: 'C', label: 'Quarter C · Jul–Sep' },
                  { value: 'D', label: 'Quarter D · Oct–Dec' },
                ]}
              />
              <Input
                label="Verification class"
                value={editDraft.verificationClass}
                onChange={(e) => touchStampDraft({ verificationClass: e.target.value })}
                placeholder="e.g. III"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-violet-200/70 pt-3 dark:border-violet-800/50">
              <Button
                disabled={busy || !editDraft.stampingDate.trim()}
                onClick={() => void saveStampResult()}
              >
                {busy ? 'Saving…' : stampResultSaved ? 'Saved ✓ — update & save' : 'Save stamp result'}
              </Button>
              {stampResultSaved ? (
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Saved — Mark complete is available at the top
                </span>
              ) : (
                <span className="text-xs text-text-secondary">
                  Fill dates, then Save — Mark complete unlocks after save
                </span>
              )}
            </div>
          </Card>
        ) : null}

        {isOpen ? (
          <Card id="section-work-type" className="scroll-mt-24 p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">Work type</h2>
            <Select
              label="What kind of service is this?"
              value={workType}
              onChange={(e) => {
                const next = e.target.value
                void patchTicket(
                  {
                    customFields: {
                      ...cf,
                      workType: next || null,
                    },
                  },
                  next ? `Work type: ${next}` : 'Work type cleared',
                )
              }}
              options={[
                { value: '', label: 'Select…' },
                { value: 'Calibration', label: 'Calibration' },
                { value: 'Repair', label: 'Repair' },
                { value: 'Spare replacement', label: 'Spare replacement' },
                { value: 'Stamping', label: 'Stamping / verification' },
                { value: 'Installation', label: 'Installation' },
                { value: 'Other', label: 'Other' },
              ]}
            />
            {workType === 'Spare replacement' ? (
              <p className="mt-2 text-xs text-text-secondary">
                Open Spare parts below to log replacements — charges roll into the job total.
              </p>
            ) : null}
          </Card>
        ) : null}

        <Card
          id="section-day-notes"
          className={`scroll-mt-24 border-2 p-4 sm:p-5 ${
            canMarkComplete
              ? 'border-emerald-400/70 bg-emerald-50/30 dark:border-emerald-700/50 dark:bg-emerald-950/20'
              : 'border-amber-400 bg-amber-50/50 shadow-[0_0_0_4px_rgba(251,191,36,0.15)] dark:border-amber-600 dark:bg-amber-950/30'
          }`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={canMarkComplete ? 'green' : 'amber'}>Step 4</Badge>
                <h2 className="text-base font-semibold text-text-primary">Daily tracking</h2>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {canMarkComplete
                  ? 'At least one day note is logged — Mark complete is unlocked.'
                  : 'Required — add today’s note before you can Mark complete. Admin sees these on the timeline.'}
              </p>
            </div>
            {dayNotes.length ? (
              <Badge color="blue">{dayNotes.length} day note(s)</Badge>
            ) : (
              <Badge color="amber">Required</Badge>
            )}
          </div>
          {dayNotes.length === 0 ? (
            <p className="mb-3 rounded-[8px] border border-dashed border-amber-300 bg-card/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:text-amber-100">
              No day notes yet. Write what you did on site (diagnosis, parts, waiting on customer…) and
              save.
            </p>
          ) : (
            <ul className="mb-4 space-y-2">
              {dayNotes.map((n) => (
                <li
                  key={String(n.id ?? `${n.day}-${n.at}`)}
                  className="rounded-[8px] border border-border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <Badge color="amber">Day {String(n.day ?? '—')}</Badge>
                    <span>{n.at ? formatDateTime(String(n.at)) : String(n.date ?? '')}</span>
                    {n.byName ? <span>· {String(n.byName)}</span> : null}
                  </div>
                  <p className="mt-1 text-text-primary">{String(n.note ?? '')}</p>
                </li>
              ))}
            </ul>
          )}
          {isOpen ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-sm">
                <span className="mb-1 block font-medium text-text-secondary">
                  Day {(dayNotes.length || 0) + 1} note *
                </span>
                <textarea
                  className="min-h-[88px] w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  value={dayNote}
                  onChange={(e) => setDayNote(e.target.value)}
                  placeholder="What did you do today? Parts ordered, findings, waiting on customer…"
                />
              </label>
              <Button
                disabled={busy || !dayNote.trim()}
                onClick={() => void addDayNote()}
                className="shrink-0"
              >
                Save day note
              </Button>
            </div>
          ) : null}
        </Card>

        {contact ? (
          <div id="section-spares" className="scroll-mt-24">
            <SparePartsPanel
              contactId={contact.id}
              contactName={contact.name}
              ticketId={id}
              fixedAssetId={ticket.assetId ? String(ticket.assetId) : undefined}
              fixedAssetLabel={
                asset
                  ? `${String(asset.name ?? 'Machine')}${
                      asset.serialNo ? ` · ${String(asset.serialNo)}` : ''
                    }`
                  : undefined
              }
              onTicketUpdated={() => void load()}
              collapsible
              defaultOpen={Boolean(cf.alsoSpareParts)}
              canEdit={isAdmin || isEngineer}
              defaultUnderWarranty={
                coverageChargeHints({
                  servicePlan: asset?.servicePlan ? String(asset.servicePlan) : null,
                  warrantyEndDate: asset?.warrantyEndDate
                    ? String(asset.warrantyEndDate)
                    : null,
                  amcEndDate: asset?.amcEndDate ? String(asset.amcEndDate) : null,
                }).underWarrantyDefault
              }
            />
            {cf.alsoSpareParts ? (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                This stamping visit was marked <strong>also spare parts</strong> — log changes here;
                payment stays on this ticket.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className={`grid gap-4 ${showPayment ? 'lg:grid-cols-2' : ''}`}>
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-surface/70 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-text-primary">Assignment</h2>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <div className="text-[10px] font-semibold uppercase text-text-secondary">Status</div>
                <div className="mt-0.5 text-sm font-medium">{labelize(status)}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-text-secondary">Priority</div>
                <div className="mt-0.5 text-sm font-medium">
                  {labelize(String(ticket.priority))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-text-secondary">
                  Assigned to
                </div>
                <div className="mt-0.5 text-sm font-medium">{assigneeName ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-text-secondary">SLA due</div>
                <div
                  className={`mt-0.5 text-sm font-medium ${breached ? 'text-accent-red' : ''}`}
                >
                  {ticket.slaDueAt ? formatDateTime(String(ticket.slaDueAt)) : '—'}
                  {breached ? ' · overdue' : ''}
                </div>
              </div>
            </div>
          </Card>

          {showPayment ? (
            <Card id="section-payment" className="scroll-mt-24 overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-border bg-surface/70 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-text-primary">Payment</h2>
                <Badge color={isPaid ? 'green' : paymentStatus === 'PARTIAL' ? 'amber' : 'gray'}>
                  {labelize(paymentStatus)}
                </Badge>
              </div>
              <div className="space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    label="Total payment ₹"
                    type="number"
                    value={payDraft.paymentTotal}
                    disabled={!canEditPayment || busy}
                    onChange={(e) => setPayDraft({ ...payDraft, paymentTotal: e.target.value })}
                  />
                  <Input
                    label="Advance ₹"
                    type="number"
                    value={payDraft.advanceAmount}
                    disabled={!canEditPayment || busy}
                    onChange={(e) => setPayDraft({ ...payDraft, advanceAmount: e.target.value })}
                  />
                  <div className="rounded-[8px] border border-border bg-surface px-3 py-2">
                    <div className="text-xs text-text-secondary">Balance (auto)</div>
                    <div className="text-lg font-bold text-accent-amber">
                      {formatCurrency(balancePreview)}
                    </div>
                  </div>
                </div>
                {canEditPayment ? (
                  <>
                    <Select
                      label="Payment method"
                      value={payDraft.paymentMethod}
                      onChange={(e) => setPayDraft({ ...payDraft, paymentMethod: e.target.value })}
                      options={[...PAYMENT_METHODS]}
                    />
                    <Input
                      label={
                        ONLINE_PAY.has(payDraft.paymentMethod)
                          ? 'UTR / txn ref'
                          : 'Reference (optional)'
                      }
                      value={payDraft.paymentReference}
                      onChange={(e) =>
                        setPayDraft({ ...payDraft, paymentReference: e.target.value })
                      }
                      placeholder={
                        ONLINE_PAY.has(payDraft.paymentMethod) ? 'UPI / bank UTR' : 'Cheque no. etc.'
                      }
                    />
                    <Button disabled={busy} onClick={() => void savePaymentDraft()}>
                      <Wallet size={16} /> Save payment
                    </Button>
                    <p className="text-xs text-text-secondary">
                      Charge / advance anytime — assign not required. Desk marks paid and closes.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-text-secondary">
                    Payment marked paid
                    {ticket.paymentMethod
                      ? ` via ${labelize(String(ticket.paymentMethod))}`
                      : ''}
                    .
                  </p>
                )}
              </div>
            </Card>
          ) : null}
        </div>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-text-primary">Team notes</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Internal only — not sent to the customer.
            </p>
          </div>
          {messages.length === 0 ? (
            <p className="px-4 py-2 text-xs text-text-secondary sm:px-5">No notes yet.</p>
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
            <textarea
              className="min-h-24 w-full resize-y rounded-[10px] border border-border bg-card px-3 py-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
              placeholder="Parts used, site access, note for admin…"
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

        {ticketDialogs}
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      {ticketOverview}

      {isStampingJob &&
      stampResultSaved &&
      (status === 'IN_PROGRESS' || status === 'PENDING') &&
      (isDesk || isAdmin || isEngineer) ? (
        <Card className="border-emerald-300/70 bg-emerald-50/50 p-4 dark:border-emerald-800/50 dark:bg-emerald-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-text-primary">
                {paymentSettledForComplete().ok
                  ? 'Stamp result saved'
                  : 'Stamp saved — payment still needed'}
              </div>
              <p className="mt-0.5 text-sm text-text-secondary">
                Stamping date {editDraft.stampingDate || '—'}
                {editDraft.nextDueDate ? ` · valid till ${editDraft.nextDueDate}` : ''}.{' '}
                {paymentSettledForComplete().ok
                  ? 'Ready to mark the job complete.'
                  : 'Mark paid fully (or leave ₹0 free), then Mark complete.'}
              </p>
            </div>
            <Button
              disabled={busy || !paymentSettledForComplete().ok}
              onClick={() => askComplete('RESOLVED')}
              title={
                !paymentSettledForComplete().ok
                  ? 'Payment missing — Mark paid fully first'
                  : undefined
              }
            >
              <CheckCircle2 size={16} /> Mark complete
            </Button>
          </div>
        </Card>
      ) : null}

      <TicketDetailGroup
        title="Actions"
        hint="Job controls in one row — assign · start · complete · docs (payment is separate below)"
        defaultOpen
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(showAssign || (isDesk && isStampingJob)) && status === 'OPEN' ? (
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                1. Assign
              </div>
              <Select
                label={isStampingJob && isDesk ? 'Engineer (optional)' : 'Engineer'}
                value={String(ticket.assignedToId ?? '')}
                onChange={(e) => {
                  if (e.target.value) void assignAndStart(e.target.value)
                }}
                options={[
                  {
                    value: '',
                    label: engineerOptions.length ? 'Select…' : 'No engineers in Users',
                  },
                  ...engineerOptions,
                ]}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                1. Assign
              </div>
              <p className="text-sm font-medium text-text-primary">
                {waitingAssign ? 'Unassigned' : (assigneeName ?? '—')}
              </p>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                {waitingAssign ? 'Optional — payment still works' : 'Engineer on this job'}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface/40 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              2. Start
            </div>
            <div className="flex flex-wrap gap-2">
              {isDesk && isStampingJob && waitingAssign ? (
                <Button size="sm" disabled={busy} onClick={() => void claimJob()}>
                  Take & start
                </Button>
              ) : null}
              {isEngineer && waitingAssign ? (
                <Button size="sm" disabled={busy} onClick={() => void claimJob()}>
                  Accept job
                </Button>
              ) : null}
              {(isEngineer || isAdmin) &&
              isOpen &&
              status === 'OPEN' &&
              ticket.assignedToId ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setWaPending({
                      payload: {
                        title: 'Start work & WhatsApp customer?',
                        lines: ['Template ticket_status_update → customer (In progress)'],
                      },
                      execute: (send) =>
                        patchTicket(
                          {
                            status: 'IN_PROGRESS',
                            sendWhatsApp: send,
                            whatsappNote: isEngineer
                              ? 'Engineer started work'
                              : 'Work started',
                          },
                          'Work started',
                        ),
                    })
                  }
                >
                  <Play size={14} /> Start work
                </Button>
              ) : null}
              {!waitingAssign && status !== 'OPEN' ? (
                <p className="text-sm text-text-secondary">
                  {labelize(status)} — already started
                </p>
              ) : null}
              {waitingAssign && !(isDesk && isStampingJob) && !isEngineer ? (
                <p className="text-sm text-text-secondary">Assign first, or leave open</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface/40 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              3. Complete
            </div>
            {(isEngineer || isDesk || isAdmin) &&
            (status === 'IN_PROGRESS' || status === 'PENDING') ? (
              isStampingJob && !stampResultSaved ? (
                <p className="text-sm text-text-secondary">
                  Save stamp result below first — then Mark complete shows at the top
                </p>
              ) : !paymentSettledForComplete().ok ? (
                <p className="text-sm text-text-secondary">
                  Payment missing — Mark paid fully (full amount) below, then Mark complete
                </p>
              ) : (
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    (isStampingJob
                      ? !stampResultSaved || !editDraft.stampingDate.trim()
                      : isEngineer && dayNotes.length === 0) ||
                    !paymentSettledForComplete().ok
                  }
                  onClick={() => askComplete('RESOLVED')}
                  title={
                    !paymentSettledForComplete().ok
                      ? 'Payment missing — Mark paid fully first'
                      : isEngineer && !isStampingJob && dayNotes.length === 0
                        ? 'Add at least one day note before Mark complete'
                        : undefined
                  }
                >
                  <CheckCircle2 size={14} /> Mark complete
                </Button>
              )
            ) : status === 'RESOLVED' || status === 'CLOSED' ? (
              <p className="text-sm font-medium text-text-primary">{labelize(status)}</p>
            ) : (
              <p className="text-sm text-text-secondary">Available when work is in progress</p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface/40 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              4. Docs
            </div>
            <div className="flex flex-wrap gap-2">
              {isAdmin && status === 'CLOSED' ? (
                <div className="relative" ref={billMenuRef}>
                  <div className="flex overflow-hidden rounded-[8px] border border-border">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none border-0 border-r border-border"
                      disabled={busy}
                      onClick={() => downloadJobSheet()}
                    >
                      <Download size={14} /> Bill
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none border-0 px-2"
                      disabled={busy}
                      aria-label="Bill summary options"
                      onClick={() => setBillMenuOpen((o) => !o)}
                    >
                      <ChevronDown size={14} className={billMenuOpen ? 'rotate-180' : ''} />
                    </Button>
                  </div>
                  {billMenuOpen ? (
                    <div className="absolute right-0 z-20 mt-1 min-w-[220px] rounded-[10px] border border-border bg-card py-1 shadow-lg">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                        onClick={() => {
                          setBillMenuOpen(false)
                          void sendBillSummaryToCustomer()
                        }}
                      >
                        <Send size={14} /> Send bill to customer
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canDownloadDocs && showPaymentAdminTools && status !== 'CLOSED' ? (
                <Button size="sm" variant="outline" onClick={() => downloadJobSheet()}>
                  <Download size={14} /> PDF
                </Button>
              ) : null}
              {status === 'CLOSED' && hasServiceReport ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const opts = serviceReportOptsFromTicket(
                      ticket as Record<string, unknown>,
                      APP_NAME,
                    )
                    if (!opts) {
                      addToast({
                        type: 'error',
                        message: 'Service report data missing on this ticket',
                      })
                      return
                    }
                    if (!openPrintableServiceReport(opts)) {
                      addToast({
                        type: 'error',
                        message: 'Allow pop-ups to download / print the report',
                      })
                    }
                  }}
                >
                  <FileText size={14} /> Service report
                </Button>
              ) : null}
              {!canDownloadDocs && status !== 'CLOSED' ? (
                <p className="text-sm text-text-secondary">After complete / paid</p>
              ) : null}
            </div>
          </div>
        </div>
      </TicketDetailGroup>

      {showPayment ? (
        <TicketDetailGroup
          id="section-payment"
          title="Payment"
          hint="Collect anytime — assign not required"
          defaultOpen={!isPaid}
        >
          <div
            className={`scroll-mt-24 space-y-3 ${sectionErrorClass(Boolean(fieldErrors.paymentTotal || fieldErrors.paymentMethod || fieldErrors.paymentReference || fieldErrors.paymentProofUrl))}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                {showPaymentAdminTools ? 'Collect & mark paid' : 'Advance & balance'}
              </h3>
              <Badge color={isPaid ? 'green' : paymentStatus === 'PARTIAL' ? 'amber' : 'gray'}>
                {labelize(paymentStatus)}
              </Badge>
            </div>
              {(fieldErrors.paymentTotal ||
                fieldErrors.paymentMethod ||
                fieldErrors.paymentReference ||
                fieldErrors.paymentProofUrl) ? (
                <div className="mb-3 space-y-2">
                  {fieldErrors.paymentTotal ? (
                    <MissingBanner message={fieldErrors.paymentTotal} />
                  ) : null}
                  {fieldErrors.paymentMethod ? (
                    <MissingBanner message={fieldErrors.paymentMethod} />
                  ) : null}
                  {fieldErrors.paymentReference ? (
                    <MissingBanner message={fieldErrors.paymentReference} />
                  ) : null}
                  {fieldErrors.paymentProofUrl ? (
                    <MissingBanner message={fieldErrors.paymentProofUrl} />
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Total payment ₹"
                  type="number"
                  value={payDraft.paymentTotal}
                  error={fieldErrors.paymentTotal}
                  disabled={!canEditPayment || busy}
                  onChange={(e) => {
                    setPayDraft({ ...payDraft, paymentTotal: e.target.value })
                    setFieldErrors((prev) => {
                      const next = { ...prev }
                      delete next.paymentTotal
                      return next
                    })
                  }}
                />
                <Input
                  label="Advance ₹"
                  type="number"
                  value={payDraft.advanceAmount}
                  disabled={!canEditPayment || busy}
                  onChange={(e) => setPayDraft({ ...payDraft, advanceAmount: e.target.value })}
                />
                <div className="rounded-[8px] border border-border bg-surface px-3 py-2">
                  <div className="text-xs text-text-secondary">Balance (auto)</div>
                  <div className="text-lg font-bold text-accent-amber">
                    {formatCurrency(balancePreview)}
                  </div>
                </div>
              </div>
              {canEditPayment ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Select
                    label={showPaymentAdminTools ? 'Payment method *' : 'Payment method'}
                    value={payDraft.paymentMethod}
                    onChange={(e) => setPayDraft({ ...payDraft, paymentMethod: e.target.value })}
                    options={[...PAYMENT_METHODS]}
                  />
                  <Input
                    label={
                      ONLINE_PAY.has(payDraft.paymentMethod)
                        ? 'UTR / txn ref *'
                        : 'Reference (cheque no.)'
                    }
                    value={payDraft.paymentReference}
                    onChange={(e) =>
                      setPayDraft({ ...payDraft, paymentReference: e.target.value })
                    }
                    placeholder={
                      ONLINE_PAY.has(payDraft.paymentMethod) ? 'UPI / bank UTR' : 'Optional'
                    }
                  />
                  {showPaymentAdminTools ? (
                    <div className="sm:col-span-2">
                      <span className="mb-1 block text-sm font-medium text-text-secondary">
                        Payment proof {ONLINE_PAY.has(payDraft.paymentMethod) ? '*' : '(optional)'}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[8px] border border-border bg-surface px-3 py-2 text-sm">
                          <ImagePlus size={16} />
                          {evidenceBusy ? 'Uploading…' : 'Upload screenshot / receipt'}
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            onChange={(e) => void uploadPaymentProof(e.target.files?.[0])}
                          />
                        </label>
                        {payDraft.paymentProofUrl ? (
                          <a
                            href={payDraft.paymentProofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-accent-blue underline"
                          >
                            View proof
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-xs text-text-secondary">
                  Payment marked paid
                  {ticket.paymentMethod
                    ? ` via ${labelize(String(ticket.paymentMethod))}`
                    : ''}
                  {ticket.paidAt ? ` · ${formatDateTime(String(ticket.paidAt))}` : ''}.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {canEditPayment ? (
                  <Button disabled={busy} onClick={() => void savePaymentDraft()}>
                    <Wallet size={16} /> Save payment
                  </Button>
                ) : null}
                {showPaymentAdminTools && canEditPayment ? (
                  <Button disabled={busy} onClick={() => void markPaidFully()}>
                    <Wallet size={16} /> Mark paid fully
                  </Button>
                ) : null}
                {showPaymentAdminTools && isPaid ? (
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => downloadJobSheet()}>
                      <Download size={16} /> Receipt PDF
                    </Button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void sendPaidWhatsApp()}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
                      style={{ backgroundColor: WA_GREEN }}
                    >
                      <WhatsAppIcon size={16} color="#fff" /> WhatsApp paid / invoice
                    </button>
                  </>
                ) : null}
                {showPaymentAdminTools ? (
                  <Button
                    variant="outline"
                    disabled={busy || (!isDone && !isPaid)}
                    onClick={() => void invoicePdfAndSend()}
                    title={!isDone ? 'Invoice only after Mark complete (RESOLVED)' : undefined}
                  >
                    <FileText size={16} />{' '}
                    {isPaid ? 'Proforma PDF + send' : 'Create proforma + due'}
                  </Button>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                {isPaid
                  ? 'Paid — you can invoice or WhatsApp the customer.'
                  : 'Enter charge anytime after the ticket is created. Assigning an engineer is separate.'}
              </p>
          </div>
        </TicketDetailGroup>
      ) : null}

      <TicketDetailGroup
        title="Work, approval & progress"
        hint="Stamp · mark complete · day notes · timeline"
        defaultOpen={isOpen || status === 'RESOLVED'}
      >

      {isStampingJob && isOpen ? (
        <Card
          id="section-stamp-result"
          className="scroll-mt-24 border-2 border-violet-400/60 bg-violet-50/40 p-4 sm:p-5 dark:border-violet-700/50 dark:bg-violet-950/20"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge color="purple">Stamping result</Badge>
            <h2 className="text-base font-semibold text-text-primary">
              Record stamp after verification
            </h2>
          </div>
          {cameOnlyForStamping || outsideMachine ? (
            <p className="mb-3 rounded-[8px] border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <strong>Outside machine</strong> — customer came only for stamping / verification. Enter
              the stamp date HMS completed today; next due usually +1 year. Saves on ticket + customer
              machine.
            </p>
          ) : (
            <p className="mb-3 text-sm text-text-secondary">
              Sold-by-us renewal. Previous valid till:{' '}
              <strong>
                {asset?.nextDueDate ? formatDate(String(asset.nextDueDate)) : 'not on file'}
              </strong>
              . Enter the new stamp date after verification — Mark complete updates the machine
              register.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label="Stamping date *"
              type="date"
              value={editDraft.stampingDate}
              onChange={(e) => {
                const stampingDate = e.target.value
                touchStampDraft((d) => ({
                  ...d,
                  stampingDate,
                  nextDueDate: stampingDate ? addOneYearIso(stampingDate) : '',
                }))
              }}
            />
            <Input
              label="Next due / valid till *"
              type="date"
              value={editDraft.nextDueDate}
              onChange={(e) => touchStampDraft({ nextDueDate: e.target.value })}
            />
            <Input
              label="VC number"
              value={editDraft.vcNumber}
              onChange={(e) => touchStampDraft({ vcNumber: e.target.value })}
            />
            <Input
              label="Plate no."
              value={editDraft.plateNo}
              onChange={(e) => touchStampDraft({ plateNo: e.target.value })}
            />
            <Select
              label="Stamping quarter"
              value={editDraft.stampingQuarter}
              onChange={(e) => touchStampDraft({ stampingQuarter: e.target.value })}
              options={[
                { value: '', label: '—' },
                { value: 'A', label: 'Quarter A · Jan–Mar' },
                { value: 'B', label: 'Quarter B · Apr–Jun' },
                { value: 'C', label: 'Quarter C · Jul–Sep' },
                { value: 'D', label: 'Quarter D · Oct–Dec' },
              ]}
            />
            <Input
              label="Verification class"
              value={editDraft.verificationClass}
              onChange={(e) => touchStampDraft({ verificationClass: e.target.value })}
              placeholder="e.g. III"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-violet-200/70 pt-3 dark:border-violet-800/50">
            <Button
              disabled={busy || !editDraft.stampingDate.trim()}
              onClick={() => void saveStampResult()}
            >
              {busy ? 'Saving…' : stampResultSaved ? 'Saved ✓ — update & save' : 'Save stamp result'}
            </Button>
            {stampResultSaved ? (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Saved — Mark complete is available at the top
              </span>
            ) : (
              <span className="text-xs text-text-secondary">
                Fill dates, then Save — Mark complete unlocks after save
              </span>
            )}
          </div>
        </Card>
      ) : null}

      {showApprove && status === 'RESOLVED' ? (
        <Card className="border-amber-300/60 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-text-primary">Pending your approval</div>
              <p className="mt-0.5 text-sm text-text-secondary">
                Job marked complete
                {isPaid
                  ? ' with payment confirmed'
                  : num(ticket.paymentTotal) <= 0
                    ? ' (free job)'
                    : ''}
                . Approve & close — the service report opens next (issues, work done, spare parts).
                {openDurationLabel ? ` · Open for ${openDurationLabel}` : ''}
              </p>
            </div>
            <Button
              disabled={
                busy ||
                (String(ticket.paymentStatus) !== 'PAID' &&
                  !(num(ticket.paymentTotal) <= 0 && num(ticket.advanceAmount) <= 0))
              }
              onClick={() => askComplete('CLOSED')}
            >
              <CheckCircle2 size={16} /> Approve & close → service report
            </Button>
          </div>
        </Card>
      ) : null}

      {showApprove && status === 'CLOSED' ? (
        <Card className="border-sky-300/50 bg-sky-50/40 p-4 dark:border-sky-800/40 dark:bg-sky-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-text-primary">
                {hasServiceReport ? 'Service report saved' : 'Service report'}
              </div>
              <p className="mt-0.5 text-sm text-text-secondary">
                {hasServiceReport
                  ? 'Report is on this ticket. Open again to update notes or add spare part changes on the customer machine.'
                  : 'Create the service report now — customer/machine are autofilled; spare parts save on the machine.'}
              </p>
            </div>
            <Button disabled={busy} onClick={() => openServiceReport()}>
              <FileText size={16} />
              {hasServiceReport ? 'Edit service report' : 'Create service report'}
            </Button>
          </div>
        </Card>
      ) : null}

      {isAdmin && status === 'CLOSED' ? (
        <Card className="border-emerald-300/50 bg-emerald-50/40 p-4 dark:border-emerald-800/40 dark:bg-emerald-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-text-primary">Billing</div>
              <p className="mt-0.5 text-sm text-text-secondary">
                Raise or open the service proforma (prefilled). Download job sheet if needed.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const params = new URLSearchParams({
                    open: 'create',
                    type: 'service',
                    ticketId: String(id),
                  })
                  if (ticket.contactId) params.set('contactId', String(ticket.contactId))
                  navigate(`/erp/invoices?${params.toString()}`)
                }}
              >
                <FileText size={16} /> Open service proforma
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => downloadJobSheet()}>
                <Download size={16} /> Job sheet PDF
              </Button>
              <Button disabled={busy} onClick={() => void invoicePdfAndSend()}>
                <FileText size={16} /> Proforma / bill
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {(isAdmin || isEngineer) && isOpen ? (
        <Card id="section-work-type" className="scroll-mt-24 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold text-text-primary">Work type</h2>
          <Select
            label="What kind of service is this?"
            value={workType}
            onChange={(e) => {
              const next = e.target.value
              void patchTicket(
                {
                  customFields: {
                    ...cf,
                    workType: next || null,
                  },
                },
                next ? `Work type: ${next}` : 'Work type cleared',
              )
            }}
            options={[
              { value: '', label: 'Select…' },
              { value: 'Calibration', label: 'Calibration' },
              { value: 'Repair', label: 'Repair' },
              { value: 'Spare replacement', label: 'Spare replacement' },
              { value: 'Stamping', label: 'Stamping / verification' },
              { value: 'Installation', label: 'Installation' },
              { value: 'Other', label: 'Other' },
            ]}
          />
          {workType === 'Spare replacement' ? (
            <p className="mt-2 text-xs text-text-secondary">
              Log replaced parts in the Spare parts section below — charges roll into payment total.
            </p>
          ) : null}
        </Card>
      ) : null}

      {(isEngineer || isAdmin) && (status === 'IN_PROGRESS' || status === 'PENDING' || isEngineer) ? (
        <Card id="section-day-notes" className="scroll-mt-24 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Step 4 — Daily tracking</h2>
              <p className="text-xs text-text-secondary">
                {isEngineer
                  ? 'Post Day 1, Day 2… notes. Admin sees these on the progress timeline.'
                  : 'Engineer day notes (read-only for you here — full timeline below).'}
              </p>
            </div>
            {dayNotes.length ? <Badge color="blue">{dayNotes.length} day note(s)</Badge> : null}
          </div>
          {dayNotes.length === 0 ? (
            <p className="mb-3 text-sm text-text-secondary">No day notes yet.</p>
          ) : (
            <ul className="mb-4 space-y-2">
              {dayNotes.map((n) => (
                <li
                  key={String(n.id ?? `${n.day}-${n.at}`)}
                  className="rounded-[8px] border border-border bg-surface/60 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <Badge color="amber">Day {String(n.day ?? '—')}</Badge>
                    <span>{n.at ? formatDateTime(String(n.at)) : String(n.date ?? '')}</span>
                    {n.byName ? <span>· {String(n.byName)}</span> : null}
                  </div>
                  <p className="mt-1 text-text-primary">{String(n.note ?? '')}</p>
                </li>
              ))}
            </ul>
          )}
          {isEngineer && isOpen ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-sm">
                <span className="mb-1 block font-medium text-text-secondary">
                  Day {(dayNotes.length || 0) + 1} note
                </span>
                <textarea
                  className="min-h-[72px] w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  value={dayNote}
                  onChange={(e) => setDayNote(e.target.value)}
                  placeholder="What did you do today? Parts ordered, waiting on customer, site findings…"
                />
              </label>
              <Button
                disabled={busy || !dayNote.trim()}
                onClick={() => void addDayNote()}
                className="shrink-0"
              >
                Save day note
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">Progress timeline</h2>
            <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
              {openDurationLabel ? <Badge color="gray">{openDurationLabel}</Badge> : null}
              {breached ? <Badge color="red">SLA breached</Badge> : null}
              {!ticket.assignedToId && status === 'OPEN' ? (
                <Badge color="amber">Needs engineer</Badge>
              ) : null}
            </div>
          </div>
          {progressTimeline.length === 0 ? (
            <p className="text-sm text-text-secondary">No timeline events yet.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {progressTimeline.map((ev, idx) => (
                <li key={`${ev.at}-${idx}`} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                  <div className="text-xs text-text-secondary">
                    {ev.at ? formatDateTime(ev.at) : '—'}
                  </div>
                  <div className="font-medium text-text-primary">{ev.title}</div>
                  {ev.detail ? (
                    <div className="text-sm text-text-secondary">{ev.detail}</div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-text-secondary">
            Day notes (Step 4) and visits from the engineer appear here. Use <strong>Assign to</strong> below to
            reassign if the current engineer cannot finish.
          </p>
        </Card>
      ) : null}

      </TicketDetailGroup>

      {/* Assignment — separate from payment (payment is above, always on) */}
      {(isAdmin || isEngineer || isDesk) ? (
      <TicketDetailGroup
        id="section-assignment"
        title="Assignment"
        hint="Optional — does not block payment"
        defaultOpen={waitingAssign || showAssign}
      >
          {fieldErrors.assignedToId ? <MissingBanner message={fieldErrors.assignedToId} className="mb-3" /> : null}
          <div className={`grid gap-3 sm:grid-cols-2 ${sectionErrorClass(Boolean(fieldErrors.assignedToId))}`}>
            {showAssign ? (
              <>
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                const next = e.target.value
                if (next === status) return
                if (next === 'RESOLVED' || next === 'CLOSED') {
                  askComplete(next as 'RESOLVED' | 'CLOSED')
                  return
                }
                setWaPending({
                  payload: {
                    title: 'Update status & WhatsApp customer?',
                    lines: [`Template ticket_status_update → customer (${labelize(next)})`],
                  },
                  execute: (send) =>
                    patchTicket(
                      {
                        status: next,
                        sendWhatsApp: send,
                        whatsappNote: `Status is now ${labelize(next)}`,
                      },
                      'Status updated',
                    ),
                })
              }}
              options={(STATUS_TRANSITIONS[status] ?? [status]).map((v) => ({
                value: v,
                label:
                  v === 'CLOSED'
                    ? 'Closed (approve — paid required)'
                    : v === 'RESOLVED'
                      ? 'Resolved (mark complete)'
                      : labelize(v),
              }))}
            />
            <Select
              label="Priority"
              value={String(ticket.priority)}
              onChange={(e) => void patchTicket({ priority: e.target.value }, 'Priority updated')}
              options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) }))}
            />
            <Select
              label={ticket.assignedToId ? 'Reassign engineer' : 'Assign to'}
              value={String(ticket.assignedToId ?? '')}
              onChange={(e) => {
                if (e.target.value) {
                  void assignAndStart(e.target.value)
                  return
                }
                void patchTicket(
                  { assignedToId: null, receivedByUserId: null },
                  'Unassigned',
                )
              }}
              options={[{ value: '', label: 'Unassigned' }, ...engineerOptions]}
            />
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
              options={[{ value: '', label: '—' }, ...engineerOptions]}
            />
            <Select
              label="Delivered by"
              value={String(ticket.deliveredByUserId ?? '')}
              onChange={(e) =>
                void patchTicket({ deliveredByUserId: e.target.value || null }, 'Delivered-by updated')
              }
              options={[
                { value: '', label: 'Fill after delivery' },
                ...engineerOptions,
              ]}
            />
            <div className="rounded-[8px] border border-border bg-surface px-3 py-2 sm:col-span-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Current owner
              </div>
              <div className="mt-0.5 text-sm font-medium text-text-primary">
                {users.find((u) => u.id === String(ticket.assignedToId ?? ''))?.name ??
                  (ticket.assignee as { name?: string } | undefined)?.name ??
                  'Unassigned'}
              </div>
              <p className="mt-1 text-xs text-text-secondary">
                Service engineer role only · SLA{' '}
                <span className={breached ? 'font-medium text-accent-red' : 'font-medium text-text-primary'}>
                  {ticket.slaDueAt ? formatDateTime(String(ticket.slaDueAt)) : '—'}
                  {breached ? ' (breached)' : ''}
                </span>
              </p>
            </div>
              </>
            ) : (
              <div className="sm:col-span-2 space-y-2 text-sm">
                <div>
                  <span className="text-xs font-semibold uppercase text-text-secondary">Status</span>
                  <div className="mt-0.5 font-medium">{labelize(status)}</div>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-text-secondary">Assigned to</span>
                  <div className="mt-0.5 font-medium">
                    {users.find((u) => u.id === String(ticket.assignedToId ?? ''))?.name ??
                      (ticket.assignee as { name?: string } | undefined)?.name ??
                      '—'}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase text-text-secondary">Priority</span>
                  <div className="mt-0.5 font-medium">{labelize(String(ticket.priority))}</div>
                </div>
                <div className="text-xs text-text-secondary">
                  SLA due:{' '}
                  <span className={breached ? 'font-medium text-accent-red' : 'font-medium text-text-primary'}>
                    {ticket.slaDueAt ? formatDateTime(String(ticket.slaDueAt)) : '—'}
                    {breached ? ' (breached)' : ''}
                  </span>
                </div>
              </div>
            )}
          </div>
      </TicketDetailGroup>
      ) : null}

      {contact && isAdmin ? (
        <TicketDetailGroup
          id="section-spares"
          title="Spare parts"
          hint={cf.alsoSpareParts ? 'Stamping + spares on this visit' : 'Parts used on this job'}
          defaultOpen={Boolean(cf.alsoSpareParts)}
        >
          {cf.alsoSpareParts ? (
            <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
              Marked <strong>also spare parts</strong> at create — log changes below; payment on this
              ticket.
            </p>
          ) : null}
          <SparePartsPanel
            contactId={contact.id}
            contactName={contact.name}
            ticketId={id}
            fixedAssetId={ticket.assetId ? String(ticket.assetId) : undefined}
            fixedAssetLabel={
              asset
                ? `${String(asset.name ?? 'Machine')}${
                    asset.serialNo ? ` · ${String(asset.serialNo)}` : ''
                  }`
                : undefined
            }
            onTicketUpdated={() => void load()}
            collapsible
            defaultOpen={Boolean(cf.alsoSpareParts)}
            canEdit
            defaultUnderWarranty={
              coverageChargeHints({
                servicePlan: asset?.servicePlan ? String(asset.servicePlan) : null,
                warrantyEndDate: asset?.warrantyEndDate
                  ? String(asset.warrantyEndDate)
                  : null,
                amcEndDate: asset?.amcEndDate ? String(asset.amcEndDate) : null,
              }).underWarrantyDefault
            }
          />
        </TicketDetailGroup>
      ) : null}

      <TicketDetailGroup title="Team notes" hint="Internal only — not sent to customer" defaultOpen={false}>
      <Card className="overflow-hidden border-0 p-0 shadow-none">
        <div className="border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
          <h3 className="text-sm font-semibold text-text-primary">Internal conversation</h3>
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
      </TicketDetailGroup>

      {ticketDialogs}
    </div>
  )
}

export default TicketDetailPage
