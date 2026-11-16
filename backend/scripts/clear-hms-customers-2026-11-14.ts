/**
 * Harish 2026-11-14: "all the existing customers are fully dummy … clear existing customer details and
 * their machines … don't delete machine names in product list and their stock".
 * Soft-deletes (deletedAt) every HMS customer (contacts + company accounts), their machines, and the
 * activities / rental agreements / spare-part changes tied to them. Products, stock units, stock
 * history, suppliers and staff are NOT touched. Audit history (work log) is kept as an audit trail.
 * Dry run by default; --apply writes. Full JSON backup first.
 *   npx tsx --env-file=.env scripts/clear-hms-customers-2026-11-14.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");

async function main() {
  const contacts = await prisma.contact.findMany({ where: { tenantId: T, deletedAt: null } });
  const accounts = await prisma.account.findMany({ where: { tenantId: T, deletedAt: null } });
  const contactIds = contacts.map((c) => c.id);
  const accountIds = accounts.map((a) => a.id);
  const assets = await prisma.customerAsset.findMany({ where: { tenantId: T, deletedAt: null } });
  const activities = await prisma.activity.findMany({
    where: {
      tenantId: T,
      deletedAt: null,
      OR: [{ contactId: { in: contactIds } }, { accountId: { in: accountIds } }],
    },
  });
  const rentals = await prisma.rentalAgreement.findMany({ where: { tenantId: T } });
  const spareChanges = await prisma.sparePartChange.findMany({ where: { tenantId: T, deletedAt: null } });
  // Safety: stock must not be tied to these customers (checked: 140 units, all IN_STOCK, none linked)
  const linkedUnits = await prisma.stockUnit.count({
    where: { tenantId: T, deletedAt: null, contactId: { in: contactIds } },
  });
  const openTickets = await prisma.ticket.count({ where: { tenantId: T, deletedAt: null } });

  console.log({
    contacts: contacts.length,
    accounts: accounts.length,
    machines: assets.length,
    activities: activities.length,
    rentals: rentals.length,
    spareChanges: spareChanges.length,
    stockUnitsLinkedToCustomers: linkedUnits,
    liveTickets: openTickets,
  });
  console.log("customers:", contacts.map((c) => c.name).join(", "));
  if (linkedUnits > 0) throw new Error("Stock units are linked to these customers — stopping (stock must stay)");

  const dir = path.resolve("D:/NOVA+ATTENDANCE/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hms-customers-before-clear-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ contacts, accounts, assets, activities, rentals, spareChanges }, null, 2));
  console.log("Backup:", file);
  if (!APPLY) {
    console.log("Dry run — nothing changed. Re-run with --apply.");
    return;
  }

  const now = new Date();
  const r = await prisma.$transaction([
    prisma.customerAsset.updateMany({ where: { tenantId: T, deletedAt: null }, data: { deletedAt: now } }),
    prisma.activity.updateMany({ where: { tenantId: T, id: { in: activities.map((a) => a.id) } }, data: { deletedAt: now } }),
    prisma.sparePartChange.updateMany({ where: { tenantId: T, deletedAt: null }, data: { deletedAt: now } }),
    prisma.contact.updateMany({ where: { tenantId: T, deletedAt: null }, data: { deletedAt: now } }),
    prisma.account.updateMany({ where: { tenantId: T, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  console.log("Applied:", { machines: r[0].count, activities: r[1].count, spareChanges: r[2].count, contacts: r[3].count, accounts: r[4].count });
  if (rentals.length) console.log(`Note: ${rentals.length} rental agreement(s) left as-is (no soft-delete column) — review`);
}

main().finally(() => prisma.$disconnect());
