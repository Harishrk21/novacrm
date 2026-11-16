/**
 * Simple lead picture for HMS sales:
 *   Outcome — Open · Closed (sale completed) · Lost
 *   Stage   — for open leads, worked out automatically from what has happened on the lead:
 *             Not contacted → Contacted → Pre-qualified → Demo → Ready to buy
 * Nobody picks a stage by hand; actions (log a call, add budget, start demo, convert…) move it.
 */
import type { BadgeColor } from '@/components/ui/Badge'

export type LeadOutcome = 'OPEN' | 'CLOSED' | 'LOST'
export type LeadStage = 'NOT_CONTACTED' | 'CONTACTED' | 'PREQUALIFIED' | 'DEMO' | 'READY'

export const LEAD_OUTCOMES: Array<{ value: LeadOutcome; label: string; color: BadgeColor }> = [
  { value: 'OPEN', label: 'Open', color: 'blue' },
  { value: 'CLOSED', label: 'Closed · sold', color: 'green' },
  { value: 'LOST', label: 'Lost', color: 'slate' },
]

export const LEAD_STAGES: Array<{ value: LeadStage; label: string; color: BadgeColor; stripe: string }> = [
  { value: 'NOT_CONTACTED', label: 'Not contacted', color: 'indigo', stripe: 'border-l-indigo-500' },
  { value: 'CONTACTED', label: 'Contacted', color: 'cyan', stripe: 'border-l-cyan-500' },
  { value: 'PREQUALIFIED', label: 'Pre-qualified', color: 'purple', stripe: 'border-l-violet-500' },
  { value: 'DEMO', label: 'Demo', color: 'amber', stripe: 'border-l-amber-500' },
  { value: 'READY', label: 'Ready to buy', color: 'teal', stripe: 'border-l-teal-500' },
]

type Row = Record<string, unknown>

function cfOf(lead: Row | null | undefined): Row {
  const cf = lead?.customFields
  return cf && typeof cf === 'object' && !Array.isArray(cf) ? (cf as Row) : {}
}

const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0
const positive = (v: unknown) => Number(v) > 0

export function leadOutcome(lead: Row | null | undefined): LeadOutcome {
  if (!lead) return 'OPEN'
  if (cfOf(lead).saleCompletedAt) return 'CLOSED'
  const st = String(lead.status ?? '')
  if (st === 'LOST' || st === 'UNQUALIFIED') return 'LOST'
  return 'OPEN'
}

/** Furthest stage the lead has reached (never goes backwards). */
export function leadStage(
  lead: Row | null | undefined,
  extra?: { activities?: Row[]; hasRequisition?: boolean },
): LeadStage {
  if (!lead) return 'NOT_CONTACTED'
  const cf = cfOf(lead)
  const st = String(lead.status ?? 'NEW')

  if (
    st === 'CONVERTED' ||
    Boolean(lead.convertedContactId) ||
    extra?.hasRequisition ||
    Boolean(cf.inventoryReqNumber) ||
    Boolean(cf.inventoryRelease) ||
    Boolean(cf.saleCompletedAt)
  ) {
    return 'READY'
  }
  if (st === 'DEMO' || Boolean(cf.demoStockUnitId) || nonEmptyArray(cf.demoDailyUpdates)) {
    return 'DEMO'
  }
  if (
    st === 'QUALIFIED' ||
    positive(cf.budget) ||
    positive(cf.salePaymentTotal) ||
    Boolean(String(cf.timeline ?? '').trim())
  ) {
    return 'PREQUALIFIED'
  }
  const history = Array.isArray(cf.timelineHistory) ? (cf.timelineHistory as Row[]) : []
  if (
    st === 'CONTACTED' ||
    Boolean(cf.clientCalledDate) ||
    Boolean(cf.lastTouchedAt) ||
    nonEmptyArray(cf.leadUpdates) ||
    history.some((h) => ['followup', 'call', 'note', 'whatsapp', 'visit'].includes(String(h.kind ?? h.type))) ||
    nonEmptyArray(extra?.activities)
  ) {
    return 'CONTACTED'
  }
  return 'NOT_CONTACTED'
}

export const leadOutcomeMeta = (o: LeadOutcome) => LEAD_OUTCOMES.find((x) => x.value === o)!
export const leadStageMeta = (s: LeadStage) => LEAD_STAGES.find((x) => x.value === s)!

/** Old ?status= links (dashboard tiles, bookmarks) → new outcome/stage filter. */
export function filterFromLegacyStatus(status: string | null): { outcome: LeadOutcome; stage: LeadStage | '' } {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETED':
      return { outcome: 'CLOSED', stage: '' }
    case 'LOST':
    case 'UNQUALIFIED':
      return { outcome: 'LOST', stage: '' }
    case 'NEW':
      return { outcome: 'OPEN', stage: 'NOT_CONTACTED' }
    case 'CONTACTED':
      return { outcome: 'OPEN', stage: 'CONTACTED' }
    case 'QUALIFIED':
      return { outcome: 'OPEN', stage: 'PREQUALIFIED' }
    case 'DEMO':
      return { outcome: 'OPEN', stage: 'DEMO' }
    case 'CONVERTED':
      return { outcome: 'OPEN', stage: 'READY' }
    default:
      return { outcome: 'OPEN', stage: '' }
  }
}

/** Single string for the leads list filter: '' = all open · 'OPEN:<stage>' · 'CLOSED' · 'LOST'. */
export function encodeLeadFilter(f: { outcome: LeadOutcome; stage: LeadStage | '' }): string {
  if (f.outcome !== 'OPEN') return f.outcome
  return f.stage ? `OPEN:${f.stage}` : ''
}

export function decodeLeadFilter(v: string): { outcome: LeadOutcome; stage: LeadStage | '' } {
  if (v === 'CLOSED' || v === 'LOST') return { outcome: v, stage: '' }
  if (v.startsWith('OPEN:')) return { outcome: 'OPEN', stage: v.slice(5) as LeadStage }
  return { outcome: 'OPEN', stage: '' }
}

export function leadMatchesFilter(lead: Row, filter: string): boolean {
  const f = decodeLeadFilter(filter)
  if (leadOutcome(lead) !== f.outcome) return false
  return !f.stage || leadStage(lead) === f.stage
}

/** Left stripe colour for list rows. */
export function leadStripe(lead: Row): string {
  const o = leadOutcome(lead)
  if (o === 'CLOSED') return 'border-l-emerald-600'
  if (o === 'LOST') return 'border-l-slate-400'
  return leadStageMeta(leadStage(lead)).stripe
}
