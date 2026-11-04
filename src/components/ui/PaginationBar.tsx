import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_SIZE, pageRange } from '@/lib/pagination'
import { cn } from '@/lib/utils'

type Props = {
  page: number
  total: number
  pageSize?: number
  onPageChange: (page: number) => void
  /** Optional label instead of "Total Records" */
  label?: string
  className?: string
  /** Hide when only one page and no rows — default shows bar whenever total > 0 or always */
  hideWhenSinglePage?: boolean
}

/** Shared footer pager — 25 rows/page by default across CRM list tables. */
export function PaginationBar({
  page,
  total,
  pageSize = PAGE_SIZE,
  onPageChange,
  label = 'Total Records',
  className,
  hideWhenSinglePage = false,
}: Props) {
  const { page: safe, from, to, pages } = pageRange(page, total, pageSize)
  if (hideWhenSinglePage && pages <= 1 && total <= pageSize) return null

  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center justify-between gap-3 border-t border-border px-4 text-[12px] text-text-secondary',
        className,
      )}
    >
      <span>
        {label} <span className="font-medium text-text-primary">{total}</span>
        {total > 0 ? (
          <span className="ml-2 text-text-secondary">
            · {pageSize}/page
          </span>
        ) : null}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={safe <= 1}
          onClick={() => onPageChange(Math.max(1, safe - 1))}
          className="rounded p-1 hover:bg-muted disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[4.5rem] text-center tabular-nums">
          {from} to {to}
        </span>
        <button
          type="button"
          disabled={safe >= pages}
          onClick={() => onPageChange(Math.min(pages, safe + 1))}
          className="rounded p-1 hover:bg-muted disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
