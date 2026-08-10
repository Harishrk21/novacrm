import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { getAuth } from '@/lib/api'

/** Ensures tenant CRM routes only load when a valid JWT session exists */
export function RequireTenantAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const kind = useAuthStore((s) => s.kind)
  const bootstrapped = useAuthStore((s) => s.bootstrapped)
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    void hydrateFromStorage()
  }, [hydrateFromStorage])

  useEffect(() => {
    // Persisted user without tokens → force clean login
    if (bootstrapped && kind === 'tenant' && !getAuth()?.accessToken) {
      void logout()
    }
  }, [bootstrapped, kind, logout])

  if (!bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Checking session…
      </div>
    )
  }

  if (kind !== 'tenant' || !getAuth()?.accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
