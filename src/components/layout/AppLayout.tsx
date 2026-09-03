import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ToastContainer } from '@/components/ui/Toast'
import { APP_NAME } from '@/lib/branding'

export function AppLayout() {
  useEffect(() => {
    document.title = APP_NAME
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-transparent p-4 sm:p-5">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
    </div>
  )
}
