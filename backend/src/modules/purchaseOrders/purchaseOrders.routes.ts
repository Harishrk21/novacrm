import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { AppError, notFound } from "../../common/errors.js";

const lineSchema = z.object({
  productId: z.string().min(1).max(36),
  description: z.string().nullable().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
});

const body = z.object({
  vendorId: z.string().min(1).max(36),
  warehouseId: z.string().min(1).max(36).nullable().optional(),
  orderDate: z.coerce.date(),
  expectedDate: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(),
  lines: z.array(lineSchema).min(1),
  customFields: z.record(z.unknown()).optional(),
});

const vendorBody = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  gstin: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  address: z.record(z.unknown()).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body, query: z.any(), params: z.any() });
const idSchema = z.object({ body: z.any(), query: z.any(), params });
const vendorSchema = z.object({ body: vendorBody, query: z.any(), params: z.any() });
const receiveSchema = z.object({
  body: z.object({
    lines: z.array(z.object({ lineId: z.string().min(1), quantity: z.coerce.number().positive() })).min(1),
  }),
  query: z.any(),
  params,
});

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate, requireTenant);

purchaseOrdersRouter.get("/vendors", async (q: Request, r: Response) => {
  const items = await prisma.vendor.findMany({
    where: { tenantId: q.auth!.tenantId!, deletedAt: null },
    orderBy: { name: "asc" },
  });
  return success(r, items);
});

purchaseOrdersRouter.post("/vendors", validate(vendorSchema), async (q: Request, r: Response) => {
  const row = await prisma.vendor.create({
    data: { ...q.body, id: newId(), tenantId: q.auth!.tenantId! },
  });
  return success(r, row, "Vendor created", 201);
});

purchaseOrdersRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const p = pagination(q.query);
  const where: any = { tenantId: t, deletedAt: null };
  if (q.query.status) where.status = q.query.status;
  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: "desc" } }),
    prisma.purchaseOrder.count({ where }),
  ]);
  const vendorIds = [...new Set(items.map((i) => i.vendorId))];
  const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds }, tenantId: t } });
  const byId = Object.fromEntries(vendors.map((v) => [v.id, v]));
  return success(
    r,
    pageResult(
      items.map((i) => ({ ...i, vendor: byId[i.vendorId] ?? null })),
      total,
      p.page,
      p.limit,
    ),
  );
});

purchaseOrdersRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body;
  if (!(await prisma.vendor.findFirst({ where: { id: d.vendorId, tenantId: t, deletedAt: null } })))
    throw notFound("Vendor");
  const productIds = d.lines.map((l: any) => l.productId);
  const count = await prisma.product.count({ where: { id: { in: productIds }, tenantId: t, deletedAt: null } });
  if (count !== new Set(productIds).size) throw new AppError("Invalid product on PO lines", 422);

  const result = await prisma.$transaction(async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "PO" } },
    });
    if (!seq) {
      seq = await tx.numberSequence.create({
        data: { tenantId: t, sequenceKey: "PO", prefix: "PO-", nextValue: 1, padding: 5 },
      });
    }
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "PO" } },
      data: { nextValue: { increment: 1 } },
    });
    const poNumber = `${seq.prefix}${String(seq.nextValue).padStart(seq.padding, "0")}`;
    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    const lines = d.lines.map((x: any) => {
      const base = new Prisma.Decimal(x.quantity).mul(x.unitPrice);
      const tax = base.mul(x.taxPercent ?? 0).div(100);
      subtotal = subtotal.add(base);
      taxTotal = taxTotal.add(tax);
      return {
        id: newId(),
        tenantId: t,
        purchaseOrderId: "",
        productId: x.productId,
        description: x.description,
        quantity: x.quantity,
        unitPrice: x.unitPrice,
        taxPercent: x.taxPercent ?? 0,
        lineTotal: base.add(tax),
      };
    });
    const poId = newId();
    const po = await tx.purchaseOrder.create({
      data: {
        id: poId,
        tenantId: t,
        poNumber,
        vendorId: d.vendorId,
        warehouseId: d.warehouseId,
        status: d.status ?? "DRAFT",
        orderDate: d.orderDate,
        expectedDate: d.expectedDate,
        subtotal,
        taxTotal,
        grandTotal: subtotal.add(taxTotal),
        notes: d.notes,
        customFields: d.customFields,
        createdById: q.auth!.userId,
      },
    });
    await tx.purchaseOrderLine.createMany({
      data: lines.map((l: any) => ({ ...l, purchaseOrderId: poId })),
    });
    const savedLines = await tx.purchaseOrderLine.findMany({ where: { tenantId: t, purchaseOrderId: poId } });
    return { ...po, lines: savedLines };
  });
  return success(r, result, "Purchase order created", 201);
});

purchaseOrdersRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!po) throw notFound("Purchase order");
  const [lines, vendor] = await Promise.all([
    prisma.purchaseOrderLine.findMany({ where: { tenantId: t, purchaseOrderId: id } }),
    prisma.vendor.findFirst({ where: { id: po.vendorId, tenantId: t } }),
  ]);
  return success(r, { ...po, lines, vendor });
});

purchaseOrdersRouter.post("/:id/receive", validate(receiveSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!po) throw notFound("Purchase order");
  const warehouseId =
    po.warehouseId ??
    (
      await prisma.warehouse.findFirst({
        where: { tenantId: t, isDefault: true, deletedAt: null },
      })
    )?.id;
  if (!warehouseId) throw new AppError("No warehouse configured", 422);

  await prisma.$transaction(async (tx) => {
    for (const recv of q.body.lines) {
      const line = await tx.purchaseOrderLine.findFirst({
        where: { id: recv.lineId, tenantId: t, purchaseOrderId: id },
      });
      if (!line) throw notFound("PO line");
      const remaining = Number(line.quantity) - Number(line.receivedQty);
      if (recv.quantity > remaining + 0.0001) throw new AppError("Receive qty exceeds ordered", 422);
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQty: { increment: recv.quantity } },
      });
      const level = await tx.stockLevel.findUnique({
        where: {
          tenantId_productId_warehouseId: { tenantId: t, productId: line.productId, warehouseId },
        },
      });
      if (level) {
        await tx.stockLevel.update({
          where: { id: level.id },
          data: { quantityOnHand: { increment: recv.quantity } },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            id: newId(),
            tenantId: t,
            productId: line.productId,
            warehouseId,
            quantityOnHand: recv.quantity,
          },
        });
      }
      await tx.stockMovement.create({
        data: {
          id: newId(),
          tenantId: t,
          productId: line.productId,
          warehouseId,
          movementType: "IN",
          quantity: recv.quantity,
          referenceType: "PURCHASE_ORDER",
          referenceId: id,
          notes: `Received against ${po.poNumber}`,
          performedBy: q.auth!.userId,
        },
      });
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { tenantId: t, purchaseOrderId: id } });
    const allReceived = lines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
    const anyReceived = lines.some((l) => Number(l.receivedQty) > 0);
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: allReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : po.status },
    });
  });

  const updated = await prisma.purchaseOrder.findFirst({ where: { id, tenantId: t } });
  const lines = await prisma.purchaseOrderLine.findMany({ where: { tenantId: t, purchaseOrderId: id } });
  return success(r, { ...updated, lines }, "Stock received");
});
