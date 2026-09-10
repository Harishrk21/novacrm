import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";
import { getWarehouseByCode } from "./warehouses.service.js";

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
    return {
      ...row,
      quantityOnHand: onHand,
      quantityReserved: reserved,
      quantityAvailable: available,
      serialInStock,
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
  const [products, warehouses, leads, contacts] = await Promise.all([
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
  ]);
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const wMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));
  const lMap = Object.fromEntries(leads.map((l) => [l.id, l]));
  const cMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  return units.map((u) => ({
    ...u,
    stampingDate: u.stampingDate
      ? new Date(String(u.stampingDate)).toISOString().slice(0, 10)
      : null,
    product: pMap[String(u.productId)] ?? null,
    warehouse: wMap[String(u.warehouseId)] ?? null,
    lead: u.leadId ? lMap[String(u.leadId)] ?? null : null,
    contact: u.contactId ? cMap[String(u.contactId)] ?? null : null,
  }));
}

export async function listUnits(t: string, q: Record<string, unknown>) {
  const where: Prisma.StockUnitWhereInput = {
    tenantId: t,
    deletedAt: null,
    ...(q.productId ? { productId: String(q.productId) } : {}),
    ...(q.warehouseId ? { warehouseId: String(q.warehouseId) } : {}),
    ...(q.status ? { status: String(q.status) as Prisma.EnumStockUnitStatusFilter["equals"] } : {}),
    ...(q.search
      ? { serialNo: { contains: String(q.search) } }
      : {}),
  };
  const rows = await prisma.stockUnit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(q.limit) || 200, 500),
  });
  return hydrateUnits(t, rows as unknown as Array<Record<string, unknown>>);
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

  const unit = await prisma.$transaction(async (tx) => {
    const created = await tx.stockUnit.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: d.productId,
        warehouseId: d.warehouseId,
        serialNo: serial,
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
        notes: `Stock in · serial ${serial}${d.stampingDate ? ` · stamped ${d.stampingDate}` : ""}`,
        referenceType: "STOCK_UNIT",
        referenceId: created.id,
        performedBy: user,
      },
    });

    return created;
  });

  return getUnit(t, unit.id);
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
  const stampData: Record<string, unknown> = {};
  if (opts.stampingDate) stampData.stampingDate = opts.stampingDate;
  if (opts.nextDueDate) stampData.nextDueDate = opts.nextDueDate;
  if (!Object.keys(stampData).length) return;

  await prisma.stockUnit.updateMany({
    where: { tenantId: t, serialNo: serial, deletedAt: null },
    data: stampData,
  });

  if (opts.contactId) {
    await prisma.customerAsset.updateMany({
      where: { tenantId: t, contactId: opts.contactId, serialNo: serial, deletedAt: null },
      data: stampData,
    });
  }
}

export async function updateStockUnit(
  t: string,
  id: string,
  d: {
    warehouseId?: string;
    serialNo?: string;
    stampingDate?: string | null;
    notes?: string | null;
    status?: "IN_STOCK" | "DEMO" | "SOLD" | "RETURNED";
  },
) {
  const existing = await prisma.stockUnit.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Stock unit");

  if (d.serialNo) {
    const serial = d.serialNo.trim().toUpperCase();
    const dup = await prisma.stockUnit.findFirst({
      where: {
        tenantId: t,
        serialNo: serial,
        deletedAt: null,
        NOT: { id },
      },
    });
    if (dup) throw new AppError(`Serial ${serial} already exists`, 409);
  }

  if (d.warehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: d.warehouseId, tenantId: t, deletedAt: null },
    });
    if (!wh) throw notFound("Warehouse");
  }

  if (d.status && d.status !== existing.status) {
    throw new AppError(
      "Use demo issue/return or lead convert to change unit status — do not patch status directly",
      400,
    );
  }

  const newWarehouseId = d.warehouseId && d.warehouseId !== existing.warehouseId ? d.warehouseId : null;

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
        update: {
          quantityOnHand: { increment: 1 },
        },
      });
      await tx.stockUnit.updateMany({
        where: { id, tenantId: t, deletedAt: null },
        data: {
          warehouseId: newWarehouseId,
          ...(d.serialNo ? { serialNo: d.serialNo.trim().toUpperCase() } : {}),
          ...("stampingDate" in d ? { stampingDate: parseDate(d.stampingDate) } : {}),
          ...("notes" in d ? { notes: d.notes?.trim() || null } : {}),
        },
      });
    });
    return getUnit(t, id);
  }

  await prisma.stockUnit.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      ...(newWarehouseId ? { warehouseId: newWarehouseId } : {}),
      ...(d.serialNo ? { serialNo: d.serialNo.trim().toUpperCase() } : {}),
      ...("stampingDate" in d ? { stampingDate: parseDate(d.stampingDate) } : {}),
      ...("notes" in d ? { notes: d.notes?.trim() || null } : {}),
    },
  });

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

export async function history(t: string, q: Record<string, unknown>) {
  const take = Math.min(Number(q.limit) || 100, 300);
  const where: Prisma.StockMovementWhereInput = {
    tenantId: t,
    ...(q.productId ? { productId: String(q.productId) } : {}),
    ...(q.warehouseId ? { warehouseId: String(q.warehouseId) } : {}),
  };
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
        .filter((r) => r.referenceType === "STOCK_UNIT" && r.referenceId)
        .map((r) => String(r.referenceId)),
    ),
  ];
  const userIds = [...new Set(rows.map((r) => r.performedBy).filter(Boolean))] as string[];

  const [products, warehouses, units, users] = await Promise.all([
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
          select: { id: true, serialNo: true, status: true, stampingDate: true },
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
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    product: pMap[r.productId] ?? null,
    warehouse: wMap[r.warehouseId] ?? null,
    stockUnit:
      r.referenceType === "STOCK_UNIT" && r.referenceId ? uMap[r.referenceId] ?? null : null,
    performer: r.performedBy ? userMap[r.performedBy] ?? null : null,
  }));
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
  const executiveWarehouse = await getWarehouseByCode(t, "EXECUTIVE");
  if (!executiveWarehouse) throw new AppError("Executive warehouse not configured", 500);

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

    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "DEMO",
        warehouseId: executiveWarehouse.id,
        leadId,
        contactId: contactId ?? null,
        customFields: {
          ...unitCf,
          demoIssuedAt: issuedAt,
          demoLeadId: leadId,
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
          warehouseId: unit.warehouseId,
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
        warehouseId: unit.warehouseId,
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
          demoWarehouseId: executiveWarehouse.id,
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
  const mainWarehouse = await getWarehouseByCode(t, "MAIN");
  if (!mainWarehouse) throw new AppError("Main warehouse not configured", 500);
  const unitCf =
    unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
      ? (unit.customFields as Record<string, unknown>)
      : {};

  await prisma.$transaction(async (tx) => {
    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "IN_STOCK",
        warehouseId: mainWarehouse.id,
        leadId: null,
        contactId: null,
        customFields: {
          ...unitCf,
          demoReturnedAt: returnedAt,
          demoReturnNotes: opts?.notes?.trim() || null,
          lastDemoLeadId: leadId ?? unitCf.demoLeadId ?? null,
          demoLeadId: null,
        },
      },
    });

    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: mainWarehouse.id,
        },
      },
    });
    const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).add(1);
    await tx.stockLevel.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: mainWarehouse.id,
        },
      },
      create: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: mainWarehouse.id,
        quantityOnHand: next,
      },
      update: { quantityOnHand: next },
    });

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: unit.productId,
        warehouseId: mainWarehouse.id,
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
