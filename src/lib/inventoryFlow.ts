import type { FlowStep } from '@/components/ui/FlowStepBar'

/** Warehouse-only sale release steps — PI / payments stay with sales. */
export const INVENTORY_FLOW_STEPS: FlowStep[] = [
  { key: 'notify', label: 'Notified', hint: 'Sales alerted you' },
  { key: 'check', label: 'Check sale', hint: 'Customer + product' },
  { key: 'stamp', label: 'Stamping?', hint: 'Yes + dates / No' },
  { key: 'reduce', label: 'Reduce stock', hint: 'Serial → customer + DC' },
  { key: 'dc', label: 'Sale DC', hint: 'Print challan' },
  { key: 'ship', label: 'Ready to ship', hint: 'Next after DC' },
]

export type InventoryReleaseRow = {
  status?: string
  shippedAt?: string | null
  serialNo?: string | null
  stockUnitId?: string | null
  customFields?: Record<string, unknown> | null
  productName?: string | null
}

export type ReleaseOrderLine = {
  /** Product / model label from the sale (must match stock model) */
  label: string
  /** How many units of this product the customer ordered */
  qty: number
  /** How many already reduced for this label */
  reduced: number
  remaining: number
  done: boolean
  index: number
}

function labelsMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/** Per ordered product: qty + how many already stocked out. */
export function releaseOrderLines(
  row: {
    qty?: unknown
    productName?: unknown
    customFields?: unknown
  } | null | undefined,
): ReleaseOrderLine[] {
  const cf =
    row?.customFields && typeof row.customFields === 'object'
      ? (row.customFields as Record<string, unknown>)
      : {}
  const releaseLines = Array.isArray(cf.releaseLines)
    ? (cf.releaseLines as Array<Record<string, unknown>>)
    : []

  // Prefer explicit order lines from sale custom fields when present
  const rawOrder = Array.isArray(cf.orderLines)
    ? (cf.orderLines as Array<Record<string, unknown>>)
    : Array.isArray(cf.saleProducts)
      ? (cf.saleProducts as Array<Record<string, unknown>>)
      : null

  let draft: Array<{ label: string; qty: number }> = []
  if (rawOrder?.length) {
    draft = rawOrder.map((l, i) => ({
      label: String(l.label ?? l.name ?? l.productName ?? `Product ${i + 1}`),
      qty: Math.max(1, Math.floor(Number(l.qty ?? l.quantity ?? 1)) || 1),
    }))
  } else if (Array.isArray(cf.stampLines) && cf.stampLines.length) {
    draft = (cf.stampLines as Array<Record<string, unknown>>).map((l, i) => ({
      label: String(l.label ?? `Product ${i + 1}`),
      qty: Math.max(1, Math.floor(Number(l.qty ?? l.quantity ?? 1)) || 1),
    }))
  } else {
    const labels = parseProductStampLines(row?.productName ? String(row.productName) : null)
    const totalQty = Math.max(1, Math.floor(Number(row?.qty) || 0) || labels.length)
    if (labels.length === 1) {
      draft = [{ label: labels[0], qty: totalQty }]
    } else {
      // Multi product names (e.g. "Superstar, Billing Pro") → 1 each unless machinesNeeded says more
      draft = labels.map((label) => ({ label, qty: 1 }))
      const fromCf =
        typeof cf.machinesNeeded === 'number' && Number.isFinite(cf.machinesNeeded)
          ? Math.max(1, Number(cf.machinesNeeded))
          : 0
      if (fromCf > draft.length) {
        // Extra units go onto the first line (same-model extras)
        draft[0].qty += fromCf - draft.length
      }
    }
  }

  // Assign release lines to order lines by label (then fill gaps)
  const usedRel = new Set<number>()
  return draft.map((d, index) => {
    let reduced = 0
    for (let ri = 0; ri < releaseLines.length; ri++) {
      if (usedRel.has(ri)) continue
      const relLabel = String(releaseLines[ri].label ?? releaseLines[ri].productName ?? '')
      if (labelsMatch(relLabel, d.label)) {
        usedRel.add(ri)
        reduced += 1
        if (reduced >= d.qty) break
      }
    }
    // If still short, claim unlabeled / leftover release slots in order
    if (reduced < d.qty) {
      for (let ri = 0; ri < releaseLines.length && reduced < d.qty; ri++) {
        if (usedRel.has(ri)) continue
        const relLabel = String(releaseLines[ri].label ?? '')
        if (!relLabel.trim()) {
          usedRel.add(ri)
          reduced += 1
        }
      }
    }
    const remaining = Math.max(0, d.qty - reduced)
    return {
      label: d.label,
      qty: d.qty,
      reduced,
      remaining,
      done: remaining === 0,
      index,
    }
  })
}

