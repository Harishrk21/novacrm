/**
 * Remove the records created by the 2026-11-11 service / stamping flow tests:
 * "TEST E2E…" customers, their machines + spare-part changes, "TEST E2E…" tickets, related activities
 * and notifications. Soft delete where the model has deletedAt; JSON backup first.
 *   npx tsx --env-file=.env scripts/remove-svc-flow-test-records-2026-11-11.ts [--apply]
 */
import { writeFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const contacts = await p.contact.findMany({ where: { deletedAt: null, name: { startsWith: "TEST E2E" } } });
const cids = contacts.map((c) => c.id);
const assets = await p.customerAsset.findMany({ where: { deletedAt: null, contactId: { in: cids } } });
const spares = await p.sparePartChange.findMany({ where: { deletedAt: null, contactId: { in: cids } } });
const tickets = await p.ticket.findMany({ where: { deletedAt: null, OR: [{ subject: { startsWith: "TEST E2E" } }, { contactId: { in: cids } }] } });
const tids = tickets.map((t) => t.id);
const activities = await p.activity.findMany({ where: { deletedAt: null, contactId: { in: cids } } });
const notifications = await p.notification.findMany({ where: { entityId: { in: [...tids, ...cids] } } });
console.log({ contacts: contacts.map((c) => c.name), machines: assets.map((a) => a.serialNo), spareChanges: spares.length,
  tickets: tickets.map((t) => `SVC-${String(t.ticketNo).padStart(5, "0")} ${t.subject}`), activities: activities.length, notifications: notifications.length });
if (!apply) { console.log("[dry run] nothing changed — re-run with --apply"); await p.$disconnect(); process.exit(0); }
const file = `D:/NOVA+ATTENDANCE/backups/svc-flow-test-records-before-remove-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ contacts, assets, spares, tickets, activities, notifications }, null, 1));
console.log("backup:", file);
const now = new Date();
const ops: Prisma.PrismaPromise<unknown>[] = [
  p.ticket.updateMany({ where: { id: { in: tids } }, data: { deletedAt: now } }),
  p.customerAsset.updateMany({ where: { id: { in: assets.map((a) => a.id) } }, data: { deletedAt: now } }),
  p.contact.updateMany({ where: { id: { in: cids } }, data: { deletedAt: now } }),
  p.activity.updateMany({ where: { id: { in: activities.map((a) => a.id) } }, data: { deletedAt: now } }),
  p.sparePartChange.updateMany({ where: { id: { in: spares.map((s) => s.id) } }, data: { deletedAt: now } }),
  p.notification.deleteMany({ where: { id: { in: notifications.map((n) => n.id) } } }),
];
await p.$transaction(ops);
console.log("done");
await p.$disconnect();
