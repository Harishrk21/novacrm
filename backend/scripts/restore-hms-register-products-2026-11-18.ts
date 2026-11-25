/**
 * HMS sells every model from its IT register too (printers, cash counters, scanners, CCTV, stones…) —
 * bring the 122 register products hidden on 2026-11-18 back into the product list, next to the
 * 120 from STOCK DETAILS, and check that every active product is placed right.
 *
 *   npx tsx scripts/restore-hms-register-products-2026-11-18.ts            # dry run + checks
 *   npx tsx scripts/restore-hms-register-products-2026-11-18.ts --apply
 */
import { prisma } from "../src/config/database.js";
import { newId } from "../src/common/utils/id.js";

const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");
const cf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const FAM_NAME: Record<string, string> = {
  WEIGHING_SCALES: "Weighing Scales",
  BILLING_MACHINE: "Billing Machine",
  TOUCH_POS: "Touch POS",
  OFFICE_AUTOMATION: "Office Automation",
  BILLING_SOFTWARE: "Billing Software",
};
const HMS_SOURCES = new Set(["hms-it-register-2026", "hms-stock-list-2026-11-18"]);

async function main() {
  const [products, brands, cats] = await Promise.all([
    prisma.product.findMany({ where: { tenantId: T, deletedAt: null } }),
    prisma.brand.findMany({ where: { tenantId: T, deletedAt: null } }),
    prisma.productCategory.findMany({ where: { tenantId: T, deletedAt: null, parentId: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const restore = products.filter((p) => !p.isActive && cf(p.attributes).source === "hms-it-register-2026");
  const active = [...products.filter((p) => p.isActive), ...restore];
  console.log(`Restore ${restore.length} register products → ${active.length} active products`);

  // ---- placement checks on the final list
  const issues: string[] = [];
  const names = new Map<string, number>();
  for (const p of active) names.set(p.name.toLowerCase(), (names.get(p.name.toLowerCase()) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) issues.push(`duplicate name: ${n} ×${c}`);
  const catId = (fam: string) => cats.find((c) => c.name.toLowerCase() === (FAM_NAME[fam] ?? "").toLowerCase())?.id ?? null;
  const fixCategory: Array<{ id: string; categoryId: string }> = [];
  const brandNames = new Set<string>();
  for (const p of active) {
    const a = cf(p.attributes);
    if (!HMS_SOURCES.has(String(a.source))) issues.push(`not an HMS-list product: ${p.name}`);
    if (!a.brand) issues.push(`no brand: ${p.name}`);
    else brandNames.add(String(a.brand));
    if (!a.machineType) issues.push(`no type: ${p.name}`);
    if (!FAM_NAME[String(a.catalogFamily)]) issues.push(`no machine family: ${p.name}`);
    const want = catId(String(a.catalogFamily));
    if (want && p.categoryId !== want) fixCategory.push({ id: p.id, categoryId: want });
    const weighing = a.catalogFamily === "WEIGHING_SCALES";
    if (weighing !== (a.catalogKind === "WEIGHING")) issues.push(`family/kind mismatch: ${p.name} (${a.catalogFamily}/${a.catalogKind})`);
  }
  const missingBrands = [...brandNames].filter((b) => !brands.some((x) => x.name.toLowerCase() === b.toLowerCase()));
  const hiddenBrands = brands.filter((b) => !b.isActive && brandNames.has(b.name));
  console.log(`Brands used: ${brandNames.size} · missing in brand list: ${missingBrands.join(", ") || "none"} · hidden but used: ${hiddenBrands.map((b) => b.name).join(", ") || "none"}`);
  console.log(`Category to fix: ${fixCategory.length}`);
  console.log(issues.length ? `Issues:\n  ${issues.join("\n  ")}` : "No placement issues");

  // summary
  const byFam = new Map<string, Map<string, number>>();
  for (const p of active) {
    const a = cf(p.attributes);
    const f = FAM_NAME[String(a.catalogFamily)] ?? "?";
    const m = byFam.get(f) ?? new Map<string, number>();
    m.set(String(a.machineType), (m.get(String(a.machineType)) ?? 0) + 1);
    byFam.set(f, m);
  }
  for (const [f, m] of byFam) console.log(`  ${f}: ${[...m.entries()].map(([t, n]) => `${t} ${n}`).join(" · ")}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written.");
    return;
  }
  if (restore.length) await prisma.product.updateMany({ where: { id: { in: restore.map((p) => p.id) } }, data: { isActive: true } });
  for (const f of fixCategory) await prisma.product.update({ where: { id: f.id }, data: { categoryId: f.categoryId } });
  if (missingBrands.length) {
    const used = new Set(brands.map((b) => b.code));
    await prisma.brand.createMany({
      data: missingBrands.map((n) => {
        let c = n.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "BRAND";
        for (let k = 2; used.has(c); k++) c = `${c.slice(0, 8)}${k}`;
        used.add(c);
        return { id: newId(), tenantId: T, name: n, code: c, isActive: true };
      }),
    });
  }
  if (hiddenBrands.length) await prisma.brand.updateMany({ where: { id: { in: hiddenBrands.map((b) => b.id) } }, data: { isActive: true } });
  console.log(`Done: ${restore.length} restored, ${fixCategory.length} categories fixed, ${missingBrands.length} brands added.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
