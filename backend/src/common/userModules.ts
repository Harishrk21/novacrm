import { prisma } from "../config/database.js";

/** Module keys a company admin may assign to employees (settings always on). */
export const ASSIGNABLE_MODULE_KEYS = [
  "crm.leads",
  "crm.contacts",
  "crm.accounts",
  "crm.deals",
  "crm.activities",
  "crm.tickets",
  "crm.amc",
  "crm.stamping",
  "crm.rentals",
  "erp.products",
  "erp.inventory",
  "erp.purchase_orders",
  "erp.invoices",
  "engagement.whatsapp",
  "engagement.emails",
  "reports",
] as const;

export type AllowedModules = Record<string, boolean>;

export function parseAllowedModulesRaw(raw: unknown): AllowedModules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: AllowedModules = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && k.length > 0) out[k] = Boolean(v);
  }
  return Object.keys(out).length ? out : null;
}

export function allowedModulesFromPreferences(preferences: unknown): AllowedModules | null {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return null;
  return parseAllowedModulesRaw((preferences as Record<string, unknown>).allowedModules);
}

/** Tenant modules currently enabled by platform admin. */
export async function loadTenantEnabledModuleKeys(tenantId: string): Promise<string[]> {
  const rows = await prisma.tenantModule.findMany({
    where: { tenantId, isEnabled: true },
    select: { moduleKey: true },
  });
  if (rows.length) {
    return rows.map((r) => r.moduleKey).filter((k) => k !== "settings");
  }
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { modulesEnabled: true },
  });
  const raw = tenant?.modulesEnabled;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([k, v]) => k !== "settings" && Boolean(v))
      .map(([k]) => k);
  }
  // Legacy empty → full assignable set so nothing disappears
  return [...ASSIGNABLE_MODULE_KEYS];
}

/**
 * Clamp employee modules to what platform granted the tenant.
 * Settings is never stored here (always allowed).
 */
export function clampAllowedModules(
  input: AllowedModules | null | undefined,
  tenantEnabled: string[],
): AllowedModules {
  const enabled = new Set(tenantEnabled);
  const out: AllowedModules = {};
  for (const key of tenantEnabled) {
    if (key === "settings") continue;
    out[key] = input != null && key in input ? Boolean(input[key]) : true;
  }
  // Drop anything not in tenant pack
  for (const key of Object.keys(out)) {
    if (!enabled.has(key)) delete out[key];
  }
  return out;
}

/**
 * Resolved sidebar/API visibility for a user.
 * - ADMIN: all tenant-enabled modules
 * - Explicit preferences.allowedModules (clamped) otherwise
 * - Legacy (no prefs): all tenant-enabled modules on
 */
export function resolveAllowedModules(
  preferences: unknown,
  roleCode: string | null | undefined,
  tenantEnabled: string[],
): AllowedModules {
  if (roleCode === "ADMIN") {
    return clampAllowedModules(null, tenantEnabled);
  }
  const explicit = allowedModulesFromPreferences(preferences);
  return clampAllowedModules(explicit, tenantEnabled);
}

export function mergePreferencesWithAllowedModules(
  current: unknown,
  allowedModules: AllowedModules,
): Record<string, unknown> {
  const prev =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  return { ...prev, allowedModules };
}

export function isUserModuleAllowed(
  allowed: AllowedModules | null | undefined,
  key: string,
  roleCode?: string | null,
): boolean {
  if (key === "settings") return true;
  if (roleCode === "ADMIN") return true;
  if (!allowed || Object.keys(allowed).length === 0) return true;
  if (!(key in allowed)) return true;
  return Boolean(allowed[key]);
}
