/** Tenant role helpers — keep admin CRM vs employee My Work distinct. */

export type TenantRoleCode = 'ADMIN' | 'MANAGER' | 'AGENT' | 'READ_ONLY' | string

/** Company owner / admin — full analytics dashboard + ERP. */
export function isCompanyAdmin(role?: string | null): boolean {
  return role === 'ADMIN'
}

/**
 * Field staff workspace (My Work / My Tasks).
 * Anyone who is not ADMIN uses the employee shell — including MANAGER.
 */
export function usesEmployeeWorkspace(role?: string | null): boolean {
  return role !== 'ADMIN'
}

/**
 * Strict data scoping: only see records assigned to self.
 * MANAGER can still browse team-wide lists; AGENT/READ_ONLY cannot.
 */
export function isScopedEmployee(role?: string | null): boolean {
  return role === 'AGENT' || role === 'READ_ONLY'
}

export function roleLabel(role?: string | null): string {
  switch (role) {
    case 'ADMIN':
      return 'Company Admin'
    case 'MANAGER':
      return 'Manager'
    case 'AGENT':
      return 'Sales Agent'
    case 'READ_ONLY':
      return 'Read only'
    default:
      return 'Team member'
  }
}
