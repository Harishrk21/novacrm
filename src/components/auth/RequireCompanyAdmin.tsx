import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { canAccessErp, canAccessProformaInvoices, isCompanyAdmin } from '@/lib/roles'

/** Blocks non-admins from company-admin-only routes (reports, users, emails, etc.). */
export function RequireCompanyAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!isCompanyAdmin(role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/** Admin or warehouse team may open ERP inventory/products. */
export function RequireErpAccess({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!canAccessErp(role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/** Admin or warehouse/billing may manage proforma invoices (Tally holds final bills). */
export function RequireBillingAccess({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!canAccessProformaInvoices(role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
