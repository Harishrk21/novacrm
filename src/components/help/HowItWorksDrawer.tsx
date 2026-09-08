import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, X } from 'lucide-react'
import { RoleHowItWorks } from '@/components/help/RoleHowItWorks'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

/** Right-side guide drawer — opened from header Help, not embedded on home. */
export function HowItWorksDrawer() {
  const open = useUIStore((s) => s.howItWorksOpen)
  const setOpen = useUIStore((s) => s.setHowItWorksOpen)
  const role = useAuthStore((s) => s.user?.role)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="How it works">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
        aria-label="Close guide"
        onClick={() => setOpen(false)}
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-[-8px_0_32px_rgba(0,0,0,0.18)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent">
              <BookOpen size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary">How it works</div>
              <div className="truncate text-xs text-text-secondary">Guide for your login — opens beside the page</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              to="/help"
              onClick={() => setOpen(false)}
              className="rounded-[6px] px-2.5 py-1.5 text-xs font-semibold text-accent-blue hover:bg-muted"
            >
              Full page
            </Link>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <RoleHowItWorks role={role} variant="full" />
        </div>
      </aside>
    </div>
  )
}
