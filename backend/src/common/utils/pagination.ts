/**
 * Default page size 20.
 * Hard cap 200 — enough for serial pickers, tight enough for concurrent tenants.
 * Prefer page+limit on the client instead of limit=500.
 */
export function pagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const requested = Number(query.limit) || 20
  const limit = Math.min(200, Math.max(1, requested))
  return { page, limit, skip: (page - 1) * limit, take: limit }
}
export function pageResult<T>(items: T[], total: number, page: number, limit: number) {
  return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } }
}
