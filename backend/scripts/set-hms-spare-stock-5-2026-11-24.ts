/**
 * Testing stock: bring every HMS spare (Spare ID SP-…) to 5 in stock with one "Opening stock" entry each.
 * Spares already at 5 or more are left alone. Entries are tagged openingStockTest so they can be found later.
 *
 *   npx tsx scripts/set-hms-spare-stock-5-2026-11-24.ts            # dry run
 *   npx tsx scripts/set-hms-spare-stock-5-2026-11-24.ts --apply
 */
import { prisma } from "../src/config/database.js";
import { newId } from "../src/common/utils/id.js";

const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const TARGET = 5;
const APPLY = process.argv.includes("--apply");

async function main() {
  const [spares, admin] = await Promise.all([
    prisma.sparePartItem.findMany({
      where: { tenantId: T, deletedAt: null, isActive: true, partCode: { startsWith: "SP-" } },
      select: { id: true, name: true, partCode: true },
      orderBy: { partCode: "asc" },
    }),
    prisma.user.findFirst({ where: { tenantId: T, email: "admin@hmsenterprises.in" }, select: { id: true } }),
  ]);
  if (!admin) throw new Error("HMS admin user not found");
  const txns = await prisma.spareStockTxn.findMany({
    where: { tenantId: T, deletedAt: null, sparePartId: { in: spares.map((s) => s.id) } },
    select: { sparePartId: true, txnType: true, quantity: true },
  });
  const bal = new Map<string, number>();
  for (const x of txns) bal.set(x.sparePartId, (bal.get(x.sparePartId) ?? 0) + (x.txnType === "IN" ? 1 : -1) * Number(x.quantity));
  const add = spares.map((s) => ({ s, now: bal.get(s.id) ?? 0 })).filter((x) => x.now < TARGET);
  console.log(`${spares.length} spares · ${add.length} below ${TARGET} → topped up to ${TARGET}`);
  if (!APPLY) {
    console.log("Dry run — nothing written.");
    return;
  }
  const now = new Date();
  await prisma.spareStockTxn.createMany({
    data: add.map(({ s, now: have }) => ({
      id: newId(),
      tenantId: T,
      sparePartId: s.id,
      txnType: "IN" as const,
      quantity: TARGET - have,
      txnDate: now,
      supplierName: "Opening stock",
      invoiceDate: now,
      notes: `Opening stock for testing — set to ${TARGET}`,
      createdById: admin.id,
      customFields: { openingStockTest: true },
    })),
  });
  console.log(`Done: ${add.length} spares now at ${TARGET}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
