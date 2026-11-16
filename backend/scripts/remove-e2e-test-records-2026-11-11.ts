/**
 * Remove the "TEST E2E" records created by the 2026-11-11 flow test and put the 2 test-sold
 * stock units back IN_STOCK (+1 on-hand, IN movement for the audit trail).
 * Soft delete (deletedAt) for business rows; notifications deleted. JSON backup first.
 *   npx tsx --env-file=.env scripts/remove-e2e-test-records-2026-11-11.ts [--apply]
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const live = { deletedAt: null };

const leads = await p.lead.findMany({ where: { ...live, name: { startsWith: "TEST E2E" } } });
const leadIds = leads.map((l) => l.id);
const reqs = await p.salesRequisition.findMany({ where: { ...live, leadId: { in: leadIds } } });
const contactIds = leads.map((l) => l.convertedContactId).filter((x): x is string => Boolean(x));
const contacts = await p.contact.findMany({ where: { ...live, id: { in: contactIds } } });
const accountIds = contacts.map((c) => c.accountId).filter((x): x is string => Boolean(x));
const accounts = await p.account.findMany({ where: { ...live, id: { in: accountIds } } });
const assets = await p.customerAsset.findMany({ where: { ...live, contactId: { in: contactIds } } });
const deals = await p.deal.findMany({ where: { ...live, OR: [{ contactId: { in: contactIds } }, { accountId: { in: accountIds } }] } });
const tickets = await p.ticket.findMany({ where: { ...live, subject: { startsWith: "TEST E2E" } } });
const ticketIds = tickets.map((t) => t.id);
const activities = await p.activity.findMany({ where: { ...live, OR: [{ leadId: { in: leadIds } }, { contactId: { in: contactIds } }] } });
const units = await p.stockUnit.findMany({ where: { ...live, status: "SOLD", contactId: { in: contactIds } } });
const entityIds = [...leadIds, ...reqs.map((r) => r.id), ...ticketIds, ...contactIds];
const notifications = await p.notification.findMany({ where: { entityId: { in: entityIds } } });

console.log({
  leads: leads.map((l) => l.name), requisitions: reqs.map((r) => r.reqNumber), contacts: contacts.map((c) => c.name),
  accounts: accounts.length, customerMachines: assets.length, deals: deals.length,
  tickets: tickets.map((t) => `SVC-${String(t.ticketNo).padStart(5, "0")} ${t.subject}`), activities: activities.length,
  unitsBackToStock: units.map((u) => u.serialNo), notifications: notifications.length,
});
if (!apply) { console.log("[dry run] nothing changed — re-run with --apply"); await p.$disconnect(); process.exit(0); }

const file = `D:/NOVA+ATTENDANCE/backups/e2e-test-records-before-remove-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ leads, reqs, contacts, accounts, assets, deals, tickets, activities, units, notifications }, null, 1));
console.log("backup:", file);

const now = new Date();
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
const ops: Prisma.PrismaPromise<unknown>[] = [
  p.lead.updateMany({ where: { id: { in: leadIds } }, data: { deletedAt: now } }),
  p.salesRequisition.updateMany({ where: { id: { in: ids(reqs) } }, data: { deletedAt: now } }),
  p.contact.updateMany({ where: { id: { in: contactIds } }, data: { deletedAt: now } }),
  p.account.updateMany({ where: { id: { in: ids(accounts) } }, data: { deletedAt: now } }),
  p.customerAsset.updateMany({ where: { id: { in: ids(assets) } }, data: { deletedAt: now } }),
  p.deal.updateMany({ where: { id: { in: ids(deals) } }, data: { deletedAt: now } }),
  p.ticket.updateMany({ where: { id: { in: ticketIds } }, data: { deletedAt: now } }),
  p.activity.updateMany({ where: { id: { in: ids(activities) } }, data: { deletedAt: now } }),
  p.notification.deleteMany({ where: { id: { in: ids(notifications) } } }),
]
// units back to stock: status, no customer, sale tags removed, +1 on hand, IN movement
for (const u of units) {
  const cf = { ...((u.customFields ?? {}) as Record<string, unknown>) };
  for (const k of ["salesRequisitionId", "reqNumber", "reducedForSaleAt", "customerName", "customerCode", "purpose", "reducedAt"]) delete cf[k];
  ops.push(p.stockUnit.update({ where: { id: u.id }, data: { status: "IN_STOCK", contactId: null, leadId: null, customFields: cf as Prisma.InputJsonValue, notes: "Back in stock — test sale removed (2026-11-11)" } }));
  ops.push(p.stockLevel.updateMany({ where: { tenantId: u.tenantId, productId: u.productId, warehouseId: u.warehouseId }, data: { quantityOnHand: { increment: 1 } } }));
  ops.push(p.stockMovement.create({ data: { id: randomUUID(), tenantId: u.tenantId, productId: u.productId, warehouseId: u.warehouseId, movementType: "IN", quantity: 1, notes: `Returned to stock — TEST E2E sale removed (${u.serialNo})`, referenceType: "STOCK_RETURN", referenceId: u.id } }));
}
await p.$transaction(ops);
const back = await p.stockUnit.findMany({ where: { id: { in: ids(units) } }, select: { serialNo: true, status: true, contactId: true } });
console.log("done; units now:", JSON.stringify(back));
await p.$disconnect();
