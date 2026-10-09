/** HMS machine coverage: GC (guarantee) → NGC → AMC (weighing only, 1-year contracts). */

export type ServicePlanCode = 'GC' | 'NGC' | 'AMC' | 'NON_AMC'

/** Guarantee on every HMS-sold product (any brand). After this → NGC. */
export const GC_MONTHS = 12

/** AMC contract length (renewable). Weighing machines only. */
export const AMC_CONTRACT_MONTHS = 12

/** Free AMC service cadence — 2 visits / year (every 6 months). */
export const AMC_SERVICE_MONTHS = 6

/** Show in “AMC due” when renewal/service is within this many days. */
export const AMC_DUE_WINDOW_DAYS = 60

export const GC_MONTH_OPTIONS = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '12 months' },
] as const

export const SERVICE_PLAN_OPTIONS: Array<{ value: ServicePlanCode; label: string; hint: string }> = [
  {
    value: 'GC',
    label: 'GC — guarantee (HMS sale)',
    hint: 'HMS-sold products (any brand): guarantee period — parts + service free',
  },
  {
    value: 'NGC',
    label: 'NGC — after guarantee',
    hint: 'Auto after GC ends — spare parts and service chargeable',
  },
  {
    value: 'AMC',
    label: 'AMC — weighing only (1 year)',
    hint: 'Weighing only · 2 service visits/year (every 6 months) · parts charged · service covered',
  },
  {
    value: 'NON_AMC',
    label: 'Non-AMC (legacy)',
    hint: 'Same as NGC — all work chargeable',
  },
]

export function normalizeServicePlan(raw: string | null | undefined): ServicePlanCode {
  if (!raw) return 'NON_AMC'
  const t = raw.trim().toUpperCase().replace(/\s+/g, '_')
  if (t === 'GC' || /guarantee|warranty|new.?machine/i.test(raw)) return 'GC'
  if (t === 'NGC' || /non.?guarantee|after.?gc|post.?warranty/i.test(raw)) return 'NGC'
  if (t === 'AMC' || /under.?amc|with.?amc/i.test(raw)) return 'AMC'
  if (t === 'NON_AMC' || /non.?amc|no.?amc/i.test(raw)) return 'NON_AMC'
  return 'NON_AMC'
}

