/**
 * Service ticket flow — one source of truth for the step bar, the "Next" line and
 * "Missed" warnings on the ticket page (same pattern as the sales flow).
 *
 *   Logged (desk) → Accepted (engineer) → Work logged (day note / stamp result)
 *   → Paid (any time; ₹0 = free job) → Complete (engineer) → Closed (desk / admin approve)
 */
import type { FlowStep } from '@/components/ui/FlowStepBar'
import { missedSteps, nextStep } from '@/lib/flowSteps'

export const SERVICE_FLOW_STEPS: FlowStep[] = [
  { key: 'logged', label: 'Logged', hint: 'Service desk' },
  { key: 'accepted', label: 'Accepted', hint: 'Engineer' },
  { key: 'work', label: 'Work logged', hint: 'Work report / stamp' },
  { key: 'payment', label: 'Paid', hint: 'Or ₹0 free · any time', anytime: true },
  { key: 'complete', label: 'Complete', hint: 'Engineer / desk' },
  { key: 'closed', label: 'Closed', hint: 'Desk / admin approve' },
]

/** Same steps, worded for the job: stamping work = the stamp result, and the desk may take it. */
export function serviceFlowSteps(isStamping: boolean): FlowStep[] {
  if (!isStamping) return SERVICE_FLOW_STEPS
  return SERVICE_FLOW_STEPS.map((s) =>
    s.key === 'accepted'
      ? { ...s, hint: 'Engineer / desk' }
      : s.key === 'work'
        ? { ...s, label: 'Stamp result', hint: 'Stamp date + valid till' }
        : s,
  )
}

export type ServiceFlowInput = {
  status: string
  assigned: boolean
  isStamping: boolean
  stampSaved: boolean
  dayNoteCount: number
  /** Paid in full, or explicitly marked Free job (GC / AMC / warranty) with no charge */
  paymentOk: boolean
  free: boolean
  balanceDue: number
  /** A charge (total) has been entered */
  chargeEntered?: boolean
}

export type ServiceGuide = {
  flags: boolean[]
  missed: number[]
  next: number
  /** What has to happen next, in plain words */
  message: string
  /** Who does it */
  owner: string
  /** Ticket tab + section to jump to for that step */
  tab: 'overview' | 'work' | 'payment' | null
  sectionId: string | null
}

export function serviceGuide(i: ServiceFlowInput): ServiceGuide {
  const done = i.status === 'RESOLVED' || i.status === 'CLOSED'
  const flags = [
    true,
    i.assigned,
    done || (i.isStamping ? i.stampSaved : i.dayNoteCount > 0),
    // Paid in full, or explicitly marked free (a forgotten ₹0 is not free)
    i.paymentOk,
    done,
    i.status === 'CLOSED',
  ]
  const missed = missedSteps(flags, SERVICE_FLOW_STEPS)
  // Payment is "any time", but completing without it is still a skipped step
  if (done && !flags[3]) missed.push(3)
  missed.sort((a, b) => a - b)
  const next = nextStep(flags, SERVICE_FLOW_STEPS)

  const step = SERVICE_FLOW_STEPS[next]?.key
  let message = 'All steps done.'
  let owner = ''
  let tab: ServiceGuide['tab'] = null
  let sectionId: string | null = null
  switch (step) {
    case 'accepted':
      message = i.isStamping
        ? 'Desk: Take & start this stamping job — or wait for an engineer to Accept.'
        : 'Waiting for the first engineer to Accept (or admin assigns an engineer).'
      owner = i.isStamping ? 'Engineer / desk' : 'Engineer'
      tab = 'overview'
      sectionId = 'section-assignment'
      break
    case 'work':
      message = i.isStamping
        ? 'Enter stamping date + next due, then Save stamp result.'
        : 'Fill the work report — what you found and changed today.'
      owner = i.isStamping ? 'Engineer / desk' : 'Engineer'
      tab = 'work'
      sectionId = i.isStamping ? 'section-stamp-result' : 'section-day-notes'
      break
    case 'payment':
      message =
        i.chargeEntered === false
          ? 'Enter the charge and Mark paid — or tick Free job (GC / AMC / warranty) if there is no charge.'
          : i.balanceDue <= 0
            ? 'Amount covered — Mark paid to confirm (method + proof for online).'
            : `Collect ₹${Math.max(0, i.balanceDue).toLocaleString('en-IN')} and Mark paid (method + proof for online).`
      owner = 'Engineer / desk'
      tab = 'payment'
      sectionId = 'section-payment'
      break
    case 'complete':
      message = 'Work and payment done — Mark complete.'
      owner = 'Engineer / desk'
      tab = 'overview'
      break
    case 'closed':
      message = 'Check the job and payment, then Approve & close (opens the service report).'
      owner = 'Desk / admin'
      tab = 'overview'
      break
    default:
      break
  }
  return { flags, missed, next, message, owner, tab, sectionId }
}

/** Plain-words fix for a skipped step (shown as "Missed · …"). */
export function serviceMissedMessage(stepIdx: number): string {
  switch (SERVICE_FLOW_STEPS[stepIdx]?.key) {
    case 'accepted':
      return 'No engineer on this job — assign one.'
    case 'work':
      return 'Completed without a work report / stamp result — add it for the record.'
    case 'payment':
      return 'Marked complete without payment — collect and Mark paid.'
    default:
      return 'Step was skipped.'
  }
}

/** The one service-ticket category list (create form, filters, reports). Stamping is its own job kind. */
export const SERVICE_CATEGORIES = [
  { value: 'Breakdown', label: 'Breakdown / repair' },
  { value: 'Installation', label: 'Installation' },
  { value: 'AMC visit', label: 'AMC visit' },
  { value: 'Other', label: 'Other' },
] as const

/** Old tickets used "Service" or no category — both mean a breakdown / repair visit. */
export function serviceCategoryLabel(raw: unknown): string {
  const v = String(raw ?? '').trim()
  if (v === 'Stamping') return 'Stamping'
  return SERVICE_CATEGORIES.find((c) => c.value === v)?.label ?? 'Breakdown / repair'
}
