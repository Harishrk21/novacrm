/**
 * One-off live DB fixes (2026-11-10). Idempotent — re-running is safe.
 *  1. rental_agreements.monthly_rate (missing → Rentals API 500)
 *  2. two indexes from schema.prisma
 *  3. Ashok sale: requisition advance ₹800 → lead's saved ₹18,600 (bug fixed in Save payment)
 *
 *   npx tsx --env-file=.env scripts/apply-2026-11-10-db-fixes.ts            # dry run
 *   npx tsx --env-file=.env scripts/apply-2026-11-10-db-fixes.ts --apply    # write
 */
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const p = new PrismaClient();

async function hasColumn(table: string, column: string) {
  const r = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    table, column,
  );
  return Number(r[0]?.n ?? 0) > 0;
}
async function hasIndex(table: string, index: string) {
  const r = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    table, index,
  );
  return Number(r[0]?.n ?? 0) > 0;
}
async function step(label: string, needed: boolean, sql: string) {
  if (!needed) return console.log(`✓ ${label} — already done`);
  console.log(`${apply ? "→ applying" : "[dry run] would apply"}: ${label}`);
  if (apply) await p.$executeRawUnsafe(sql);
}

async function main() {
  const db = await p.$queryRawUnsafe<Array<{ db: string }>>("SELECT DATABASE() AS db");
  console.log("Database:", db[0]?.db, apply ? "(APPLY)" : "(dry run)");

  await step("rental_agreements.monthly_rate", !(await hasColumn("rental_agreements", "monthly_rate")),
    "ALTER TABLE `rental_agreements` ADD COLUMN `monthly_rate` DECIMAL(15, 2) NULL");
  await step("index spare_stock_txns(tenant_id, issued_to_user_id)",
    !(await hasIndex("spare_stock_txns", "spare_stock_txns_tenant_id_issued_to_user_id_idx")),
    "CREATE INDEX `spare_stock_txns_tenant_id_issued_to_user_id_idx` ON `spare_stock_txns`(`tenant_id`, `issued_to_user_id`)");
  await step("index tickets(tenant_id, payment_status, status)",
    !(await hasIndex("tickets", "tickets_tenant_id_payment_status_status_idx")),
    "CREATE INDEX `tickets_tenant_id_payment_status_status_idx` ON `tickets`(`tenant_id`, `payment_status`, `status`)");

  // 3. Ashok — sync requisition advance to the lead's saved payment (only if still out of sync)
  const lead = await p.lead.findFirst({ where: { name: "Ashok", deletedAt: null } });
  const req = lead ? await p.salesRequisition.findFirst({ where: { leadId: lead.id, deletedAt: null } }) : null;
  const cf = (lead?.customFields ?? {}) as Record<string, unknown>;
  const leadAdv = Number(cf.saleAdvanceAmount ?? 0);
  const leadTotal = Number(cf.salePaymentTotal ?? cf.budget ?? 0);
  if (!lead || !req) console.log("✓ Ashok sale — no lead/requisition found, skipped");
  else if (Number(req.advanceAmount) === leadAdv) console.log(`✓ Ashok sale — already in sync (advance ₹${leadAdv})`);
  else {
    console.log(`${apply ? "→ applying" : "[dry run] would apply"}: Ashok ${req.reqNumber} advance ₹${req.advanceAmount} → ₹${leadAdv} (total ₹${leadTotal}, due ₹${Math.max(0, leadTotal - leadAdv)})`);
    if (apply) {
      const rcf = (req.customFields ?? {}) as Record<string, unknown>;
      await p.salesRequisition.update({
        where: { id: req.id },
        data: { advanceAmount: leadAdv, customFields: { ...rcf, salePaymentTotal: leadTotal || null } },
      });
    }
  }
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
