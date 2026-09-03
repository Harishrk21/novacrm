import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";

export async function list(t: string, q: any) {
  const p = pagination(q);
  const where: any = { tenantId: t, deletedAt: null };
  if (q.search) {
    where.OR = [{ name: { contains: String(q.search) } }, { sku: { contains: String(q.search) } }];
  }
  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: "desc" } }),
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

export async function create(t: string, d: any) {
  await category(t, d.categoryId);
  const data = pickProductData(d);
  return prisma.product.create({
    data: { ...data, id: newId(), tenantId: t } as Parameters<typeof prisma.product.create>[0]["data"],
  });
}

export async function update(t: string, id: string, d: any) {
  await category(t, d.categoryId);
  const data = pickProductData(d);
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
