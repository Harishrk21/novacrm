import type { FlowStep } from '@/components/ui/FlowStepBar'
import { parseProductStampLines } from '@/lib/inventoryFlow'

/** Demo is optional — not part of the required progress bar. */
export const SALES_FLOW_STEPS: FlowStep[] = [
  { key: 'enquiry', label: 'Enquiry', hint: 'Details filled' },
  { key: 'followup', label: 'Follow-up', hint: 'Call / reminder' },
  { key: 'ready', label: 'Ready to buy', hint: 'Customer linked' },
  { key: 'requisition', label: 'Admin sign-off', hint: 'Requisition' },
  { key: 'inventory', label: 'Stock out', hint: 'Inventory reduce' },
  { key: 'ship', label: 'Ready to ship', hint: 'Delivery' },
  { key: 'payment', label: 'PI / Payment', hint: 'Sales team' },
]

export type SalesRequisitionRow = {
  id: string
  reqNumber?: string
  status?: string
  shippedAt?: string | null
  invoiceId?: string | null
  advanceAmount?: number
  paymentNotes?: string | null
  rejectedReason?: string | null
  productName?: string | null
  serialNo?: string | null
  stockUnitId?: string | null
  productId?: string | null
  qty?: number
  customFields?: Record<string, unknown> | null
}

/** Merge live requisition + lead.inventoryRelease mirror (inventory sync). */
export function resolveSaleRelease(
  lead: Record<string, unknown> | null | undefined,
  requisition?: SalesRequisitionRow | null,
): {
  status: string
  shippedAt: string | null
  stockReducedAt: string | null
  invoiceId: string | null
  advanceAmount: number
  paymentNotes: string | null
  productName: string | null
  qty: number
  releaseLines: Array<Record<string, unknown>>
  stampLines: Array<Record<string, unknown>>
  machinesNeeded: number
  machinesReduced: number
  inventoryDone: boolean
  shipped: boolean
} {
  const lcf =
    lead?.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {}
  const mirror =
    lcf.inventoryRelease && typeof lcf.inventoryRelease === 'object'
      ? (lcf.inventoryRelease as Record<string, unknown>)
      : null
  const reqCf =
    requisition?.customFields && typeof requisition.customFields === 'object'
      ? requisition.customFields
      : null

  const status = String(requisition?.status ?? mirror?.status ?? '')
  const shippedAt =
    (requisition?.shippedAt ? String(requisition.shippedAt) : null) ||
    (mirror?.shippedAt ? String(mirror.shippedAt) : null) ||
    null
  const stockReducedAt =
    (reqCf?.stockReducedAt ? String(reqCf.stockReducedAt) : null) ||
    (mirror?.stockReducedAt ? String(mirror.stockReducedAt) : null) ||
    null
  const releaseLines = Array.isArray(reqCf?.releaseLines)
    ? (reqCf!.releaseLines as Array<Record<string, unknown>>)
    : Array.isArray(mirror?.releaseLines)
      ? (mirror!.releaseLines as Array<Record<string, unknown>>)
      : []
  const stampLines = Array.isArray(reqCf?.stampLines)
    ? (reqCf!.stampLines as Array<Record<string, unknown>>)
    : Array.isArray(mirror?.stampLines)
      ? (mirror!.stampLines as Array<Record<string, unknown>>)
      : []
  const productName =
    (requisition?.productName ? String(requisition.productName) : null) ||
    (mirror?.productName ? String(mirror.productName) : null) ||
    null
  const nameParts = parseProductStampLines(productName)
  const machinesNeeded = Math.max(
    1,
    stampLines.length,
    typeof reqCf?.machinesNeeded === 'number' ? Number(reqCf.machinesNeeded) : 0,
    typeof mirror?.machinesNeeded === 'number' ? Number(mirror.machinesNeeded) : 0,
    Number(requisition?.qty) || 0,
    nameParts.length,
  )
  const machinesReduced = releaseLines.length
  const inventoryDone =
    status === 'FULFILLED' ||
    Boolean(stockReducedAt) ||
    machinesReduced >= machinesNeeded ||
    (Array.isArray(mirror?.products) &&
      (mirror!.products as Array<{ stockReduced?: boolean }>).length > 0 &&
      (mirror!.products as Array<{ stockReduced?: boolean }>).every((p) => p.stockReduced))

  return {
    status,
    shippedAt,
    stockReducedAt,
    invoiceId:
      (requisition?.invoiceId ? String(requisition.invoiceId) : null) ||
      (mirror?.invoiceId ? String(mirror.invoiceId) : null) ||
      null,
    advanceAmount: Number(requisition?.advanceAmount ?? lcf.saleAdvanceAmount ?? 0),
    paymentNotes: requisition?.paymentNotes ? String(requisition.paymentNotes) : null,
    productName,
    qty: Number(requisition?.qty) || 1,
    releaseLines,
    stampLines,
    machinesNeeded,
    machinesReduced,
    inventoryDone,
    shipped: Boolean(shippedAt),
  }
}

