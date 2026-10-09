import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";
import { getWarehouseByCode } from "./warehouses.service.js";
import {
  expandSerialRange,
  familyCodeFromProduct,
  formatHmsUniqId,
  isWeighingProduct,
  sequenceKeyForFamily,
} from "./hmsUniqId.js";
import { normalizePhone } from "../../common/utils/phone.js";
import {
  expireEntityNotifications,
  notifyAdmins,
} from "../notifications/notify.service.js";
import { allPool } from "../../common/utils/concurrency.js";

async function notifyDemoAdmins(
  t: string,
  kind: "out" | "back",
  opts: { unitId: string; label: string; product?: string | null; customer?: string | null },
) {
  const machine = [opts.product, opts.label].filter(Boolean).join(" · ") || "Machine";
  if (kind === "out") {
    await notifyAdmins(t, {
      title: "Demo issued — unit left HMS",
      message: `${machine} issued for demo${opts.customer ? ` to ${opts.customer}` : ""}. Demo poirukunu — open Demo tab to monitor and return when it comes back.`,
      type: "DEMO_ISSUE",
      entityType: "stock_unit",
      entityId: opts.unitId,
    });
    return;
  }
  // Task done — clear the "demo out" alert, then post the return confirmation
  await expireEntityNotifications({
    tenantId: t,
    entityType: "stock_unit",
    entityId: opts.unitId,
    types: ["DEMO_ISSUE"],
    mode: "remove",
  });
  await notifyAdmins(t, {
    title: "Demo returned to HMS stock",
    message: `${machine} is back in HMS stock${opts.customer ? ` (was with ${opts.customer})` : ""}.`,
    type: "DEMO_RETURN",
    entityType: "stock_unit",
    entityId: opts.unitId,
  });
}

function parseDate(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapMachineType(kind: unknown): "WEIGHING" | "BILLING" | "OTHER" {
  const k = String(kind ?? "").toUpperCase();
  if (k.includes("BILL") || k.includes("POS")) return "BILLING";
  if (k.includes("WEIGH") || k === "GOODS" || !k) return "WEIGHING";
  return "OTHER";
}

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
  const [products, warehouses, unitCounts] = await Promise.all([
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
        attributes: true,
      },
    }),
    prisma.warehouse.findMany({
      where: { tenantId: t, id: { in: warehouseIds }, deletedAt: null },
      select: { id: true, name: true, code: true },
    }),
    prisma.stockUnit.groupBy({
      by: ["productId", "warehouseId", "status"],
      where: { tenantId: t, deletedAt: null, productId: { in: productIds } },
      _count: { _all: true },
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
    const serialInStock = unitCounts
      .filter(
        (u) =>
          u.productId === row.productId &&
          u.warehouseId === row.warehouseId &&
          u.status === "IN_STOCK",
      )
      .reduce((s, u) => s + u._count._all, 0);
    const serialRented = unitCounts
      .filter((u) => u.productId === row.productId && u.status === "RENTED")
      .reduce((s, u) => s + u._count._all, 0);
    return {
      ...row,
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: available,
      serialInStock,
      serialRented,
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

export async function adjust(
  t: string,
  user: string,
  d: {
    productId: string;
    warehouseId: string;
    quantity: number;
    movementType: "IN" | "OUT" | "ADJUST" | "RETURN";
    notes?: string;
    referenceType?: string;
    referenceId?: string;
  },
) {
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

async function hydrateUnits(t: string, units: Array<Record<string, unknown>>) {
  if (!units.length) return [];
  const productIds = [...new Set(units.map((u) => String(u.productId)))];
  const warehouseIds = [...new Set(units.map((u) => String(u.warehouseId)))];
  const leadIds = [...new Set(units.map((u) => u.leadId).filter(Boolean).map(String))];
  const contactIds = [...new Set(units.map((u) => u.contactId).filter(Boolean).map(String))];
  const brandIds = [...new Set(units.map((u) => u.brandId).filter(Boolean).map(String))];
  const receiptIds = [...new Set(units.map((u) => u.receiptId).filter(Boolean).map(String))];
  const [products, warehouses, leads, contacts, brands, receipts] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: t, id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        imageUrl: true,
        attributes: true,
        salePrice: true,
        purchasePrice: true,
        unit: true,
        productType: true,
      },
    }),
    prisma.warehouse.findMany({
      where: { tenantId: t, id: { in: warehouseIds } },
      select: { id: true, name: true, code: true },
    }),
    leadIds.length
      ? prisma.lead.findMany({
          where: { tenantId: t, id: { in: leadIds }, deletedAt: null },
          select: {
            id: true,
            name: true,
            company: true,
            phone: true,
            city: true,
            status: true,
            customFields: true,
          },
        })
      : Promise.resolve([]),
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: t, id: { in: contactIds }, deletedAt: null },
          select: { id: true, name: true, customerCode: true, phone: true, city: true },
        })
      : Promise.resolve([]),
    brandIds.length
      ? prisma.brand.findMany({
          where: { tenantId: t, id: { in: brandIds }, deletedAt: null },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
    receiptIds.length
      ? prisma.stockReceipt.findMany({
          where: { tenantId: t, id: { in: receiptIds }, deletedAt: null },
          select: {
            id: true,
            vendorId: true,
            brandId: true,
            spec: true,
            unitAmount: true,
            invoiceNo: true,
            invoiceDate: true,
            receivedDate: true,
            quantity: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const vendorIds = [
    ...new Set(receipts.map((r) => r.vendorId).filter(Boolean).map(String)),
  ];
  const vendors = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { tenantId: t, id: { in: vendorIds }, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const wMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));
  const lMap = Object.fromEntries(leads.map((l) => [l.id, l]));
  const cMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const bMap = Object.fromEntries(brands.map((b) => [b.id, b]));
  const vMap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const rMap = Object.fromEntries(
    receipts.map((r) => [
      r.id,
      {
        ...r,
        invoiceDate: r.invoiceDate
          ? new Date(String(r.invoiceDate)).toISOString().slice(0, 10)
          : null,
        receivedDate: r.receivedDate
          ? new Date(String(r.receivedDate)).toISOString().slice(0, 10)
          : null,
        vendor: r.vendorId ? vMap[r.vendorId] ?? null : null,
      },
    ]),
  );
  return units.map((u) => ({
    ...u,
    unitCost: u.unitCost != null ? Number(u.unitCost) : null,
    stampingDate: u.stampingDate
      ? new Date(String(u.stampingDate)).toISOString().slice(0, 10)
      : null,
    product: pMap[String(u.productId)] ?? null,
    warehouse: wMap[String(u.warehouseId)] ?? null,
    lead: u.leadId ? lMap[String(u.leadId)] ?? null : null,
    contact: u.contactId ? cMap[String(u.contactId)] ?? null : null,
    brand: u.brandId ? bMap[String(u.brandId)] ?? null : null,
    receipt: u.receiptId ? rMap[String(u.receiptId)] ?? null : null,
  }));
}

/** Lightweight hydrate for stock lists — products + brands only (skips leads/contacts/receipts). */
async function hydrateUnitsLite(t: string, units: Array<Record<string, unknown>>) {
  if (!units.length) return [];
  const productIds = [...new Set(units.map((u) => String(u.productId)))];
  const brandIds = [...new Set(units.map((u) => u.brandId).filter(Boolean).map(String))];
  const [products, brands] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: t, id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        attributes: true,
        imageUrl: true,
      },
    }),
    brandIds.length
      ? prisma.brand.findMany({
          where: { tenantId: t, id: { in: brandIds }, deletedAt: null },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
  ]);
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const bMap = Object.fromEntries(brands.map((b) => [b.id, b]));
  return units.map((u) => ({
    ...u,
    unitCost: u.unitCost != null ? Number(u.unitCost) : null,
    stampingDate: u.stampingDate
      ? new Date(String(u.stampingDate)).toISOString().slice(0, 10)
      : null,
    product: pMap[String(u.productId)] ?? null,
    brand: u.brandId ? bMap[String(u.brandId)] ?? null : null,
    warehouse: null,
    lead: null,
    contact: null,
    receipt: null,
  }));
}

export async function listUnits(t: string, q: Record<string, unknown>) {
  const search = q.search ? String(q.search).trim() : "";
  const lite =
    q.lite === "1" ||
    q.lite === 1 ||
    q.lite === true ||
    q.light === "1" ||
    q.light === true;
  const where: Prisma.StockUnitWhereInput = {
    tenantId: t,
    deletedAt: null,
    ...(q.productId ? { productId: String(q.productId) } : {}),
    ...(q.warehouseId ? { warehouseId: String(q.warehouseId) } : {}),
    ...(q.status ? { status: String(q.status) as Prisma.EnumStockUnitStatusFilter["equals"] } : {}),
    ...(search
      ? {
          OR: [
            { serialNo: { contains: search } },
            { hmsUniqId: { contains: search } },
          ],
        }
      : {}),
  };
  const rows = await prisma.stockUnit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(q.limit) || 200, 500),
    ...(lite
      ? {
          select: {
            id: true,
            productId: true,
            warehouseId: true,
            serialNo: true,
            hmsUniqId: true,
            brandId: true,
            status: true,
            unitCost: true,
            stampingDate: true,
            notes: true,
            leadId: true,
            contactId: true,
            customFields: true,
            createdAt: true,
            updatedAt: true,
          },
        }
      : {}),
  });
  const asRecords = rows as unknown as Array<Record<string, unknown>>;
  return lite ? hydrateUnitsLite(t, asRecords) : hydrateUnits(t, asRecords);
}

