import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin } from '@/lib/roles'

/** Blocks agents from company-admin-only routes (reports, ERP, users, etc.). */
export function RequireCompanyAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!isCompanyAdmin(role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
