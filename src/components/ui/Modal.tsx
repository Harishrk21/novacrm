import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Optional leading icon in the header (e.g. WhatsApp) */
  icon?: ReactNode
  /** Color theme for confirm / small dialogs */
  accent?: 'theme' | 'sky' | 'emerald' | 'violet' | 'amber'
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
}

const accents = {
  theme: {
    bar: '',
    blob: '',
    chip: '',
    border: 'border-border',
    footerBorder: 'border-border',
  },
  sky: {
    bar: 'from-sky-100 via-cyan-50 to-white dark:from-sky-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-sky-300/50 dark:bg-sky-400/20',
    chip: 'text-sky-700 dark:text-sky-200',
    border: 'border-sky-200/80 dark:border-sky-800/60',
    footerBorder: 'border-sky-100 dark:border-border',
  },
  emerald: {
    bar: 'from-emerald-100 via-teal-50 to-white dark:from-emerald-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-emerald-300/45 dark:bg-emerald-400/20',
    chip: 'text-emerald-700 dark:text-emerald-200',
    border: 'border-emerald-200/80 dark:border-emerald-800/60',
    footerBorder: 'border-emerald-100 dark:border-border',
  },
  violet: {
    bar: 'from-violet-100 via-fuchsia-50 to-white dark:from-violet-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-violet-300/45 dark:bg-violet-400/20',
    chip: 'text-violet-700 dark:text-violet-200',
    border: 'border-violet-200/80 dark:border-violet-800/60',
    footerBorder: 'border-violet-100 dark:border-border',
  },
  amber: {
    bar: 'from-amber-100 via-orange-50 to-white dark:from-amber-950/70 dark:via-[var(--color-card)] dark:to-[var(--color-muted)]',
    blob: 'bg-amber-300/45 dark:bg-amber-400/20',
    chip: 'text-amber-800 dark:text-amber-200',
    border: 'border-amber-200/80 dark:border-amber-800/60',
    footerBorder: 'border-amber-100 dark:border-border',
  },
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'lg',
  icon,
  accent = 'theme',
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  const a = accents[accent]
  const themed = accent === 'theme'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border bg-card shadow-[var(--shadow-hover)] sm:rounded-2xl',
          a.border,
          sizes[size],
        )}
      >
        <div
          className={cn(
            'relative shrink-0 overflow-hidden border-b border-border px-5 py-4',
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
          {!themed ? (
            <>
              <div className={cn('pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full blur-2xl', a.blob)} />
              <div className={cn('pointer-events-none absolute -bottom-8 right-0 h-24 w-24 rounded-full blur-2xl', a.blob)} />
            </>
          ) : (
            <div
              className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full blur-2xl"
              style={{ background: 'var(--color-accent-soft)' }}
            />
          )}
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {icon ? <div className="mt-1 shrink-0">{icon}</div> : null}
              <div className="min-w-0">
              <p
                className={cn(
                  'mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]',
                  themed ? '' : a.chip,
                )}
                style={themed ? { color: 'var(--color-accent-blue)' } : undefined}
              >
                HMS Enterprises
              </p>
              <h2 id="modal-title" className="text-xl font-semibold tracking-tight text-text-primary">
                {title}
              </h2>
              {subtitle ? <p className="mt-1 text-sm text-text-secondary">{subtitle}</p> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border bg-card p-2 text-text-secondary shadow-sm transition hover:bg-muted hover:text-text-primary"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <div
            className={cn(
              'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-4',
              a.footerBorder,
            )}
            style={{
              background: `linear-gradient(90deg, var(--color-panel-from), var(--color-card) 50%, var(--color-panel-to))`,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body: string
  confirmLabel?: string
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Delete',
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      accent="amber"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-base text-text-secondary">{body}</p>
    </Modal>
  )
}