/** One-shot payload for Stock / Add-Reduce pages — avoids 7× remote round-trips. */
export async function stockWorkspace(t: string) {
  // Lazy import avoids circular deps with spareStock module
  const spare = await import("../spareStock/spareStock.service.js");
  // Seed once in background on first hit (cached after) — don't block workspace
  void spare.seedDefaultItems(t).catch(() => undefined);

  const [products, unitRows, vendors, brands, warehouses, users, spareRows] = await allPool(
    [
      () =>
        prisma.product.findMany({
          where: { tenantId: t, deletedAt: null },
          take: 500,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            sku: true,
            attributes: true,
            imageUrl: true,
            isActive: true,
            hsnSac: true,
            description: true,
            productType: true,
          },
        }),
      () =>
        prisma.stockUnit.findMany({
          where: {
            tenantId: t,
            deletedAt: null,
            status: { in: ["IN_STOCK", "DEMO"] },
          },
          take: 500,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            productId: true,
            warehouseId: true,
            serialNo: true,
            hmsUniqId: true,
            brandId: true,
            status: true,
            unitCost: true,
            stampingDate: true,
            notes: true,
            contactId: true,
            customFields: true,
            createdAt: true,
          },
        }),
      () =>
        prisma.vendor.findMany({
          where: { tenantId: t, deletedAt: null },
          take: 300,
          orderBy: { name: "asc" },
          select: { id: true, name: true, phone: true, gstin: true },
        }),
      () =>
        prisma.brand.findMany({
          where: { tenantId: t, deletedAt: null },
          take: 200,
          orderBy: { name: "asc" },
          select: { id: true, name: true, code: true, isActive: true },
        }),
      () =>
        prisma.warehouse.findMany({
          where: { tenantId: t, deletedAt: null, isActive: true },
          orderBy: { code: "asc" },
          select: { id: true, name: true, code: true },
        }),
      () =>
        prisma.user.findMany({
          where: { tenantId: t, deletedAt: null, status: "ACTIVE" },
          take: 200,
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, roleId: true },
        }),
      () =>
        prisma.sparePartItem
          .findMany({
            where: { tenantId: t, deletedAt: null, isActive: true },
            orderBy: [{ machineFamily: "asc" }, { name: "asc" }],
          })
          .catch(() => [] as Array<{ id: string }>),
    ],
    3,
  );

  const spareIds = spareRows.map((i) => i.id);
  const [roles, balMap] = await Promise.all([
    (() => {
      const roleIds = [...new Set(users.map((u) => u.roleId))];
      return roleIds.length
        ? prisma.role.findMany({
            where: { tenantId: t, id: { in: roleIds }, deletedAt: null },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]);
    })(),
    spareIds.length ? spare.balancesOf(t, spareIds).catch(() => ({} as Record<string, number>)) : Promise.resolve({} as Record<string, number>),
  ]);
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const bMap = Object.fromEntries(brands.map((b) => [b.id, b]));

  const units = unitRows.map((u) => ({
    ...u,
    unitCost: u.unitCost != null ? Number(u.unitCost) : null,
    stampingDate: u.stampingDate
      ? new Date(String(u.stampingDate)).toISOString().slice(0, 10)
      : null,
    product: pMap[u.productId] ?? null,
    brand: u.brandId ? bMap[u.brandId] ?? null : null,
  }));

  const spares = spareRows.map((i) => ({
    ...i,
    quantityOnHand: balMap[i.id] ?? 0,
  }));

  return {
    products,
    units,
    vendors,
    brands,
    warehouses,
    spares,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roleCode: roleMap[u.roleId]?.code ?? null,
      role: roleMap[u.roleId]
        ? { code: roleMap[u.roleId]!.code, name: roleMap[u.roleId]!.name }
        : null,
    })),
  };
}

export async function getUnit(t: string, id: string) {
  const row = await prisma.stockUnit.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Stock unit");
  const [hydrated] = await hydrateUnits(t, [row as unknown as Record<string, unknown>]);
  return hydrated;
}

export async function addStockUnit(
  t: string,
  user: string,
  d: {
    productId: string;
    warehouseId: string;
    serialNo: string;
    stampingDate?: string | null;
    notes?: string | null;
  },
) {
  const serial = d.serialNo.trim().toUpperCase();
  if (!serial) throw new AppError("Serial number is required", 400);

  const dup = await prisma.stockUnit.findFirst({
    where: { tenantId: t, serialNo: serial, deletedAt: null },
  });
  if (dup) throw new AppError(`Serial ${serial} already exists in inventory`, 409);

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

  const familyShort = familyCodeFromProduct(product.attributes, product.sku);
  const year = new Date().getUTCFullYear();
  const seqKey = sequenceKeyForFamily(year, familyShort);

  const unit = await prisma.$transaction(async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: seqKey } },
    });
    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: seqKey,
          prefix: `${year}-${familyShort}-`,
          nextValue: 1,
          padding: 4,
        },
      });
    }
    const hmsUniqId = formatHmsUniqId(year, familyShort, seq.nextValue);
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: seqKey } },
      data: { nextValue: seq.nextValue + 1 },
    });

    const created = await tx.stockUnit.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: d.productId,
        warehouseId: d.warehouseId,
        serialNo: serial,
        hmsUniqId,
        stampingDate: parseDate(d.stampingDate),
        notes: d.notes?.trim() || null,
        status: "IN_STOCK",
      },
    });

    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: d.productId,
          warehouseId: d.warehouseId,
        },
      },
    });
    const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).add(1);
    await tx.stockLevel.upsert({
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

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: d.productId,
        warehouseId: d.warehouseId,
        movementType: "IN",
        quantity: 1,
        notes: `Stock in · ${hmsUniqId} · serial ${serial}${d.stampingDate ? ` · stamped ${d.stampingDate}` : ""}`,
        referenceType: "STOCK_UNIT",
        referenceId: created.id,
        performedBy: user,
      },
    });

    return created;
  });

  return getUnit(t, unit.id);
}

export type ReceiveBatchUnitInput = {
  serialNo?: string;
  hmsUniqId?: string | null;
};

export type ReceiveBatchInput = {
  productId: string;
  warehouseId: string;
  vendorId?: string | null;
  brandId?: string | null;
  spec?: string | null;
  quantity: number;
  unitAmount?: number | null;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  receivedDate?: string | null;
  notes?: string | null;
  stampingDate?: string | null;
  /** Starting serial — used when units[] omitted */
  startSerial?: string | null;
  /** Explicit per-unit rows (preferred when UI already expanded) */
  units?: ReceiveBatchUnitInput[] | null;
};

/**
 * Invoice-style batch receive: one StockReceipt + N StockUnits with HMS Unique IDs.
 * Weighing machines: no supplier serial by default — serialNo stored as HMS Unique ID.
 */
export async function receiveBatchStock(t: string, user: string, d: ReceiveBatchInput) {
  const qty = Math.floor(Number(d.quantity));
  if (!Number.isFinite(qty) || qty < 1 || qty > 200) {
    throw new AppError("Quantity must be between 1 and 200", 422);
  }

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

  const weighing = isWeighingProduct(product.attributes, product.sku);

  let unitRows: ReceiveBatchUnitInput[] = Array.isArray(d.units) ? [...d.units] : [];
  if (unitRows.length === 0) {
    const start = String(d.startSerial ?? "").trim();
    if (!weighing && !start) throw new AppError("Starting serial number is required", 422);
    unitRows = weighing
      ? Array.from({ length: qty }, () => ({ serialNo: "" }))
      : expandSerialRange(start, qty).map((serialNo) => ({ serialNo }));
  }
  if (unitRows.length !== qty) {
    throw new AppError(`Expected ${qty} unit rows, got ${unitRows.length}`, 422);
  }

  if (d.vendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: d.vendorId, tenantId: t, deletedAt: null },
    });
    if (!vendor) throw notFound("Supplier");
  }
  if (d.brandId) {
    const brand = await prisma.brand.findFirst({
      where: { id: d.brandId, tenantId: t, deletedAt: null, isActive: true },
    });
    if (!brand) throw notFound("Brand");
  }

  const familyShort = familyCodeFromProduct(product.attributes, product.sku);
  const year = new Date().getUTCFullYear();
  const seqKey = sequenceKeyForFamily(year, familyShort);
  const receivedDate = parseDate(d.receivedDate) ?? new Date();
  const invoiceDate = parseDate(d.invoiceDate);
  const stampingDate = parseDate(d.stampingDate);
  const unitAmount = new Prisma.Decimal(Number(d.unitAmount) || 0);

  let createdIds: { receiptId: string; ids: string[] };
  try {
    createdIds = await prisma.$transaction(
      async (tx) => {
        let seq = await tx.numberSequence.findUnique({
          where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: seqKey } },
        });
        if (!seq) {
          seq = await tx.numberSequence.create({
            data: {
              tenantId: t,
              sequenceKey: seqKey,
              prefix: `${year}-${familyShort}-`,
              nextValue: 1,
              padding: 4,
            },
          });
        }

        const startSeq = seq.nextValue;
        const allocated: string[] = [];
        for (let i = 0; i < qty; i++) {
          const manual = unitRows[i]?.hmsUniqId?.trim().toUpperCase() || null;
          allocated.push(manual || formatHmsUniqId(year, familyShort, startSeq + i));
        }
        if (new Set(allocated).size !== allocated.length) {
          throw new AppError("Duplicate HMS Unique IDs in this batch", 422);
        }
        const existingIds = await tx.stockUnit.findMany({
          where: {
            tenantId: t,
            deletedAt: null,
            hmsUniqId: { in: allocated.filter(Boolean) },
          },
          select: { hmsUniqId: true },
        });
        if (existingIds.length) {
          throw new AppError(
            `HMS Unique ID already used: ${existingIds.map((x) => x.hmsUniqId).join(", ")}`,
            409,
          );
        }

        // Weighing: no factory serial — use HMS Unique ID as the stock identity key.
        // Other products: supplier serial required.
        const serials = unitRows.map((u, i) => {
          const raw = String(u.serialNo ?? "")
            .trim()
            .toUpperCase();
          if (raw) return raw;
          if (weighing) return allocated[i]!;
          return "";
        });
        if (serials.some((s) => !s)) {
          throw new AppError("Every unit needs a serial number", 422);
        }
        if (new Set(serials).size !== serials.length) {
          throw new AppError("Duplicate serials in this batch", 422);
        }
        const existingSerials = await tx.stockUnit.findMany({
          where: { tenantId: t, deletedAt: null, serialNo: { in: serials } },
          select: { serialNo: true },
        });
        if (existingSerials.length) {
          throw new AppError(
            `Serial / Unique ID already in stock: ${existingSerials.map((x) => x.serialNo).join(", ")}`,
            409,
          );
        }

        const maxUsed = startSeq + qty - 1;
        const autoMax = unitRows.reduce((max, u, i) => {
          if (u.hmsUniqId?.trim()) return max;
          return Math.max(max, startSeq + i);
        }, startSeq - 1);
        if (autoMax >= startSeq) {
          await tx.numberSequence.update({
            where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: seqKey } },
            data: { nextValue: Math.max(seq.nextValue, autoMax + 1, maxUsed + 1) },
          });
        }

        const receiptId = newId();
        await tx.stockReceipt.create({
          data: {
            id: receiptId,
            tenantId: t,
            vendorId: d.vendorId || null,
            brandId: d.brandId || null,
            productId: d.productId,
            warehouseId: d.warehouseId,
            spec: d.spec?.trim() || null,
            quantity: qty,
            unitAmount,
            invoiceNo: d.invoiceNo?.trim() || null,
            invoiceDate,
            receivedDate,
            notes: d.notes?.trim() || null,
            createdById: user,
          },
        });

        const ids: string[] = [];
        for (let i = 0; i < qty; i++) {
          const id = newId();
          ids.push(id);
          const moveNote = `Stock in · ${allocated[i]} · ${serials[i]}${
            d.invoiceNo ? ` · inv ${String(d.invoiceNo).slice(0, 40)}` : ""
          }`.slice(0, 255);
          await tx.stockUnit.create({
            data: {
              id,
              tenantId: t,
              productId: d.productId,
              warehouseId: d.warehouseId,
              serialNo: serials[i]!,
              hmsUniqId: allocated[i]!,
              receiptId,
              brandId: d.brandId || null,
              unitCost: unitAmount,
              stampingDate,
              notes: d.notes?.trim() || null,
              status: "IN_STOCK",
            },
          });
          await tx.stockMovement.create({
            data: {
              id: newId(),
              tenantId: t,
              productId: d.productId,
              warehouseId: d.warehouseId,
              movementType: "IN",
              quantity: 1,
              notes: moveNote,
              // Unit id so history can show HMS / serial; receipt stays on stock_units.receiptId
              referenceType: "STOCK_UNIT",
              referenceId: id,
              performedBy: user,
            },
          });
        }

        const current = await tx.stockLevel.findUnique({
          where: {
            tenantId_productId_warehouseId: {
              tenantId: t,
              productId: d.productId,
              warehouseId: d.warehouseId,
            },
          },
        });
        const nextQty = (current?.quantityOnHand ?? new Prisma.Decimal(0)).add(qty);
        await tx.stockLevel.upsert({
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
            quantityOnHand: nextQty,
          },
          update: { quantityOnHand: nextQty },
        });

        return { receiptId, ids };
      },
      { timeout: 25_000, maxWait: 8_000 },
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        throw new AppError(
          "Duplicate serial or HMS Unique ID already exists in stock",
          409,
        );
      }
      if (err.code === "P2021" || err.code === "P2022") {
        throw new AppError(
          "Database is missing stock receive tables — ask admin to run prisma db push",
          500,
        );
      }
      throw new AppError(err.message || "Could not receive stock", 500);
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      throw new AppError("Invalid stock receive data — check product, warehouse, and unit rows", 422);
    }
    if (err instanceof Error) {
      throw new AppError(err.message || "Could not receive stock", 500);
    }
    throw err;
  }

  const units = await hydrateUnits(
    t,
    (
      await prisma.stockUnit.findMany({
        where: { tenantId: t, id: { in: createdIds.ids } },
        orderBy: { hmsUniqId: "asc" },
      })
    ) as unknown as Array<Record<string, unknown>>,
  );

  return {
    receiptId: createdIds.receiptId,
    quantity: qty,
    units,
  };
}

