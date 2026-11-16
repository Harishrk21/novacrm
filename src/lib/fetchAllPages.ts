/**
 * The API returns at most 200 rows per request. List pages that filter / count / page on the
 * client need every row — otherwise records past the first page silently disappear (Contacts and
 * Leads used to stop at 100, Delivery challans at 80). Reads page 1, then fetches the remaining
 * pages 4 at a time. `max` is a safety ceiling.
 */
type PageLike<T> = { items?: T[]; meta?: { total?: number; pages?: number } | Record<string, unknown> }

const PAGE = 200

export async function fetchAllPages<T>(
  fetchPage: (p: { page: number; limit: number }) => Promise<PageLike<T>>,
  max = 5000,
): Promise<T[]> {
  const first = await fetchPage({ page: 1, limit: PAGE })
  const out: T[] = [...(first.items ?? [])]
  const meta = (first.meta ?? {}) as { total?: number; pages?: number }
  const total = Math.min(Number(meta.total ?? out.length) || out.length, max)
  const pages = Math.min(Number(meta.pages ?? Math.ceil(total / PAGE)) || 1, Math.ceil(max / PAGE))
  if ((first.items ?? []).length < PAGE || pages <= 1) return out
  for (let start = 2; start <= pages; start += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - start + 1) }, (_, i) => fetchPage({ page: start + i, limit: PAGE })),
    )
    for (const r of batch) out.push(...(r.items ?? []))
  }
  return out.slice(0, max)
}

/** Same as fetchAllPages but keeps the `{ items, meta }` shape existing callers expect. */
export async function fetchAllAsPage<T>(
  fetchPage: (p: { page: number; limit: number }) => Promise<PageLike<T>>,
  max = 5000,
): Promise<{ items: T[]; meta: { total: number; page: number; limit: number; pages: number } }> {
  const items = await fetchAllPages(fetchPage, max)
  return { items, meta: { total: items.length, page: 1, limit: items.length, pages: 1 } }
}
