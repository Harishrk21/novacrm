import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";

export async function levels(t: string, q: Record<string, unknown>) {
  const where: Prisma.StockLevelWhereInput = {
    tenantId: t,
    ...(q.productId ? { productId: String(q.productId) } : {}),
    ...(q.warehouseId ? { warehouseId: String(q.warehouseId) } : {}),
  };
  const rows = await prisma.stockLevel.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  if (!rows.length) return [];

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
  const [products, warehouses] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: t, id: { in: productIds }, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        salePrice: true,
        purchasePrice: true,
        reorderLevel: true,
        imageUrl: true,
        trackInventory: true,
        hsnSac: true,
        productType: true,
        isActive: true,
      },
    }),
    prisma.warehouse.findMany({
      where: { tenantId: t, id: { in: warehouseIds }, deletedAt: null },
      select: { id: true, name: true, code: true },
    }),
  ]);
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const wMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));

  return rows.map((row) => {
    const product = pMap[row.productId];
    const onHand = Number(row.quantityOnHand);
    const reserved = Number(row.quantityReserved);
    const available = onHand - reserved;
    const reorder = Number(product?.reorderLevel ?? 0);
    const unitCost = Number(product?.purchasePrice ?? 0);
    return {
      ...row,
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: available,
      stockValue: available * unitCost,
      isLowStock: available <= reorder,
      product: product
        ? {
            ...product,
            salePrice: Number(product.salePrice),
            purchasePrice: Number(product.purchasePrice),
            reorderLevel: reorder,
          }
        : null,
      warehouse: wMap[row.warehouseId] ?? null,
    };
  });
}

export async function adjust(t: string, user: string, d: {
  productId: string;
  warehouseId: string;
  quantity: number;
  movementType: "IN" | "OUT" | "ADJUST" | "RETURN";
  notes?: string;
  referenceType?: string;
  referenceId?: string;
}) {
  const [product, warehouse] = await Promise.all([
    prisma.product.findFirst({
      where: { id: d.productId, tenantId: t, deletedAt: null, isActive: true },
    }),
    prisma.warehouse.findFirst({
      where: { id: d.warehouseId, tenantId: t, deletedAt: null, isActive: true },
    }),
  ]);
  if (!product) throw notFound("Product");
  if (!warehouse) throw notFound("Warehouse");

  const magnitude = new Prisma.Decimal(d.quantity).abs();
  const delta =
    d.movementType === "OUT" || d.movementType === "RETURN"
      ? magnitude.negated()
      : new Prisma.Decimal(d.quantity);

  return prisma.$transaction(async (tx) => {
    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: d.productId,
          warehouseId: d.warehouseId,
        },
      },
    });
    const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).add(delta);
    if (next.isNegative()) throw new AppError("Insufficient stock", 409);

    const level = await tx.stockLevel.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: d.productId,
          warehouseId: d.warehouseId,
        },
      },
      create: {
        id: newId(),
        tenantId: t,
        productId: d.productId,
        warehouseId: d.warehouseId,
        quantityOnHand: next,
      },
      update: { quantityOnHand: next },
    });

    const movement = await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: d.productId,
        warehouseId: d.warehouseId,
        movementType: d.movementType,
        quantity: d.movementType === "OUT" || d.movementType === "RETURN" ? magnitude : d.quantity,
        notes: d.notes?.trim() || "Stock adjustment",
        referenceType: d.referenceType,
        referenceId: d.referenceId,
        performedBy: user,
      },
    });

    return {
      level,
      movement,
      quantityAvailable: level.quantityOnHand.sub(level.quantityReserved),
    };
  });
}
