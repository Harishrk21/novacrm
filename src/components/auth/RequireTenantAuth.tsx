import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { getAuth } from '@/lib/api'
import { SessionSkeleton } from '@/components/ui/Skeleton'

/** Ensures tenant CRM routes only load when a valid JWT session exists */
export function RequireTenantAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const kind = useAuthStore((s) => s.kind)
  const bootstrapped = useAuthStore((s) => s.bootstrapped)
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    void hydrateFromStorage()
  }, [hydrateFromStorage])

  // Light refresh only — avoid hammering /auth/me on every focus (slow on distant RDS)
  useEffect(() => {
    let last = 0
    const maybeRefresh = () => {
      const now = Date.now()
      if (now - last < 120_000) return
      last = now
      void refreshSession()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const tick = window.setInterval(() => void refreshSession(), 5 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(tick)
    }
  }, [refreshSession])

  useEffect(() => {
    if (bootstrapped && kind === 'tenant' && !getAuth()?.accessToken) {
      void logout()
    }
  }, [bootstrapped, kind, logout])

  if (!bootstrapped) {
    return <SessionSkeleton variant="tenant" />
  }

  if (kind !== 'tenant' || !getAuth()?.accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
