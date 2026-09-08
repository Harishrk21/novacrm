import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

type Accent = 'theme' | 'sky' | 'emerald' | 'violet' | 'amber'

/** theme = follows active Color palette (recommended) */
const accents: Record<Accent, { bar: string; blob: string; chip: string; chipText: string; border: string }> = {
  theme: {
    bar: '',
    blob: '',
    chip: '',
    chipText: '',
    border: 'border-[color:var(--color-border)]',
  },
  sky: {
    bar: 'from-sky-100 via-cyan-50 to-white dark:from-sky-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-sky-300/50 dark:bg-sky-400/20',
    chip: 'bg-sky-600/10 dark:bg-sky-400/15',
    chipText: 'text-sky-700 dark:text-sky-200',
    border: 'border-sky-200/80 dark:border-sky-800/60',
  },
  emerald: {
    bar: 'from-emerald-100 via-teal-50 to-white dark:from-emerald-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-emerald-300/45 dark:bg-emerald-400/20',
    chip: 'bg-emerald-600/10 dark:bg-emerald-400/15',
    chipText: 'text-emerald-700 dark:text-emerald-200',
    border: 'border-emerald-200/80 dark:border-emerald-800/60',
  },
  violet: {
    bar: 'from-violet-100 via-fuchsia-50 to-white dark:from-violet-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-violet-300/45 dark:bg-violet-400/20',
    chip: 'bg-violet-600/10 dark:bg-violet-400/15',
    chipText: 'text-violet-700 dark:text-violet-200',
    border: 'border-violet-200/80 dark:border-violet-800/60',
  },
  amber: {
    bar: 'from-amber-100 via-orange-50 to-white dark:from-amber-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-amber-300/45 dark:bg-amber-400/20',
    chip: 'bg-amber-600/10 dark:bg-amber-400/15',
    chipText: 'text-amber-800 dark:text-amber-200',
    border: 'border-amber-200/80 dark:border-amber-800/60',
  },
}

interface FormPanelProps {
  open: boolean
  title: string
  subtitle?: string
  eyebrow?: string
  accent?: Accent
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
}

/** Inline page form — follows active palette when accent="theme". */
export function FormPanel({
  open,
  title,
  subtitle,
  eyebrow = 'HMS Enterprises',
  accent = 'theme',
  onClose,
  children,
  footer,
  className,
  bodyClassName,
}: FormPanelProps) {
  if (!open) return null
  const a = accents[accent]
  const themed = accent === 'theme'

  return (
    <section
      className={cn(
        'mb-5 overflow-hidden rounded-[16px] border bg-card shadow-[var(--shadow-hover)]',
        a.border,
        className,
      )}
    >
      <header
        className={cn(
          'relative overflow-hidden border-b border-border px-5 py-4',
          themed ? '' : cn('bg-gradient-to-br', a.bar),
        )}
        style={
          themed
            ? {
                background: `linear-gradient(135deg, var(--color-panel-from) 0%, var(--color-card) 55%, var(--color-panel-to) 100%)`,
              }
            : undefined
        }
      >
        <div
          className={cn(
            'pointer-events-none absolute -left-6 -top-8 h-28 w-28 rounded-full blur-2xl',
            themed ? '' : a.blob,
          )}
          style={themed ? { background: 'var(--color-accent-soft)' } : undefined}
        />
        <div
          className={cn(
            'pointer-events-none absolute -bottom-10 right-4 h-32 w-32 rounded-full blur-2xl',
            themed ? '' : a.blob,
          )}
          style={themed ? { background: 'var(--color-accent-soft)' } : undefined}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span
              className={cn(
                'mb-1.5 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]',
                themed ? '' : cn(a.chip, a.chipText),
              )}
              style={
                themed
                  ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent-blue)' }
                  : undefined
              }
            >
              {eyebrow}
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-text-primary">{title}</h2>
            {subtitle ? <p className="mt-1 max-w-2xl text-sm text-text-secondary">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border bg-card p-2 text-text-secondary shadow-sm transition hover:bg-muted hover:text-text-primary"
            aria-label="Close form"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className={cn('px-5 py-5', bodyClassName)}>{children}</div>

      {footer ? (
        <footer
          className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4"
          style={{
            background: `linear-gradient(90deg, var(--color-panel-from), var(--color-card) 50%, var(--color-panel-to))`,
          }}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  )
}

export function FormPanelCancel({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={disabled}>
      Cancel
    </Button>
  )
}
