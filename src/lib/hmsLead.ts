/** HMS sale-tracking: service types, enquiry sources, lead stage pipeline */

export const HMS_SERVICE_TYPES = [
  { value: 'SALES', label: 'Sales', hint: 'New machine / product sale — you own this' },
  {
    value: 'SERVICE',
    label: 'Service',
    hint: 'Repair / breakdown / AMC visit — notify service desk',
  },
  {
    value: 'STAMPING',
    label: 'Stamping',
    hint: 'Govt verification / stamp — notify service desk',
  },
  {
    value: 'RENTAL',
    label: 'Rental',
    hint: 'Hire machine — notify service desk, then issue from Rentals',
  },
  {
    value: 'RENEWAL',
    label: 'Renewal',
    hint: 'AMC / stamping renewal — notify service desk',
  },
] as const

export type HmsServiceType = (typeof HMS_SERVICE_TYPES)[number]['value']

/**
 * Way of enquiries — exact HMS labels.
 * Matched to LeadSource.name (case-insensitive / aliases).
 */
export const HMS_WAY_OF_ENQUIRIES = [
  {
    code: 'ADV_JD_IM',
    label: 'ADV-JD, IM',
    aliases: ['ADV-JD, IM', 'ADV-JD,IM', 'Advertisement', 'Just Dial', 'IndiaMART', 'India Mart'],
  },
  {
    code: 'OFFICE_VISIT',
    label: 'OFFICE VISIT',
    aliases: ['Office Visit', 'OFFICE VISIT'],
  },
  {
    code: 'SHOWROOM',
    label: 'SHOWROOM',
    aliases: ['Showroom', 'SHOWROOM'],
  },
  {
    code: 'CUS_CARE_DEPT',
    label: 'CUS CARE DEPT',
    aliases: ['Customer Care', 'CUS CARE DEPT', 'Cus Care Dept', 'Customer Care Dept'],
  },
  {
    code: 'WEBSITE_CALLS',
    label: 'WEBSITE CALLS',
    aliases: ['Website Call', 'Website Calls', 'WEBSITE CALLS'],
  },
  {
    code: 'WEBSITE_MAILS',
    label: 'WEBSITE MAILS',
    aliases: ['Website Mail', 'Website Mails', 'WEBSITE MAILS'],
  },
  {
    code: 'EXPO_CALLS',
    label: 'EXPO CALLS',
    aliases: ['Expo Call', 'Expo Calls', 'EXPO CALLS', 'Exhibition'],
  },
  {
    code: 'INSTAGRAM',
    label: 'INSTAGRAM',
    aliases: ['Instagram', 'INSTAGRAM'],
  },
] as const

/** Zoho-style lead stage strip — maps to LeadStatus */
export const HMS_LEAD_PIPELINE = [
  { value: 'NEW', label: 'Not Contacted', short: 'New' },
  { value: 'CONTACTED', label: 'Contacted', short: 'Contacted' },
  { value: 'QUALIFIED', label: 'Pre-Qualified', short: 'Qualified' },
  { value: 'DEMO', label: 'Demo', short: 'Demo' },
  { value: 'CONVERTED', label: 'Won', short: 'Won' },
  { value: 'LOST', label: 'Sales closed', short: 'Closed' },
  { value: 'UNQUALIFIED', label: 'Junk / NQ', short: 'Junk' },
] as const

export type HmsLeadStatus = (typeof HMS_LEAD_PIPELINE)[number]['value']

export function leadPipelineLabel(status: string) {
  return HMS_LEAD_PIPELINE.find((s) => s.value === status)?.label ?? status
}

/** Resolve HMS enquiry way → sourceId from API lookups */
export function matchEnquirySourceId(
  sources: Array<{ id: string; name: string }>,
  wayCode: string,
): string {
  const way = HMS_WAY_OF_ENQUIRIES.find((w) => w.code === wayCode)
  if (!way) return ''
  const aliases = way.aliases.map((a) => a.toLowerCase().replace(/\s+/g, ''))
  const hit = sources.find((s) => {
    const n = s.name.toLowerCase().replace(/\s+/g, '')
    return aliases.some((a) => n === a || n.includes(a) || a.includes(n))
  })
  return hit?.id ?? ''
}

export function enquiryWayFromSourceName(name: string | null | undefined): string {
  if (!name) return ''
  const n = name.toLowerCase().replace(/\s+/g, '')
  for (const w of HMS_WAY_OF_ENQUIRIES) {
    if (w.aliases.some((a) => {
      const al = a.toLowerCase().replace(/\s+/g, '')
      return n === al || n.includes(al) || al.includes(n)
    })) {
      return w.code
    }
  }
  return ''
}

/** Canonical names to upsert in seed / ensureSources */
export const HMS_LEAD_SOURCE_SEED = HMS_WAY_OF_ENQUIRIES.map((w) => w.label)

export type LeadOrderedProduct = {
  id?: string
  name: string
  qty: number
}

function productsFromUnknownArray(arr: unknown): LeadOrderedProduct[] {
  if (!Array.isArray(arr)) return []
  const out: LeadOrderedProduct[] = []
  for (const raw of arr) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const name = String(r.name ?? r.label ?? r.productName ?? '').trim()
    if (!name) continue
    const qty = Math.max(1, Math.floor(Number(r.qty ?? r.quantity ?? 1)) || 1)
    out.push({
      id: r.id != null ? String(r.id) : undefined,
      name,
      qty,
    })
  }
  return out
}

/** Products the customer asked for — order lines, sale products, or comma-split names. */
export function leadOrderedProducts(
  cf: Record<string, unknown> | null | undefined,
): LeadOrderedProduct[] {
  if (!cf) return []
  const fromLines = productsFromUnknownArray(cf.orderLines)
  if (fromLines.length) return fromLines
  const fromSale = productsFromUnknownArray(cf.saleProducts)
  if (fromSale.length) return fromSale
  const fromInterested = productsFromUnknownArray(cf.interested_products)
  if (fromInterested.length) return fromInterested

  const blob = String(
    cf.interested_product_name ?? cf.product_interest ?? cf.requirement ?? '',
  ).trim()
  if (!blob) return []
  return blob
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, qty: 1 }))
}
