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
      duration={1.2}
    >
      <div className={className}>{children}</div>
    </SkeletonTheme>
  )
}

/** Full-screen session bootstrap (replaces "Checking session…"). */
export function SessionSkeleton({ variant = 'tenant' }: { variant?: 'tenant' | 'platform' }) {
  const dark = variant === 'platform'
  return (
    <div
      className={cn(
        'flex min-h-screen flex-col gap-6 p-6 sm:p-10',
        dark ? 'bg-slate-950' : 'bg-surface',
      )}
    >
      <SkeletonTheme
        baseColor={dark ? '#1e293b' : 'var(--color-muted, #e5e7eb)'}
        highlightColor={dark ? '#334155' : 'var(--color-card, #f9fafb)'}
        borderRadius={8}
      >
        <div className="flex items-center gap-4">
          <Skeleton width={44} height={44} circle />
          <div className="flex-1">
            <Skeleton width="28%" height={18} />
            <Skeleton width="18%" height={12} className="mt-2" />
          </div>
          <Skeleton width={120} height={36} />
        </div>
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="hidden w-56 shrink-0 space-y-3 sm:block">
            <Skeleton height={28} />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={22} />
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <Skeleton height={40} width="40%" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton height={88} />
              <Skeleton height={88} />
              <Skeleton height={88} />
            </div>
            <Skeleton height={220} />
            <Skeleton height={140} />
          </div>
        </div>
      </SkeletonTheme>
    </div>
  )
}

/** Generic page body while data loads. */
export function PageSkeleton({
  cards = 3,
  rows = 6,
  className,
}: {
  cards?: number
  rows?: number
  className?: string
}) {
  return (
    <SkeletonProvider className={cn('space-y-4', className)}>
      <Skeleton height={28} width="32%" />
      <Skeleton height={14} width="48%" />
      {cards > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} height={96} />
          ))}
        </div>
      ) : null}
      <div className="space-y-2 rounded-[10px] border border-border bg-card p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height={36} />
        ))}
      </div>
    </SkeletonProvider>
  )
}

/** Table / list loading block. */
export function TableSkeleton({
  rows = 8,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <SkeletonProvider className={cn('space-y-2 p-4', className)}>
      <Skeleton height={18} width="30%" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={40} />
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
