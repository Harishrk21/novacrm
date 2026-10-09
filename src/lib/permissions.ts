/** Frontend mirror of backend role permissions (keep in sync with backend/src/common/permissions.ts). */

export type Permission =
  | "*"
  | "dashboard:view"
  | "reports:view"
  | "reports:export"
  | "users:view"
  | "users:write"
  | "users:delete"
  | "settings:view"
  | "settings:write"
  | "setup:access"
  | "leads:view"
  | "leads:write"
  | "leads:delete"
  | "leads:convert"
  | "contacts:view"
  | "contacts:write"
  | "contacts:delete"
  | "contacts:import"
  | "accounts:view"
  | "accounts:write"
  | "accounts:delete"
  | "deals:view"
  | "deals:write"
  | "deals:delete"
  | "activities:view"
  | "activities:write"
  | "activities:delete"
  | "tickets:view"
  | "tickets:create"
  | "tickets:write"
  | "tickets:assign"
  | "tickets:approve"
  | "tickets:delete"
  | "assets:view"
  | "assets:write"
  | "assets:delete"
  | "products:view"
  | "products:write"
  | "products:delete"
  | "inventory:view"
  | "inventory:write"
  | "purchase_orders:view"
  | "purchase_orders:write"
  | "invoices:view"
  | "invoices:write"
  | "requisitions:view"
  | "requisitions:write"
  | "requisitions:approve"
  | "requisitions:fulfill"
  | "whatsapp:view"
  | "whatsapp:send"
  | "analytics:view"
  | "ai:use"

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: ["*"],
  MANAGER: [
    "dashboard:view",
    "reports:view",
    "reports:export",
    "users:view",
    "settings:view",
    "setup:access",
    "leads:view",
    "leads:write",
    "leads:convert",
    "contacts:view",
    "contacts:write",
    "contacts:import",
    "accounts:view",
    "accounts:write",
    "deals:view",
    "deals:write",
    "activities:view",
    "activities:write",
    "tickets:view",
    "tickets:create",
    "tickets:write",
    "tickets:assign",
    "tickets:approve",
    "assets:view",
    "assets:write",
    "products:view",
    "inventory:view",
    "inventory:write",
    "invoices:view",
    "invoices:write",
    "requisitions:view",
    "requisitions:write",
    "requisitions:approve",
    "whatsapp:view",
    "whatsapp:send",
    "analytics:view",
    "ai:use",
  ],
  SERVICE_DESK: [
    "dashboard:view",
    "leads:view",
    "contacts:view",
    "contacts:write",
    "contacts:import",
    "tickets:view",
    "tickets:create",
    "tickets:write",
    "tickets:approve",
    "assets:view",
    "assets:write",
    "products:view",
    "products:write",
    "inventory:view",
    "inventory:write",
    "purchase_orders:view",
    "purchase_orders:write",
    "whatsapp:view",
    "whatsapp:send",
    "ai:use",
    "settings:view",
  ],
  SERVICE_ENGINEER: [
    "dashboard:view",
    "leads:view",
    "contacts:view",
    "tickets:view",
    "tickets:write",
    "assets:view",
    "products:view",
    "products:write",
    "inventory:view",
    "inventory:write",
    "purchase_orders:view",
    "purchase_orders:write",
    "whatsapp:view",
    "whatsapp:send",
    "ai:use",
    "activities:view",
    "activities:write",
    "settings:view",
  ],
  SALES_EXECUTIVE: [
    "dashboard:view",
    "leads:view",
    "leads:write",
    "leads:convert",
    "contacts:view",
    "contacts:write",
    "deals:view",
    "deals:write",
    "activities:view",
    "activities:write",
    "products:view",
    "products:write",
    "inventory:view",
    "inventory:write",
    "purchase_orders:view",
    "purchase_orders:write",
    "invoices:view",
    "invoices:write",
    "requisitions:view",
    "requisitions:write",
    "whatsapp:view",
    "whatsapp:send",
    "ai:use",
    "settings:view",
  ],
  AGENT: [
    "dashboard:view",
    "leads:view",
    "leads:write",
    "leads:convert",
    "contacts:view",
    "contacts:write",
    "deals:view",
    "deals:write",
    "activities:view",
    "activities:write",
    "products:view",
    "products:write",
    "inventory:view",
    "inventory:write",
    "purchase_orders:view",
    "purchase_orders:write",
    "invoices:view",
    "invoices:write",
    "requisitions:view",
    "requisitions:write",
    "whatsapp:view",
    "whatsapp:send",
    "ai:use",
    "settings:view",
  ],
  WAREHOUSE: [
    "dashboard:view",
    "leads:view",
    "contacts:view",
    "products:view",
    "products:write",
    "inventory:view",
    "inventory:write",
    "invoices:view",
    "invoices:write",
    "requisitions:view",
    "requisitions:fulfill",
    "whatsapp:view",
    "ai:use",
    "settings:view",
  ],
  READ_ONLY: [
    "dashboard:view",
    "leads:view",
    "contacts:view",
    "accounts:view",
    "deals:view",
    "activities:view",
    "tickets:view",
    "assets:view",
    "products:view",
    "inventory:view",
    "invoices:view",
    "requisitions:view",
    "settings:view",
  ],
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!role) return false
  const list = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.READ_ONLY
  if (list.includes("*")) return true
  return list.includes(permission)
}

export function canAny(role: string | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p))
}
