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

function addOneMonth(d: Date) {
  const next = new Date(d.getTime());
  next.setMonth(next.getMonth() + 1);
  return next;
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

function unitCfRecord(unit: { customFields: unknown }) {
  return unit.customFields &&
    typeof unit.customFields === "object" &&
    !Array.isArray(unit.customFields)
    ? ({ ...(unit.customFields as Record<string, unknown>) } as Record<string, unknown>)
    : {};
}

/** Clear active-hire keys; keep lastRentalId / rentalReturnedAt history. */
function clearActiveRentalFields(cf: Record<string, unknown>) {
  const next = { ...cf };
  delete next.rentalId;
  delete next.rentalNo;
  delete next.rentedAt;
  delete next.expectedReturnAt;
  delete next.rentalCustomerName;
  delete next.rentalCustomerPhone;
  delete next.rentalCustomerCompany;
  return next;
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
      select: {
        id: true,
        serialNo: true,
        hmsUniqId: true,
        status: true,
        stampingDate: true,
        warehouseId: true,
      },
    }),
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: t, id: { in: contactIds }, deletedAt: null },
          select: { id: true, name: true, phone: true, email: true, customerCode: true },
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
      monthlyRate: r.monthlyRate != null ? Number(r.monthlyRate) : null,
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
  contactId: string;
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
  monthlyRate?: number | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
  notes?: string | null;
};

