/** Force AGENT / READ_ONLY users onto their own assigned records. */
export function isScopedEmployeeRole(role?: string | null): boolean {
  return role === "AGENT" || role === "READ_ONLY";
}

export function forceAssignedToMe(
  auth: { userId?: string; role?: string } | undefined,
  query: Record<string, unknown>,
  field = "assignedToId",
): Record<string, unknown> {
  if (!auth?.userId || !isScopedEmployeeRole(auth.role)) return query;
  return { ...query, [field]: auth.userId };
}
