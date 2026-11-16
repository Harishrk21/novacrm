/**
 * One-off (2026-11-11): one service category list. Old tickets saved "Service" or no category
 * (both = breakdown / repair visit) → "Breakdown". Stamping / Installation / AMC visit / Other untouched.
 *   npx tsx --env-file=.env scripts/apply-2026-11-11-ticket-category-fix.ts [--apply]
 */
import { PrismaClient, Prisma } from "@prisma/client";
const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const rows = await p.ticket.findMany({ where: { deletedAt: null }, select: { id: true, ticketNo: true, customFields: true } });
let n = 0;
for (const r of rows) {
  const cf = (r.customFields ?? {}) as Record<string, unknown>;
  const cat = String(cf.category ?? "").trim();
  if (cat && cat !== "Service") continue;
  n++;
  console.log(`${apply ? "→" : "[dry run]"} #${r.ticketNo}: "${cat || "(none)"}" → "Breakdown"`);
  if (apply) await p.ticket.update({ where: { id: r.id }, data: { customFields: { ...cf, category: "Breakdown" } as Prisma.InputJsonValue } });
}
if (!n) console.log("✓ all tickets use the standard categories");
await p.$disconnect();
