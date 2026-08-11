import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Color theme for confirm / small dialogs */
  accent?: 'sky' | 'emerald' | 'violet' | 'amber'
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
}

const accents = {
  sky: {
    bar: 'from-sky-100 via-cyan-50 to-white',
    blob: 'bg-sky-300/50',
    chip: 'text-sky-700',
  },
  emerald: {
    bar: 'from-emerald-100 via-teal-50 to-white',
    blob: 'bg-emerald-300/45',
    chip: 'text-emerald-700',
  },
  violet: {
    bar: 'from-violet-100 via-fuchsia-50 to-white',
    blob: 'bg-violet-300/45',
    chip: 'text-violet-700',
  },
  amber: {
    bar: 'from-amber-100 via-orange-50 to-white',
    blob: 'bg-amber-300/45',
    chip: 'text-amber-800',
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
  accent = 'sky',
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-sky-200/80 bg-card shadow-[0_24px_64px_rgba(14,165,233,0.18)] sm:rounded-2xl',
          sizes[size],
        )}
      >
        <div className={cn('relative shrink-0 overflow-hidden border-b border-sky-100 bg-gradient-to-br px-5 py-4', a.bar)}>
          <div className={cn('pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full blur-2xl', a.blob)} />
          <div className={cn('pointer-events-none absolute -bottom-8 right-0 h-24 w-24 rounded-full blur-2xl', a.blob)} />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('mb-1 text-[11px] font-semibold uppercase tracking-[0.14em]', a.chip)}>
                NovaCRM
              </p>
              <h2 id="modal-title" className="text-xl font-semibold tracking-tight text-slate-900">
                {title}
              </h2>
              {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/80 bg-white/90 p-2 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-sky-100 bg-gradient-to-r from-sky-50/70 via-white to-emerald-50/40 px-5 py-4">
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
