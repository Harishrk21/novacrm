/**
 * Add the older models found in HMS's 2020 sales register (and the service register) to the product list,
 * each with its own Product ID, so the 2020 import can link every machine to a product.
 *
 *   npx tsx scripts/load-hms-2020-models-2026-11-26.ts <plan2020.json> <out-codes.json>           # dry run
 *   npx tsx scripts/load-hms-2020-models-2026-11-26.ts <plan2020.json> <out-codes.json> --apply   # writes (backup first)
 *
 * plan2020.json = { products: [{ name, brand, model, type, fam, kind }] } — grouped from the register text
 * (Harish 2026-11-26: "what are the brands and machines you see which is not in product list give them a
 * unique product id and add them to our product list").
 * Product ID = brand code + running number (POINT → PNT-001 …), same scheme as assign-hms-product-ids.
 * out-codes.json = { "<product name>": "<Product ID>" } for every product in the plan (new and existing).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/database.js";
import { newId } from "../src/common/utils/id.js";

const TENANT = "25393a78-d3d2-483b-b141-3f4345ff4572";
const [planFile, outFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!planFile || !outFile) throw new Error("usage: <plan2020.json> <out-codes.json> [--apply]");

type Fam = "WEIGHING_SCALES" | "BILLING_MACHINE" | "TOUCH_POS" | "OFFICE_AUTOMATION" | "BILLING_SOFTWARE";
type Item = { name: string; brand: string; model: string; type: string; fam: Fam; kind: string };

const FAM_NAME: Record<Fam, string> = {
  WEIGHING_SCALES: "Weighing Scales",
  BILLING_MACHINE: "Billing Machine",
  TOUCH_POS: "Touch POS",
  OFFICE_AUTOMATION: "Office Automation",
  BILLING_SOFTWARE: "Billing Software",
};
// 3-letter codes for brands new to the list (existing brands keep theirs)
const NEW_CODES: Record<string, string> = {
  Point: "PNT", Ishtaa: "ISH", Sharp: "SHP", Iota: "IOT", Meezan: "MZN", "Nukkad Shops": "NKD", "Secure Max": "SCM",
  "RV Tech": "RVT", "VG Solution": "VGS", Expert: "EXP", Accurate: "ACU", Alfa: "ALF", ASK: "ASK", Arasan: "ARS",
  Atco: "ATC", Atlas: "ATL", Balaji: "BLJ", Belita: "BLT", "Bill Touch": "BTC", CAS: "CAS", "CP Plus": "CPP",
  Citizen: "CTZ", "E-National": "ENT", "G-Pin": "GPN", Global: "GLB", Grandmaster: "GRM", Henex: "HNX",
  Hikvision: "HIK", Mohan: "MHN", Motorola: "MOT", Omega: "OMG", Opal: "OPL", Prince: "PRC", Rudran: "RDN",
  Sanyo: "SNY", Shakthi: "SKT", Sonic: "SNC", Sugan: "SGN", Supreme: "SPR", Sure: "SUR", Trident: "TRD",
  Vasavi: "VSV", Zebra: "ZBR",
};
const cf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function main() {
  const t = TENANT;
  const plan = JSON.parse(fs.readFileSync(planFile!, "utf8")) as { products: Item[]; sales: Record<string, string>; service: Record<string, string> };
  const [products, brands, cats] = await Promise.all([
    prisma.product.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.brand.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.productCategory.findMany({ where: { tenantId: t, deletedAt: null, parentId: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const active = products.filter((p) => p.isActive && /^[A-Z]{3}-\d{3,}$/.test(p.sku));
  const byName = new Map(active.map((p) => [p.name, p]));
  const catOf = (f: Fam) => cats.find((c) => c.name.toLowerCase() === FAM_NAME[f].toLowerCase())?.id ?? null;

  // every name the plan uses must be either an existing product or a planned new one
  const planned = new Map(plan.products.map((p) => [p.name, p]));
  const used = new Set([...Object.values(plan.sales), ...Object.values(plan.service)]);
  const missing = [...used].filter((n) => !planned.has(n) && !byName.has(n));
  if (missing.length) throw new Error(`plan uses unknown products: ${missing.join(", ")}`);
  const clash = plan.products.filter((p) => byName.has(p.name));
  if (clash.length) throw new Error(`already in the list: ${clash.map((p) => p.name).join(", ")}`);

  // brand codes
  const usedCodes = new Set(brands.map((b) => b.code));
  const brandPlan = new Map<string, { id?: string; code: string; create: boolean; recode: boolean }>();
  for (const name of [...new Set(plan.products.map((p) => p.brand))].sort()) {
    const b = brands.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (b && /^[A-Z]{3}$/.test(b.code)) {
      brandPlan.set(name, { id: b.id, code: b.code, create: false, recode: false });
      continue;
    }
    const code = NEW_CODES[name];
    if (!code) throw new Error(`no code for new brand ${name}`);
    if (usedCodes.has(code) && !(b && b.code === code)) throw new Error(`code ${code} for ${name} is taken`);
    usedCodes.add(code);
    brandPlan.set(name, { id: b?.id, code, create: !b, recode: !!b });
  }

  // Product IDs: continue each brand's running number
  const maxOf = new Map<string, number>();
  for (const p of products) {
    const m = p.sku.match(/^([A-Z]{3})-(\d+)$/);
    if (m) maxOf.set(m[1]!, Math.max(maxOf.get(m[1]!) ?? 0, Number(m[2])));
  }
  const sorted = [...plan.products].sort((a, b) => (a.brand === b.brand ? a.model.localeCompare(b.model, "en", { numeric: true }) : a.brand.localeCompare(b.brand)));
  const codeOf = new Map<string, string>();
  for (const p of sorted) {
    const pre = brandPlan.get(p.brand)!.code;
    const n = (maxOf.get(pre) ?? 0) + 1;
    maxOf.set(pre, n);
    codeOf.set(p.name, `${pre}-${String(n).padStart(3, "0")}`);
  }

  console.log(`New products: ${sorted.length} · existing products reused: ${[...used].filter((n) => byName.has(n)).length}`);
  console.log(`Brands: ${[...brandPlan].filter(([, v]) => v.create).length} new, ${[...brandPlan].filter(([, v]) => v.recode).length} given a code`);
  let last = "";
  for (const p of sorted) {
    if (p.brand !== last) console.log(`\n## ${p.brand} (${brandPlan.get(p.brand)!.code})${brandPlan.get(p.brand)!.create ? " — new brand" : ""}`);
    last = p.brand;
    console.log(`  ${codeOf.get(p.name)}  ${p.name}   [${p.type}]`);
  }

  const codes: Record<string, string> = {};
  for (const n of used) codes[n] = codeOf.get(n) ?? byName.get(n)!.sku;
  fs.writeFileSync(outFile!, JSON.stringify(codes, null, 1));

  if (!APPLY) {
    console.log("\nDry run — nothing written. Add --apply to load.");
    return;
  }
  const backup = path.resolve("backups", `products-before-2020-models-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.writeFileSync(backup, JSON.stringify({ products, brands }, null, 1));
  console.log(`Backup: ${backup}`);

  const create = [...brandPlan].filter(([, v]) => v.create);
  if (create.length) await prisma.brand.createMany({ data: create.map(([name, v]) => ({ id: newId(), tenantId: t, name, code: v.code, isActive: true })) });
  for (const [, v] of [...brandPlan].filter(([, v]) => v.recode)) await prisma.brand.update({ where: { id: v.id! }, data: { code: v.code } });
  await prisma.brand.updateMany({ where: { tenantId: t, name: { in: [...brandPlan.keys()] } }, data: { isActive: true } });
  const allBrands = await prisma.brand.findMany({ where: { tenantId: t, deletedAt: null } });
  const brandId = (n: string) => allBrands.find((b) => b.name.toLowerCase() === n.toLowerCase())?.id ?? null;

  const data = sorted.map((p) => {
    const code = codeOf.get(p.name)!;
    return {
      id: newId(),
      tenantId: t,
      sku: code,
      name: p.name.slice(0, 191),
      categoryId: catOf(p.fam),
      productType: "GOODS" as const,
      unit: "NOS",
      trackInventory: true,
      isActive: true,
      taxPercent: 18,
      attributes: {
        brand: p.brand,
        brandId: brandId(p.brand),
        model: p.model,
        machineType: p.type,
        suppliers: [],
        catalogFamily: p.fam,
        catalogFamilyName: FAM_NAME[p.fam],
        catalogKind: p.kind,
        requiresStamping: p.fam === "WEIGHING_SCALES",
        gcApplicable: true,
        warrantyMonths: 12,
        amcApplicable: p.fam === "WEIGHING_SCALES",
        productCode: code,
        olderModel: true,
        source: "hms-2020-register",
      } as object,
    };
  });
  for (let k = 0; k < data.length; k += 100) await prisma.product.createMany({ data: data.slice(k, k + 100) });
  const check = await prisma.product.count({ where: { tenantId: t, deletedAt: null, sku: { in: data.map((d) => d.sku) } } });
  console.log(`Done: ${check} / ${data.length} products added.`);
  void cf;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
