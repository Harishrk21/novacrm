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
    bar: 'from-sky-100 via-cyan-50 to-white',
    blob: 'bg-sky-300/50',
    chip: 'bg-sky-600/10',
    chipText: 'text-sky-700',
    border: 'border-sky-200/80',
  },
  emerald: {
    bar: 'from-emerald-100 via-teal-50 to-white',
    blob: 'bg-emerald-300/45',
    chip: 'bg-emerald-600/10',
    chipText: 'text-emerald-700',
    border: 'border-emerald-200/80',
  },
  violet: {
    bar: 'from-violet-100 via-fuchsia-50 to-white',
    blob: 'bg-violet-300/45',
    chip: 'bg-violet-600/10',
    chipText: 'text-violet-700',
    border: 'border-violet-200/80',
  },
  amber: {
    bar: 'from-amber-100 via-orange-50 to-white',
    blob: 'bg-amber-300/45',
    chip: 'bg-amber-600/10',
    chipText: 'text-amber-800',
    border: 'border-amber-200/80',
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
  eyebrow = 'NovaCRM',
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
