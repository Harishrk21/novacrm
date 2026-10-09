import { prisma } from "../config/database.js";
import { AppError } from "./errors.js";

export type InventoryAreas = {
  /** Serial machine / product stock (weighing + billing machines, Touch POS units). */
  machines: boolean;
  /** Billing / Touch POS / paper rolls / labels spare quantity stock. */
  sparesBilling: boolean;
  /** Weighing machine spare quantity stock. */
  sparesWeighing: boolean;
};

export const ALL_INVENTORY_AREAS: InventoryAreas = {
  machines: true,
  sparesBilling: true,
  sparesWeighing: true,
};

export const NO_INVENTORY_AREAS: InventoryAreas = {
  machines: false,
  sparesBilling: false,
  sparesWeighing: false,
};

export function parseInventoryAreasRaw(raw: unknown): InventoryAreas | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    machines: Boolean(o.machines),
    sparesBilling: Boolean(o.sparesBilling),
    sparesWeighing: Boolean(o.sparesWeighing),
  };
}

/** Read areas from User.preferences JSON. */
export function inventoryAreasFromPreferences(preferences: unknown): InventoryAreas | null {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return null;
  return parseInventoryAreasRaw((preferences as Record<string, unknown>).inventoryAreas);
}

/**
 * Resolved visibility for a user.
 * - Explicit preferences.inventoryAreas wins (admin can still restrict).
 * - Otherwise full access — teams use self-control on which stock they touch.
 */
export function resolveInventoryAreas(
  preferences: unknown,
  _roleCode?: string | null,
): InventoryAreas {
  const explicit = inventoryAreasFromPreferences(preferences);
  if (explicit) return explicit;
  return { ...ALL_INVENTORY_AREAS };
}

export function hasAnyInventoryArea(areas: InventoryAreas): boolean {
  return areas.machines || areas.sparesBilling || areas.sparesWeighing;
}

export function assertSpareFamilyAllowed(
  areas: InventoryAreas,
  family: "WEIGHING" | "BILLING",
): void {
  const ok = family === "BILLING" ? areas.sparesBilling : areas.sparesWeighing;
  if (!ok) {
    const label = family === "BILLING" ? "billing / Touch POS" : "weighing";
    throw new AppError(`You do not have access to ${label} spare stock`, 403);
  }
}

export function assertMachinesAllowed(areas: InventoryAreas): void {
  if (!areas.machines) {
    throw new AppError("You do not have access to machine / product stock", 403);
  }
}

export function allowedSpareFamilies(areas: InventoryAreas): Array<"WEIGHING" | "BILLING"> {
  const out: Array<"WEIGHING" | "BILLING"> = [];
  if (areas.sparesBilling) out.push("BILLING");
  if (areas.sparesWeighing) out.push("WEIGHING");
  return out;
}

export function mergePreferencesWithInventoryAreas(
  current: unknown,
  areas: InventoryAreas,
): Record<string, unknown> {
  const prev =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  return { ...prev, inventoryAreas: areas };
}

const areasCache = new Map<string, { at: number; areas: InventoryAreas }>();
const AREAS_TTL_MS = 60_000;

export async function loadUserInventoryAreas(
  tenantId: string,
  userId: string,
): Promise<InventoryAreas> {
  const key = `${tenantId}:${userId}`;
  const hit = areasCache.get(key);
  if (hit && Date.now() - hit.at < AREAS_TTL_MS) return hit.areas;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { preferences: true, roleId: true },
  });
  if (!user) throw new AppError("User not found", 404);
  const role = await prisma.role.findFirst({
    where: { id: user.roleId, tenantId, deletedAt: null },
    select: { code: true },
  });
  const areas = resolveInventoryAreas(user.preferences, role?.code);
  areasCache.set(key, { at: Date.now(), areas });
  return areas;
}
