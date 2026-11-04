import { useEffect, useMemo, useState } from 'react'
import { PAGE_SIZE, clampPage, pageCount, pageRange, slicePage } from '@/lib/pagination'

/**
 * Client-side pagination for an in-memory row list.
 * Pass `resetKey` (search, filters, tab) so page resets to 1 when the dataset changes.
 */
export function usePagedRows<T>(items: T[], resetKey?: string | number, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [resetKey, pageSize])

  const total = items.length
  const pages = pageCount(total, pageSize)
  const pageSafe = clampPage(page, total, pageSize)
  const rows = useMemo(() => slicePage(items, pageSafe, pageSize), [items, pageSafe, pageSize])
  const { from, to } = pageRange(pageSafe, total, pageSize)

  return {
    page: pageSafe,
    setPage,
    rows,
    total,
    pages,
    from,
    to,
    pageSize,
  }
}
