/** Tenant role helpers — keep admin CRM vs desk / engineer / warehouse / sales distinct. */

export type TenantRoleCode =
  | 'ADMIN'
  | 'MANAGER'
  | 'AGENT'
  | 'READ_ONLY'
  | 'SERVICE_DESK'
  | 'SERVICE_ENGINEER'
  | 'SALES_EXECUTIVE'
  | 'WAREHOUSE'
  | string

/** Company owner / admin — full analytics dashboard + ERP + users. */
export function isCompanyAdmin(role?: string | null): boolean {
  return role === 'ADMIN'
}

export function isServiceDesk(role?: string | null): boolean {
  return role === 'SERVICE_DESK'
}

export function isServiceEngineer(role?: string | null): boolean {
  return role === 'SERVICE_ENGINEER'
}

/**
 * Sales desk — in-office team (calls / enquiries / conversion), parallel to Service Desk.
 * Role code stays `SALES_EXECUTIVE` (legacy `AGENT`) for DB compatibility.
 */
export function isSalesDesk(role?: string | null): boolean {
  return role === 'SALES_EXECUTIVE' || role === 'AGENT'
}

/** @deprecated use isSalesDesk — same role */
export function isSalesExecutive(role?: string | null): boolean {
  return isSalesDesk(role)
}

export function isWarehouse(role?: string | null): boolean {
  return role === 'WAREHOUSE'
}

export type LookupUser = {
  id: string
  name: string
  email?: string
  phone?: string | null
  roleCode?: string | null
  roleName?: string | null
  avatarUrl?: string | null
}

/** Users who can be assigned service tickets / field jobs. */
export function filterServiceEngineers<T extends LookupUser>(users: T[]): T[] {
  return users.filter((u) => u.roleCode === 'SERVICE_ENGINEER')
}

/** Users who can own sale enquiries / demos (sales desk). */
export function filterSalesExecutives<T extends LookupUser>(users: T[]): T[] {
  return users.filter((u) => isSalesDesk(u.roleCode))
}

/** Can assign tickets to engineers and approve completion. */
export function canAssignTickets(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER'
}

export function canApproveTickets(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'SERVICE_DESK'
}

/** Can create service tickets (desk or admin). */
export function canCreateTickets(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'SERVICE_DESK'
}

/** Can open ERP inventory/products (self-control model — most ops roles). */
export function canAccessErp(role?: string | null): boolean {
  return (
    role === 'ADMIN' ||
    role === 'MANAGER' ||
    role === 'WAREHOUSE' ||
    role === 'SALES_EXECUTIVE' ||
    role === 'AGENT' ||
    role === 'SERVICE_DESK' ||
    role === 'SERVICE_ENGINEER'
  )
}

/**
 * Proforma invoices (CRM estimates) — final GST bills live in Tally.
 * Admin + manager + warehouse + sales desk (create after stock is sold).
 */
export function canAccessProformaInvoices(role?: string | null): boolean {
  return (
    role === 'ADMIN' ||
    role === 'MANAGER' ||
    role === 'WAREHOUSE' ||
    isSalesDesk(role)
  )
}

/** Can use Sale tracking (admin + sales desk). */
export function canAccessSaleTracking(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || isSalesDesk(role)
}

/**
 * Field staff / non-admin workspace shell.
 * Admin keeps the analytics dashboard; everyone else uses a focused home.
 */
export function usesEmployeeWorkspace(role?: string | null): boolean {
  return role !== 'ADMIN'
}

/**
 * Strict data scoping: only see tickets assigned to self.
 * SERVICE_ENGINEER and READ_ONLY.
 */
export function isScopedEmployee(role?: string | null): boolean {
  return role === 'SERVICE_ENGINEER' || role === 'READ_ONLY'
}

export function roleLabel(role?: string | null): string {
  switch (role) {
    case 'ADMIN':
      return 'Company Admin'
    case 'MANAGER':
      return 'Manager'
    case 'SERVICE_DESK':
      return 'Service Desk'
    case 'SERVICE_ENGINEER':
      return 'Service Engineer'
    case 'SALES_EXECUTIVE':
    case 'AGENT':
      return 'Sales Desk'
    case 'WAREHOUSE':
      return 'Warehouse & billing'
    case 'READ_ONLY':
      return 'Read only'
    default:
      return 'Team member'
  }
}

export const TENANT_ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'SALES_EXECUTIVE', label: 'Sales desk' },
  { value: 'SERVICE_DESK', label: 'Service desk' },
  { value: 'SERVICE_ENGINEER', label: 'Service engineer' },
  { value: 'WAREHOUSE', label: 'Warehouse & billing' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'READ_ONLY', label: 'Read only' },
] as const
