/**
 * Replace the spare list with HMS's own spare register (SOFTWARE DETAILS → "SPARE S.NO").
 *
 *   npx tsx scripts/load-hms-spares-2026-11-24.ts <spares.json>            # dry run
 *   npx tsx scripts/load-hms-spares-2026-11-24.ts <spares.json> --apply
 *
 * spares.json is built from the sheet (75 written names merged into 62 spares, HMS's 20 "DOUBLE ENTRY"
 * rows left out). Each spare gets a Spare ID (SP-001…) in partCode; every unit's HMS number (F-6483…)
 * and every receipt (supplier, date, invoice, rate) is kept on the spare.
 * The old generic spares are hidden (not deleted — past jobs keep their spare names).
 * Stock quantities are NOT changed here.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/database.js";
import { newId } from "../src/common/utils/id.js";

const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) throw new Error("Usage: tsx scripts/load-hms-spares-2026-11-24.ts <spares.json> [--apply]");

type Spare = {
  spareId: string;
  name: string;
  group: string;
  family: "WEIGHING" | "BILLING";
  written: string[];
  count: number;
  numbered: number;
  bulk: number;
  units: string[];
  receipts: Array<{ supplier: string; date: string; invoice: string; rate: string; units: string[]; qty: number }>;
};

async function main() {
  const { spares } = JSON.parse(fs.readFileSync(file!, "utf8")) as { spares: Spare[] };
  const current = await prisma.sparePartItem.findMany({ where: { tenantId: T, deletedAt: null } });
  const isHms = (i: (typeof current)[number]) => /^SP-\d{3}$/.test(i.partCode ?? "");
  const old = current.filter((i) => i.isActive && !isHms(i));
  const byCode = new Map(current.filter(isHms).map((i) => [i.partCode!, i]));

  const creates = spares.filter((s) => !byCode.has(s.spareId));
  const updates = spares.filter((s) => byCode.has(s.spareId));
  console.log(`${spares.length} HMS spares (${creates.length} new, ${updates.length} already there) · ${spares.reduce((a, s) => a + s.count, 0)} units`);
  console.log(`Old spares hidden: ${old.length} — ${old.map((o) => o.name).join(", ")}`);
  if (!APPLY) {
    console.log("Dry run — nothing written.");
    return;
  }
  fs.mkdirSync(path.resolve("backups"), { recursive: true });
  const backup = path.resolve("backups", `spares-before-hms-list-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify(current, null, 1));
  console.log(`Backup: ${backup}`);

  const cfOf = (s: Spare) => ({
    spareId: s.spareId,
    group: s.group,
    writtenAs: s.written,
    unitsReceived: s.count,
    unitNumbers: s.units,
    bulkUnits: s.bulk,
    receipts: s.receipts,
    source: "hms-spare-register-2026-11-24",
  });
  if (creates.length) {
    await prisma.sparePartItem.createMany({
      data: creates.map((s) => ({
        id: newId(),
        tenantId: T,
        machineFamily: s.family,
        name: s.name,
        partCode: s.spareId,
        unit: "NOS",
        isActive: true,
        customFields: cfOf(s) as object,
      })),
    });
  }
  for (const s of updates) {
    await prisma.sparePartItem.update({
      where: { id: byCode.get(s.spareId)!.id },
      data: { name: s.name, machineFamily: s.family, isActive: true, customFields: cfOf(s) as object },
    });
  }
  if (old.length) await prisma.sparePartItem.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { isActive: false } });
  console.log(`Done: ${creates.length} added, ${updates.length} refreshed, ${old.length} old spares hidden.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