/** Preview next HMS Unique IDs for a product + quantity (no persistence). */
export async function previewHmsUniqIds(t: string, productId: string, quantity: number) {
  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty) || qty < 1 || qty > 200) {
    throw new AppError("Quantity must be between 1 and 200", 422);
  }
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: t, deletedAt: null },
  });
  if (!product) throw notFound("Product");
  const familyShort = familyCodeFromProduct(product.attributes, product.sku);
  const year = new Date().getUTCFullYear();
  const seqKey = sequenceKeyForFamily(year, familyShort);
  const seq = await prisma.numberSequence.findUnique({
    where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: seqKey } },
  });
  const start = seq?.nextValue ?? 1;
  return Array.from({ length: qty }, (_, i) => formatHmsUniqId(year, familyShort, start + i));
}

function addYears(date: Date, years: number) {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/** Keep warehouse serial stamping aligned with the customer machine register when serial matches */
export async function syncStampingAcrossRegisters(
  t: string,
  opts: {
    serialNo?: string | null;
    contactId?: string | null;
    stampingDate?: Date | null;
    nextDueDate?: Date | null;
  },
) {
  const serial = opts.serialNo?.trim().toUpperCase();
  if (!serial) return;

  // StockUnit only has stampingDate — nextDueDate belongs on CustomerAsset
  if (opts.stampingDate) {
    await prisma.stockUnit.updateMany({
      where: { tenantId: t, serialNo: serial, deletedAt: null },
      data: { stampingDate: opts.stampingDate },
    });
  }

  if (opts.contactId) {
    const assetData: Record<string, unknown> = {};
    if (opts.stampingDate) assetData.stampingDate = opts.stampingDate;
    if (opts.nextDueDate) assetData.nextDueDate = opts.nextDueDate;
    if (Object.keys(assetData).length) {
      await prisma.customerAsset.updateMany({
        where: { tenantId: t, contactId: opts.contactId, serialNo: serial, deletedAt: null },
        data: assetData,
      });
    }
  }
}

export type DemoPlacementInput = {
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCompany?: string | null;
  customerAddress?: string | null;
  city?: string | null;
  state?: string | null;
  assigneeUserId: string;
  notes?: string | null;
};

export type RentalPlacementInput = {
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCompany?: string | null;
  customerAddress?: string | null;
  city?: string | null;
  state?: string | null;
  contactId?: string | null;
  startAt: string;
  expectedReturnAt?: string | null;
  dailyRate?: number | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
  notes?: string | null;
};

export type UpdateStockUnitInput = {
  warehouseId?: string;
  serialNo?: string;
  hmsUniqId?: string | null;
  brandId?: string | null;
  unitCost?: number | null;
  stampingDate?: string | null;
  notes?: string | null;
  placement?: "STOCK" | "DEMO" | "RENTAL";
  demo?: DemoPlacementInput;
  rental?: RentalPlacementInput;
};

async function applyUnitFieldPatch(
  t: string,
  id: string,
  existing: {
    id: string;
    productId: string;
    warehouseId: string;
    serialNo: string;
    contactId: string | null;
    status: string;
  },
  d: UpdateStockUnitInput,
) {
  if (d.serialNo) {
    const serial = d.serialNo.trim().toUpperCase();
    const dup = await prisma.stockUnit.findFirst({
      where: { tenantId: t, serialNo: serial, deletedAt: null, NOT: { id } },
    });
    if (dup) throw new AppError(`Serial ${serial} already exists`, 409);
  }
  if (d.hmsUniqId?.trim()) {
    const uniq = d.hmsUniqId.trim().toUpperCase();
    const dup = await prisma.stockUnit.findFirst({
      where: { tenantId: t, hmsUniqId: uniq, deletedAt: null, NOT: { id } },
    });
    if (dup) throw new AppError(`HMS Unique ID ${uniq} already exists`, 409);
  }
  if (d.brandId) {
    const brand = await prisma.brand.findFirst({
      where: { id: d.brandId, tenantId: t, deletedAt: null },
    });
    if (!brand) throw notFound("Brand");
  }
  if (d.warehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: d.warehouseId, tenantId: t, deletedAt: null },
    });
    if (!wh) throw notFound("Warehouse");
  }

  const newWarehouseId =
    d.warehouseId && d.warehouseId !== existing.warehouseId ? d.warehouseId : null;
  const fieldData = {
    ...(d.serialNo ? { serialNo: d.serialNo.trim().toUpperCase() } : {}),
    ...("hmsUniqId" in d
      ? { hmsUniqId: d.hmsUniqId?.trim() ? d.hmsUniqId.trim().toUpperCase() : null }
      : {}),
    ...("brandId" in d ? { brandId: d.brandId || null } : {}),
    ...("unitCost" in d
      ? { unitCost: d.unitCost != null ? new Prisma.Decimal(d.unitCost) : null }
      : {}),
    ...("stampingDate" in d ? { stampingDate: parseDate(d.stampingDate) } : {}),
    ...("notes" in d ? { notes: d.notes?.trim() || null } : {}),
  };

  if (newWarehouseId && existing.status === "IN_STOCK") {
    await prisma.$transaction(async (tx) => {
      const dec = await tx.stockLevel.findUnique({
        where: {
          tenantId_productId_warehouseId: {
            tenantId: t,
            productId: existing.productId,
            warehouseId: existing.warehouseId,
          },
        },
      });
      const decNext = (dec?.quantityOnHand ?? new Prisma.Decimal(0)).sub(1);
      if (decNext.isNegative()) throw new AppError("Insufficient stock at source warehouse", 409);
      if (dec) {
        await tx.stockLevel.update({
          where: { id: dec.id },
          data: { quantityOnHand: decNext },
        });
      }
      await tx.stockLevel.upsert({
        where: {
          tenantId_productId_warehouseId: {
            tenantId: t,
            productId: existing.productId,
            warehouseId: newWarehouseId,
          },
        },
        create: {
          id: newId(),
          tenantId: t,
          productId: existing.productId,
          warehouseId: newWarehouseId,
          quantityOnHand: 1,
        },
        update: { quantityOnHand: { increment: 1 } },
      });
      await tx.stockUnit.updateMany({
        where: { id, tenantId: t, deletedAt: null },
        data: { warehouseId: newWarehouseId, ...fieldData },
      });
    });
  } else {
    await prisma.stockUnit.updateMany({
      where: { id, tenantId: t, deletedAt: null },
      data: {
        ...(newWarehouseId && existing.status === "IN_STOCK"
          ? { warehouseId: newWarehouseId }
          : {}),
        ...fieldData,
      },
    });
  }

  if ("stampingDate" in d && d.stampingDate) {
    const stamp = parseDate(d.stampingDate);
    const nextDue = stamp ? addYears(stamp, 1) : null;
    await syncStampingAcrossRegisters(t, {
      serialNo: d.serialNo?.trim().toUpperCase() ?? existing.serialNo,
      contactId: existing.contactId,
      stampingDate: stamp,
      nextDueDate: nextDue,
    });
  }
}

