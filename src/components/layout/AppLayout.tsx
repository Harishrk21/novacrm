import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { AppFooterBar } from './AppFooterBar'
import { FieldBottomNav } from './FieldBottomNav'
import { ToastContainer } from '@/components/ui/Toast'
import { HowItWorksDrawer } from '@/components/help/HowItWorksDrawer'
import { PwaInstallTip } from '@/components/pwa/PwaInstallTip'
import { APP_NAME } from '@/lib/branding'
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
          <Outlet key={location.pathname} />
        </main>
        {!fieldShell ? <AppFooterBar /> : null}
      </div>
      {fieldShell ? <FieldBottomNav /> : null}
      <HowItWorksDrawer />
      <ToastContainer />
      <UnsavedBeforeUnload />
    </div>
  )
}