/** How many machines still need stock-out on a multi-product sale. */
export function releaseStockProgress(
  row: {
    status?: unknown
    qty?: unknown
    productName?: unknown
    customFields?: unknown
  } | null | undefined,
): {
  releaseLines: Array<Record<string, unknown>>
  productLabels: string[]
  orderLines: ReleaseOrderLine[]
  /** Next product line that still needs units (null if all done) */
  activeLine: ReleaseOrderLine | null
  needed: number
  reducedCount: number
  remaining: number
  allReduced: boolean
  partial: boolean
} {
  const cf =
    row?.customFields && typeof row.customFields === 'object'
      ? (row.customFields as Record<string, unknown>)
      : {}
  const releaseLines = Array.isArray(cf.releaseLines)
    ? (cf.releaseLines as Array<Record<string, unknown>>)
    : []
  const orderLines = releaseOrderLines(row)
  const productLabels = orderLines.map((l) => l.label)
  const needed = orderLines.reduce((s, l) => s + l.qty, 0) || Math.max(1, Number(row?.qty) || 1)
  const reducedCount = orderLines.reduce((s, l) => s + l.reduced, 0)
  const remaining = orderLines.reduce((s, l) => s + l.remaining, 0)
  const allReduced = remaining === 0 && needed > 0
  const activeLine = orderLines.find((l) => !l.done) ?? null
  return {
    releaseLines,
    productLabels,
    orderLines,
    activeLine,
    needed,
    reducedCount,
    remaining,
    allReduced,
    partial: reducedCount > 0 && !allReduced,
  }
}

/** True when catalog product name matches the ordered product label. */
export function productMatchesOrderLabel(
  product: { name?: unknown } | null | undefined,
  orderLabel: string,
): boolean {
  if (!product) return false
  return labelsMatch(String(product.name ?? ''), orderLabel)
}

export function inventoryStepDoneFlags(row: InventoryReleaseRow | null | undefined): boolean[] {
  if (!row) return INVENTORY_FLOW_STEPS.map(() => false)
  const st = String(row.status ?? '')
  const cf =
    row.customFields && typeof row.customFields === 'object'
      ? row.customFields
      : {}
  const notified = Boolean(cf.inventoryNotifiedAt) || st === 'APPROVED' || st === 'FULFILLED'
  const checked = Boolean(row.productName) || Boolean(row.serialNo) || Boolean(row.stockUnitId)
  const stamped =
    Boolean(cf.stampingConfirmedAt) ||
    Boolean(cf.stampingSkipped) ||
    (Array.isArray(cf.stampLines) &&
      (cf.stampLines as Array<{ confirmed?: boolean }>).length > 0 &&
      (cf.stampLines as Array<{ confirmed?: boolean }>).every((l) => l.confirmed))
  const { allReduced } = releaseStockProgress(row)
  const saleDc = Boolean(cf.saleDcNo || cf.saleDeliveryChallan)
  const shipped = Boolean(row.shippedAt)
  return [notified, checked && notified, stamped && notified, allReduced, saleDc, shipped]
}

/** Split multi-product productName for per-line stamping confirm. */
export function parseProductStampLines(productName?: string | null): string[] {
  const raw = String(productName ?? '').trim()
  if (!raw) return ['Product']
  const parts = raw
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts : [raw]
}

/** Suggest Yes for weighing-like names; billing/POS suggest No — inventory still confirms. */
export function suggestStampingRequired(label: string): boolean {
  const n = label.toLowerCase()
  if (/bill|pos|touch|software|printer|cctv|biometric/.test(n)) return false
  return /scale|weigh|balance|platform|ws\b/.test(n)
}

export function inventoryActiveStepIndex(flags: boolean[]): number {
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) return i
  }
  return Math.max(0, flags.length - 1)
}
