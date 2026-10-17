import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { AppFooterBar } from './AppFooterBar'
import { FieldBottomNav } from './FieldBottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { LowMachineStockAlert } from '@/components/inventory/LowMachineStockAlert'
import { HowItWorksDrawer } from '@/components/help/HowItWorksDrawer'
import { PwaInstallTip } from '@/components/pwa/PwaInstallTip'
import { APP_NAME } from '@/lib/branding'
import { isTenantSession } from '@/lib/api'
import { useModulesStore } from '@/store/modulesStore'
import { useUnsavedStore } from '@/store/unsavedStore'
import { useFieldShell } from '@/hooks/useFieldShell'
import { useAuthStore } from '@/store/authStore'
import { isServiceEngineer } from '@/lib/roles'
import { cn } from '@/lib/utils'

/** Warn on tab close only — never touch history from a navigation blocker. */
function UnsavedBeforeUnload() {
  const dirty = useUnsavedStore((s) => s.dirty)

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  return null
}

export function AppLayout() {
  const loadModules = useModulesStore((s) => s.load)
  const location = useLocation()
  const fieldShell = useFieldShell()
  const role = useAuthStore((s) => s.user?.role)
  const showInstallTip = isServiceEngineer(role) && location.pathname === '/'

  useEffect(() => {
    document.title = fieldShell ? 'HMS Field' : APP_NAME
  }, [fieldShell])

  useEffect(() => {
    void loadModules()
  }, [loadModules])

  // Prefetch common routes + warm lookups cache so nav isn't double-waiting
  useEffect(() => {
    const idle =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? window.requestIdleCallback
        : (cb: () => void) => window.setTimeout(cb, 150)
    const id = idle(() => {
      void import('@/pages/TicketsPage')
      void import('@/pages/WorkqueuePage')
      void import('@/pages/LeadsPage')
      void import('@/pages/ContactsPage')
      void import('@/pages/NotificationsPage')
      void import('@/pages/erp/InventoryHubPage')
      void import('@/lib/api').then(({ api }) => {
        if (!isTenantSession()) return
        // Warm fast core first, then full catalog — don't block UI
        void api
          .lookups({ scope: 'core' })
          .then(() => api.lookups({ scope: 'full' }))
          .catch(() => undefined)
      })
    })
    return () => {
      if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(id as number)
      } else {
        window.clearTimeout(id as number)
      }
    }
  }, [])

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      {!fieldShell ? <Sidebar /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar fieldShell={fieldShell} />
        <main
          className={cn(
            'min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface p-3 sm:p-4 lg:p-5',
            fieldShell && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          {showInstallTip ? <PwaInstallTip /> : null}
          {/* No pathname key — remounting every visit forced full skeleton + refetch */}
          <Outlet />
        </main>
        {!fieldShell ? <AppFooterBar /> : null}
      </div>
      {fieldShell ? <FieldBottomNav /> : null}
      <HowItWorksDrawer />
      <ToastContainer />
      <LowMachineStockAlert />
      <UnsavedBeforeUnload />
    </div>
  )
}
