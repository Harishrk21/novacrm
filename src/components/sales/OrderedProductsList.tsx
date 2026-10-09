import { cn } from '@/lib/utils'
import type { LeadOrderedProduct } from '@/lib/hmsLead'

/** Qty + model in a fixed grid so every lead row lines up. */
export function OrderedProductsList({
  products,
  empty = 'No product yet',
  className,
}: {
  products: LeadOrderedProduct[]
  empty?: string
  className?: string
}) {
  if (!products.length) {
    return <span className={cn('text-xs text-text-secondary', className)}>{empty}</span>
  }
  const total = products.reduce((s, p) => s + p.qty, 0)
  return (
    <div className={cn('min-w-[200px]', className)}>
      <div className="mb-1 grid grid-cols-[2.5rem_1fr] gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        <span>Qty</span>
        <span>Model</span>
      </div>
      <ul className="divide-y divide-border/80">
        {products.map((p, i) => (
          <li
            key={`${p.id ?? p.name}-${i}`}
            className="grid grid-cols-[2.5rem_1fr] items-start gap-2 py-1 first:pt-0 last:pb-0"
          >
            <span className="pt-0.5 tabular-nums text-xs font-semibold text-text-secondary">
              {p.qty}
            </span>
            <span className="text-sm font-medium leading-snug text-text-primary">{p.name}</span>
          </li>
        ))}
      </ul>
      {products.length > 1 ? (
        <div className="mt-1 text-[10px] text-text-secondary">
          {products.length} models · {total} unit{total === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  )
}
