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
import { useSidebarConfigStore } from '@/lib/sidebarConfig'
import { useUnsavedStore } from '@/store/unsavedStore'
import { useFieldShell } from '@/hooks/useFieldShell'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { isServiceEngineer } from '@/lib/roles'
import { useFieldLocationPings } from '@/lib/fieldLocation'
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
  // Engineers: location goes to the owner's Field tracking while the app is open
  useFieldLocationPings(isServiceEngineer(role))
  const showInstallTip = isServiceEngineer(role) && location.pathname === '/'
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen)

  useEffect(() => {
    document.title = fieldShell ? 'HMS Field' : APP_NAME
  }, [fieldShell])

  // Phone drawer: close after navigating, and on Escape.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, setMobileNavOpen])
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen, setMobileNavOpen])

  useEffect(() => {
    void loadModules()
    void useSidebarConfigStore.getState().load()
  }, [loadModules])

  // Prefetch common routes + warm lookups cache so nav isn't double-waiting
  useEffect(() => {
    const warm = () => {
      void import('@/pages/TicketsPage')
      void import('@/pages/WorkqueuePage')
      void import('@/pages/LeadsPage')
      void import('@/pages/ContactsPage')
      void import('@/pages/NotificationsPage')
      void import('@/pages/erp/InventoryHubPage')
      void import('@/lib/api').then(({ api }) => {
        if (!isTenantSession()) return
        // Company letterhead (logo, GSTIN, address) for printed documents
        void import('@/lib/printLetterhead').then((m) => m.primePrintCompany())
        // Warm fast core first, then full catalog — don't block UI
        void api
          .lookups({ scope: 'core' })
          .then(() => api.lookups({ scope: 'full' }))
          .catch(() => undefined)
      })
    }
    const useRic = typeof window !== 'undefined' && 'requestIdleCallback' in window
    const idleId = useRic ? window.requestIdleCallback(warm) : window.setTimeout(warm, 150)
    return () => {
      if (useRic && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      } else {
        window.clearTimeout(idleId)
      }
    }
  }, [])

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      {!fieldShell ? (
        <>
          {/* Desktop (lg+): normal column. Phone/tablet: off-canvas drawer over the page. */}
          <div
            className={cn(
              'h-full shrink-0',
              'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-[110] max-lg:max-w-[85vw] max-lg:shadow-2xl max-lg:transition-transform max-lg:duration-200',
              mobileNavOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
            )}
          >
            <Sidebar />
          </div>
          {mobileNavOpen ? (
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-[105] bg-black/50 lg:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
          ) : null}
        </>
      ) : null}
      <div className="relative z-0 flex min-w-0 flex-1 flex-col">
        <Topbar fieldShell={fieldShell} />
        {/* Wrapper is the positioning box for full-page forms (FormPanel layout="page") */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        <main
          className={cn(
            // Keep page sticky cells below topbar menus (z-100) / portaled overlays
            'relative z-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface p-3 sm:p-4 lg:p-5',
            fieldShell && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          {showInstallTip ? <PwaInstallTip /> : null}
          {/* No pathname key — remounting every visit forced full skeleton + refetch */}
          <Outlet />
        </main>
        <div id="page-form-root" />
        </div>
        {/* Inside content column so it clears the sidebar and does not cover chrome menus */}
        <LowMachineStockAlert />
        {!fieldShell ? <AppFooterBar /> : null}
      </div>
      {fieldShell ? <FieldBottomNav /> : null}
      <HowItWorksDrawer />
      <ToastContainer />
      <UnsavedBeforeUnload />
    </div>
  )
}
