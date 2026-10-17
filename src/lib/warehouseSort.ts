/** Keep in sync with backend STANDARD_WAREHOUSES order. */
const STANDARD_CODE_ORDER = ['MAIN', 'STORE', 'DEMO', 'EXECUTIVE', 'STAMPING'] as const

/**
 * Dropdown order: Main warehouse first, then other standard codes,
 * then custom warehouses A→Z by name.
 */
export function sortWarehousesForDropdown<
  T extends { code?: string | null; name?: string | null; isDefault?: boolean | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aCode = String(a.code ?? '').toUpperCase()
    const bCode = String(b.code ?? '').toUpperCase()
    const aDefault = Boolean(a.isDefault) || aCode === 'MAIN'
    const bDefault = Boolean(b.isDefault) || bCode === 'MAIN'
    if (aDefault !== bDefault) return aDefault ? -1 : 1
    const ai = STANDARD_CODE_ORDER.indexOf(aCode as (typeof STANDARD_CODE_ORDER)[number])
    const bi = STANDARD_CODE_ORDER.indexOf(bCode as (typeof STANDARD_CODE_ORDER)[number])
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    }
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, {
      sensitivity: 'base',
    })
  })
}

export function preferMainWarehouseId<
  T extends { id: string; code?: string | null; isDefault?: boolean | null },
>(rows: T[]): string {
  const main =
    rows.find((w) => Boolean(w.isDefault) || String(w.code ?? '').toUpperCase() === 'MAIN') ??
    rows[0]
  return main ? String(main.id) : ''
}