export function salesStepDoneFlags(input: {
  lead: Record<string, unknown> | null
  activities?: Array<Record<string, unknown>>
  requisition?: SalesRequisitionRow | null
}): boolean[] {
  const lead = input.lead
  if (!lead) return SALES_FLOW_STEPS.map(() => false)

  const status = String(lead.status ?? 'NEW')
  const cf =
    lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {}

  const hasEnquiry =
    Boolean(String(lead.name ?? '').trim()) &&
    (Boolean(String(lead.phone ?? '').trim()) || Boolean(String(lead.email ?? '').trim()))

  const acts = input.activities ?? []
  const hasFollowup =
    acts.some((a) =>
      ['CALL', 'TASK', 'MEETING', 'NOTE', 'WHATSAPP', 'VISIT'].includes(String(a.type)),
    ) ||
    Boolean(cf.nextFollowUpAt) ||
    Boolean(cf.follow_up_date) ||
    Boolean(cf.lastTouchedAt) ||
    ['CONTACTED', 'QUALIFIED', 'DEMO', 'CONVERTED'].includes(status)

  const readyBuy =
    status === 'CONVERTED' ||
    Boolean(lead.convertedContactId) ||
    Boolean(cf.contact_id)

  const release = resolveSaleRelease(lead, input.requisition)
  const requisitionApproved = ['APPROVED', 'FULFILLED'].includes(release.status)
  const paymentDone =
    Boolean(release.invoiceId) ||
    Boolean(cf.saleCompletedAt) ||
    Number(cf.salePaymentTotal ?? cf.budget ?? 0) > 0 ||
    Number(release.advanceAmount) > 0 ||
    Boolean(release.paymentNotes) ||
    Boolean(cf.lastPaymentFollowupAt) ||
    (Array.isArray(input.requisition?.customFields?.paymentFollowups) &&
      (input.requisition!.customFields!.paymentFollowups as unknown[]).length > 0)

  return [
    hasEnquiry,
    hasFollowup,
    readyBuy,
    requisitionApproved,
    release.inventoryDone,
    release.shipped,
    paymentDone,
  ]
}

export function saleAllStepsDone(flags: boolean[]): boolean {
  return flags.length > 0 && flags.every(Boolean)
}

export function saleIsCompleted(lead: Record<string, unknown> | null | undefined): boolean {
  if (!lead) return false
  const cf =
    lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {}
  return Boolean(cf.saleCompletedAt)
}

/** True when stock is out and PI has not been raised yet. */
export function saleReadyForProforma(
  lead: Record<string, unknown> | null | undefined,
  requisition?: SalesRequisitionRow | null,
): boolean {
  const release = resolveSaleRelease(lead, requisition)
  if (!release.inventoryDone) return false
  if (release.invoiceId) return false
  const cf =
    lead?.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {}
  if (cf.invoiceId || cf.saleInvoiceId) return false
  return true
}

/**
 * Deep-link into Proforma create with sale context.
 * Invoices page loads lead + requisition and fills customer, lines, serials, amounts.
 */
export function buildSaleProformaHref(opts: {
  leadId: string
  requisitionId?: string | null
  contactId?: string | null
  productId?: string | null
  serialNo?: string | null
  stockUnitId?: string | null
  unitPrice?: number | string | null
}): string {
  const q = new URLSearchParams()
  q.set('open', '1')
  q.set('fromSale', '1')
  q.set('leadId', opts.leadId)
  if (opts.requisitionId) q.set('requisitionId', opts.requisitionId)
  if (opts.contactId) q.set('contactId', opts.contactId)
  if (opts.productId) q.set('productId', opts.productId)
  if (opts.serialNo) q.set('serialNo', opts.serialNo)
  if (opts.stockUnitId) q.set('stockUnitId', opts.stockUnitId)
  if (opts.unitPrice != null && opts.unitPrice !== '') q.set('unitPrice', String(opts.unitPrice))
  return `/erp/invoices?${q.toString()}`
}

export function salesStepBlockers(
  stepIndex: number,
  flags: boolean[],
  input: {
    status: string
    requisition?: SalesRequisitionRow | null
    lead?: Record<string, unknown> | null
    role?: string | null
  },
): string[] {
  const missing: string[] = []
  const release = resolveSaleRelease(input.lead ?? null, input.requisition)
  const st = release.status

  if (stepIndex <= 0) return missing

  for (let i = 0; i < stepIndex; i++) {
    if (flags[i]) continue
    switch (i) {
      case 0:
        missing.push('Complete enquiry name + phone/email')
        break
      case 1:
        missing.push('Log a follow-up or schedule a reminder')
        break
      case 2:
        missing.push('Link customer / convert (Ready to buy)')
        break
      case 3:
        if (st === 'PENDING_APPROVAL') missing.push('Waiting for admin to sign the requisition')
        else if (st === 'REJECTED') missing.push('Requisition was rejected — resubmit')
        else missing.push('Submit sales requisition for admin approval')
        break
      case 4:
        missing.push(
          release.machinesNeeded > 1
            ? `Inventory must reduce all machines (${release.machinesReduced}/${release.machinesNeeded})`
            : 'Inventory must reduce stock for this sale',
        )
        break
      case 5:
        missing.push('Inventory must mark ready to ship')
        break
      case 6:
        missing.push('Record PI / payment (total or advance) on this sale')
        break
      default:
        break
    }
  }
  return missing
}

/** Map step key → page section id for click navigation */
export function salesStepSectionId(key: string): string {
  switch (key) {
    case 'enquiry':
      return 'section-enquiry'
    case 'followup':
      return 'section-followup'
    case 'ready':
      return 'section-ready'
    case 'requisition':
      return 'section-requisition'
    case 'inventory':
    case 'ship':
      return 'section-requisition'
    case 'payment':
      return 'section-payment'
    default:
      return 'section-enquiry'
  }
}
