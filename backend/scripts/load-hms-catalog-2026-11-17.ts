/**
 * Load HMS Enterprises' real machine catalog (brand → type → model, with usual suppliers).
 *
 *   npx tsx scripts/load-hms-catalog-2026-11-17.ts <catalog.json>            # dry run — shows what would change
 *   npx tsx scripts/load-hms-catalog-2026-11-17.ts <catalog.json> --apply    # writes
 *
 * The catalog JSON is built from HMS's IT register (kept outside the repo — it lists their suppliers).
 * Each row: { sku, name, brand, model, type, family, kind, requiresStamping, suppliers[] }.
 *
 * What it does
 *  - creates missing brands and suppliers (case-insensitive match on name)
 *  - creates / updates one product per brand + model, with attributes.brand, .suppliers, .machineType
 *  - hides (isActive=false) the older sample products not in this catalog — nothing is deleted;
 *    old stock units and customer machines keep pointing at them
 *  - hides the test brands MASK and ISTHA
 *  - writes a backup of every product / brand row it changes to backups/
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/database.js";
import { newId } from "../src/common/utils/id.js";

const TENANT = "25393a78-d3d2-483b-b141-3f4345ff4572"; // HMS Enterprises
const APPLY = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: tsx scripts/load-hms-catalog-2026-11-17.ts <catalog.json> [--apply]");
  process.exit(1);
}

type Row = {
  sku: string;
  name: string;
  brand: string;
  model: string;
  type: string;
  family: string;
  kind: string;
  requiresStamping: boolean;
  suppliers: string[];
};
const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];

const FAMILY_NAME: Record<string, string> = {
  WEIGHING_SCALES: "Weighing Scales",
  BILLING_MACHINE: "Billing Machine",
  TOUCH_POS: "Touch POS",
  OFFICE_AUTOMATION: "Office Automation",
  BILLING_SOFTWARE: "Billing Software",
};
const TEST_BRANDS = ["MASK", "ISTHA"];
const key = (s: string) => s.trim().toLowerCase();

function brandCode(name: string, used: Set<string>) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "BRAND";
  let code = base;
  for (let i = 2; used.has(code); i++) code = `${base.slice(0, 8)}${i}`;
  used.add(code);
  return code;
}

async function main() {
  const t = TENANT;
  const [brands, vendors, products, cats] = await Promise.all([
    prisma.brand.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.vendor.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.product.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.productCategory.findMany({
      where: { tenantId: t, deletedAt: null, parentId: null },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // ---- category per family (top-level category with the family's name)
  const catByFamily = new Map<string, string>();
  for (const [fam, name] of Object.entries(FAMILY_NAME)) {
    const c = cats.find((x) => key(x.name) === key(name));
    if (c) catByFamily.set(fam, c.id);
  }

  // ---- brands
  const brandByName = new Map(brands.map((b) => [key(b.name), b]));
  const usedCodes = new Set(brands.map((b) => b.code));
  const newBrands: Array<{ id: string; name: string; code: string }> = [];
  for (const name of [...new Set(rows.map((r) => r.brand))]) {
    if (brandByName.has(key(name))) continue;
    const b = { id: newId(), name, code: brandCode(name, usedCodes) };
    newBrands.push(b);
    brandByName.set(key(name), { ...b, tenantId: t, isActive: true } as never);
  }
  const hideBrands = brands.filter((b) => TEST_BRANDS.includes(b.name.toUpperCase()) && b.isActive);
  const reactivate = brands.filter((b) => !b.isActive && rows.some((r) => key(r.brand) === key(b.name)));

  // ---- suppliers
  const vendorByName = new Map(vendors.map((v) => [key(v.name), v]));
  const newVendors: Array<{ id: string; name: string }> = [];
  for (const name of [...new Set(rows.flatMap((r) => r.suppliers))]) {
    if (vendorByName.has(key(name))) continue;
    const v = { id: newId(), name };
    newVendors.push(v);
    vendorByName.set(key(name), v as never);
  }

  // ---- products
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const creates: Row[] = [];
  const updates: Row[] = [];
  for (const r of rows) (bySku.has(r.sku) ? updates : creates).push(r);
  const catalogSkus = new Set(rows.map((r) => r.sku));
  const hideProducts = products.filter((p) => !catalogSkus.has(p.sku) && p.isActive);

  console.log(`HMS catalog from ${path.basename(file)}: ${rows.length} models`);
  console.log(`  brands:    +${newBrands.length} new (${newBrands.map((b) => b.name).join(", ") || "—"})`);
  console.log(`             hide test brands: ${hideBrands.map((b) => b.name).join(", ") || "—"}`);
  console.log(`  suppliers: +${newVendors.length} new (${newVendors.map((v) => v.name).join(", ") || "—"})`);
  console.log(`  products:  +${creates.length} new, ${updates.length} updated, ${hideProducts.length} old hidden`);
  console.log(`  categories found: ${[...catByFamily.keys()].join(", ")}`);
  const missingCat = [...new Set(rows.map((r) => r.family))].filter((f) => !catByFamily.has(f));
  if (missingCat.length) console.log(`  (no category for: ${missingCat.join(", ")} — products left uncategorised)`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Add --apply to load.");
    return;
  }

  // ---- backup
  const backupDir = path.resolve("backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `hms-catalog-before-load-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ products: [...hideProducts, ...updates.map((r) => bySku.get(r.sku))], brands: hideBrands }, null, 1),
  );
  console.log(`Backup: ${backupFile}`);

  // Batched writes (the DB is far away — one long transaction times out). Safe to re-run: every step
  // matches on name / SKU first.
  const tx = prisma;
  {
    {
      if (newBrands.length) {
        await tx.brand.createMany({
          data: newBrands.map((b) => ({ id: b.id, tenantId: t, name: b.name, code: b.code, isActive: true })),
        });
      }
      for (const b of reactivate) await tx.brand.update({ where: { id: b.id }, data: { isActive: true } });
      for (const b of hideBrands) await tx.brand.update({ where: { id: b.id }, data: { isActive: false } });
      if (newVendors.length) {
        await tx.vendor.createMany({ data: newVendors.map((v) => ({ id: v.id, tenantId: t, name: v.name })) });
      }

      const productCreates: Array<Parameters<typeof prisma.product.createMany>[0] extends { data: infer D } ? (D extends Array<infer E> ? E : never) : never> = [];
      for (const r of rows) {
        const brand = brandByName.get(key(r.brand))!;
        const isWeighing = r.family === "WEIGHING_SCALES";
        const attrs = {
          brand: r.brand,
          brandId: brand.id,
          model: r.model,
          machineType: r.type,
          suppliers: r.suppliers,
          catalogFamily: r.family,
          catalogFamilyName: FAMILY_NAME[r.family] ?? r.family,
          catalogKind: r.kind,
          catalogIndustry: null,
          catalogIndustryName: null,
          requiresStamping: r.requiresStamping,
          gcApplicable: true,
          warrantyMonths: 12,
          amcApplicable: isWeighing,
          source: "hms-it-register-2026",
        };
        const existing = bySku.get(r.sku);
        if (existing) {
          await tx.product.update({
            where: { id: existing.id },
            data: {
              name: r.name.slice(0, 191),
              isActive: true,
              categoryId: catByFamily.get(r.family) ?? existing.categoryId,
              attributes: { ...((existing.attributes as Record<string, unknown>) ?? {}), ...attrs },
            },
          });
        } else {
          productCreates.push({
            id: newId(),
            tenantId: t,
            sku: r.sku,
            name: r.name.slice(0, 191),
            categoryId: catByFamily.get(r.family) ?? null,
            productType: "GOODS",
            unit: "NOS",
            trackInventory: true,
            isActive: true,
            taxPercent: 18,
            attributes: attrs,
          });
        }
      }
      for (let i = 0; i < productCreates.length; i += 50) {
        await tx.product.createMany({ data: productCreates.slice(i, i + 50) });
      }
      if (hideProducts.length) {
        await tx.product.updateMany({
          where: { id: { in: hideProducts.map((p) => p.id) } },
          data: { isActive: false },
        });
      }
    }
  }
  console.log("Loaded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
