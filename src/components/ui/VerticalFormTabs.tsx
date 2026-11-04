import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type VerticalFormTab = {
  id: string
  label: string
  icon?: LucideIcon
  /** Optional badge (e.g. note count) */
  count?: number
  /** Soft hint that the step still needs attention */
  alert?: boolean
}

type Accent = 'theme' | 'sky' | 'violet' | 'emerald' | 'amber'

const accentActive: Record<Exclude<Accent, 'theme'>, string> = {
  sky: 'border-sky-600 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  violet:
    'border-violet-600 bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  emerald:
    'border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  amber:
    'border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
}

const chipActive: Record<Exclude<Accent, 'theme'>, string> = {
  sky: 'bg-sky-600 text-white',
  violet: 'bg-violet-600 text-white',
  emerald: 'bg-emerald-600 text-white',
  amber: 'bg-amber-600 text-white',
}

export function VerticalFormTabNav({
  tabs,
  active,
  onChange,
  accent = 'theme',
  title = 'Steps',
  className,
}: {
  tabs: VerticalFormTab[]
  active: string
  onChange: (id: string) => void
  accent?: Accent
  title?: string
  className?: string
}) {
  const themed = accent === 'theme'

  return (
    <>
      <div
        className={cn(
          'flex gap-1 overflow-x-auto border-b border-border px-2 py-2 md:hidden',
          className,
        )}
        role="tablist"
        aria-label={title}
      >
        {tabs.map((tab, idx) => {
          const Icon = tab.icon
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
                isActive
                  ? themed
                    ? 'bg-accent-blue text-white'
                    : chipActive[accent]
                  : tab.alert
                    ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100'
                    : 'bg-muted text-text-secondary hover:text-text-primary',
              )}
            >
              <span className="tabular-nums opacity-70">{idx + 1}</span>
              {Icon ? <Icon size={13} className="opacity-80" /> : null}
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span className="tabular-nums opacity-80">{tab.count}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      <nav
        className={cn(
          'hidden w-40 shrink-0 self-stretch border-r border-border bg-muted/20 md:block lg:w-44',
          className,
        )}
        aria-label={title}
        role="tablist"
      >
        <div className="border-b border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          {title}
        </div>
        <ul className="py-1">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon
            const isActive = tab.id === active
            return (
              <li key={tab.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onChange(tab.id)}
                  className={cn(
                    'flex w-full items-center gap-2 border-l-2 px-3 py-2.5 text-left text-sm transition',
                    isActive
                      ? themed
                        ? 'border-accent-blue bg-accent-soft font-semibold text-accent-blue'
                        : cn(accentActive[accent], 'font-semibold')
                      : tab.alert
                        ? 'border-amber-400 text-amber-900 hover:bg-amber-50 dark:text-amber-100 dark:hover:bg-amber-950/30'
                        : 'border-transparent text-text-primary hover:bg-muted/60',
                  )}
                >
                  <span className="w-4 shrink-0 text-[11px] tabular-nums text-text-secondary">
                    {idx + 1}
                  </span>
                  {Icon ? <Icon size={14} className="shrink-0 opacity-70" /> : null}
                  <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                  {typeof tab.count === 'number' ? (
                    <span className="tabular-nums text-[11px] text-text-secondary">{tab.count}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}

/** Left steps + right panel shell for lengthy create/edit forms */
export function VerticalFormShell({
  tabs,
  active,
  onChange,
  accent = 'theme',
  title = 'Steps',
  children,
  className,
}: {
  tabs: VerticalFormTab[]
  active: string
  onChange: (id: string) => void
  accent?: Accent
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card md:flex-row',
        className,
      )}
    >
      <VerticalFormTabNav
        tabs={tabs}
        active={active}
        onChange={onChange}
        accent={accent}
        title={title}
      />
      <div className="min-w-0 flex-1 space-y-4 p-3 sm:p-4">{children}</div>
    </div>
  )
}

export function ReviewRow({
  label,
  value,
  empty = '—',
}: {
  label: string
  value?: string | number | null
  empty?: string
}) {
  const display =
    value === null || value === undefined || String(value).trim() === ''
      ? empty
      : String(value)
  const isEmpty = display === empty
  return (
    <div className="grid gap-0.5 border-b border-border/60 py-2 last:border-0 sm:grid-cols-[140px_1fr] sm:gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div
        className={cn(
          'break-words text-sm',
          isEmpty ? 'text-text-secondary' : 'font-medium text-text-primary',
        )}
      >
        {display}
      </div>
    </div>
  )
}

export function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit?: () => void
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-muted/10 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-accent-blue hover:underline"
          >
            Edit
          </button>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  )
}
