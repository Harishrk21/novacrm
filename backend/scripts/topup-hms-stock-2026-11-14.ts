/**
 * Harish 2026-11-14: "make sure fill each stock with 3+ quantities".
 * Tops every active HMS machine/product (GOODS) up to at least 3 units IN STOCK, and every spare part
 * up to a balance of 3 — through the same Add stock APIs the warehouse uses (receipt + history rows).
 * Never removes stock. Dry run by default; --apply writes.
 *   npx tsx --env-file=.env scripts/topup-hms-stock-2026-11-14.ts [--apply] [--api=http://127.0.0.1:10000/api]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");
const API = process.argv.find((a) => a.startsWith("--api="))?.slice(6) ?? "http://127.0.0.1:10000/api";
const MIN = 3;
const today = new Date().toISOString().slice(0, 10);
const stamp = today.slice(2).replace(/-/g, ""); // 261114

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "warehouse@hmsenterprises.in", password: "Demo@12345", tenantSlug: "hms" }),
  });
  const j = await r.json();
  if (!j.success) throw new Error("warehouse login failed");
  return j.data.accessToken as string;
}
async function post(tok: string, path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`${path} ${r.status} ${j.message ?? j.error?.message ?? ""}`);
  return j.data;
}

async function main() {
  const wh =
    (await prisma.warehouse.findFirst({ where: { tenantId: T, deletedAt: null, isActive: true, isDefault: true } })) ??
    (await prisma.warehouse.findFirst({ where: { tenantId: T, deletedAt: null, isActive: true }, orderBy: { code: "asc" } }));
  if (!wh) throw new Error("No warehouse");
  const vendor = await prisma.vendor.findFirst({ where: { tenantId: T, deletedAt: null }, orderBy: { name: "asc" } });

  const products = await prisma.product.findMany({
    where: { tenantId: T, deletedAt: null, isActive: true, productType: "GOODS" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true },
  });
  const plan: Array<{ id: string; name: string; sku: string; have: number; add: number; brandId: string | null }> = [];
  for (const p of products) {
    const units = await prisma.stockUnit.findMany({
      where: { tenantId: T, productId: p.id, deletedAt: null },
      select: { status: true, brandId: true },
    });
    const have = units.filter((u) => u.status === "IN_STOCK").length;
    const brands = units.map((u) => u.brandId).filter(Boolean) as string[];
    const brandId = brands.sort((a, b) => brands.filter((x) => x === b).length - brands.filter((x) => x === a).length)[0] ?? null;
    if (have < MIN) plan.push({ id: p.id, name: p.name, sku: p.sku ?? "", have, add: MIN - have, brandId });
  }

  const spares = await prisma.sparePartItem.findMany({ where: { tenantId: T, deletedAt: null, isActive: true } });
  const spare = await import("../src/modules/spareStock/spareStock.service.js");
  const bal = spares.length ? await spare.balancesOf(T, spares.map((s) => s.id)) : {};
  const sparePlan = spares
    .map((s) => ({ s, have: Number((bal as Record<string, number>)[s.id] ?? 0) }))
    .filter((x) => x.have < MIN)
    .map((x) => ({ ...x, add: MIN - x.have }));

  console.log(`Warehouse ${wh.name}; ${products.length} products, ${plan.length} below ${MIN}; ${spares.length} spare parts, ${sparePlan.length} below ${MIN}`);
  for (const x of plan) console.log(`  + ${x.add}  ${x.name} (has ${x.have})`);
  for (const x of sparePlan) console.log(`  + ${x.add}  spare: ${x.s.name} (has ${x.have})`);
  if (!APPLY) {
    console.log("Dry run — nothing changed. Re-run with --apply.");
    return;
  }

  const tok = await login();
  let units = 0;
  for (const x of plan) {
    const base = (x.sku || x.name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    await post(tok, "/inventory/receipts", {
      productId: x.id,
      warehouseId: wh.id,
      vendorId: vendor?.id ?? null,
      brandId: x.brandId,
      quantity: x.add,
      receivedDate: today,
      invoiceDate: today,
      invoiceNo: `TOPUP-${stamp}`,
      notes: "Opening stock top-up (min 3 per product)",
      // Weighing products ignore this and get HMS unique IDs; others need a starting serial
      startSerial: `${base}-${stamp}${new Date().toTimeString().slice(0, 5).replace(":", "")}-01`,
    });
    units += x.add;
  }
  for (const x of sparePlan) {
    await post(tok, "/spare-stock/receive", {
      machineFamily: x.s.machineFamily,
      sparePartId: x.s.id,
      quantity: x.add,
      supplierName: vendor?.name ?? "HMS opening stock",
      invoiceDate: today,
      invoiceNo: `TOPUP-${stamp}`,
      notes: "Opening stock top-up (min 3 per spare)",
    });
  }
  console.log(`Applied: ${units} machine units across ${plan.length} products; ${sparePlan.reduce((s, x) => s + x.add, 0)} spare parts across ${sparePlan.length} items`);
}

main().finally(() => prisma.$disconnect());
