import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";

export async function list(t: string, q: any) {
  // Machine pickers load the whole catalog in one call — HMS has ~200 models, so allow up to 500
  const p = pagination({ ...q, limit: Math.min(500, Number(q.limit) || 25) });
  if (Number(q.limit) > 200) {
    p.limit = Math.min(500, Number(q.limit));
    p.take = p.limit;
    p.skip = (p.page - 1) * p.limit;
  }
  const where: any = { tenantId: t, deletedAt: null };
  // Hidden (old) products stay out of pickers; the catalog admin can ask for them
  if (q.includeInactive !== "1" && q.includeInactive !== "true") where.isActive = true;
  if (q.search) {
    where.OR = [{ name: { contains: String(q.search) } }, { sku: { contains: String(q.search) } }];
  }
  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, skip: p.skip, take: p.take, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.product.count({ where }),
  ]);
  return pageResult(items, total, p.page, p.limit);
}

export async function get(t: string, id: string) {
  const product = await prisma.product.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!product) throw notFound("Product");

  const [category, stockLevels, movements, invoiceLines, tickets, warehouses] = await Promise.all([
    product.categoryId
      ? prisma.productCategory.findFirst({
          where: { id: product.categoryId, tenantId: t, deletedAt: null },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve(null),
    prisma.stockLevel.findMany({ where: { tenantId: t, productId: id } }),
    prisma.stockMovement.findMany({
      where: { tenantId: t, productId: id },
      orderBy: { movedAt: "desc" },
      take: 30,
    }),
    prisma.invoiceLine.findMany({
      where: { tenantId: t, productId: id },
      take: 20,
      orderBy: { id: "desc" },
    }),
    prisma.ticket.findMany({
      where: { tenantId: t, productId: id, deletedAt: null },
      take: 12,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
      },
    }),
    prisma.warehouse.findMany({
      where: { tenantId: t, deletedAt: null },
      select: { id: true, name: true, code: true },
    }),
  ]);

  const warehouseMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));
  const invoiceIds = [...new Set(invoiceLines.map((l) => l.invoiceId))];
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({
        where: { tenantId: t, id: { in: invoiceIds }, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          invoiceDate: true,
          grandTotal: true,
          accountId: true,
        },
      })
    : [];
  const invoiceMap = Object.fromEntries(invoices.map((i) => [i.id, i]));

  const levels = stockLevels.map((row) => ({
    ...row,
    warehouse: warehouseMap[row.warehouseId] ?? null,
    quantityAvailable: Number(row.quantityOnHand) - Number(row.quantityReserved),
  }));

  const moves = movements.map((m) => ({
    ...m,
    warehouse: warehouseMap[m.warehouseId] ?? null,
  }));

  const lines = invoiceLines.map((l) => ({
    ...l,
    invoice: invoiceMap[l.invoiceId] ?? null,
  }));

  const onHand = levels.reduce((s, r) => s + Number(r.quantityOnHand), 0);
  const reserved = levels.reduce((s, r) => s + Number(r.quantityReserved), 0);

  return {
    ...product,
    category,
    stockLevels: levels,
    movements: moves,
    invoiceLines: lines,
    tickets,
    stockSummary: {
      onHand,
      reserved,
      available: onHand - reserved,
      isLow: onHand <= Number(product.reorderLevel ?? 0),
    },
  };
}

async function category(t: string, id?: string | null) {
  if (id && !(await prisma.productCategory.findFirst({ where: { id, tenantId: t, deletedAt: null } }))) {
    throw notFound("Product category");
  }
}

const productDataKeys = [
  "categoryId",
  "sku",
  "name",
  "description",
  "productType",
  "unit",
  "hsnSac",
  "salePrice",
  "purchasePrice",
  "mrp",
  "taxPercent",
  "trackInventory",
  "reorderLevel",
  "isActive",
  "imageUrl",
  "attributes",
  "customFields",
] as const;

