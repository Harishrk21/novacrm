/**
 * One-off (2026-11-10): leads that already have a sales requisition are past "Ready to buy",
 * but some were stored as NEW / CONTACTED / QUALIFIED / DEMO (old flow linked a customer
 * without converting). Set them to CONVERTED so reports and the new linear flow agree.
 * Lost / junk leads are left alone. Idempotent.
 *
 *   npx tsx --env-file=.env scripts/apply-2026-11-10-lead-status-fix.ts            # dry run
 *   npx tsx --env-file=.env scripts/apply-2026-11-10-lead-status-fix.ts --apply
 */
import { PrismaClient } from "@prisma/client";
const apply = process.argv.includes("--apply");
const p = new PrismaClient();
const reqs = await p.salesRequisition.findMany({ where: { deletedAt: null }, select: { leadId: true, reqNumber: true } });
const leads = await p.lead.findMany({
  where: { id: { in: reqs.map((r) => r.leadId) }, deletedAt: null, status: { notIn: ["CONVERTED", "LOST", "UNQUALIFIED"] } },
  select: { id: true, name: true, status: true },
});
if (!leads.length) console.log("✓ all leads with a requisition are already CONVERTED");
for (const l of leads) {
  const req = reqs.find((r) => r.leadId === l.id)?.reqNumber;
  console.log(`${apply ? "→" : "[dry run]"} ${l.name} (${req}): ${l.status} → CONVERTED`);
  if (apply) await p.lead.update({ where: { id: l.id }, data: { status: "CONVERTED" } });
}
await p.$disconnect();
