/** Force field engineers / sales staff onto their own assigned records. */
export function isScopedEmployeeRole(role?: string | null): boolean {
  return (
    role === "SERVICE_ENGINEER" ||
    role === "SALES_EXECUTIVE" ||
    role === "AGENT" ||
    role === "READ_ONLY"
  );
}

export function isSalesExecutiveRole(role?: string | null): boolean {
  return role === "SALES_EXECUTIVE" || role === "AGENT";
}

export function isCompanyAdminRole(role?: string | null): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function isServiceDeskRole(role?: string | null): boolean {
  return role === "SERVICE_DESK";
}

export function canAssignTicketsRole(role?: string | null): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function canApproveTicketsRole(role?: string | null): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function canCreateTicketsRole(role?: string | null): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SERVICE_DESK";
}

export function forceAssignedToMe(
  auth: { userId?: string; role?: string } | undefined,
  query: Record<string, unknown>,
  field = "assignedToId",
): Record<string, unknown> {
  if (!auth?.userId || !isScopedEmployeeRole(auth.role)) return query;
  return { ...query, [field]: auth.userId };
}
