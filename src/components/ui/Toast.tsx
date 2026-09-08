import { Check, X, AlertTriangle, Info } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const DEFAULT_TITLE = {
  success: 'Success',
  error: 'Something went wrong',
  warning: 'Warning',
  info: 'Info',
} as const

const tone = {
  success: {
    shell:
      'border-emerald-200/90 bg-emerald-50 text-emerald-950 dark:border-emerald-500/35 dark:bg-emerald-950/90 dark:text-emerald-50',
    icon: 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/40',
    close:
      'bg-emerald-100/80 text-emerald-800 hover:bg-emerald-200/90 dark:bg-emerald-900/80 dark:text-emerald-100 dark:hover:bg-emerald-800',
    message: 'text-emerald-900/80 dark:text-emerald-100/85',
  },
  error: {
    shell:
      'border-rose-200/90 bg-rose-50 text-rose-950 dark:border-rose-500/35 dark:bg-rose-950/90 dark:text-rose-50',
    icon: 'bg-rose-500 text-white shadow-sm shadow-rose-500/40',
    close:
      'bg-rose-100/80 text-rose-800 hover:bg-rose-200/90 dark:bg-rose-900/80 dark:text-rose-100 dark:hover:bg-rose-800',
    message: 'text-rose-900/80 dark:text-rose-100/85',
  },
  warning: {
    shell:
      'border-amber-200/90 bg-amber-50 text-amber-950 dark:border-amber-500/35 dark:bg-amber-950/90 dark:text-amber-50',
    icon: 'bg-amber-500 text-white shadow-sm shadow-amber-500/40',
    close:
      'bg-amber-100/80 text-amber-900 hover:bg-amber-200/90 dark:bg-amber-900/80 dark:text-amber-100 dark:hover:bg-amber-800',
    message: 'text-amber-900/80 dark:text-amber-100/85',
  },
  info: {
    shell:
      'border-sky-200/90 bg-sky-50 text-sky-950 dark:border-sky-500/35 dark:bg-sky-950/90 dark:text-sky-50',
    icon: 'bg-sky-500 text-white shadow-sm shadow-sky-500/40',
    close:
      'bg-sky-100/80 text-sky-800 hover:bg-sky-200/90 dark:bg-sky-900/80 dark:text-sky-100 dark:hover:bg-sky-800',
    message: 'text-sky-900/80 dark:text-sky-100/85',
  },
} as const

function ToastIcon({ type }: { type: keyof typeof tone }) {
  const cls = 'size-[18px]'
  if (type === 'success') return <Check className={cls} strokeWidth={2.75} />
  if (type === 'error') return <X className={cls} strokeWidth={2.75} />
  if (type === 'warning') return <AlertTriangle className={cls} strokeWidth={2.5} />
  return <Info className={cls} strokeWidth={2.5} />
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)
  const removeToast = useUIStore((s) => s.removeToast)

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-2.5 sm:right-5 sm:top-5"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const styles = tone[t.type]
        const title = t.title?.trim() || DEFAULT_TITLE[t.type]
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-2xl border px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.12)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.45)]',
              'animate-in fade-in slide-in-from-top-2 duration-200',
              styles.shell,
            )}
          >
            <div
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
                styles.icon,
              )}
            >
              <ToastIcon type={t.type} />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold leading-snug tracking-tight">{title}</p>
              <p className={cn('mt-0.5 text-[13px] leading-snug', styles.message)}>{t.message}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => removeToast(t.id)}
              className={cn(
                'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                styles.close,
              )}
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
