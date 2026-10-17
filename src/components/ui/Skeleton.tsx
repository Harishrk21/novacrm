import Skeleton, { SkeletonTheme } from 'react-loading-skeleton'
import { cn } from '@/lib/utils'

export { Skeleton }

/** Theme-aware wrapper so skeletons follow light/dark + accent soft tones. */
export function SkeletonProvider({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <SkeletonTheme
      baseColor="var(--color-muted, #e5e7eb)"
      highlightColor="var(--color-card, #f9fafb)"
      borderRadius={8}
      duration={0.75}
    >
      <div className={className}>{children}</div>
    </SkeletonTheme>
  )
}

/** Compact session bootstrap — avoid a heavy full-dashboard fake layout. */
export function SessionSkeleton({ variant = 'tenant' }: { variant?: 'tenant' | 'platform' }) {
  const dark = variant === 'platform'
  return (
    <div
      className={cn(
        'flex min-h-screen flex-col items-center justify-center gap-4 p-6',
        dark ? 'bg-slate-950' : 'bg-surface',
      )}
    >
      <SkeletonTheme
        baseColor={dark ? '#1e293b' : 'var(--color-muted, #e5e7eb)'}
        highlightColor={dark ? '#334155' : 'var(--color-card, #f9fafb)'}
        borderRadius={8}
        duration={0.7}
      >
        <Skeleton width={48} height={48} circle />
        <Skeleton width={160} height={14} />
        <Skeleton width={220} height={10} />
      </SkeletonTheme>
    </div>
  )
}

/** Generic page body while data loads. */
export function PageSkeleton({
  cards = 2,
  rows = 4,
  className,
}: {
  cards?: number
  rows?: number
  className?: string
}) {
  return (
    <SkeletonProvider className={cn('space-y-3', className)}>
      <Skeleton height={22} width="28%" />
      <Skeleton height={12} width="40%" />
      {cards > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} height={72} />
          ))}
        </div>
      ) : null}
      <div className="space-y-2 rounded-[10px] border border-border bg-card p-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height={32} />
        ))}
      </div>
    </SkeletonProvider>
  )
}

/** Table / list loading block. */
export function TableSkeleton({
  rows = 5,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <SkeletonProvider className={cn('space-y-2 p-3', className)}>
      <Skeleton height={14} width="24%" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={34} />
      ))}
    </SkeletonProvider>
  )
}

/** Detail page (ticket / contact / deal) loading. */
export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonProvider className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton height={14} width="20%" />
          <Skeleton height={28} width="45%" />
        </div>
        <Skeleton height={36} width={120} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Skeleton height={160} />
          <Skeleton height={220} />
        </div>
        <div className="space-y-3">
          <Skeleton height={120} />
          <Skeleton height={160} />
        </div>
      </div>
    </SkeletonProvider>
  )
}

/** Compact block for cards / panels. */
export function BlockSkeleton({
  lines = 4,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <SkeletonProvider className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={i === 0 ? 20 : 14} width={i === 0 ? '40%' : '100%'} />
      ))}
    </SkeletonProvider>
  )
}

/** Dashboard KPI strip. */
export function StatsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <SkeletonProvider className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={88} />
      ))}
    </SkeletonProvider>
  )
}