/** Create sale-tracking DEMO lead + issue unit from Inventory edit. */
async function placeUnitOnDemo(
  t: string,
  userId: string,
  unitId: string,
  demo: DemoPlacementInput,
) {
  const name = demo.customerName.trim();
  if (!name) throw new AppError("Customer name is required for demo", 422);
  if (!demo.assigneeUserId) throw new AppError("Select who is responsible for this demo", 422);

  const assignee = await prisma.user.findFirst({
    where: { id: demo.assigneeUserId, tenantId: t, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!assignee) throw new AppError("Assignee not found or inactive", 404);

  const unit = await prisma.stockUnit.findFirst({
    where: { id: unitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status === "DEMO" && unit.leadId) {
    // Update existing demo enquiry + unit snapshot
    await prisma.lead.updateMany({
      where: { id: unit.leadId, tenantId: t, deletedAt: null },
      data: {
        name,
        phone: demo.customerPhone?.trim() || null,
        email: demo.customerEmail?.trim() || null,
        company: demo.customerCompany?.trim() || null,
        city: demo.city?.trim() || null,
        state: demo.state?.trim() || null,
        assignedToId: assignee.id,
      },
    });
    const cf =
      unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
        ? (unit.customFields as Record<string, unknown>)
        : {};
    await prisma.stockUnit.update({
      where: { id: unit.id },
      data: {
        notes: demo.notes?.trim() || unit.notes,
        customFields: {
          ...cf,
          demoCustomerName: name,
          demoCompany: demo.customerCompany?.trim() || null,
          demoPhone: demo.customerPhone?.trim() || null,
          demoCity: demo.city?.trim() || null,
          demoState: demo.state?.trim() || null,
          demoAddress: demo.customerAddress?.trim() || null,
          demoExecutiveId: assignee.id,
          demoExecutiveName: assignee.name,
        },
      },
    });
    return getUnit(t, unitId);
  }
  if (unit.status !== "IN_STOCK") {
    throw new AppError(
      `Serial ${unit.serialNo} is ${unit.status} — return it before issuing a new demo`,
      409,
    );
  }

  const leadId = newId();
  const maxRow = await prisma.lead.aggregate({
    where: { tenantId: t },
    _max: { leadNo: true },
  });
  const leadNo = (maxRow._max.leadNo ?? 0) + 1;
  const demoPhone = demo.customerPhone?.trim() || null;
  await prisma.lead.create({
    data: {
      id: leadId,
      tenantId: t,
      leadNo,
      name,
      phone: demoPhone,
      phoneNormalized: normalizePhone(demoPhone),
      email: demo.customerEmail?.trim() || null,
      company: demo.customerCompany?.trim() || null,
      city: demo.city?.trim() || null,
      state: demo.state?.trim() || null,
      status: "NEW",
      assignedToId: assignee.id,
      createdById: userId,
      customFields: {
        serviceType: "SALES",
        verified: true,
        fromInventoryDemo: true,
        demoAddress: demo.customerAddress?.trim() || null,
        requirement: demo.notes?.trim() || "Demo machine issued from Inventory",
      },
    },
  });

  await issueDemoUnit(t, userId, leadId, unitId);

  // Prefer DEMO warehouse when present
  const demoWh = await getWarehouseByCode(t, "DEMO");
  if (demoWh) {
    await prisma.stockUnit.updateMany({
      where: { id: unitId, tenantId: t, deletedAt: null, status: "DEMO" },
      data: { warehouseId: demoWh.id },
    });
  }
  if (demo.notes?.trim()) {
    await prisma.stockUnit.updateMany({
      where: { id: unitId, tenantId: t, deletedAt: null },
      data: { notes: demo.notes.trim() },
    });
  }
  return getUnit(t, unitId);
}

async function placeUnitOnRental(
  t: string,
  userId: string,
  unitId: string,
  rental: RentalPlacementInput,
) {
  const unit = await prisma.stockUnit.findFirst({
    where: { id: unitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");

  const { issueRental, getRental } = await import("../rentals/rentals.service.js");

  if (unit.status === "RENTED") {
    const cf =
      unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
        ? (unit.customFields as Record<string, unknown>)
        : {};
    const rentalId = cf.rentalId ? String(cf.rentalId) : "";
    if (!rentalId) throw new AppError("Active rental link missing on this unit", 409);
    const startAt = new Date(rental.startAt);
    if (Number.isNaN(startAt.getTime())) throw new AppError("Invalid rental start", 422);
    const expectedReturnAt = rental.expectedReturnAt
      ? new Date(rental.expectedReturnAt)
      : null;
    await prisma.rentalAgreement.updateMany({
      where: { id: rentalId, tenantId: t, status: "ACTIVE" },
      data: {
        customerName: rental.customerName.trim(),
        customerPhone: rental.customerPhone?.trim() || null,
        customerEmail: rental.customerEmail?.trim() || null,
        customerCompany: rental.customerCompany?.trim() || null,
        customerAddress: rental.customerAddress?.trim() || null,
        city: rental.city?.trim() || null,
        state: rental.state?.trim() || null,
        contactId: rental.contactId || null,
        startAt,
        expectedReturnAt:
          expectedReturnAt && !Number.isNaN(expectedReturnAt.getTime())
            ? expectedReturnAt
            : null,
        dailyRate: rental.dailyRate != null ? rental.dailyRate : null,
        totalAmount: rental.totalAmount != null ? rental.totalAmount : null,
        depositAmount: rental.depositAmount != null ? rental.depositAmount : null,
        notes: rental.notes?.trim() || null,
      },
    });
    await prisma.stockUnit.update({
      where: { id: unit.id },
      data: {
        contactId: rental.contactId || null,
        notes: rental.notes?.trim() || unit.notes,
        customFields: {
          ...cf,
          rentalCustomerName: rental.customerName.trim(),
          rentalCustomerPhone: rental.customerPhone?.trim() || null,
          rentalCustomerCompany: rental.customerCompany?.trim() || null,
          expectedReturnAt: expectedReturnAt?.toISOString() ?? null,
          rentedAt: startAt.toISOString(),
        },
      },
    });
    await getRental(t, rentalId);
    return getUnit(t, unitId);
  }

  if (unit.status !== "IN_STOCK") {
    throw new AppError(
      `Serial ${unit.serialNo} is ${unit.status} — return it before issuing a rental`,
      409,
    );
  }

  // Sales intake lead marked as RENTAL category
  const leadId = newId();
  const maxRow = await prisma.lead.aggregate({
    where: { tenantId: t },
    _max: { leadNo: true },
  });
  const rentalPhone = rental.customerPhone?.trim() || null;
  await prisma.lead.create({
    data: {
      id: leadId,
      tenantId: t,
      leadNo: (maxRow._max.leadNo ?? 0) + 1,
      name: rental.customerName.trim(),
      phone: rentalPhone,
      phoneNormalized: normalizePhone(rentalPhone),
      email: rental.customerEmail?.trim() || null,
      company: rental.customerCompany?.trim() || null,
      city: rental.city?.trim() || null,
      state: rental.state?.trim() || null,
      status: "CONTACTED",
      createdById: userId,
      customFields: {
        serviceType: "RENTAL",
        verified: true,
        fromInventoryRental: true,
        requirement: rental.notes?.trim() || "Rental issued from Inventory",
      },
    },
  });

  await issueRental(t, userId, {
    stockUnitId: unitId,
    contactId: rental.contactId || null,
    leadId,
    customerName: rental.customerName,
    customerPhone: rental.customerPhone,
    customerEmail: rental.customerEmail,
    customerCompany: rental.customerCompany,
    customerAddress: rental.customerAddress,
    city: rental.city,
    state: rental.state,
    startAt: rental.startAt,
    expectedReturnAt: rental.expectedReturnAt,
    dailyRate: rental.dailyRate,
    totalAmount: rental.totalAmount,
    depositAmount: rental.depositAmount,
    notes: rental.notes,
  });

  return getUnit(t, unitId);
}

export async function updateStockUnit(t: string, userId: string, id: string, d: UpdateStockUnitInput) {
  const existing = await prisma.stockUnit.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Stock unit");

  const placement = d.placement ?? "STOCK";

  // Detect demo warehouse selection as DEMO placement shortcut
  let resolvedPlacement = placement;
  if (placement === "STOCK" && d.warehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: d.warehouseId, tenantId: t, deletedAt: null },
      select: { code: true },
    });
    const code = String(wh?.code ?? "").toUpperCase();
    if ((code === "DEMO" || code === "EXECUTIVE") && existing.status === "IN_STOCK" && d.demo) {
      resolvedPlacement = "DEMO";
    }
  }

  if (resolvedPlacement === "DEMO") {
    if (!d.demo) throw new AppError("Demo customer details and assignee are required", 422);
    await applyUnitFieldPatch(t, id, existing, { ...d, warehouseId: undefined });
    return placeUnitOnDemo(t, userId, id, d.demo);
  }

  if (resolvedPlacement === "RENTAL") {
    if (!d.rental) throw new AppError("Rental customer details and period are required", 422);
    await applyUnitFieldPatch(t, id, existing, { ...d, warehouseId: undefined });
    return placeUnitOnRental(t, userId, id, d.rental);
  }

  // STOCK placement — optional return from demo/rental is done via dedicated actions
  await applyUnitFieldPatch(t, id, existing, d);
  return getUnit(t, id);
}

/** Record govt stamping on a serial — metadata only; does not change stock quantity */
export async function recordStamping(
  t: string,
  user: string,
  stockUnitId: string,
  stampingDate: string,
  notes?: string,
) {
  const unit = await prisma.stockUnit.findFirst({
    where: { id: stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");

  const stamp = parseDate(stampingDate);
  if (!stamp) throw new AppError("Valid stamping date is required", 400);

  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};

  const prevStamp = unit.stampingDate
    ? new Date(unit.stampingDate).toISOString().slice(0, 10)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        stampingDate: stamp,
        customFields: {
          ...unitCf,
          lastStampedAt: new Date().toISOString(),
          previousStampingDate: prevStamp,
          stampingNotes: notes?.trim() || null,
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: unit.warehouseId,
        movementType: "ADJUST",
        quantity: 0,
        notes:
          notes?.trim() ||
          `Govt stamping · serial ${unit.serialNo} · ${stamp.toISOString().slice(0, 10)}`,
        referenceType: "STOCK_UNIT",
        referenceId: unit.id,
        performedBy: user,
      },
    });
  });

  const nextDue = addYears(stamp, 1);
  await syncStampingAcrossRegisters(t, {
    serialNo: unit.serialNo,
    contactId: unit.contactId,
    stampingDate: stamp,
    nextDueDate: nextDue,
  });

  return getUnit(t, unit.id);
}

/** Calendar day bounds in Asia/Kolkata (HMS business day). */
function dayBounds(fromYmd: string, toYmd: string) {
  const from = new Date(`${fromYmd}T00:00:00+05:30`);
  const toEnd = new Date(`${toYmd}T00:00:00+05:30`);
  toEnd.setTime(toEnd.getTime() + 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toEnd.getTime())) {
    throw new AppError("Invalid date range", 422);
  }
  if (from >= toEnd) {
    throw new AppError("From date must be on or before To date", 422);
  }
  const days = Math.round((toEnd.getTime() - from.getTime()) / 86_400_000);
  if (days > 366) {
    throw new AppError("Date range cannot exceed 366 days", 422);
  }
  return { from, toEnd };
}

/**
 * Units added (stock receive) in a date range — for Excel / PDF download.
 * Filters by unit createdAt (when the unit was entered into stock).
 */
export async function exportStockIn(
  t: string,
  q: { from: string; to: string; warehouseId?: string; productId?: string },
) {
  const { from, toEnd } = dayBounds(q.from, q.to);
  const warehouseId = q.warehouseId ? String(q.warehouseId) : "";
  const productId = q.productId ? String(q.productId) : "";

  const unitWhere: Prisma.StockUnitWhereInput = {
    tenantId: t,
    deletedAt: null,
    createdAt: { gte: from, lt: toEnd },
    ...(warehouseId ? { warehouseId } : {}),
    ...(productId ? { productId } : {}),
  };

  const receiptWhere: Prisma.StockReceiptWhereInput = {
    tenantId: t,
    deletedAt: null,
    receivedDate: { gte: from, lt: toEnd },
    ...(warehouseId ? { warehouseId } : {}),
    ...(productId ? { productId } : {}),
  };

  const [unitRows, receiptRows, unitCount] = await Promise.all([
    prisma.stockUnit.findMany({
      where: unitWhere,
      orderBy: [{ createdAt: "asc" }, { hmsUniqId: "asc" }],
      take: 5000,
    }),
    prisma.stockReceipt.findMany({
      where: receiptWhere,
      orderBy: { receivedDate: "asc" },
      take: 2000,
    }),
    prisma.stockUnit.count({ where: unitWhere }),
  ]);

  const units = await hydrateUnits(t, unitRows as unknown as Array<Record<string, unknown>>);

  const productIds = [...new Set(receiptRows.map((r) => r.productId))];
  const warehouseIds = [...new Set(receiptRows.map((r) => r.warehouseId))];
  const vendorIds = [...new Set(receiptRows.map((r) => r.vendorId).filter(Boolean).map(String))];
  const brandIds = [...new Set(receiptRows.map((r) => r.brandId).filter(Boolean).map(String))];

  const [products, warehouses, vendors, brands] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { tenantId: t, id: { in: productIds } },
          select: { id: true, name: true, sku: true },
        })
      : Promise.resolve([]),
    warehouseIds.length
      ? prisma.warehouse.findMany({
          where: { tenantId: t, id: { in: warehouseIds } },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { tenantId: t, id: { in: vendorIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    brandIds.length
      ? prisma.brand.findMany({
          where: { tenantId: t, id: { in: brandIds } },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
  ]);
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const wMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));
  const vMap = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const bMap = Object.fromEntries(brands.map((b) => [b.id, b]));

  const receipts = receiptRows.map((r) => ({
    id: r.id,
    receivedDate: r.receivedDate
      ? new Date(String(r.receivedDate)).toISOString().slice(0, 10)
      : null,
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate
      ? new Date(String(r.invoiceDate)).toISOString().slice(0, 10)
      : null,
    quantity: r.quantity,
    unitAmount: Number(r.unitAmount),
    lineTotal: Number(r.unitAmount) * r.quantity,
    spec: r.spec,
    notes: r.notes,
    product: pMap[r.productId] ?? null,
    warehouse: wMap[r.warehouseId] ?? null,
    vendor: r.vendorId ? vMap[r.vendorId] ?? null : null,
    brand: r.brandId ? bMap[r.brandId] ?? null : null,
  }));

  const unitExportRows = units.map((raw) => {
    const u = raw as Record<string, unknown>;
    const product = u.product as { id?: string; name?: string; sku?: string } | null;
    const warehouse = u.warehouse as { name?: string; code?: string } | null;
    const brand = u.brand as { name?: string } | null;
    const receipt = u.receipt as {
      invoiceNo?: string | null;
      receivedDate?: string | null;
      vendor?: { name?: string } | null;
      spec?: string | null;
    } | null;
    return {
      addedDate: u.createdAt
        ? new Date(String(u.createdAt)).toISOString().slice(0, 10)
        : "",
      hmsUniqId: (u.hmsUniqId as string | null) ?? "",
      serialNo: (u.serialNo as string | null) ?? "",
      productId: (u.productId as string | null) ?? product?.id ?? "",
      productName: product?.name ?? "",
      sku: product?.sku ?? "",
      brand: brand?.name ?? "",
      supplier: receipt?.vendor?.name ?? "",
      warehouse: warehouse?.name ?? "",
      status: (u.status as string | null) ?? "",
      unitCost: (u.unitCost as number | null) ?? 0,
      invoiceNo: receipt?.invoiceNo ?? "",
      receivedDate: receipt?.receivedDate ?? "",
      spec: receipt?.spec ?? "",
      stampingDate: (u.stampingDate as string | null) ?? "",
      notes: (u.notes as string | null) ?? "",
    };
  });

  const totalValue = unitExportRows.reduce((s, r) => s + Number(r.unitCost || 0), 0);

  return {
    from: q.from,
    to: q.to,
    generatedAt: new Date().toISOString(),
    truncated: unitCount > unitRows.length,
    summary: {
      unitsAdded: unitCount,
      unitsInExport: unitExportRows.length,
      receipts: receipts.length,
      totalValue,
    },
    units: unitExportRows,
    receipts,
  };
}

export async function history(t: string, q: Record<string, unknown>) {
  const take = Math.min(Number(q.limit) || 200, 500);
  const fromRaw = q.from ? String(q.from).slice(0, 10) : "";
  const toRaw = q.to ? String(q.to).slice(0, 10) : "";
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
  const to = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? new Date(`${toRaw}T23:59:59.999Z`) : null;
  const movementType = q.movementType ? String(q.movementType).toUpperCase() : "";
  const referenceType = q.referenceType ? String(q.referenceType) : "";
  /** add | reduce | all — maps to receive vs stock-reduce style movements */
  const action = q.action ? String(q.action).toLowerCase() : "";

  const where: Prisma.StockMovementWhereInput = {
    tenantId: t,
    ...(q.productId ? { productId: String(q.productId) } : {}),
    ...(q.warehouseId ? { warehouseId: String(q.warehouseId) } : {}),
    ...(movementType && ["IN", "OUT", "ADJUST", "RETURN"].includes(movementType)
      ? { movementType: movementType as "IN" | "OUT" | "ADJUST" | "RETURN" }
      : {}),
    ...(referenceType ? { referenceType } : {}),
    ...(from || to
      ? {
          movedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  if (action === "add") {
    where.movementType = "IN";
  } else if (action === "reduce") {
    where.OR = [{ referenceType: "STOCK_REDUCE" }, { referenceType: "DEMO_ISSUE" }];
  }

  const rows = await prisma.stockMovement.findMany({
    where,
    orderBy: { movedAt: "desc" },
    take,
  });
  if (!rows.length) return [];

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
  const unitIds = [
    ...new Set(
      rows
        .filter(
          (r) =>
            r.referenceId &&
            (r.referenceType === "STOCK_UNIT" ||
              r.referenceType === "STOCK_REDUCE" ||
              r.referenceType === "DEMO_ISSUE"),
        )
        .map((r) => String(r.referenceId)),
    ),
  ];
  const receiptIds = [
    ...new Set(
      rows
        .filter((r) => r.referenceType === "STOCK_RECEIPT" && r.referenceId)
        .map((r) => String(r.referenceId)),
    ),
  ];
  const userIds = [...new Set(rows.map((r) => r.performedBy).filter(Boolean))] as string[];

  const [products, warehouses, units, receipts, users] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: t, id: { in: productIds } },
      select: { id: true, sku: true, name: true },
    }),
    prisma.warehouse.findMany({
      where: { tenantId: t, id: { in: warehouseIds } },
      select: { id: true, name: true },
    }),
    unitIds.length
      ? prisma.stockUnit.findMany({
          where: { tenantId: t, id: { in: unitIds } },
          select: {
            id: true,
            serialNo: true,
            hmsUniqId: true,
            status: true,
            stampingDate: true,
            customFields: true,
          },
        })
      : Promise.resolve([]),
    receiptIds.length
      ? prisma.stockReceipt.findMany({
          where: { tenantId: t, id: { in: receiptIds } },
          select: {
            id: true,
            invoiceNo: true,
            invoiceDate: true,
            receivedDate: true,
            quantity: true,
          },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId: t, id: { in: userIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const wMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));
  const uMap = Object.fromEntries(units.map((u) => [u.id, u]));
  const receiptMap = Object.fromEntries(receipts.map((r) => [r.id, r]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return rows.map((r) => {
    const unit =
      (r.referenceType === "STOCK_UNIT" ||
        r.referenceType === "STOCK_REDUCE" ||
        r.referenceType === "DEMO_ISSUE") &&
      r.referenceId
        ? uMap[r.referenceId] ?? null
        : null;
    const unitCf =
      unit?.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
        ? (unit.customFields as Record<string, unknown>)
        : {};
    const isAdd = r.movementType === "IN" || r.referenceType === "STOCK_RECEIPT";
    const isReduce = r.referenceType === "STOCK_REDUCE" || r.referenceType === "DEMO_ISSUE";
    const reducePurpose =
      r.referenceType === "DEMO_ISSUE"
        ? "DEMO"
        : (unitCf.reducePurpose as string | undefined) ?? (isReduce ? "SALE" : null);
    const customerName =
      (unitCf.demoCustomerName as string | undefined) ||
      (unitCf.saleCustomerName as string | undefined) ||
      null;
    return {
      ...r,
      quantity: Number(r.quantity),
      action: isReduce ? "REDUCE" : isAdd ? "ADD" : r.movementType,
      product: pMap[r.productId] ?? null,
      warehouse: wMap[r.warehouseId] ?? null,
      stockUnit: unit
        ? {
            id: unit.id,
            serialNo: unit.serialNo,
            hmsUniqId: unit.hmsUniqId,
            status: unit.status,
            stampingDate: unit.stampingDate,
          }
        : null,
      receipt:
        r.referenceType === "STOCK_RECEIPT" && r.referenceId
          ? receiptMap[r.referenceId] ?? null
          : null,
      issuedToName: (unitCf.issuedToName as string | undefined) ?? null,
      reduceReason: (unitCf.reduceReason as string | undefined) ?? null,
      reducePurpose,
      customerName,
      performer: r.performedBy ? userMap[r.performedBy] ?? null : null,
    };
  });
}

/** Issue a serial unit for lead demo — leaves warehouse (OUT) and status DEMO */
export async function issueDemoUnit(t: string, user: string, leadId: string, stockUnitId: string) {
  const [lead, unit] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } }),
    prisma.stockUnit.findFirst({ where: { id: stockUnitId, tenantId: t, deletedAt: null } }),
  ]);
  if (!lead) throw notFound("Lead");
  if (!unit) throw notFound("Stock unit");
  if (unit.status !== "IN_STOCK") {
    throw new AppError(`Unit ${unit.serialNo} is not available (status: ${unit.status})`, 409);
  }

  const leadCf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const existingDemoId = leadCf.demoStockUnitId ? String(leadCf.demoStockUnitId) : "";
  if (existingDemoId && lead.status === "DEMO") {
    throw new AppError("This enquiry already has a demo unit out. Return it before issuing another.", 409);
  }

  const product = await prisma.product.findFirst({
    where: { id: unit.productId, tenantId: t, deletedAt: null },
    select: {
      id: true,
      sku: true,
      name: true,
      salePrice: true,
      purchasePrice: true,
      unit: true,
      productType: true,
      attributes: true,
    },
  });

  const contactId = leadCf.contact_id ? String(leadCf.contact_id) : null;
  const executiveUser = lead.assignedToId
    ? await prisma.user.findFirst({
        where: { id: lead.assignedToId, tenantId: t, deletedAt: null },
        select: { id: true, name: true },
      })
    : null;
  const demoWarehouse =
    (await getWarehouseByCode(t, "DEMO")) || (await getWarehouseByCode(t, "EXECUTIVE"));
  if (!demoWarehouse) throw new AppError("Demo warehouse not configured", 500);

  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};
  const issuedAt = new Date().toISOString();
  const dcDate = issuedAt.slice(0, 10);

  const tenant = await prisma.tenant.findFirst({
    where: { id: t, deletedAt: null },
    select: {
      name: true,
      phone: true,
      email: true,
      gstin: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });
  const sellerAddress = [
    tenant?.addressLine1,
    tenant?.addressLine2,
    [tenant?.city, tenant?.state].filter(Boolean).join(", "),
    tenant?.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const catalogFamily =
    product?.attributes && typeof product.attributes === "object"
      ? String(
          (product.attributes as Record<string, unknown>).catalogFamilyName ??
            (product.attributes as Record<string, unknown>).catalogFamily ??
            "",
        )
      : "";
  const catalogIndustry =
    product?.attributes && typeof product.attributes === "object"
      ? String(
          (product.attributes as Record<string, unknown>).catalogIndustryName ??
            (product.attributes as Record<string, unknown>).catalogIndustry ??
            "",
        )
      : "";

  await prisma.$transaction(async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "DEMO_DC" } },
    });
    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: "DEMO_DC",
          prefix: "DC-",
          nextValue: 1,
          padding: 5,
        },
      });
    }
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "DEMO_DC" } },
      data: { nextValue: { increment: 1 } },
    });
    const dcNumber = `${seq.prefix}${String(seq.nextValue).padStart(seq.padding, "0")}`;

    const deliveryChallan = {
      number: dcNumber,
      date: dcDate,
      issuedAt,
      purpose: "DEMO" as const,
      customerName: lead.name,
      company: lead.company ?? null,
      phone: lead.phone ?? null,
      city: lead.city ?? null,
      state: lead.state ?? null,
      addressLine: null as string | null,
      productName: product?.name ?? "Product",
      productSku: product?.sku ?? null,
      serialNo: unit.serialNo,
      qty: 1,
      stampingDate: unit.stampingDate ? unit.stampingDate.toISOString().slice(0, 10) : null,
      catalogFamily: catalogFamily || null,
      catalogIndustry: catalogIndustry || null,
      executiveName: executiveUser?.name ?? null,
      executiveId: executiveUser?.id ?? null,
      leadId,
      stockUnitId: unit.id,
      notes: "Issued for demonstration / trial — not a sale. Return or convert via Sale tracking.",
      sellerName: tenant?.name ?? "HMS Enterprises",
      sellerPhone: tenant?.phone ?? null,
      sellerEmail: tenant?.email ?? null,
      sellerGstin: tenant?.gstin ?? null,
      sellerAddress: sellerAddress || null,
    };

    const sourceWarehouseId = unit.warehouseId;
    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "DEMO",
        warehouseId: demoWarehouse.id,
        leadId,
        contactId: contactId ?? null,
        customFields: {
          ...unitCf,
          demoIssuedAt: issuedAt,
          demoLeadId: leadId,
          /** Restore stock count here when demo returns */
          demoFromWarehouseId: sourceWarehouseId,
          demoCustomerName: lead.name,
          demoCompany: lead.company ?? null,
          demoPhone: lead.phone ?? null,
          demoCity: lead.city ?? null,
          demoState: lead.state ?? null,
          demoExecutiveId: executiveUser?.id ?? null,
          demoExecutiveName: executiveUser?.name ?? null,
          demoEnquiryDate: leadCf.enquiry_date ?? dcDate,
          productName: product?.name ?? null,
          productSku: product?.sku ?? null,
          productSalePrice: product?.salePrice != null ? Number(product.salePrice) : null,
          productPurchasePrice: product?.purchasePrice != null ? Number(product.purchasePrice) : null,
          productType: product?.productType ?? null,
          productAttributes: product?.attributes ?? null,
          catalogFamily: catalogFamily || null,
          catalogIndustry: catalogIndustry || null,
          demoDcNo: dcNumber,
          demoDcDate: dcDate,
          demoDeliveryChallan: deliveryChallan,
        },
      },
    });

    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: sourceWarehouseId,
        },
      },
    });
    const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).sub(1);
    if (next.isNegative()) throw new AppError("Insufficient stock for demo issue", 409);
    if (current) {
      await tx.stockLevel.update({
        where: { id: current.id },
        data: { quantityOnHand: next },
      });
    }

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: sourceWarehouseId,
        movementType: "OUT",
        quantity: 1,
        notes: `Demo issue · DC ${dcNumber} · ${product?.name ?? "product"} · serial ${unit.serialNo} · ${lead.name}`,
        referenceType: "STOCK_UNIT",
        referenceId: unit.id,
        performedBy: user,
      },
    });

    await tx.lead.update({
      where: { id: leadId },
      data: {
        status: "DEMO",
        customFields: {
          ...leadCf,
          demoStockUnitId: unit.id,
          demoSerialNo: unit.serialNo,
          demoProductId: unit.productId,
          demoProductName: product?.name ?? null,
          demoProductSku: product?.sku ?? null,
          demoIssuedAt: issuedAt,
          demoWarehouseId: demoWarehouse.id,
          demoExecutiveId: executiveUser?.id ?? null,
          demoExecutiveName: executiveUser?.name ?? null,
          demoCatalogFamily: catalogFamily || null,
          demoCatalogIndustry: catalogIndustry || null,
          demoDailyUpdates: Array.isArray(leadCf.demoDailyUpdates) ? leadCf.demoDailyUpdates : [],
          demoDcNo: dcNumber,
          demoDcDate: dcDate,
          demoDeliveryChallan: deliveryChallan,
        },
      },
    });
  });

  void notifyDemoAdmins(t, "out", {
    unitId: unit.id,
    label: unit.hmsUniqId || unit.serialNo,
    product: product?.name,
    customer: lead.name,
  }).catch(() => undefined);

  return getUnit(t, unit.id);
}