function pickProductData(d: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of productDataKeys) {
    if (key in d) out[key] = d[key];
  }
  if (typeof out.name === "string") out.name = out.name.trim().slice(0, 191);
  if (typeof out.sku === "string") out.sku = out.sku.trim().slice(0, 64);
  return out;
}

const PRODUCT_CODE_RE = /^[A-Z]{3}-\d{3,}$/;
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Product ID = <brand code>-<next number for that brand>, e.g. HMS-118. Used once a workspace has
 * Product IDs (HMS). The brand code is the brand's 3-letter code; a brand without one gets the first
 * free 3 letters of its name.
 */
async function nextProductCode(t: string, brandName: string) {
  const [brands, codes] = await Promise.all([
    prisma.brand.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, name: true, code: true } }),
    prisma.product.findMany({ where: { tenantId: t, sku: { contains: "-" } }, select: { sku: true } }),
  ]);
  const brand = brands.find((b) => b.name.toLowerCase() === brandName.toLowerCase());
  let prefix = brand && /^[A-Z]{3}$/.test(brand.code) ? brand.code : "";
  if (!prefix) {
    const used = new Set(brands.map((b) => b.code));
    const letters = brandName.toUpperCase().replace(/[^A-Z]/g, "") || "GEN";
    const candidates = [letters.slice(0, 3), `${letters[0]}${letters.slice(1).replace(/[AEIOU]/g, "").slice(0, 2)}`];
    for (let i = 0; i < 26; i++) candidates.push(`${letters.slice(0, 2)}${String.fromCharCode(65 + i)}`);
    prefix = candidates.find((c) => c.length === 3 && !used.has(c)) ?? letters.slice(0, 3);
    if (brand) await prisma.brand.update({ where: { id: brand.id }, data: { code: prefix } });
  }
  let max = 0;
  for (const c of codes) {
    const m = c.sku.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export async function create(t: string, d: any) {
  await category(t, d.categoryId);
  const data = pickProductData(d);
  const attrs = asRecord(data.attributes);
  const brandName = String(attrs.brand ?? "").trim();
  const usesIds = brandName
    ? !!(await prisma.product.findFirst({ where: { tenantId: t, sku: { contains: "-" }, deletedAt: null, isActive: true }, select: { sku: true }, orderBy: { updatedAt: "desc" } }).then((p) => p && PRODUCT_CODE_RE.test(p.sku)))
    : false;
  if (usesIds) {
    // Workspace with Product IDs (HMS): every new product gets the next ID for its brand
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = await nextProductCode(t, brandName);
      try {
        return await prisma.product.create({
          data: {
            ...data,
            sku: code,
            attributes: { ...attrs, productCode: code, ...(data.sku ? { oldSku: data.sku } : {}) },
            id: newId(),
            tenantId: t,
          } as unknown as Parameters<typeof prisma.product.create>[0]["data"],
        });
      } catch (e) {
        if (attempt === 2 || !String((e as Error).message).includes("Unique constraint")) throw e;
      }
    }
  }
  return prisma.product.create({
    data: { ...data, id: newId(), tenantId: t } as Parameters<typeof prisma.product.create>[0]["data"],
  });
}

export async function update(t: string, id: string, d: any) {
  await category(t, d.categoryId);
  const data = pickProductData(d);
  // A Product ID never changes — keep the SKU and the code even if the edit sends something else
  const current = await prisma.product.findFirst({ where: { id, tenantId: t, deletedAt: null }, select: { sku: true, attributes: true } });
  const code = String(asRecord(current?.attributes).productCode ?? "");
  if (current && PRODUCT_CODE_RE.test(code)) {
    delete data.sku;
    if (data.attributes) data.attributes = { ...asRecord(data.attributes), productCode: code };
  }
  const r = await prisma.product.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: data as Parameters<typeof prisma.product.updateMany>[0]["data"],
  });
  if (!r.count) throw notFound("Product");
  return get(t, id);
}

export async function remove(t: string, id: string) {
  const r = await prisma.product.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!r.count) throw notFound("Product");
}
