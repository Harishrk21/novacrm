import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";

type Family = "WEIGHING" | "BILLING";

const DEFAULT_SPARES: Record<Family, string[]> = {
  WEIGHING: [
    "Battery",
    "Load cell",
    "Display board",
    "Adaptor / SMPS",
    "Keypad",
    "Printer head",
    "Platform pad",
    "Junction box",
  ],
  BILLING: [
    "Battery",
    "Thermal printer roll",
    "Paper roll",
    "Labels",
    "Printer head",
    "Cash drawer cable",
    "Touch glass",
    "Power adaptor",
    "LAN cable",
    "Motherboard",
    "Touch POS glass",
  ],
};

let tablesReady = false;
/** Tenants that already have default spare catalog rows — skip N+1 seed on every list. */
const seededTenants = new Set<string>();

export async function ensureSpareStockTables() {
  if (tablesReady) return;
  try {
    await prisma.$queryRawUnsafe("SELECT 1 FROM spare_part_items LIMIT 1");
    await prisma.$queryRawUnsafe("SELECT 1 FROM spare_stock_txns LIMIT 1");
    tablesReady = true;
    return;
  } catch {
    /* create */
  }

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS \`spare_part_items\` (
  \`id\` CHAR(36) NOT NULL,
  \`tenant_id\` CHAR(36) NOT NULL,
  \`machine_family\` ENUM('WEIGHING', 'BILLING') NOT NULL,
  \`name\` VARCHAR(191) NOT NULL,
  \`part_code\` VARCHAR(64) NULL,
  \`unit\` VARCHAR(32) NOT NULL DEFAULT 'NOS',
  \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
  \`custom_fields\` JSON NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  \`deleted_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`spare_part_items_tenant_family_name\` (\`tenant_id\`, \`machine_family\`, \`name\`),
  KEY \`spare_part_items_tenant_family_active\` (\`tenant_id\`, \`machine_family\`, \`is_active\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS \`spare_stock_txns\` (
  \`id\` CHAR(36) NOT NULL,
  \`tenant_id\` CHAR(36) NOT NULL,
  \`spare_part_id\` CHAR(36) NOT NULL,
  \`txn_type\` ENUM('IN', 'OUT') NOT NULL,
  \`quantity\` DECIMAL(15, 3) NOT NULL,
  \`txn_date\` DATE NOT NULL,
  \`supplier_name\` VARCHAR(191) NULL,
  \`invoice_date\` DATE NULL,
  \`invoice_no\` VARCHAR(80) NULL,
  \`issued_to_user_id\` CHAR(36) NULL,
  \`ticket_id\` CHAR(36) NULL,
  \`notes\` TEXT NULL,
  \`created_by_id\` CHAR(36) NOT NULL,
  \`custom_fields\` JSON NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  \`deleted_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  KEY \`spare_stock_txns_part_date\` (\`tenant_id\`, \`spare_part_id\`, \`txn_date\`),
  KEY \`spare_stock_txns_type_date\` (\`tenant_id\`, \`txn_type\`, \`txn_date\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  tablesReady = true;
}

function parseDate(raw?: string | null) {
  if (!raw) return null;
  const d = new Date(String(raw).slice(0, 10) + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1, 12, 0, 0);
  const end = new Date(year, month, 0, 12, 0, 0);
  return { start, end };
}

export async function seedDefaultItems(t: string, family?: Family) {
  await ensureSpareStockTables();
  const cacheKey = family ? `${t}:${family}` : t;
  if (seededTenants.has(cacheKey) || seededTenants.has(t)) return;

  const families: Family[] = family ? [family] : ["WEIGHING", "BILLING"];
  const wanted = families.flatMap((fam) =>
    DEFAULT_SPARES[fam].map((name) => ({ fam, name })),
  );
  const existing = await prisma.sparePartItem.findMany({
    where: {
      tenantId: t,
      deletedAt: null,
      machineFamily: { in: families },
      name: { in: wanted.map((w) => w.name) },
    },
    select: { machineFamily: true, name: true },
  });
  const have = new Set(existing.map((e) => `${e.machineFamily}::${e.name}`));
  const missing = wanted.filter((w) => !have.has(`${w.fam}::${w.name}`));
  if (missing.length) {
    await prisma.sparePartItem.createMany({
      data: missing.map((w) => ({
        id: newId(),
        tenantId: t,
        machineFamily: w.fam,
        name: w.name,
        unit: "NOS",
      })),
      skipDuplicates: true,
    });
  }
  seededTenants.add(cacheKey);
  if (!family) seededTenants.add(t);
}

export async function listItems(
  t: string,
  q: { machineFamily?: string; search?: string; active?: boolean },
) {
  await ensureSpareStockTables();
  await seedDefaultItems(t, q.machineFamily as Family | undefined);
  const where: Prisma.SparePartItemWhereInput = {
    tenantId: t,
    deletedAt: null,
    ...(q.machineFamily ? { machineFamily: q.machineFamily as Family } : {}),
    ...(q.active === false ? {} : { isActive: true }),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search } },
            { partCode: { contains: q.search } },
          ],
        }
      : {}),
  };
  const items = await prisma.sparePartItem.findMany({
    where,
    orderBy: [{ machineFamily: "asc" }, { name: "asc" }],
  });
  const balMap = await balancesOf(
    t,
    items.map((i) => i.id),
  );
  return items.map((i) => ({
    ...i,
    quantityOnHand: balMap[i.id] ?? 0,
  }));
}

export async function createItem(
  t: string,
  body: { machineFamily: Family; name: string; partCode?: string | null; unit?: string },
) {
  await ensureSpareStockTables();
  const name = body.name.trim();
  if (!name) throw new AppError("Spare name is required", 400);
  const dup = await prisma.sparePartItem.findFirst({
    where: {
      tenantId: t,
      machineFamily: body.machineFamily,
      name,
      deletedAt: null,
    },
  });
  if (dup) throw new AppError("Spare already exists for this machine type", 409);
  return prisma.sparePartItem.create({
    data: {
      id: newId(),
      tenantId: t,
      machineFamily: body.machineFamily,
      name,
      partCode: body.partCode?.trim() || null,
      unit: body.unit?.trim() || "NOS",
    },
  });
}

export async function updateItem(
  t: string,
  id: string,
  body: {
    machineFamily?: Family;
    name?: string;
    partCode?: string | null;
    unit?: string;
    isActive?: boolean;
  },
) {
  await ensureSpareStockTables();
  const existing = await prisma.sparePartItem.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Spare part");

  const nextFamily = body.machineFamily ?? (existing.machineFamily as Family);
  const nextName = body.name != null ? body.name.trim() : existing.name;
  if (!nextName) throw new AppError("Spare name is required", 400);

  const dup = await prisma.sparePartItem.findFirst({
    where: {
      tenantId: t,
      machineFamily: nextFamily,
      name: nextName,
      deletedAt: null,
      NOT: { id },
    },
  });
  if (dup) throw new AppError("Spare already exists for this machine type", 409);

  return prisma.sparePartItem.update({
    where: { id },
    data: {
      machineFamily: nextFamily,
      name: nextName,
      ...("partCode" in body ? { partCode: body.partCode?.trim() || null } : {}),
      ...(body.unit != null ? { unit: body.unit.trim() || "NOS" } : {}),
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
    },
  });
}

export async function balanceOf(t: string, sparePartId: string, beforeDate?: Date | null) {
  await ensureSpareStockTables();
  const where: Prisma.SpareStockTxnWhereInput = {
    tenantId: t,
    sparePartId,
    deletedAt: null,
    ...(beforeDate ? { txnDate: { lt: beforeDate } } : {}),
  };
  const rows = await prisma.spareStockTxn.groupBy({
    by: ["txnType"],
    where,
    _sum: { quantity: true },
  });
  let bal = 0;
  for (const r of rows) {
    const q = Number(r._sum.quantity ?? 0);
    bal += r.txnType === "IN" ? q : -q;
  }
  return bal;
}

/** Batch balances for many parts (avoids N+1 on list / monthly). */
export async function balancesOf(
  t: string,
  sparePartIds: string[],
  beforeDate?: Date | null,
): Promise<Record<string, number>> {
  await ensureSpareStockTables();
  const out: Record<string, number> = {};
  for (const id of sparePartIds) out[id] = 0;
  if (!sparePartIds.length) return out;
  const rows = await prisma.spareStockTxn.groupBy({
    by: ["sparePartId", "txnType"],
    where: {
      tenantId: t,
      sparePartId: { in: sparePartIds },
      deletedAt: null,
      ...(beforeDate ? { txnDate: { lt: beforeDate } } : {}),
    },
    _sum: { quantity: true },
  });
  for (const r of rows) {
    const q = Number(r._sum.quantity ?? 0);
    out[r.sparePartId] = (out[r.sparePartId] ?? 0) + (r.txnType === "IN" ? q : -q);
  }
  return out;
}

function dayAfter(d: Date) {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  n.setHours(12, 0, 0, 0);
  return n;
}

async function findOrCreatePart(
  t: string,
  machineFamily: Family,
  sparePartId?: string | null,
  spareName?: string | null,
) {
  if (sparePartId) {
    const row = await prisma.sparePartItem.findFirst({
      where: { id: sparePartId, tenantId: t, deletedAt: null },
    });
    if (!row) throw notFound("Spare part");
    return row;
  }
  const name = spareName?.trim();
  if (!name) throw new AppError("Select or enter a spare name", 400);
  const existing = await prisma.sparePartItem.findFirst({
    where: { tenantId: t, machineFamily, name, deletedAt: null },
  });
  if (existing) return existing;
  return prisma.sparePartItem.create({
    data: {
      id: newId(),
      tenantId: t,
      machineFamily,
      name,
      unit: "NOS",
    },
  });
}

export async function receive(
  t: string,
  userId: string,
  body: {
    machineFamily: Family;
    sparePartId?: string | null;
    spareName?: string | null;
    quantity: number;
    supplierName: string;
    invoiceDate: string;
    invoiceNo?: string | null;
    txnDate?: string | null;
    notes?: string | null;
    unitAmount?: number | null;
    spareUniqIds?: string[] | null;
  },
) {
  await ensureSpareStockTables();
  if (!(body.quantity > 0)) throw new AppError("Quantity must be positive", 400);
  const invoiceDate = parseDate(body.invoiceDate);
  if (!invoiceDate) throw new AppError("Invoice date is required", 400);
  const txnDate = parseDate(body.txnDate) ?? invoiceDate;
  const part = await findOrCreatePart(t, body.machineFamily, body.sparePartId, body.spareName);

  const uniqIds = (body.spareUniqIds ?? [])
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean)
    .slice(0, Math.floor(body.quantity));

  const txn = await prisma.spareStockTxn.create({
    data: {
      id: newId(),
      tenantId: t,
      sparePartId: part.id,
      txnType: "IN",
      quantity: body.quantity,
      txnDate,
      supplierName: body.supplierName.trim(),
      invoiceDate,
      invoiceNo: body.invoiceNo?.trim() || null,
      notes: body.notes?.trim() || null,
      createdById: userId,
      customFields: {
        ...(uniqIds.length ? { spareUniqIds: uniqIds } : {}),
        ...(body.unitAmount != null && Number.isFinite(body.unitAmount)
          ? { unitAmount: body.unitAmount }
          : {}),
      },
    },
  });

  const onHand = await balanceOf(t, part.id);
  return { txn, part, quantityOnHand: onHand };
}

export async function issue(
  t: string,
  userId: string,
  body: {
    sparePartId: string;
    quantity: number;
    issuedToUserId?: string | null;
    txnDate?: string | null;
    ticketId?: string | null;
    notes?: string | null;
    reason?: string | null;
  },
) {
  await ensureSpareStockTables();
  if (!(body.quantity > 0)) throw new AppError("Quantity must be positive", 400);
  const part = await prisma.sparePartItem.findFirst({
    where: { id: body.sparePartId, tenantId: t, deletedAt: null },
  });
  if (!part) throw notFound("Spare part");

  const targetUserId = body.issuedToUserId?.trim() || userId;
  const engineer = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId: t, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!engineer) throw notFound("User");

  const txnDate = parseDate(body.txnDate) ?? new Date();
  // Available as of issue date (includes same-day prior IN/OUT) — blocks backdated oversell
  const availableAsOf = await balanceOf(t, part.id, dayAfter(txnDate));
  if (body.quantity > availableAsOf) {
    throw new AppError(
      `Insufficient stock for ${part.name} as of ${String(txnDate).slice(0, 15)}. Available: ${availableAsOf}, requested: ${body.quantity}`,
      409,
    );
  }

  const reason = (body.reason ?? body.notes)?.trim() || null;

  const txn = await prisma.spareStockTxn.create({
    data: {
      id: newId(),
      tenantId: t,
      sparePartId: part.id,
      txnType: "OUT",
      quantity: body.quantity,
      txnDate,
      issuedToUserId: engineer.id,
      ticketId: body.ticketId || null,
      notes: reason,
      createdById: userId,
      customFields: {
        issuedToName: engineer.name,
        reduceReason: reason,
        reducedAt: new Date().toISOString(),
      },
    },
  });

  return {
    txn,
    part,
    issuedTo: engineer,
    quantityOnHand: await balanceOf(t, part.id),
  };
}

export async function getItemFamily(t: string, sparePartId: string): Promise<Family> {
  await ensureSpareStockTables();
  const part = await prisma.sparePartItem.findFirst({
    where: { id: sparePartId, tenantId: t, deletedAt: null },
    select: { machineFamily: true },
  });
  if (!part) throw notFound("Spare part");
  return part.machineFamily as Family;
}

export async function history(
  t: string,
  q: {
    machineFamily?: string;
    sparePartId?: string;
    from?: string;
    to?: string;
    limit?: number;
    allowedFamilies?: Family[];
  },
) {
  await ensureSpareStockTables();
  const from = parseDate(q.from);
  const to = parseDate(q.to);
  const where: Prisma.SpareStockTxnWhereInput = {
    tenantId: t,
    deletedAt: null,
    ...(q.sparePartId ? { sparePartId: q.sparePartId } : {}),
    ...(from || to
      ? {
          txnDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const familyFilter =
    q.machineFamily != null
      ? [q.machineFamily as Family]
      : q.allowedFamilies?.length
        ? q.allowedFamilies
        : null;

  if (familyFilter) {
    const partIds = (
      await prisma.sparePartItem.findMany({
        where: {
          tenantId: t,
          machineFamily: { in: familyFilter },
          deletedAt: null,
        },
        select: { id: true },
      })
    ).map((p) => p.id);
    where.sparePartId = { in: partIds.length ? partIds : ["__none__"] };
  }

  const rows = await prisma.spareStockTxn.findMany({
    where,
    orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(q.limit ?? 200, 500),
  });

  const partIds = [...new Set(rows.map((r) => r.sparePartId))];
  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.issuedToUserId, r.createdById])
        .filter(Boolean)
        .map(String),
    ),
  ];
  const [parts, users] = await Promise.all([
    partIds.length
      ? prisma.sparePartItem.findMany({ where: { id: { in: partIds }, tenantId: t } })
      : [],
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds }, tenantId: t },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    spareName: partMap[r.sparePartId]?.name ?? "—",
    machineFamily: partMap[r.sparePartId]?.machineFamily ?? null,
    issuedToName:
      (r.customFields as { issuedToName?: string } | null)?.issuedToName ??
      (r.issuedToUserId ? userMap[r.issuedToUserId] : null),
    createdByName: userMap[r.createdById] ?? null,
  }));
}

export async function monthlyReport(
  t: string,
  q: {
    year: number;
    month: number;
    machineFamily?: string;
    sparePartId?: string;
    allowedFamilies?: Family[];
  },
) {
  await ensureSpareStockTables();
  await seedDefaultItems(t, q.machineFamily as Family | undefined);
  const { start } = monthBounds(q.year, q.month);
  const nextStart = new Date(q.year, q.month, 1, 12, 0, 0);
  const sparePartId = q.sparePartId ? String(q.sparePartId) : "";

  const familyWhere =
    q.machineFamily != null
      ? { machineFamily: q.machineFamily as Family }
      : q.allowedFamilies?.length
        ? { machineFamily: { in: q.allowedFamilies } }
        : {};

  const items = await prisma.sparePartItem.findMany({
    where: {
      tenantId: t,
      deletedAt: null,
      isActive: true,
      ...familyWhere,
      ...(sparePartId ? { id: sparePartId } : {}),
    },
    orderBy: [{ machineFamily: "asc" }, { name: "asc" }],
  });
  const ids = items.map((i) => i.id);
  const [openingMap, monthTxns] = await Promise.all([
    balancesOf(t, ids, start),
    ids.length
      ? prisma.spareStockTxn.groupBy({
          by: ["sparePartId", "txnType"],
          where: {
            tenantId: t,
            sparePartId: { in: ids },
            deletedAt: null,
            txnDate: { gte: start, lt: nextStart },
          },
          _sum: { quantity: true },
        })
      : Promise.resolve([]),
  ]);
  const receivedMap: Record<string, number> = {};
  const issuedMap: Record<string, number> = {};
  for (const r of monthTxns) {
    const qty = Number(r._sum.quantity ?? 0);
    if (r.txnType === "IN") receivedMap[r.sparePartId] = qty;
    else issuedMap[r.sparePartId] = qty;
  }

  const rows = items.map((item) => {
    const opening = openingMap[item.id] ?? 0;
    const received = receivedMap[item.id] ?? 0;
    const issued = issuedMap[item.id] ?? 0;
    return {
      sparePartId: item.id,
      name: item.name,
      machineFamily: item.machineFamily,
      unit: item.unit,
      opening,
      received,
      issued,
      closing: opening + received - issued,
      month: q.month,
      year: q.year,
      periodLabel: `${String(q.month).padStart(2, "0")}/${q.year}`,
    };
  });

  return {
    year: q.year,
    month: q.month,
    machineFamily: q.machineFamily ?? null,
    items: rows,
    totals: {
      opening: rows.reduce((s, r) => s + r.opening, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      issued: rows.reduce((s, r) => s + r.issued, 0),
      closing: rows.reduce((s, r) => s + r.closing, 0),
    },
  };
}