/** Return demo unit to available stock — restores inventory count */
export async function returnDemoUnit(
  t: string,
  user: string,
  stockUnitId: string,
  opts?: { notes?: string; leadId?: string },
) {
  const unit = await prisma.stockUnit.findFirst({
    where: { id: stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status !== "DEMO") {
    throw new AppError(`Unit ${unit.serialNo} is not on demo (status: ${unit.status})`, 409);
  }

  const leadId = opts?.leadId ?? unit.leadId ?? null;
  const returnedAt = new Date().toISOString();
  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};
  // Return to the warehouse we issued from — fall back to MAIN only if unknown
  const fromWhId =
    (typeof unitCf.demoFromWarehouseId === "string" && unitCf.demoFromWarehouseId.trim()) ||
    null;
  let returnWarehouseId = fromWhId;
  if (returnWarehouseId) {
    const exists = await prisma.warehouse.findFirst({
      where: { id: returnWarehouseId, tenantId: t, deletedAt: null },
      select: { id: true },
    });
    if (!exists) returnWarehouseId = null;
  }
  if (!returnWarehouseId) {
    const mainWarehouse = await getWarehouseByCode(t, "MAIN");
    if (!mainWarehouse) throw new AppError("Main warehouse not configured", 500);
    returnWarehouseId = mainWarehouse.id;
  }

  await prisma.$transaction(async (tx) => {
    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "IN_STOCK",
        warehouseId: returnWarehouseId,
        leadId: null,
        contactId: null,
        customFields: {
          ...unitCf,
          demoReturnedAt: returnedAt,
          demoReturnNotes: opts?.notes?.trim() || null,
          lastDemoLeadId: leadId ?? unitCf.demoLeadId ?? null,
          demoLeadId: null,
          demoFromWarehouseId: null,
        },
      },
    });

    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: returnWarehouseId!,
        },
      },
    });
    const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).add(1);
    await tx.stockLevel.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: returnWarehouseId!,
        },
      },
      create: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: returnWarehouseId!,
        quantityOnHand: next,
      },
      update: { quantityOnHand: next },
    });

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: returnWarehouseId!,
        movementType: "RETURN",
        quantity: 1,
        notes:
          opts?.notes?.trim() ||
          `Demo returned · serial ${unit.serialNo} · back in stock`,
        referenceType: "STOCK_UNIT",
        referenceId: unit.id,
        performedBy: user,
      },
    });

    if (leadId) {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId: t, deletedAt: null },
      });
      if (lead) {
        const leadCf =
          lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
            ? (lead.customFields as Record<string, unknown>)
            : {};
        await tx.lead.update({
          where: { id: leadId },
          data: {
            status: lead.status === "DEMO" ? "NEW" : lead.status,
            customFields: {
              ...leadCf,
              demoStockUnitId: null,
              demoSerialNo: null,
              demoReturnedAt: returnedAt,
              demoReturnNotes: opts?.notes?.trim() || null,
            },
          },
        });
      }
    }
  });

  void notifyDemoAdmins(t, "back", {
    unitId: unit.id,
    label: unit.hmsUniqId || unit.serialNo,
    product: unitCf.productName ? String(unitCf.productName) : null,
    customer: unitCf.demoCustomerName ? String(unitCf.demoCustomerName) : null,
  }).catch(() => undefined);

  return getUnit(t, unit.id);
}

