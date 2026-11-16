/**
 * One-off (2026-11-11): auto "Service SVC-…" tasks never closed with their job.
 * Cancels PENDING/OVERDUE tasks whose ticket is deleted, completes those whose ticket is
 * RESOLVED/CLOSED. Dry run by default; pass --apply. JSON backup written before changes.
 */
import fs from "node:fs";
import { prisma as p } from "../src/config/database.js";

const apply = process.argv.includes("--apply");
const tasks = await p.activity.findMany({
  where: { deletedAt: null, status: { in: ["PENDING", "OVERDUE"] } },
  select: { id: true, tenantId: true, title: true, status: true, customFields: true },
});
const linked = tasks
  .map((t) => ({ t, ticketId: (t.customFields as Record<string, unknown> | null)?.ticketId }))
  .filter((x): x is { t: (typeof tasks)[number]; ticketId: string } => typeof x.ticketId === "string");
const tickets = await p.ticket.findMany({
  where: { id: { in: [...new Set(linked.map((x) => x.ticketId))] } },
  select: { id: true, status: true, deletedAt: true },
});
const byId = new Map(tickets.map((t) => [t.id, t]));
const cancel = linked.filter((x) => !byId.get(x.ticketId) || byId.get(x.ticketId)!.deletedAt);
const complete = linked.filter((x) => {
  const tk = byId.get(x.ticketId);
  return tk && !tk.deletedAt && (tk.status === "RESOLVED" || tk.status === "CLOSED");
});
console.log({ openTicketTasks: linked.length, toCancel: cancel.length, toComplete: complete.length });
for (const x of [...cancel, ...complete]) console.log(" -", x.t.title);
if (apply && (cancel.length || complete.length)) {
  fs.mkdirSync("backups", { recursive: true });
  const file = `backups/stale-ticket-tasks-before-settle-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify({ cancel: cancel.map((x) => x.t), complete: complete.map((x) => x.t) }, null, 1));
  await p.activity.updateMany({ where: { id: { in: cancel.map((x) => x.t.id) } }, data: { status: "CANCELLED" } });
  await p.activity.updateMany({ where: { id: { in: complete.map((x) => x.t.id) } }, data: { status: "COMPLETED", completedAt: new Date() } });
  console.log("applied; backup", file);
}
await p.$disconnect();
