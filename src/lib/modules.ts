/** Module keys stored on tenant_modules / modules_enabled. */

export type ModuleKey =
  | "crm.leads"
  | "crm.contacts"
  | "crm.accounts"
  | "crm.deals"
  | "crm.activities"
  | "crm.tickets"
  | "crm.amc"
  | "crm.stamping"
  | "crm.rentals"
  | "erp.products"
  | "erp.inventory"
  | "erp.purchase_orders"
  | "erp.invoices"
  | "engagement.whatsapp"
  | "engagement.emails"
  | "reports"
  | "settings"

/** HMS / weighing template — full ops pack (no feature loss). */
export const HMS_FULL_MODULES: Record<string, boolean> = {
  "crm.leads": true,
  "crm.contacts": true,
  "crm.accounts": true,
  "crm.deals": true,
  "crm.activities": true,
  "crm.tickets": true,
  "crm.amc": true,
  "crm.stamping": true,
  "crm.rentals": true,
  "erp.products": true,
  "erp.inventory": true,
  "erp.purchase_orders": true,
  "erp.invoices": true,
  "engagement.whatsapp": true,
  "engagement.emails": true,
  reports: true,
  settings: true,
}

export type TenantModuleRow = {
  moduleKey: string
  isEnabled: boolean
  label?: string
  moduleGroup?: string
}

/** If modules list is empty (legacy), treat as full HMS pack so nothing disappears. */
export function isModuleEnabled(
  modules: TenantModuleRow[] | null | undefined,
  key: string,
  fallback = true,
): boolean {
  if (!modules?.length) return fallback
  const row = modules.find((m) => m.moduleKey === key)
  if (!row) {
    // Unknown key: allow core HMS paths so upgrades don't hide screens
    return fallback
  }
  return Boolean(row.isEnabled)
}
