import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";
import { getWarehouseByCode } from "../inventory/warehouses.service.js";

function parseDateTime(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function nextRentalNo(tx: Prisma.TransactionClient, tenantId: string) {
  let seq = await tx.numberSequence.findUnique({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey: "RENTAL" } },
  });
  if (!seq) {
    seq = await tx.numberSequence.create({
      data: {
        tenantId,
        sequenceKey: "RENTAL",
        prefix: "RNT-",
        nextValue: 1,
        padding: 5,
      },
    });
  }
  await tx.numberSequence.update({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey: "RENTAL" } },
    data: { nextValue: { increment: 1 } },
  });
  return `${seq.prefix}${String(seq.nextValue).padStart(seq.padding, "0")}`;
}

async function hydrate(
  t: string,
  rows: Awaited<ReturnType<typeof prisma.rentalAgreement.findMany>>,
) {
  if (!rows.length) return [];
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const unitIds = [...new Set(rows.map((r) => r.stockUnitId))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter(Boolean))] as string[];
  const userIds = [
    ...new Set(
      rows.flatMap((r) => [r.issuedById, r.returnedById]).filter(Boolean) as string[],
    ),
  ];
  const whIds = [...new Set(rows.map((r) => r.fromWarehouseId).filter(Boolean))] as string[];

  const [products, units, contacts, users, warehouses] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId: t, id: { in: productIds }, deletedAt: null },
      select: { id: true, name: true, sku: true, imageUrl: true },
    }),
    prisma.stockUnit.findMany({
      where: { tenantId: t, id: { in: unitIds }, deletedAt: null },
      select: { id: true, serialNo: true, status: true, stampingDate: true },
    }),
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: t, id: { in: contactIds }, deletedAt: null },
          select: { id: true, name: true, phone: true, email: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId: t, id: { in: userIds }, deletedAt: null },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    whIds.length
      ? prisma.warehouse.findMany({
          where: { tenantId: t, id: { in: whIds }, deletedAt: null },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
  ]);

  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const uMap = Object.fromEntries(units.map((u) => [u.id, u]));
  const cMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const wMap = Object.fromEntries(warehouses.map((w) => [w.id, w]));

  return rows.map((r) => {
    const overdue =
      r.status === "ACTIVE" &&
      r.expectedReturnAt != null &&
      r.expectedReturnAt.getTime() < Date.now();
    return {
      ...r,
      status: overdue ? ("OVERDUE" as const) : r.status,
      dailyRate: r.dailyRate != null ? Number(r.dailyRate) : null,
      totalAmount: r.totalAmount != null ? Number(r.totalAmount) : null,
      depositAmount: r.depositAmount != null ? Number(r.depositAmount) : null,
      product: pMap[r.productId] ?? null,
      stockUnit: uMap[r.stockUnitId] ?? null,
      contact: r.contactId ? cMap[r.contactId] ?? null : null,
      issuedBy: r.issuedById ? userMap[r.issuedById] ?? null : null,
      returnedBy: r.returnedById ? userMap[r.returnedById] ?? null : null,
      fromWarehouse: r.fromWarehouseId ? wMap[r.fromWarehouseId] ?? null : null,
    };
  });
}

export async function listRentals(t: string, q: Record<string, unknown>) {
  const status = q.status ? String(q.status) : "";
  const where: Prisma.RentalAgreementWhereInput = {
    tenantId: t,
    ...(status && status !== "OVERDUE" ? { status: status as never } : {}),
    ...(status === "OVERDUE"
      ? { status: "ACTIVE", expectedReturnAt: { lt: new Date() } }
      : {}),
    ...(q.contactId ? { contactId: String(q.contactId) } : {}),
    ...(q.productId ? { productId: String(q.productId) } : {}),
  };
  const rows = await prisma.rentalAgreement.findMany({
    where,
    orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(200, Number(q.limit ?? 100) || 100),
  });
  return hydrate(t, rows);
}

export async function getRental(t: string, id: string) {
  const row = await prisma.rentalAgreement.findFirst({ where: { id, tenantId: t } });
  if (!row) throw notFound("Rental");
  const [item] = await hydrate(t, [row]);
  return item;
}

export type IssueRentalInput = {
  stockUnitId: string;
  contactId?: string | null;
  leadId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCompany?: string | null;
  customerAddress?: string | null;
  city?: string | null;
  state?: string | null;
  startAt: string;
  expectedReturnAt?: string | null;
  dailyRate?: number | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
  notes?: string | null;
};