/** Issue machine on rental — reduces warehouse stock and marks unit RENTED. */
export async function issueRental(t: string, userId: string, d: IssueRentalInput) {
  const contactId = d.contactId?.trim();
  if (!contactId) throw new AppError("Select a CRM customer before issuing a rental", 400);

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId: t, deletedAt: null },
  });
  if (!contact) throw notFound("Contact");

  if (d.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: d.leadId, tenantId: t, deletedAt: null },
    });
    if (!lead) throw notFound("Lead");
  }

  const startAt = parseDateTime(d.startAt);
  if (!startAt) throw new AppError("Rental start date/time is required", 400);
  let expectedReturnAt = parseDateTime(d.expectedReturnAt ?? null);
  if (!expectedReturnAt) expectedReturnAt = addOneMonth(startAt);

  const name = (d.customerName || contact.name || "").trim();
  if (!name) throw new AppError("Customer name is required", 400);

  const rentalId = newId();

  await prisma.$transaction(async (tx) => {
    // Race-safe: lock unit row via find + status check inside txn
    const unit = await tx.stockUnit.findFirst({
      where: { id: d.stockUnitId, tenantId: t, deletedAt: null },
    });
    if (!unit) throw notFound("Stock unit");
    if (unit.status !== "IN_STOCK") {
      throw new AppError(
        `Serial ${unit.serialNo} is not available (status: ${unit.status})`,
        409,
      );
    }

    const activeOnUnit = await tx.rentalAgreement.findFirst({
      where: {
        tenantId: t,
        stockUnitId: unit.id,
        status: "ACTIVE",
      },
      select: { id: true, rentalNo: true },
    });
    if (activeOnUnit) {
      throw new AppError(
        `Serial ${unit.serialNo} already on active rental ${activeOnUnit.rentalNo}`,
        409,
      );
    }

    const product = await tx.product.findFirst({
      where: { id: unit.productId, tenantId: t, deletedAt: null },
      select: { id: true, name: true, sku: true },
    });

    const fromWarehouseId = unit.warehouseId;
    const rentalNo = await nextRentalNo(tx, t);

    const current = await tx.stockLevel.findUnique({
      where: {
        tenantId_productId_warehouseId: {
          tenantId: t,
          productId: unit.productId,
          warehouseId: fromWarehouseId,
        },
      },
    });
    const onHand = current?.quantityOnHand ?? new Prisma.Decimal(0);
    if (onHand.lessThan(1)) {
      throw new AppError(
        `Insufficient stock for rental issue (on hand: ${onHand.toString()})`,
        409,
      );
    }
    const next = onHand.sub(1);
    if (next.isNegative()) throw new AppError("Insufficient stock for rental issue", 409);

    await tx.rentalAgreement.create({
      data: {
        id: rentalId,
        tenantId: t,
        rentalNo,
        status: "ACTIVE",
        productId: unit.productId,
        stockUnitId: unit.id,
        contactId,
        leadId: d.leadId || null,
        customerName: name,
        customerPhone: d.customerPhone?.trim() || contact.phone || null,
        customerEmail: d.customerEmail?.trim() || contact.email || null,
        customerCompany: d.customerCompany?.trim() || null,
        customerAddress: d.customerAddress?.trim() || null,
        city: d.city?.trim() || null,
        state: d.state?.trim() || null,
        startAt,
        expectedReturnAt,
        dailyRate: d.dailyRate != null ? d.dailyRate : null,
        monthlyRate: d.monthlyRate != null ? d.monthlyRate : null,
        totalAmount: d.totalAmount != null ? d.totalAmount : null,
        depositAmount: d.depositAmount != null ? d.depositAmount : null,
        notes: d.notes?.trim() || null,
        issuedById: userId,
        fromWarehouseId,
      },
    });

    const unitCf = unitCfRecord(unit);
    const updated = await tx.stockUnit.updateMany({
      where: { id: unit.id, tenantId: t, status: "IN_STOCK", deletedAt: null },
      data: {
        status: "RENTED",
        contactId,
        leadId: d.leadId || null,
        customFields: {
          ...unitCf,
          rentalId,
          rentalNo,
          rentedAt: startAt.toISOString(),
          expectedReturnAt: expectedReturnAt?.toISOString() ?? null,
          rentalCustomerName: name,
          rentalCustomerPhone: d.customerPhone?.trim() || contact.phone || null,
          rentalCustomerCompany: d.customerCompany?.trim() || null,
        },
      },
    });
    if (updated.count !== 1) {
      throw new AppError(
        `Serial ${unit.serialNo} was just taken by another issue — try again`,
        409,
      );
    }

    if (current) {
      await tx.stockLevel.update({
        where: { id: current.id },
        data: { quantityOnHand: next },
      });
    } else {
      throw new AppError("Insufficient stock for rental issue (no stock level row)", 409);
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
          lead.customFields &&
          typeof lead.customFields === "object" &&
          !Array.isArray(lead.customFields)
            ? (lead.customFields as Record<string, unknown>)
            : {};
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            status: "QUALIFIED",
            convertedContactId: contactId || lead.convertedContactId,
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

async function restoreStockFromRental(
  tx: Prisma.TransactionClient,
  t: string,
  userId: string,
  rental: {
    id: string;
    rentalNo: string;
    productId: string;
    stockUnitId: string;
    fromWarehouseId: string | null;
  },
  opts: {
    finalStatus: "RETURNED" | "CANCELLED";
    notes?: string | null;
    movementType: "RETURN" | "IN";
    movementLabel: string;
  },
) {
  const unit = await tx.stockUnit.findFirst({
    where: { id: rental.stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status !== "RENTED") {
    throw new AppError(
      `Serial ${unit.serialNo} is ${unit.status} — expected RENTED for this rental`,
      409,
    );
  }

  const mainWh = await getWarehouseByCode(t, "MAIN");
  if (!mainWh) throw new AppError("MAIN warehouse not configured", 500);
  const returnWhId = rental.fromWarehouseId || mainWh.id;
  const at = new Date();

  await tx.rentalAgreement.update({
    where: { id: rental.id },
    data: {
      status: opts.finalStatus,
      returnedAt: at,
      returnedById: userId,
      returnNotes: opts.notes?.trim() || null,
    },
  });

  const cleared = clearActiveRentalFields(unitCfRecord(unit));
  const unitUpdated = await tx.stockUnit.updateMany({
    where: { id: unit.id, tenantId: t, status: "RENTED", deletedAt: null },
    data: {
      status: "IN_STOCK",
      warehouseId: returnWhId,
      contactId: null,
      leadId: null,
      customFields: {
        ...cleared,
        rentalReturnedAt: at.toISOString(),
        lastRentalId: rental.id,
        lastRentalNo: rental.rentalNo,
        lastRentalOutcome: opts.finalStatus,
      },
    },
  });
  if (unitUpdated.count !== 1) {
    throw new AppError(
      `Serial ${unit.serialNo} was already restored — refresh and try again`,
      409,
    );
  }

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
      movementType: opts.movementType,
      quantity: 1,
      referenceType: "RENTAL",
      referenceId: rental.id,
      notes: `${opts.movementLabel} ${rental.rentalNo}${
        opts.notes ? ` · ${opts.notes.trim().slice(0, 120)}` : ""
      }`,
      performedBy: userId,
      movedAt: at,
    },
  });
}

export async function returnRental(
  t: string,
  userId: string,
  id: string,
  notes?: string | null,
) {
  const rental = await prisma.rentalAgreement.findFirst({ where: { id, tenantId: t } });
  if (!rental) throw notFound("Rental");
  if (rental.status !== "ACTIVE") {
    throw new AppError(
      `Only active rentals can be returned (current: ${rental.status.toLowerCase()})`,
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    const locked = await tx.rentalAgreement.findFirst({
      where: { id, tenantId: t, status: "ACTIVE" },
    });
    if (!locked) {
      throw new AppError("Rental is no longer active — refresh and try again", 409);
    }
    await restoreStockFromRental(tx, t, userId, locked, {
      finalStatus: "RETURNED",
      notes,
      movementType: "RETURN",
      movementLabel: "Rental return",
    });
  });

  return getRental(t, id);
}

export async function cancelRental(
  t: string,
  userId: string,
  id: string,
  notes?: string | null,
) {
  const rental = await prisma.rentalAgreement.findFirst({ where: { id, tenantId: t } });
  if (!rental) throw notFound("Rental");
  if (rental.status !== "ACTIVE") {
    throw new AppError(
      `Only active rentals can be cancelled (current: ${rental.status.toLowerCase()})`,
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    const locked = await tx.rentalAgreement.findFirst({
      where: { id, tenantId: t, status: "ACTIVE" },
    });
    if (!locked) {
      throw new AppError("Rental is no longer active — refresh and try again", 409);
    }
    await restoreStockFromRental(tx, t, userId, locked, {
      finalStatus: "CANCELLED",
      notes: notes?.trim() || "Cancelled — stock restored",
      movementType: "IN",
      movementLabel: "Rental cancel",
    });
  });

  return getRental(t, id);
}

export type PatchRentalInput = {
  expectedReturnAt?: string | null;
  dailyRate?: number | null;
  monthlyRate?: number | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
  notes?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerCompany?: string | null;
  customerAddress?: string | null;
  city?: string | null;
  state?: string | null;
};

/** Extend due date / update rates & notes — no serial or product swap. */
export async function patchRental(t: string, id: string, d: PatchRentalInput) {
  const rental = await prisma.rentalAgreement.findFirst({ where: { id, tenantId: t } });
  if (!rental) throw notFound("Rental");
  if (rental.status !== "ACTIVE") {
    throw new AppError("Only active rentals can be updated", 409);
  }

  const expectedReturnAt =
    d.expectedReturnAt !== undefined
      ? parseDateTime(d.expectedReturnAt)
      : undefined;

  await prisma.rentalAgreement.update({
    where: { id },
    data: {
      ...(expectedReturnAt !== undefined ? { expectedReturnAt } : {}),
      ...(d.dailyRate !== undefined
        ? { dailyRate: d.dailyRate != null ? d.dailyRate : null }
        : {}),
      ...(d.monthlyRate !== undefined
        ? { monthlyRate: d.monthlyRate != null ? d.monthlyRate : null }
        : {}),
      ...(d.totalAmount !== undefined
        ? { totalAmount: d.totalAmount != null ? d.totalAmount : null }
        : {}),
      ...(d.depositAmount !== undefined
        ? { depositAmount: d.depositAmount != null ? d.depositAmount : null }
        : {}),
      ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
      ...(d.customerName !== undefined
        ? { customerName: d.customerName?.trim() || rental.customerName }
        : {}),
      ...(d.customerPhone !== undefined
        ? { customerPhone: d.customerPhone?.trim() || null }
        : {}),
      ...(d.customerEmail !== undefined
        ? { customerEmail: d.customerEmail?.trim() || null }
        : {}),
      ...(d.customerCompany !== undefined
        ? { customerCompany: d.customerCompany?.trim() || null }
        : {}),
      ...(d.customerAddress !== undefined
        ? { customerAddress: d.customerAddress?.trim() || null }
        : {}),
      ...(d.city !== undefined ? { city: d.city?.trim() || null } : {}),
      ...(d.state !== undefined ? { state: d.state?.trim() || null } : {}),
    },
  });

  if (expectedReturnAt !== undefined || d.customerName !== undefined) {
    const unit = await prisma.stockUnit.findFirst({
      where: { id: rental.stockUnitId, tenantId: t, deletedAt: null },
    });
    if (unit) {
      const cf = unitCfRecord(unit);
      await prisma.stockUnit.update({
        where: { id: unit.id },
        data: {
          customFields: {
            ...cf,
            ...(expectedReturnAt !== undefined
              ? { expectedReturnAt: expectedReturnAt?.toISOString() ?? null }
              : {}),
            ...(d.customerName !== undefined
              ? { rentalCustomerName: d.customerName?.trim() || rental.customerName }
              : {}),
            ...(d.customerPhone !== undefined
              ? { rentalCustomerPhone: d.customerPhone?.trim() || null }
              : {}),
            ...(d.customerCompany !== undefined
              ? { rentalCustomerCompany: d.customerCompany?.trim() || null }
              : {}),
          },
        },
      });
    }
  }

  return getRental(t, id);
}

export async function rentalSummary(t: string) {
  const [active, overdue, returnedMonth, cancelled] = await Promise.all([
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
    prisma.rentalAgreement.count({ where: { tenantId: t, status: "CANCELLED" } }),
  ]);
  return { active, overdue, returnedThisMonth: returnedMonth, cancelled };
}
