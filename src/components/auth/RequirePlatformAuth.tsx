import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { getAuth } from '@/lib/api'
import { SessionSkeleton } from '@/components/ui/Skeleton'

/** Platform master console — only platform JWT sessions. */
export function RequirePlatformAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const kind = useAuthStore((s) => s.kind)
  const bootstrapped = useAuthStore((s) => s.bootstrapped)
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage)

  useEffect(() => {
    void hydrateFromStorage()
  }, [hydrateFromStorage])

  if (!bootstrapped) {
    return <SessionSkeleton variant="platform" />
  }

  if (kind !== 'platform' || !getAuth()?.accessToken) {
    return <Navigate to="/login/admin" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