/** Issue machine on rental — reduces warehouse stock and marks unit RENTED. */
export async function issueRental(t: string, userId: string, d: IssueRentalInput) {
  const unit = await prisma.stockUnit.findFirst({
    where: { id: d.stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status !== "IN_STOCK") {
    throw new AppError(`Serial ${unit.serialNo} is not available (status: ${unit.status})`, 409);
  }

  const startAt = parseDateTime(d.startAt);
  if (!startAt) throw new AppError("Rental start date/time is required", 400);
  const expectedReturnAt = parseDateTime(d.expectedReturnAt ?? null);
  const name = d.customerName.trim();
  if (!name) throw new AppError("Customer name is required", 400);

  if (d.contactId) {
    const c = await prisma.contact.findFirst({
      where: { id: d.contactId, tenantId: t, deletedAt: null },
    });
    if (!c) throw notFound("Contact");
  }
  if (d.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: d.leadId, tenantId: t, deletedAt: null },
    });
    if (!lead) throw notFound("Lead");
  }

  const product = await prisma.product.findFirst({
    where: { id: unit.productId, tenantId: t, deletedAt: null },
    select: { id: true, name: true, sku: true },
  });

  const fromWarehouseId = unit.warehouseId;
  const rentalId = newId();

  await prisma.$transaction(async (tx) => {
    const rentalNo = await nextRentalNo(tx, t);

    await tx.rentalAgreement.create({
      data: {
        id: rentalId,
        tenantId: t,
        rentalNo,
        status: "ACTIVE",
        productId: unit.productId,
        stockUnitId: unit.id,
        contactId: d.contactId || null,
        leadId: d.leadId || null,
        customerName: name,
        customerPhone: d.customerPhone?.trim() || null,
        customerEmail: d.customerEmail?.trim() || null,
        customerCompany: d.customerCompany?.trim() || null,
        customerAddress: d.customerAddress?.trim() || null,
        city: d.city?.trim() || null,
        state: d.state?.trim() || null,
        startAt,
        expectedReturnAt,
        dailyRate: d.dailyRate != null ? d.dailyRate : null,
        totalAmount: d.totalAmount != null ? d.totalAmount : null,
        depositAmount: d.depositAmount != null ? d.depositAmount : null,
        notes: d.notes?.trim() || null,
        issuedById: userId,
        fromWarehouseId,
      },
    });

    const unitCf =
      unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
        ? (unit.customFields as Record<string, unknown>)
        : {};

    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "RENTED",
        contactId: d.contactId || null,
        leadId: d.leadId || null,
        customFields: {
          ...unitCf,
          rentalId,
          rentalNo,
          rentedAt: startAt.toISOString(),
          expectedReturnAt: expectedReturnAt?.toISOString() ?? null,
          rentalCustomerName: name,
          rentalCustomerPhone: d.customerPhone?.trim() || null,
          rentalCustomerCompany: d.customerCompany?.trim() || null,
        },
      },
    });

    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: fromWarehouseId,
        },
      },
    });
    const next = (current?.quantityOnHand ?? new Prisma.Decimal(0)).sub(1);
    if (next.isNegative()) throw new AppError("Insufficient stock for rental issue", 409);
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
        warehouseId: fromWarehouseId,
        movementType: "OUT",
        quantity: 1,
        referenceType: "RENTAL",
        referenceId: rentalId,
        notes: `Rental ${rentalNo} · ${product?.name ?? "product"} · S/No ${unit.serialNo} → ${name}`,
        performedBy: userId,
        movedAt: startAt,
      },
    });

    if (d.leadId) {
      const lead = await tx.lead.findFirst({
        where: { id: d.leadId, tenantId: t, deletedAt: null },
      });
      if (lead) {
        const lcf =
          lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
            ? (lead.customFields as Record<string, unknown>)
            : {};
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            status: "QUALIFIED",
            convertedContactId: d.contactId || lead.convertedContactId,
            customFields: {
              ...lcf,
              rentalAgreementId: rentalId,
              rentalNo,
              rentalIssuedAt: startAt.toISOString(),
              serviceType: lcf.serviceType ?? "RENTAL",
            },
          },
        });
      }
    }
  });

  return getRental(t, rentalId);
}

export async function returnRental(
  t: string,
  userId: string,
  id: string,
  notes?: string | null,
) {
  const rental = await prisma.rentalAgreement.findFirst({ where: { id, tenantId: t } });
  if (!rental) throw notFound("Rental");
  if (rental.status === "RETURNED" || rental.status === "CANCELLED") {
    throw new AppError(`Rental already ${rental.status.toLowerCase()}`, 409);
  }

  const unit = await prisma.stockUnit.findFirst({
    where: { id: rental.stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");

  const mainWh = await getWarehouseByCode(t, "MAIN");
  if (!mainWh) throw new AppError("MAIN warehouse not configured", 500);
  const returnWhId = rental.fromWarehouseId || mainWh.id;
  const returnedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.rentalAgreement.update({
      where: { id },
      data: {
        status: "RETURNED",
        returnedAt,
        returnedById: userId,
        returnNotes: notes?.trim() || null,
      },
    });

    const unitCf =
      unit.customFields && typeof unit.customFields === "object" && !Array.isArray(unit.customFields)
        ? (unit.customFields as Record<string, unknown>)
        : {};

    await tx.stockUnit.update({
      where: { id: unit.id },
      data: {
        status: "IN_STOCK",
        warehouseId: returnWhId,
        contactId: null,
        leadId: null,
        customFields: {
          ...unitCf,
          rentalReturnedAt: returnedAt.toISOString(),
          lastRentalId: id,
        },
      },
    });

    await tx.stockLevel.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: rental.productId,
          warehouseId: returnWhId,
        },
      },
      create: {
        id: newId(),
        tenantId: t,
        productId: rental.productId,
        warehouseId: returnWhId,
        quantityOnHand: 1,
      },
      update: { quantityOnHand: { increment: 1 } },
    });

    await tx.stockMovement.create({
      data: {
        id: newId(),
        tenantId: t,
        productId: rental.productId,
        warehouseId: returnWhId,
        movementType: "RETURN",
        quantity: 1,
        referenceType: "RENTAL",
        referenceId: id,
        notes: `Rental return ${rental.rentalNo}${notes ? ` · ${notes.trim().slice(0, 120)}` : ""}`,
        performedBy: userId,
        movedAt: returnedAt,
      },
    });
  });

  return getRental(t, id);
}

export async function rentalSummary(t: string) {
  const [active, overdue, returnedMonth] = await Promise.all([
    prisma.rentalAgreement.count({ where: { tenantId: t, status: "ACTIVE" } }),
    prisma.rentalAgreement.count({
      where: { tenantId: t, status: "ACTIVE", expectedReturnAt: { lt: new Date() } },
    }),
    prisma.rentalAgreement.count({
      where: {
        tenantId: t,
        status: "RETURNED",
        returnedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
  ]);
  return { active, overdue, returnedThisMonth: returnedMonth };
}
