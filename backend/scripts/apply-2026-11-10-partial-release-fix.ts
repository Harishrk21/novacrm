/**
 * One-off (2026-11-10, W3): sales that were marked FULFILLED / ready to ship with only some of
 * the ordered machines reduced. Rule: no half machines — reset them to "stock out pending"
 * (APPROVED, not shipped) so the warehouse reduces the remaining ordered machines, then ships.
 * Reduced units stay with the customer. Idempotent.
 *
 *   npx tsx --env-file=.env scripts/apply-2026-11-10-partial-release-fix.ts            # dry run
 *   npx tsx --env-file=.env scripts/apply-2026-11-10-partial-release-fix.ts --apply
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { syncSaleReleaseToLead } from "../src/modules/requisitions/requisitions.service.js";

const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const rows = await p.salesRequisition.findMany({ where: { deletedAt: null, status: { in: ["APPROVED", "FULFILLED"] } } });
let touched = 0;
for (const r of rows) {
  const cf = (r.customFields ?? {}) as Record<string, unknown>;
  const lines = (Array.isArray(cf.orderLines) ? cf.orderLines : []) as Array<Record<string, unknown>>;
  const fromLines = lines.reduce((s, l) => s + Math.max(1, Number(l.qty ?? 1) || 1), 0);
  const needed = Math.max(Number(cf.machinesNeeded) || 0, fromLines, Number(r.qty) || 1);
  const reduced = Array.isArray(cf.releaseLines) ? cf.releaseLines.length : 0;
  const premature = reduced < needed && (r.status === "FULFILLED" || r.shippedAt != null);
  if (!premature) continue;
  touched++;
  console.log(`${apply ? "→" : "[dry run]"} ${r.reqNumber}: ${r.status}${r.shippedAt ? " + shipped" : ""} with ${reduced}/${needed} machines → APPROVED, not shipped (warehouse to reduce ${needed - reduced} more)`);
  if (!apply) continue;
  const updated = await p.salesRequisition.update({
    where: { id: r.id },
    data: {
      status: "APPROVED",
      shippedAt: null,
      customFields: {
        ...cf,
        fulfilledAt: null,
        readyToShipAt: null,
        awaitingSalesPi: false,
        machinesNeeded: needed,
        machinesReduced: reduced,
        partialReleaseResetAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  await syncSaleReleaseToLead(r.tenantId, r.leadId, updated);
}
if (!touched) console.log("✓ no partially released sales marked fulfilled / shipped");
await p.$disconnect();
