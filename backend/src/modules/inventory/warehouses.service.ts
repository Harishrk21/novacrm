import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";

/** Standard warehouse codes used across inventory and demo flow */
export const STANDARD_WAREHOUSES = [
  { code: "MAIN", name: "Main warehouse", isDefault: true },
  { code: "STORE", name: "Store", isDefault: false },
  { code: "EXECUTIVE", name: "Executive", isDefault: false },
  { code: "STAMPING", name: "Stamping", isDefault: false },
] as const;

export type WarehouseCode = (typeof STANDARD_WAREHOUSES)[number]["code"];

/** Ensure all four standard warehouses exist for a tenant (idempotent). */
export async function ensureStandardWarehouses(tenantId: string) {
  for (const w of STANDARD_WAREHOUSES) {
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
