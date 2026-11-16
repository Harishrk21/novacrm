/**
 * Put the units sold during Harish's testing back IN_STOCK (2026-11-11, Harish: "yes").
 * For each SOLD unit: status IN_STOCK, no customer, sale tags removed, +1 on-hand, IN movement;
 * the customer-machine record carrying the same serial is soft-deleted. JSON backup first.
 *   npx tsx --env-file=.env scripts/return-test-sold-units-2026-11-11.ts [--apply]
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const units = await p.stockUnit.findMany({ where: { deletedAt: null, status: "SOLD" } });
const keys = units.flatMap((u) => [u.serialNo, u.hmsUniqId]).filter((x): x is string => Boolean(x));
const assets = await p.customerAsset.findMany({ where: { deletedAt: null, serialNo: { in: keys } } });
console.log(`${apply ? "returning" : "[dry run] would return"} ${units.length} units: ${units.map((u) => u.serialNo).join(", ")}`);
console.log(`${apply ? "removing" : "[dry run] would remove"} ${assets.length} customer-machine records with those serials`);
if (!apply) { await p.$disconnect(); process.exit(0); }

const file = `D:/NOVA+ATTENDANCE/backups/sold-units-before-return-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ units, assets }, null, 1));
console.log("backup:", file);

const ops: Prisma.PrismaPromise<unknown>[] = [
  p.customerAsset.updateMany({ where: { id: { in: assets.map((a) => a.id) } }, data: { deletedAt: new Date() } }),
];
for (const u of units) {
  const cf = { ...((u.customFields ?? {}) as Record<string, unknown>) };
  for (const k of ["salesRequisitionId", "reqNumber", "reducedForSaleAt", "customerName", "customerCode", "purpose", "reducedAt"]) delete cf[k];
  ops.push(p.stockUnit.update({ where: { id: u.id }, data: { status: "IN_STOCK", contactId: null, leadId: null, customFields: cf as Prisma.InputJsonValue, notes: "Back in stock — test sale cleared (2026-11-11)" } }));
  ops.push(p.stockLevel.updateMany({ where: { tenantId: u.tenantId, productId: u.productId, warehouseId: u.warehouseId }, data: { quantityOnHand: { increment: 1 } } }));
  ops.push(p.stockMovement.create({ data: { id: randomUUID(), tenantId: u.tenantId, productId: u.productId, warehouseId: u.warehouseId, movementType: "IN", quantity: 1, notes: `Returned to stock — test sale cleared (${u.serialNo})`, referenceType: "STOCK_RETURN", referenceId: u.id } }));
}
await p.$transaction(ops);
const groups = await p.stockUnit.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true });
console.log("stock now:", JSON.stringify(groups));
await p.$disconnect();
