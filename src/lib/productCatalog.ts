export const WARRANTY_MONTH_OPTIONS = [
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '12 months' },
  { value: '24', label: '24 months' },
  { value: '36', label: '36 months' },
] as const

export const PRODUCT_NAME_MAX = 191

export function productAttrs(source: { attributes?: unknown } | Record<string, unknown> | null | undefined) {
  if (!source || typeof source !== 'object') return {} as Record<string, unknown>
  const raw =
    'attributes' in source && source.attributes && typeof source.attributes === 'object'
      ? source.attributes
      : source
  return (raw as Record<string, unknown>) ?? {}
}

export function defaultRequiresStamping(catalogKind: string) {
  return catalogKind === 'WEIGHING'
}

/** Weighing machines usually have no supplier serial — identified by HMS Unique ID. */
export function isWeighingCatalogProduct(
  source: { attributes?: unknown; sku?: string } | Record<string, unknown> | null | undefined,
) {
  const a = productAttrs(source)
  const family = String(a.familyCode ?? a.catalogFamily ?? '').toUpperCase()
  const kind = String(a.catalogKind ?? '').toUpperCase()
  if (family === 'WEIGHING_SCALES' || kind === 'WEIGHING') return true
  const sku = String(
    (source && typeof source === 'object' && 'sku' in source ? source.sku : '') ?? '',
  ).toUpperCase()
  return sku.includes('-WS-') || sku.startsWith('HMS-WS')
}

/** Catalog product flag — when false, hide stamping fields across inventory, service & stamping register. */
export function productRequiresStamping(
  source: { attributes?: unknown } | Record<string, unknown> | null | undefined,
) {
  const a = productAttrs(source)
  if (typeof a.requiresStamping === 'boolean') return a.requiresStamping
  return defaultRequiresStamping(String(a.catalogKind ?? ''))
}

export function machineTypeRequiresStamping(
  machineType: string,
  catalogProducts: Array<{ attributes?: unknown }>,
) {
  const match = catalogProducts.find(
    (p) => String(productAttrs(p).catalogKind ?? '') === machineType,
  )
  if (match) return productRequiresStamping(match)
  return defaultRequiresStamping(machineType)
}

export function assetRequiresStamping(asset: {
  machineType?: string | null
  product?: { attributes?: unknown } | null
}) {
  if (asset.product) return productRequiresStamping(asset.product)
  return String(asset.machineType ?? 'WEIGHING') === 'WEIGHING'
}

export function formatWarrantyMonths(value: unknown) {
  if (value == null || value === '') return '—'
  const months = Number(value)
  if (!Number.isNaN(months) && months > 0) return `${months} month${months === 1 ? '' : 's'}`
  return String(value)
}

export function warrantyMonthsFromAttrs(attrs: Record<string, unknown>) {
  if (attrs.warrantyMonths != null && attrs.warrantyMonths !== '') return String(attrs.warrantyMonths)
  const legacy = String(attrs.warranty ?? '').trim()
  const match = legacy.match(/^(\d+)/)
  return match ? match[1] : ''
}

export function truncateProductName(name: string, max = PRODUCT_NAME_MAX) {
  const trimmed = name.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

/** Same machine families as Add / Reduce stock. */
export const HMS_MACHINE_TYPES = [
  { value: 'WEIGHING_SCALES', label: 'Weighing' },
  { value: 'BILLING_MACHINE', label: 'Billing' },
  { value: 'TOUCH_POS', label: 'Touch POS' },
  { value: 'CASH_COUNTING', label: 'Cash Counting' },
  { value: 'OFFICE_AUTOMATION', label: 'Office Automation' },
  { value: 'BILLING_SOFTWARE', label: 'Billing Software' },
] as const

export type HmsMachineType = (typeof HMS_MACHINE_TYPES)[number]['value']

export function productMatchesHmsType(
  p: { attributes?: unknown; sku?: string } | Record<string, unknown> | null | undefined,
  type: string,
) {
  const a = productAttrs(p)
  const fam = String(a.catalogFamily ?? a.familyCode ?? '')
  const kind = String(a.catalogKind ?? '')
  if (type === 'CASH_COUNTING') return kind === 'CCM'
  if (type === 'OFFICE_AUTOMATION') return fam === 'OFFICE_AUTOMATION' && kind !== 'CCM'
  return fam === type
}

export function productMatchesBrand(
  p: { attributes?: unknown; name?: string } | Record<string, unknown> | null | undefined,
  brandId: string,
  brandName?: string,
) {
  if (!brandId && !brandName) return true
  const a = productAttrs(p)
  const pid = String(a.brandId ?? a.brand_id ?? '')
  if (brandId && pid && pid === brandId) return true
  const pname = String(a.brand ?? a.brandName ?? '').toLowerCase()
  const needle = (brandName ?? '').toLowerCase()
  if (needle && pname && (pname === needle || pname.includes(needle))) return true
  const name = String(
    p && typeof p === 'object' && 'name' in p ? (p as { name?: unknown }).name : '',
  ).toLowerCase()
  if (needle && name.includes(needle)) return true
  return !pid && !pname
}

export function assetTypeFromHmsType(type: string): string {
  if (type === 'WEIGHING_SCALES') return 'WEIGHING'
  if (type === 'CASH_COUNTING') return 'CCM'
  if (type === 'BILLING_MACHINE' || type === 'TOUCH_POS' || type === 'BILLING_SOFTWARE') {
    return 'BILLING'
  }
  return 'OTHER'
}
