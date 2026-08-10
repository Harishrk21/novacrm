import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const styles = {
  success: 'border-l-accent-green bg-emerald-50',
  error: 'border-l-accent-red bg-red-50',
  warning: 'border-l-accent-amber bg-amber-50',
  info: 'border-l-accent-blue bg-blue-50',
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)
  const removeToast = useUIStore((s) => s.removeToast)

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.type]
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-start gap-3 rounded-[8px] border border-border border-l-4 bg-card p-3 shadow-[0_4px_12px_rgba(0,0,0,0.12)] animate-in',
              styles[t.type],
            )}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm font-medium text-text-primary">{t.message}</p>
            <button onClick={() => removeToast(t.id)} className="text-text-secondary hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