/** Resolve the live enquiry linked to a DEMO serial (handles stale / soft-deleted links). */
async function resolveLeadForDemoUnit(t: string, unit: {
  id: string;
  serialNo: string;
  leadId: string | null;
  customFields: unknown;
}) {
  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};
  const candidateIds = [unit.leadId, unitCf.demoLeadId ? String(unitCf.demoLeadId) : null].filter(
    (x): x is string => Boolean(x),
  );

  for (const id of candidateIds) {
    const live = await prisma.lead.findFirst({
      where: { id, tenantId: t, deletedAt: null },
    });
    if (live) return { lead: live, stale: false as const };
  }

  // Lead may still hold demoStockUnitId even if unit.leadId was cleared / wrong
  const demoLeads = await prisma.lead.findMany({
    where: { tenantId: t, deletedAt: null, status: "DEMO" },
    take: 300,
  });
  const byUnit = demoLeads.find((l) => {
    const cf =
      l.customFields && typeof l.customFields === "object" && !Array.isArray(l.customFields)
        ? (l.customFields as Record<string, unknown>)
        : {};
    return (
      String(cf.demoStockUnitId ?? "") === unit.id ||
      String(cf.demoSerialNo ?? "").toUpperCase() === unit.serialNo.toUpperCase()
    );
  });
  if (byUnit) return { lead: byUnit, stale: false as const };

  for (const id of candidateIds) {
    const soft = await prisma.lead.findFirst({
      where: { id, tenantId: t, deletedAt: { not: null } },
    });
    if (soft) return { lead: soft, stale: true as const };
  }

  return { lead: null, stale: false as const };
}