export function addMonths(isoDate: string | Date, months: number): string {
  const d =
    typeof isoDate === 'string' ? new Date(isoDate.slice(0, 10) + 'T12:00:00') : new Date(isoDate)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function isDateOnOrAfter(iso: string | null | undefined, today = new Date()): boolean {
  if (!iso) return false
  const d = new Date(String(iso).slice(0, 10) + 'T23:59:59')
  return !Number.isNaN(d.getTime()) && d.getTime() >= today.getTime()
}

export function daysUntil(dateStr?: string | null, today = new Date()): number | null {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return null
  const t = new Date(today)
  t.setHours(12, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / (24 * 60 * 60 * 1000))
}

export function isWeighingMachine(machineType?: string | null): boolean {
  return String(machineType ?? '').toUpperCase() === 'WEIGHING'
}

/** Effective coverage: GC that expired is treated as NGC. */
export function effectiveServicePlan(opts: {
  servicePlan?: string | null
  warrantyEndDate?: string | null
  amcEndDate?: string | null
}): ServicePlanCode {
  const plan = normalizeServicePlan(opts.servicePlan)
  if (plan === 'GC' && !isUnderGc(opts)) return 'NGC'
  if (plan === 'AMC' && !isAmcActive(opts)) return 'NGC'
  if (plan === 'NON_AMC') return 'NGC'
  return plan
}

/** GC active when warrantyEndDate is still in the future. */
export function isUnderGc(opts: {
  servicePlan?: string | null
  warrantyEndDate?: string | null
}): boolean {
  if (normalizeServicePlan(opts.servicePlan) !== 'GC') return false
  return isDateOnOrAfter(opts.warrantyEndDate)
}

export function isAmcActive(opts: {
  servicePlan?: string | null
  amcEndDate?: string | null
}): boolean {
  if (normalizeServicePlan(opts.servicePlan) !== 'AMC') return false
  if (!opts.amcEndDate) return true
  return isDateOnOrAfter(opts.amcEndDate)
}

/**
 * AMC is weighing-only.
 * Eligible after GC ends (≈1 year from HMS sale), or any older weighing unit
 * (including outside machines the customer wants on AMC).
 */
export function canEnrollAmc(opts: {
  machineType?: string | null
  servicePlan?: string | null
  warrantyEndDate?: string | null
  amcEndDate?: string | null
  origin?: string | null
}): { ok: boolean; reason: string } {
  if (!isWeighingMachine(opts.machineType)) {
    return {
      ok: false,
      reason: 'AMC is only for weighing machines (not billing / CCTV / other).',
    }
  }
  const plan = normalizeServicePlan(opts.servicePlan)
  if (plan === 'AMC' && isAmcActive(opts)) {
    return { ok: false, reason: 'Already on an active AMC — renew when it ends.' }
  }
  if (plan === 'GC' && isUnderGc(opts)) {
    return {
      ok: false,
      reason: 'Still under HMS guarantee (GC). AMC opens after GC ends (~1 year from sale).',
    }
  }
  return {
    ok: true,
    reason:
      'Weighing machine — convert to AMC for 1 year (renewable). Service free every 6 months; parts charged.',
  }
}

export type ChargeHints = {
  plan: ServicePlanCode
  serviceFree: boolean
  sparesFree: boolean
  underWarrantyDefault: boolean
  label: string
  summary: string
}

export function coverageChargeHints(opts: {
  servicePlan?: string | null
  warrantyEndDate?: string | null
  amcEndDate?: string | null
}): ChargeHints {
  const plan = normalizeServicePlan(opts.servicePlan)
  if (plan === 'GC' && isUnderGc(opts)) {
    return {
      plan,
      serviceFree: true,
      sparesFree: true,
      underWarrantyDefault: true,
      label: 'GC',
      summary: 'HMS guarantee — service and spare parts free (any brand sold by us)',
    }
  }
  if (plan === 'AMC' && isAmcActive(opts)) {
    return {
      plan,
      serviceFree: true,
      sparesFree: false,
      underWarrantyDefault: false,
      label: 'AMC',
      summary: 'AMC (weighing) — 2 free service visits/year (every 6 months); spare parts charged · 1-year renewable',
    }
  }
  if (plan === 'GC') {
    return {
      plan: 'NGC',
      serviceFree: false,
      sparesFree: false,
      underWarrantyDefault: false,
      label: 'GC ended → NGC',
      summary: 'Guarantee ended — now NGC. Weighing machines can enroll AMC.',
    }
  }
  return {
    plan: plan === 'AMC' ? 'NGC' : plan === 'NON_AMC' ? 'NGC' : plan,
    serviceFree: false,
    sparesFree: false,
    underWarrantyDefault: false,
    label: plan === 'AMC' ? 'AMC expired' : plan === 'NGC' ? 'NGC' : 'Non-AMC',
    summary: 'Spare parts and service are chargeable',
  }
}

export function defaultWarrantyEndFromToday(): string {
  return addMonths(new Date().toISOString().slice(0, 10), GC_MONTHS)
}

/** HMS stamping calendar: A Jan–Mar · B Apr–Jun · C Jul–Sep · D Oct–Dec */
export type StampQuarter = 'A' | 'B' | 'C' | 'D'

export const STAMP_QUARTERS: Array<{
  code: StampQuarter
  months: string
  monthNos: [number, number, number]
}> = [
  { code: 'A', months: 'Jan–Mar', monthNos: [1, 2, 3] },
  { code: 'B', months: 'Apr–Jun', monthNos: [4, 5, 6] },
  { code: 'C', months: 'Jul–Sep', monthNos: [7, 8, 9] },
  { code: 'D', months: 'Oct–Dec', monthNos: [10, 11, 12] },
]

export function stampQuarterFromDate(iso?: string | Date | null): StampQuarter {
  const d =
    typeof iso === 'string'
      ? new Date(iso.slice(0, 10) + 'T12:00:00')
      : iso instanceof Date
        ? iso
        : new Date()
  const m = d.getMonth() + 1
  if (m <= 3) return 'A'
  if (m <= 6) return 'B'
  if (m <= 9) return 'C'
  return 'D'
}

export function stampQuarterMeta(code: StampQuarter) {
  return STAMP_QUARTERS.find((q) => q.code === code) ?? STAMP_QUARTERS[3]!
}

export function stampQuarterLabel(code: StampQuarter, year?: number | null) {
  const q = stampQuarterMeta(code)
  return year ? `Quarter ${code} · ${q.months} ${year}` : `Quarter ${code} · ${q.months}`
}

/** Prefer stored tag, else derive from stamping due / stamp / sale date. */
export function stampQuarterOf(source: {
  nextDueDate?: string | Date | null
  stampingDate?: string | Date | null
  customFields?: Record<string, unknown> | null
}): { code: StampQuarter; year: number; label: string } {
  const cf = source.customFields ?? {}
  const stored = String(cf.stampingQuarter ?? '').toUpperCase()
  const due = source.nextDueDate ?? source.stampingDate ?? new Date()
  const code = (['A', 'B', 'C', 'D'].includes(stored) ? stored : stampQuarterFromDate(due)) as StampQuarter
  const year = Number(cf.stampingQuarterYear) || new Date(
    String(due).slice(0, 10) + 'T12:00:00',
  ).getFullYear()
  return { code, year, label: stampQuarterLabel(code, year) }
}

/** HMS-sold machine: 1yr GC from sale day; weighing also 1yr stamping + A–D quarter. */
export function hmsSoldCoverage(soldAt: Date | string = new Date(), weighing: boolean) {
  const base =
    typeof soldAt === 'string'
      ? soldAt.slice(0, 10)
      : soldAt.toISOString().slice(0, 10)
  const gcEnd = addMonths(base, GC_MONTHS)
  const stampDue = weighing ? addMonths(base, GC_MONTHS) : null
  const quarter = stampQuarterFromDate(base)
  const year = new Date((stampDue ?? base) + 'T12:00:00').getFullYear()
  return {
    servicePlan: 'GC' as const,
    warrantyEndDate: gcEnd,
    stampingDate: weighing ? base : null,
    nextDueDate: stampDue,
    stampingQuarter: quarter,
    stampingQuarterYear: year,
    soldAt: base,
    quarterLabel: stampQuarterLabel(quarter, year),
  }
}

export function defaultAmcEndFromStart(startIso?: string | null): string {
  const base = startIso?.slice(0, 10) || new Date().toISOString().slice(0, 10)
  return addMonths(base, AMC_CONTRACT_MONTHS)
}

export function defaultNextAmcService(fromIso?: string | null): string {
  const base = fromIso?.slice(0, 10) || new Date().toISOString().slice(0, 10)
  return addMonths(base, AMC_SERVICE_MONTHS)
}

export type AmcDueKind = 'renewal' | 'service' | 'eligible' | 'expired'

export type AmcDueRow = {
  kind: AmcDueKind
  days: number | null
  label: string
  urgency: 'overdue' | 'soon' | 'ok'
}

/** Ranking for contact “AMC due” related list (weighing only). */
export function amcDueInfo(asset: {
  machineType?: string | null
  servicePlan?: string | null
  warrantyEndDate?: string | null
  amcEndDate?: string | null
  nextServiceDueDate?: string | null
}): AmcDueRow | null {
  if (!isWeighingMachine(asset.machineType)) return null

  const plan = normalizeServicePlan(asset.servicePlan)
  const amcDays = daysUntil(asset.amcEndDate)
  const serviceDays = daysUntil(asset.nextServiceDueDate)

  if (plan === 'AMC' && amcDays != null && amcDays < 0) {
    return {
      kind: 'expired',
      days: amcDays,
      label: `AMC expired ${Math.abs(amcDays)}d ago — renew`,
      urgency: 'overdue',
    }
  }
  if (plan === 'AMC' && amcDays != null && amcDays <= AMC_DUE_WINDOW_DAYS) {
    return {
      kind: 'renewal',
      days: amcDays,
      label: amcDays === 0 ? 'AMC renews today' : `AMC renewal in ${amcDays}d`,
      urgency: amcDays <= 14 ? 'soon' : 'ok',
    }
  }
  if (plan === 'AMC' && serviceDays != null && serviceDays <= AMC_DUE_WINDOW_DAYS) {
    return {
      kind: 'service',
      days: serviceDays,
      label:
        serviceDays < 0
          ? `Free service overdue ${Math.abs(serviceDays)}d`
          : serviceDays === 0
            ? 'Free AMC service today'
            : `Free AMC service in ${serviceDays}d`,
      urgency: serviceDays <= 7 ? 'soon' : 'ok',
    }
  }

  const enroll = canEnrollAmc(asset)
  if (enroll.ok) {
    return {
      kind: 'eligible',
      days: null,
      label: 'Eligible for AMC (1 year) — weighing',
      urgency: 'ok',
    }
  }

  return null
}
