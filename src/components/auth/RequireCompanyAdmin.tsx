import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { canAccessProformaInvoices, isCompanyAdmin } from '@/lib/roles'
import { hasAnyInventoryArea, resolveInventoryAreas } from '@/lib/inventoryAreas'

/** Blocks non-admins from company-admin-only routes (reports, users, emails, etc.). */
export function RequireCompanyAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!isCompanyAdmin(role)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/**
 * ERP shell: at least one inventory area required.
 * Explicit all-off blocks even ADMIN/WAREHOUSE (role default only applies when unset).
 * Prefer hiding links in the sidebar over a silent bounce to dashboard.
 */
export function RequireErpAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  if (!hasAnyInventoryArea(areas)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

/** Machine serial stock / products / suppliers — needs machines area. */
export function RequireMachinesAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  if (!areas.machines) {
    const spareFallback =
      areas.sparesBilling || areas.sparesWeighing ? '/erp/spare-stock' : '/'
    return <Navigate to={spareFallback} replace />
  }
  return <>{children}</>
}

/** Spare quantity stock — needs billing and/or weighing spare area. */
export function RequireSparesAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  if (!areas.sparesBilling && !areas.sparesWeighing) {
    const machineFallback = areas.machines ? '/erp/inventory' : '/'
    return <Navigate to={machineFallback} replace />
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
