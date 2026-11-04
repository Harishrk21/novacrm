/** Default page size for CRM list tables (contacts, leads, tickets, inventory, …). */
export const PAGE_SIZE = 25

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size))
}

export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, size))
}

export function pageRange(page: number, total: number, size = PAGE_SIZE) {
  const safe = clampPage(page, total, size)
  if (total <= 0) return { page: 1, from: 0, to: 0, pages: 1 }
  const from = (safe - 1) * size + 1
  const to = Math.min(safe * size, total)
  return { page: safe, from, to, pages: pageCount(total, size) }
}

export function slicePage<T>(items: T[], page: number, size = PAGE_SIZE): T[] {
  const { page: safe } = pageRange(page, items.length, size)
  const start = (safe - 1) * size
  return items.slice(start, start + size)
}
