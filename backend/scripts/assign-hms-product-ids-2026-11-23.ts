/**
 * Give every HMS product a short, permanent Product ID:  <BRAND CODE>-<NUMBER>   e.g. HMS-012, IMN-004, WEP-007
 *
 *   npx tsx scripts/assign-hms-product-ids-2026-11-23.ts            # dry run — prints the full list
 *   npx tsx scripts/assign-hms-product-ids-2026-11-23.ts --apply    # writes (backup first)
 *
 * - The ID is stored as the product's SKU (unique in the database) and in attributes.productCode;
 *   the old SKU is kept in attributes.oldSku.
 * - Numbers run per brand in a fixed order (machine family → type → name), so the list reads well.
 * - IDs never change afterwards — not even if a product's name or brand is corrected.
 * - Products that already have an ID keep it; new ones take the next free number for their brand.
 * - The brand's code becomes the 3-letter prefix (Brand.code).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/database.js";

const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");
const cf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const BRAND_CODE: Record<string, string> = {
  HMS: "HMS",
  iMin: "IMN",
  Sunmi: "SNM",
  NGX: "NGX",
  TVS: "TVS",
  Retsol: "RTS",
  Xprint: "XPR",
  TSC: "TSC",
  BPOS: "BPS",
  Zenpert: "ZNP",
  Softland: "SFT",
  Scangel: "SCG",
  Sensible: "SNS",
  WEP: "WEP",
  LADA: "LDA",
  Phoenix: "PHX",
  Wensar: "WNS",
  Generic: "GEN",
  Anchor: "ANC",
  Biomax: "BMX",
  BoxP: "BXP",
  ECS: "ECS",
  Maxsell: "MXS",
  Smart: "SMT",
  Urovo: "URV",
  "Weighing Master": "WMS",
};
const FAMILY_ORDER = ["WEIGHING_SCALES", "BILLING_MACHINE", "TOUCH_POS", "OFFICE_AUTOMATION", "BILLING_SOFTWARE"];
const CODE_RE = /^[A-Z]{3}-\d{3,}$/;

async function main() {
  const [products, brands] = await Promise.all([
    prisma.product.findMany({ where: { tenantId: T, deletedAt: null } }),
    prisma.brand.findMany({ where: { tenantId: T, deletedAt: null } }),
  ]);
  const hms = products.filter((p) => p.isActive && /^hms-/.test(String(cf(p.attributes).source ?? "")));
  const unknownBrands = [...new Set(hms.map((p) => String(cf(p.attributes).brand ?? "")))].filter((b) => !BRAND_CODE[b]);
  if (unknownBrands.length) throw new Error(`No code for brand(s): ${unknownBrands.join(", ")}`);

  // keep existing IDs, number the rest after the highest per brand
  const next = new Map<string, number>();
  for (const p of hms) {
    const code = String(cf(p.attributes).productCode ?? "");
    if (CODE_RE.test(code)) {
      const [pre, n] = code.split("-");
      next.set(pre!, Math.max(next.get(pre!) ?? 1, Number(n) + 1));
    }
  }
  const sorted = [...hms].sort((a, b) => {
    const A = cf(a.attributes);
    const B = cf(b.attributes);
    return (
      String(A.brand).localeCompare(String(B.brand)) ||
      FAMILY_ORDER.indexOf(String(A.catalogFamily)) - FAMILY_ORDER.indexOf(String(B.catalogFamily)) ||
      String(A.machineType).localeCompare(String(B.machineType)) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
  });
  const plan: Array<{ id: string; code: string; name: string; brand: string; type: string; oldSku: string; isNew: boolean }> = [];
  for (const p of sorted) {
    const a = cf(p.attributes);
    const have = String(a.productCode ?? "");
    if (CODE_RE.test(have)) {
      plan.push({ id: p.id, code: have, name: p.name, brand: String(a.brand), type: String(a.machineType), oldSku: p.sku, isNew: false });
      continue;
    }
    const pre = BRAND_CODE[String(a.brand)]!;
    const n = next.get(pre) ?? 1;
    next.set(pre, n + 1);
    plan.push({ id: p.id, code: `${pre}-${String(n).padStart(3, "0")}`, name: p.name, brand: String(a.brand), type: String(a.machineType), oldSku: p.sku, isNew: true });
  }

  // a new ID must not already be another product's SKU (e.g. a hidden sample product)
  const planned = new Set(plan.map((x) => x.id));
  const taken = new Map(products.filter((p) => !planned.has(p.id)).map((p) => [p.sku.toUpperCase(), p.name]));
  const clash = plan.filter((x) => taken.has(x.code));
  if (clash.length) throw new Error(`ID already used as a SKU: ${clash.map((c) => `${c.code} (${taken.get(c.code)})`).join(", ")}`);
  if (new Set(plan.map((x) => x.code)).size !== plan.length) throw new Error("duplicate IDs in plan");

  let brand = "";
  for (const x of plan) {
    if (x.brand !== brand) {
      brand = x.brand;
      console.log(`\n## ${brand} (${BRAND_CODE[brand]}) — ${plan.filter((y) => y.brand === brand).length}`);
    }
    console.log(`  ${x.code}  ${x.name}   [${x.type}]${x.isNew ? "" : "  (kept)"}`);
  }
  console.log(`\n${plan.length} products · ${new Set(plan.map((x) => x.brand)).size} brands · ${plan.filter((x) => x.isNew).length} new IDs`);
  fs.writeFileSync(path.resolve("backups", "hms-product-ids-2026-11-23.json"), JSON.stringify(plan, null, 1));

  if (!APPLY) {
    console.log("\nDry run — nothing written.");
    return;
  }
  const backup = path.resolve("backups", `products-before-ids-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ products: hms, brands }, null, 1));
  console.log(`Backup: ${backup}`);
  const byId = new Map(hms.map((p) => [p.id, p]));
  const updates = plan
    .filter((x) => x.isNew)
    .map((x) => {
      const p = byId.get(x.id)!;
      return prisma.product.update({
        where: { id: x.id },
        data: { sku: x.code, attributes: { ...cf(p.attributes), productCode: x.code, oldSku: p.sku } as object },
      });
    });
  for (let k = 0; k < updates.length; k += 20) await Promise.all(updates.slice(k, k + 20));
  // brand codes = the 3-letter prefixes
  for (const [name, code] of Object.entries(BRAND_CODE)) {
    const b = brands.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!b || b.code === code) continue;
    const other = brands.find((x) => x.code === code && x.id !== b.id);
    if (other) await prisma.brand.update({ where: { id: other.id }, data: { code: `${other.code}-OLD`.slice(0, 32) } });
    await prisma.brand.update({ where: { id: b.id }, data: { code } });
  }
  console.log(`Done: ${updates.length} products got their ID.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
