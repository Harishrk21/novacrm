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