/**
 * Inventory “Close demo” with outcome — works even when the enquiry link is stale.
 * READY_TO_BUY needs a live enquiry; NOT_INTERESTED always returns the serial to stock.
 */
export async function closeDemoFromUnit(
  t: string,
  user: string,
  stockUnitId: string,
  body: {
    notes?: string;
    outcome: "NOT_INTERESTED" | "READY_TO_BUY";
    stageId?: string;
    sendWhatsApp?: boolean;
  },
) {
  const unit = await prisma.stockUnit.findFirst({
    where: { id: stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status !== "DEMO") {
    throw new AppError(`Unit ${unit.serialNo} is not on demo (status: ${unit.status})`, 409);
  }

  const resolved = await resolveLeadForDemoUnit(t, unit);
  const notes = body.notes?.trim() || undefined;

  if (body.outcome === "READY_TO_BUY") {
    if (!resolved.lead || resolved.stale) {
      throw new AppError(
        "Sale enquiry for this demo is missing or was deleted. Re-open the enquiry from Sale tracking, or choose Not interested to return the serial to stock.",
        404,
      );
    }
    // Heal link so leads.returnDemo finds demoStockUnitId
    const leadCf =
      resolved.lead.customFields &&
      typeof resolved.lead.customFields === "object" &&
      !Array.isArray(resolved.lead.customFields)
        ? (resolved.lead.customFields as Record<string, unknown>)
        : {};
    if (String(leadCf.demoStockUnitId ?? "") !== unit.id || resolved.lead.status !== "DEMO") {
      await prisma.lead.update({
        where: { id: resolved.lead.id },
        data: {
          status: "DEMO",
          deletedAt: null,
          customFields: {
            ...leadCf,
            demoStockUnitId: unit.id,
            demoSerialNo: unit.serialNo,
            demoProductId: unit.productId,
          },
        },
      });
    }
    if (unit.leadId !== resolved.lead.id) {
      await prisma.stockUnit.update({
        where: { id: unit.id },
        data: {
          leadId: resolved.lead.id,
          customFields: {
            ...((unit.customFields &&
            typeof unit.customFields === "object" &&
            !Array.isArray(unit.customFields)
              ? unit.customFields
              : {}) as Record<string, unknown>),
            demoLeadId: resolved.lead.id,
          },
        },
      });
    }
    const { returnDemo } = await import("../leads/leads.service.js");
    return returnDemo(t, user, resolved.lead.id, {
      notes,
      outcome: "READY_TO_BUY",
      stageId: body.stageId,
      sendWhatsApp: body.sendWhatsApp,
    });
  }

  // NOT_INTERESTED — always free the serial; close enquiry when live
  if (resolved.lead && !resolved.stale) {
    const leadCf =
      resolved.lead.customFields &&
      typeof resolved.lead.customFields === "object" &&
      !Array.isArray(resolved.lead.customFields)
        ? (resolved.lead.customFields as Record<string, unknown>)
        : {};
    if (String(leadCf.demoStockUnitId ?? "") !== unit.id) {
      await prisma.lead.update({
        where: { id: resolved.lead.id },
        data: {
          customFields: {
            ...leadCf,
            demoStockUnitId: unit.id,
            demoSerialNo: unit.serialNo,
            demoProductId: unit.productId,
          },
        },
      });
    }
    try {
      const { returnDemo } = await import("../leads/leads.service.js");
      return await returnDemo(t, user, resolved.lead.id, {
        notes,
        outcome: "NOT_INTERESTED",
        sendWhatsApp: body.sendWhatsApp,
      });
    } catch (err) {
      // If enquiry path still fails, never leave the serial stuck on DEMO
      console.error("closeDemoFromUnit lead path failed, returning serial only", err);
    }
  }

  const stockUnit = await returnDemoUnit(t, user, unit.id, {
    notes: notes || "Demo returned — enquiry missing or already closed",
    leadId: resolved.lead?.id ?? unit.leadId ?? undefined,
  });

  if (resolved.lead && !resolved.stale) {
    try {
      const after = await prisma.lead.findFirst({
        where: { id: resolved.lead.id, tenantId: t, deletedAt: null },
      });
      if (after && after.status !== "LOST" && after.status !== "CONVERTED") {
        const afterCf =
          after.customFields && typeof after.customFields === "object" && !Array.isArray(after.customFields)
            ? (after.customFields as Record<string, unknown>)
            : {};
        await prisma.lead.update({
          where: { id: after.id },
          data: {
            status: "LOST",
            customFields: {
              ...afterCf,
              demoReturnReason: "NOT_INTERESTED",
              demoStockUnitId: null,
              demoSerialNo: null,
              closedAt: new Date().toISOString(),
            },
          },
        });
      }
    } catch {
      /* non-fatal */
    }
  }

  return {
    outcome: "NOT_INTERESTED" as const,
    stockUnit,
    leadId: resolved.lead?.id ?? null,
    enquiryMissing: !resolved.lead || resolved.stale,
    next: null,
  };
}

/** Mark demo unit sold when lead converts — creates customer machine when possible */
export async function markDemoSold(t: string, user: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : "";
  if (!unitId) return null;

  const unit = await prisma.stockUnit.findFirst({
    where: { id: unitId, tenantId: t, deletedAt: null },
  });
  if (!unit || unit.status === "SOLD") return unit;

  const product = await prisma.product.findFirst({
    where: { id: unit.productId, tenantId: t, deletedAt: null },
    select: { id: true, name: true, sku: true, productType: true, attributes: true },
  });

  const contactId =
    lead.convertedContactId ??
    (cf.contact_id ? String(cf.contact_id) : null) ??
    unit.contactId ??
    null;

  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};
  const attrs =
    unitCf.productAttributes && typeof unitCf.productAttributes === "object"
      ? (unitCf.productAttributes as Record<string, unknown>)
      : product?.attributes && typeof product.attributes === "object"
        ? (product.attributes as Record<string, unknown>)
        : {};

  const stampingDate = unit.stampingDate;
  const nextDueDate = stampingDate ? addYears(stampingDate, 1) : null;

  await prisma.$transaction(async (tx) => {
    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "SOLD",
        leadId: null,
        contactId: contactId ?? unit.contactId,
        customFields: {
          ...unitCf,
          soldAt: new Date().toISOString(),
          soldLeadId: leadId,
        },
      },
    });

    if (contactId) {
      const existingAsset = await tx.customerAsset.findFirst({
        where: {
          tenantId: t,
          contactId,
          serialNo: unit.serialNo,
          deletedAt: null,
        },
      });
      if (!existingAsset) {
        const capacity = attrs.capacity ? String(attrs.capacity) : null;
        const accuracy = attrs.accuracy ? String(attrs.accuracy) : null;
        const platformSize = attrs.platform ? String(attrs.platform) : null;
        await tx.customerAsset.create({
          data: {
            id: newId(),
            tenantId: t,
            contactId,
            machineType: mapMachineType(attrs.catalogKind ?? product?.productType),
            name: product?.name ?? String(unitCf.productName ?? `Machine ${unit.serialNo}`),
            model: attrs.model
              ? String(attrs.model)
              : product?.sku
                ? product.sku
                : unitCf.productSku
                  ? String(unitCf.productSku)
                  : null,
            serialNo: unit.serialNo,
            capacity,
            accuracy,
            platformSize,
            origin: "SOLD_BY_US",
            servicePlan: "NON_AMC",
            stampingDate,
            nextDueDate,
            notes: "Added from demo conversion",
            customFields: {
              stockUnitId: unit.id,
              productId: unit.productId,
              productSku: product?.sku ?? unitCf.productSku ?? null,
              convertedFromLeadId: leadId,
              catalogFamily: unitCf.catalogFamily ?? attrs.catalogFamilyName ?? null,
              catalogIndustry: unitCf.catalogIndustry ?? attrs.catalogIndustryName ?? null,
              demoDcNo: unitCf.demoDcNo ?? null,
            },
          },
        });
      } else if (stampingDate) {
        await tx.customerAsset.update({
          where: { id: existingAsset.id },
          data: {
            stampingDate,
            nextDueDate: nextDueDate ?? existingAsset.nextDueDate,
          },
        });
      }
    }

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: unit.warehouseId,
        movementType: "OUT",
        quantity: 0,
        notes: `Demo converted to sale · serial ${unit.serialNo}`,
        referenceType: "LEAD_SALE",
        referenceId: leadId,
        performedBy: user,
      },
    });
  });

  if (contactId && stampingDate) {
    await syncStampingAcrossRegisters(t, {
      serialNo: unit.serialNo,
      contactId,
      stampingDate,
      nextDueDate,
    });
  }

  return getUnit(t, unit.id);
}

