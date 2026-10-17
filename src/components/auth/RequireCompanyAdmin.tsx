import { Navigate } from 'react-router-dom'
import { AccessDenied } from '@/components/auth/AccessDenied'
import { useAuthStore } from '@/store/authStore'
import { canAccessProformaInvoices, isCompanyAdmin } from '@/lib/roles'
import { hasAnyInventoryArea, resolveInventoryAreas } from '@/lib/inventoryAreas'

/** Blocks non-admins from company-admin-only routes (reports, users, emails, etc.). */
export function RequireCompanyAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!isCompanyAdmin(role)) {
    return (
      <AccessDenied
        title="Admin access required"
        hint="This area is for company admins. Ask an admin if you need reports, users, or email settings."
      />
    )
  }
  return <>{children}</>
}

/**
 * ERP shell: at least one inventory area required.
 * Explicit all-off blocks even ADMIN/WAREHOUSE (role default only applies when unset).
 */
export function RequireErpAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  if (!hasAnyInventoryArea(areas)) {
    return (
      <AccessDenied
        title="Inventory access required"
        hint="No inventory areas are enabled on your account. Ask your company admin to turn on Machines or Spares for you."
      />
    )
  }
  return <>{children}</>
}

/** Machine serial stock / products / suppliers — needs machines area. */
export function RequireMachinesAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  if (!areas.machines) {
    if (areas.sparesBilling || areas.sparesWeighing) {
      return <Navigate to="/erp/spare-stock" replace />
    }
    return (
      <AccessDenied
        title="Machines stock not enabled"
        hint="Your account does not include the Machines inventory area."
      />
    )
  }
  return <>{children}</>
}

/** Spare quantity stock — needs billing and/or weighing spare area. */
export function RequireSparesAccess({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  if (!areas.sparesBilling && !areas.sparesWeighing) {
    if (areas.machines) {
      return <Navigate to="/erp/inventory" replace />
    }
    return (
      <AccessDenied
        title="Spare stock not enabled"
        hint="Your account does not include Spares (billing or weighing)."
      />
    )
  }
  return <>{children}</>
}

/** Admin or warehouse/billing may manage proforma invoices (Tally holds final bills). */
export function RequireBillingAccess({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!canAccessProformaInvoices(role)) {
    return (
      <AccessDenied
        title="Billing access required"
        hint="Proforma invoices are limited to admin and billing/warehouse roles."
      />
    )
  }
  return <>{children}</>
}
