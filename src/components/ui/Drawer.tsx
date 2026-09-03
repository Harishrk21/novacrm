import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  width?: number
  footer?: ReactNode
}

export function Drawer({ open, onClose, title, children, width = 480, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 transition-opacity duration-150',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-card shadow-[-4px_0_24px_rgba(0,0,0,0.1)] transition-transform duration-150',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            onClick={onClose}
            className="ml-2 shrink-0 rounded-[6px] p-1 text-text-secondary hover:bg-slate-100 transition-colors duration-150"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
      </aside>
    </>
  )
}
