import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type PageTab = {
  id: string
  label: string
  count?: number
}

type Accent = 'theme' | 'sky' | 'emerald' | 'violet' | 'amber'

const accentActive: Record<Exclude<Accent, 'theme'>, string> = {
  sky: 'bg-sky-600 text-white shadow-sm shadow-sky-600/25',
  emerald: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25',
  violet: 'bg-violet-600 text-white shadow-sm shadow-violet-600/25',
  amber: 'bg-amber-600 text-white shadow-sm shadow-amber-600/25',
}

const accentWrap: Record<Exclude<Accent, 'theme'>, string> = {
  sky: 'border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-cyan-50',
  emerald: 'border-emerald-200/80 bg-gradient-to-r from-emerald-50 via-white to-teal-50',
  violet: 'border-violet-200/80 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50',
  amber: 'border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-orange-50',
}

interface PageTabsProps {
  tabs: PageTab[]
  active: string
  onChange: (id: string) => void
  accent?: Accent
  className?: string
  children?: ReactNode
}

/** Same-page switcher — default accent follows Color palette. */
export function PageTabs({
  tabs,
  active,
  onChange,
  accent = 'theme',
  className,
  children,
}: PageTabsProps) {
  const themed = accent === 'theme'

  return (
    <div className={cn('mb-5', className)}>
      <div
        className={cn(
          'inline-flex flex-wrap gap-1 rounded-[14px] border p-1.5',
          themed ? 'border-border' : accentWrap[accent],
        )}
        style={
          themed
            ? {
                background: `linear-gradient(90deg, var(--color-panel-from), var(--color-card), var(--color-panel-to))`,
              }
            : undefined
        }
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={cn(
                'rounded-[10px] px-4 py-2 text-sm font-medium transition-all',
                isActive
                  ? themed
                    ? 'text-white shadow-sm'
                    : accentActive[accent]
                  : 'text-text-secondary hover:bg-card/80 hover:text-text-primary',
              )}
              style={
                isActive && themed
                  ? { backgroundColor: 'var(--color-accent-blue)' }
                  : undefined
              }
            >
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span
                  className={cn(
                    'ml-2 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                    isActive ? 'bg-white/25' : 'bg-muted text-text-secondary',
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {children}
    </div>
  )
}
