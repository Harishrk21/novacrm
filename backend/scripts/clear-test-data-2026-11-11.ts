/**
 * Clear Harish's test data from the live DB (2026-11-11): leads, tickets, follow-ups / activities,
 * sales requisitions, deals, proforma invoices (soft delete: deletedAt) + notifications (hard delete).
 * Products, stock units, contacts and customer machines are kept.
 * Writes a full JSON backup of every touched row first. Dry run unless --apply.
 *   npx tsx --env-file=.env scripts/clear-test-data-2026-11-11.ts [--apply]
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const live = { deletedAt: null };
const data = {
  leads: await p.lead.findMany({ where: live }),
  tickets: await p.ticket.findMany({ where: live }),
  activities: await p.activity.findMany({ where: live }),
  salesRequisitions: await p.salesRequisition.findMany({ where: live }),
  deals: await p.deal.findMany({ where: live }),
  invoices: await p.invoice.findMany({ where: live }),
  notifications: await p.notification.findMany(),
};
for (const [k, v] of Object.entries(data)) console.log(`${apply ? "clearing" : "[dry run] would clear"} ${k}: ${v.length}`);
if (!apply) { await p.$disconnect(); process.exit(0); }

const file = `D:/NOVA+ATTENDANCE/backups/live-test-data-before-clear-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
console.log("backup written:", file);

const now = new Date();
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
const r = await p.$transaction([
  p.lead.updateMany({ where: { id: { in: ids(data.leads) } }, data: { deletedAt: now } }),
  p.ticket.updateMany({ where: { id: { in: ids(data.tickets) } }, data: { deletedAt: now } }),
  p.activity.updateMany({ where: { id: { in: ids(data.activities) } }, data: { deletedAt: now } }),
  p.salesRequisition.updateMany({ where: { id: { in: ids(data.salesRequisitions) } }, data: { deletedAt: now } }),
  p.deal.updateMany({ where: { id: { in: ids(data.deals) } }, data: { deletedAt: now } }),
  p.invoice.updateMany({ where: { id: { in: ids(data.invoices) } }, data: { deletedAt: now } }),
  p.notification.deleteMany({ where: { id: { in: ids(data.notifications) } } }),
]);
console.log("done:", r.map((x) => x.count).join(" / "), "(leads / tickets / activities / requisitions / deals / invoices / notifications)");
await p.$disconnect();