/** Easy stock reduce — remove one serial from on-hand (self-control). */
export async function reduceStockUnit(
  t: string,
  userId: string,
  id: string,
  opts?: string | null | {
    notes?: string | null;
    reason?: string | null;
    /** SALE = sold (permanent). DEMO = taken to customer for demo (returnable). */
    purpose?: "SALE" | "DEMO" | null;
    issuedToUserId?: string | null;
    contactId?: string | null;
  },
) {
  // Back-compat: older callers passed notes as a string
  const body =
    typeof opts === "string" || opts == null
      ? {
          notes: opts ?? null,
          reason: null as string | null,
          purpose: null as "SALE" | "DEMO" | null,
          issuedToUserId: null as string | null,
          contactId: null as string | null,
        }
      : opts;

  const unitId = String(id ?? "").trim();
  if (!unitId) throw notFound("Stock unit");

  const unit = await prisma.stockUnit.findFirst({
    where: { id: unitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status === "SOLD") throw new AppError("Unit already removed from stock", 409);
  if (unit.status !== "IN_STOCK" && unit.status !== "DEMO") {
    throw new AppError(`Cannot reduce unit in status ${unit.status}`, 409);
  }

  const purpose: "SALE" | "DEMO" =
    body.purpose === "DEMO" ? "DEMO" : body.purpose === "SALE" ? "SALE" : "SALE";
  // Demo issue only from on-hand warehouse stock
  if (purpose === "DEMO" && unit.status !== "IN_STOCK") {
    throw new AppError("Only IN_STOCK units can be issued for demo", 409);
  }

  const reason =
    (body.reason ?? body.notes)?.trim() ||
    (purpose === "DEMO" ? "Demo — taken to customer site" : "Sale");
  let engineer: { id: string; name: string } | null = null;
  if (body.issuedToUserId?.trim()) {
    engineer = await prisma.user.findFirst({
      where: { id: body.issuedToUserId.trim(), tenantId: t, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!engineer) throw notFound("Engineer / user");
  }

  let mappedContact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    customerCode: string | null;
    accountId: string | null;
  } | null = null;
  if (body.contactId?.trim()) {
    mappedContact = await prisma.contact.findFirst({
      where: { id: body.contactId.trim(), tenantId: t, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        customerCode: true,
        accountId: true,
      },
    });
    if (!mappedContact) throw notFound("Customer");
  }
  if (purpose === "DEMO") {
    if (!mappedContact) {
      throw new AppError("Select the customer this demo is going to", 422);
    }
    let company: string | null = null;
    if (mappedContact.accountId) {
      const acc = await prisma.account.findFirst({
        where: { id: mappedContact.accountId, tenantId: t, deletedAt: null },
        select: { name: true },
      });
      company = acc?.name ?? null;
    }
    // Proper demo path: enquiry + DC + warehouse OUT (no orphan DEMO units)
    const placed = (await placeUnitOnDemo(t, userId, unitId, {
      customerName: mappedContact.name,
      customerPhone: mappedContact.phone,
      customerEmail: mappedContact.email,
      customerCompany: company,
      city: mappedContact.city,
      state: mappedContact.state,
      assigneeUserId: engineer?.id ?? userId,
      notes: reason,
    })) as Record<string, unknown>;
    return {
      id: unit.id,
      productId: unit.productId,
      warehouseId: (placed.warehouseId as string) ?? unit.warehouseId,
      serialNo: unit.serialNo,
      hmsUniqId: unit.hmsUniqId,
      status: "DEMO" as const,
      purpose: "DEMO" as const,
      notes: reason,
      customFields: (placed.customFields as Record<string, unknown>) ?? {},
      reducedAt: new Date().toISOString(),
      leadId: (placed.leadId as string) ?? null,
    };
  }

  // SALE path only (DEMO returns early via placeUnitOnDemo)
  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};

  const label = unit.hmsUniqId || unit.serialNo || unit.id;
  const movementNotes = [`Stock reduce · ${label}`, reason, engineer ? `Issued to: ${engineer.name}` : null]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 255);

  const reducedAt = new Date().toISOString();
  const nextCf = {
    ...unitCf,
    reducedAt,
    reducedById: userId,
    reduceReason: reason,
    reducePurpose: "SALE" as const,
    issuedToUserId: engineer?.id ?? null,
    issuedToName: engineer?.name ?? null,
    saleContactId: mappedContact?.id ?? null,
    saleCustomerName: mappedContact?.name ?? null,
  };

  // Remote RDS: default 5s interactive tx often times out mid-reduce
  await prisma.$transaction(
    async (tx) => {
      if (unit.status === "IN_STOCK") {
        const level = await tx.stockLevel.findUnique({
          where: {
            tenantId_productId_warehouseId: {
              tenantId: t,
              productId: unit.productId,
              warehouseId: unit.warehouseId,
            },
          },
        });
        if (level) {
          // Unit row is source of truth — clamp level if out of sync instead of failing
          const next = level.quantityOnHand.sub(1);
          await tx.stockLevel.update({
            where: { id: level.id },
            data: { quantityOnHand: next.isNegative() ? 0 : next },
          });
        }
      }

      await tx.stockUnit.update({
        where: { id: unit.id },
        data: {
          status: "SOLD",
          leadId: null,
          ...(mappedContact ? { contactId: mappedContact.id } : {}),
          notes: reason || unit.notes,
          customFields: nextCf as Prisma.InputJsonValue,
        },
      });

      await tx.stockMovement.create({
        data: {
          id: newId(),
          tenantId: t,
          productId: unit.productId,
          warehouseId: unit.warehouseId,
          movementType: "OUT",
          quantity: 1,
          notes: movementNotes,
          referenceType: "STOCK_REDUCE",
          referenceId: unit.id,
          performedBy: userId,
        },
      });
    },
    { timeout: 25_000, maxWait: 8_000 },
  );

  // Slim response — skip hydrateUnits (extra round-trips) on slow RDS
  return {
    id: unit.id,
    productId: unit.productId,
    warehouseId: unit.warehouseId,
    serialNo: unit.serialNo,
    hmsUniqId: unit.hmsUniqId,
    status: "SOLD" as const,
    purpose: "SALE" as const,
    notes: reason || unit.notes,
    customFields: nextCf,
    reducedAt,
  };
}

export type DeliveryChallanListItem = {
  purpose: "SALE" | "DEMO";
  number: string;
  date: string;
  customerName: string;
  company?: string | null;
  phone?: string | null;
  productName?: string | null;
  reqNumber?: string | null;
  leadId?: string | null;
  requisitionId?: string | null;
  stockUnitId?: string | null;
  challan: Record<string, unknown>;
};

/** All sale + demo delivery challans for warehouse archive / reprint. */
export async function listDeliveryChallans(t: string): Promise<DeliveryChallanListItem[]> {
  const [reqs, demoUnits] = await Promise.all([
    prisma.salesRequisition
      .findMany({
        where: { tenantId: t, deletedAt: null },
        take: 300,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          reqNumber: true,
          leadId: true,
          customFields: true,
          updatedAt: true,
        },
      })
      .catch(() => [] as Array<{
        id: string;
        reqNumber: string;
        leadId: string;
        customFields: unknown;
        updatedAt: Date;
      }>),
    prisma.stockUnit.findMany({
      where: { tenantId: t, deletedAt: null, status: "DEMO" },
      take: 300,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        leadId: true,
        customFields: true,
        updatedAt: true,
      },
    }),
  ]);

  const items: DeliveryChallanListItem[] = [];

  for (const row of reqs) {
    const cf =
      row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
        ? (row.customFields as Record<string, unknown>)
        : {};
    const challan =
      cf.saleDeliveryChallan && typeof cf.saleDeliveryChallan === "object"
        ? (cf.saleDeliveryChallan as Record<string, unknown>)
        : null;
    if (!challan && !cf.saleDcNo) continue;
    const number = String(challan?.number ?? cf.saleDcNo ?? "");
    if (!number) continue;
    items.push({
      purpose: "SALE",
      number,
      date: String(challan?.date ?? cf.saleDcDate ?? ""),
      customerName: String(challan?.customerName ?? "Customer"),
      company: challan?.company != null ? String(challan.company) : null,
      phone: challan?.phone != null ? String(challan.phone) : null,
      productName: challan?.productName != null ? String(challan.productName) : null,
      reqNumber: row.reqNumber,
      leadId: row.leadId,
      requisitionId: row.id,
      stockUnitId: challan?.stockUnitId != null ? String(challan.stockUnitId) : null,
      challan: challan ?? {
        number,
        date: String(cf.saleDcDate ?? ""),
        purpose: "SALE",
        customerName: "Customer",
        productName: "",
        serialNo: "—",
        qty: 1,
        issuedAt: String(cf.saleDcAt ?? ""),
      },
    });
  }

  for (const unit of demoUnits) {
    const cf =
      unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
        ? (unit.customFields as Record<string, unknown>)
        : {};
    const challan =
      cf.demoDeliveryChallan && typeof cf.demoDeliveryChallan === "object"
        ? (cf.demoDeliveryChallan as Record<string, unknown>)
        : null;
    if (!challan && !cf.demoDcNo) continue;
    const number = String(challan?.number ?? cf.demoDcNo ?? "");
    if (!number) continue;
    items.push({
      purpose: "DEMO",
      number,
      date: String(challan?.date ?? cf.demoDcDate ?? ""),
      customerName: String(challan?.customerName ?? cf.demoCustomerName ?? "Customer"),
      company:
        challan?.company != null
          ? String(challan.company)
          : cf.demoCompany != null
            ? String(cf.demoCompany)
            : null,
      phone:
        challan?.phone != null
          ? String(challan.phone)
          : cf.demoPhone != null
            ? String(cf.demoPhone)
            : null,
      productName:
        challan?.productName != null
          ? String(challan.productName)
          : cf.productName != null
            ? String(cf.productName)
            : null,
      reqNumber: null,
      leadId: unit.leadId,
      requisitionId: null,
      stockUnitId: unit.id,
      challan: challan ?? {
        number,
        date: String(cf.demoDcDate ?? ""),
        purpose: "DEMO",
        customerName: String(cf.demoCustomerName ?? "Customer"),
        productName: String(cf.productName ?? ""),
        serialNo: "—",
        qty: 1,
        issuedAt: String(cf.demoIssuedAt ?? ""),
      },
    });
  }

  items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.number.localeCompare(a.number));
  return items;
}
