import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";

/** Standard warehouse codes used across inventory and demo flow */
export const STANDARD_WAREHOUSES = [
  { code: "MAIN", name: "Main warehouse", isDefault: true },
  { code: "STORE", name: "Store", isDefault: false },
  { code: "DEMO", name: "Demo", isDefault: false },
  { code: "EXECUTIVE", name: "Executive", isDefault: false },
  { code: "STAMPING", name: "Stamping", isDefault: false },
] as const;

export type WarehouseCode = (typeof STANDARD_WAREHOUSES)[number]["code"];

/**
 * Ensure all four standard warehouses exist for a tenant (idempotent).
 * Fast path: if MAIN already exists, skip the 4 sequential upserts (huge win on high-latency RDS).
 */
export async function ensureStandardWarehouses(tenantId: string) {
  const existing = await prisma.warehouse.findMany({
    where: {
      tenantId,
      code: { in: STANDARD_WAREHOUSES.map((w) => w.code) },
      deletedAt: null,
    },
    select: { code: true },
  });
  const have = new Set(existing.map((w) => w.code));
  if (STANDARD_WAREHOUSES.every((w) => have.has(w.code))) return;

  for (const w of STANDARD_WAREHOUSES) {
    if (have.has(w.code)) continue;
    await prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId, code: w.code } },
      update: { isActive: true, deletedAt: null, name: w.name },
      create: {
        id: newId(),
        tenantId,
        code: w.code,
        name: w.name,
        isDefault: w.isDefault,
        isActive: true,
      },
    });
  }
}

export async function getWarehouseByCode(tenantId: string, code: WarehouseCode) {
  await ensureStandardWarehouses(tenantId);
  return prisma.warehouse.findFirst({
    where: { tenantId, code, deletedAt: null, isActive: true },
  });
}
