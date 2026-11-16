/**
 * HMS live data tidy-up approved by Harish on 2026-11-14 ("yes proceed").
 *   1. Soft-delete 6 test products (no stock, no bills, no jobs).
 *   2. Soft-delete 3 machines whose customers were already deleted (showed as "Customer" on AMC).
 *   3. Sindhu (CUS-00010) area "hij" → blank (city Chennai kept).
 *   4. Employee Dhanush designation "field engineerr" → "Field Engineer".
 * Dry run by default; pass --apply to write. Backup JSON is written before any change.
 *   npx tsx --env-file=.env scripts/tidy-hms-data-2026-11-14.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");

const TEST_PRODUCTS = [
  "3a54773f-e295-4c92-a603-05d9723a9dd6", // Smoke Admin 1793688980533
  "56f888d8-ecfd-48ed-b2b9-c259780253c3", // Smoke Admin 1793689265085
  "6fac33f9-7d27-4d5d-9cd6-7fb232228c68", // Smoke Admin 1793689087855
  "b3c800e0-5294-4286-a432-dc3eb563e0a8", // Sales Desk Smoke POS
  "b3f16796-c170-40fc-b2c2-e8b6518b7204", // Test Prod E2E-…-sales
  "ba97b43e-d33b-499d-9816-a5c9d0f0eecb", // Test Prod E2E-…-admin
];
const ORPHAN_MACHINES = [
  "1e3d1547-1a1d-416d-8689-3c0b19d90839", // Preethu V (deleted) — departmental store billing machine
  "643e7db3-ded3-4cb2-9b0f-883087cf937f", // Harish kumar R (deleted) — Weighing scale 20kg (AMC)
  "709c1b3e-e918-4768-8378-085ca8d3d797", // Preethu V (deleted) — Weighing scale 20kg
];
const SINDHU = "ea57a50e-95fd-4412-9d95-c679495ca783";
const DHANUSH_EMP = "f2183e28-cb79-4d77-a3ed-436728ff5f40";

async function main() {
  const products = await prisma.product.findMany({ where: { tenantId: T, id: { in: TEST_PRODUCTS }, deletedAt: null } });
  // Safety: refuse if any of them picked up stock, bills or jobs since the check
  for (const p of products) {
    const [units, lines, tickets] = await Promise.all([
      prisma.stockUnit.count({ where: { tenantId: T, productId: p.id, deletedAt: null } }),
      prisma.invoiceLine.count({ where: { tenantId: T, productId: p.id } }),
      prisma.ticket.count({ where: { tenantId: T, productId: p.id, deletedAt: null } }),
    ]);
    if (units || lines || tickets) throw new Error(`${p.name} is now in use (units ${units}, bill lines ${lines}, jobs ${tickets}) — stopping`);
  }
  const machines = await prisma.customerAsset.findMany({ where: { tenantId: T, id: { in: ORPHAN_MACHINES }, deletedAt: null } });
  for (const m of machines) {
    const c = await prisma.contact.findFirst({ where: { id: m.contactId }, select: { deletedAt: true } });
    if (!c?.deletedAt) throw new Error(`Machine ${m.name} has a live customer — stopping`);
  }
  const sindhu = await prisma.contact.findFirst({ where: { tenantId: T, id: SINDHU }, select: { id: true, name: true, area: true, city: true } });
  const emp: Array<{ id: string; name: string; designation: string | null }> = await prisma.$queryRawUnsafe(
    "SELECT id, name, designation FROM employees WHERE id = ? AND tenant_id = ?", DHANUSH_EMP, T,
  );

  console.log(`Products to remove (${products.length}):`, products.map((p) => p.name));
  console.log(`Orphan machines to remove (${machines.length}):`, machines.map((m) => m.name));
  console.log("Sindhu:", sindhu);
  console.log("Employee:", emp);

  const dir = path.resolve("D:/NOVA+ATTENDANCE/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hms-tidy-before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ products, machines, sindhu, emp }, null, 2));
  console.log("Backup:", file);

  if (!APPLY) {
    console.log("Dry run — nothing changed. Re-run with --apply.");
    return;
  }
  const now = new Date();
  const [p, m] = await prisma.$transaction([
    prisma.product.updateMany({ where: { tenantId: T, id: { in: products.map((x) => x.id) }, deletedAt: null }, data: { deletedAt: now, isActive: false } }),
    prisma.customerAsset.updateMany({ where: { tenantId: T, id: { in: machines.map((x) => x.id) }, deletedAt: null }, data: { deletedAt: now } }),
    prisma.contact.updateMany({ where: { tenantId: T, id: SINDHU, area: "hij" }, data: { area: null } }),
  ]);
  const e = await prisma.$executeRawUnsafe(
    "UPDATE employees SET designation = 'Field Engineer' WHERE id = ? AND tenant_id = ? AND designation = 'field engineerr'", DHANUSH_EMP, T,
  );
  console.log(`Applied: products ${p.count}, machines ${m.count}, employee rows ${e}`);
}

main().finally(() => prisma.$disconnect());
