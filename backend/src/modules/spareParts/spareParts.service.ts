import { Prisma, SparePartChangeType } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";

function parseDate(v: unknown): Date {
  if (!v || v === "") return new Date();
  const d = new Date(String(v).slice(0, 10) + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function serialize(row: Record<string, unknown>) {
  return {
    ...row,
    changedAt: row.changedAt
      ? new Date(String(row.changedAt)).toISOString().slice(0, 10)
      : null,
    chargeAmount: row.chargeAmount != null ? Number(row.chargeAmount) : null,
    quantity: Number(row.quantity ?? 1),
  };
}

async function hydrate(t: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return [];
  const contactIds = [...new Set(rows.map((r) => String(r.contactId)))];
  const assetIds = [
    ...new Set(rows.map((r) => r.assetId).filter(Boolean).map(String)),
  ];
  const userIds = [
    ...new Set(rows.map((r) => r.performedByUserId).filter(Boolean).map(String)),
  ];
  const ticketIds = [
    ...new Set(rows.map((r) => r.ticketId).filter(Boolean).map(String)),
  ];

  const [contacts, assets, users, tickets] = await Promise.all([
    prisma.contact.findMany({
      where: { tenantId: t, id: { in: contactIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        customerCode: true,
        phone: true,
        mobile: true,
        city: true,
      },
    }),
    assetIds.length
      ? prisma.customerAsset.findMany({
          where: { tenantId: t, id: { in: assetIds }, deletedAt: null },
          select: { id: true, name: true, serialNo: true, machineType: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId: t, id: { in: userIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    ticketIds.length
      ? prisma.ticket.findMany({
          where: { tenantId: t, id: { in: ticketIds }, deletedAt: null },
          select: { id: true, ticketNo: true, subject: true },
        })
      : Promise.resolve([]),
  ]);

  const cMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const aMap = Object.fromEntries(assets.map((a) => [a.id, a]));
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const tMap = Object.fromEntries(tickets.map((tk) => [tk.id, tk]));

  return rows.map((r) => ({
    ...serialize(r),
    contact: cMap[String(r.contactId)] ?? null,
    asset: r.assetId ? aMap[String(r.assetId)] ?? null : null,
    performer: r.performedByUserId ? uMap[String(r.performedByUserId)] ?? null : null,
    ticket: r.ticketId ? tMap[String(r.ticketId)] ?? null : null,
  }));
}

export async function list(t: string, q: Record<string, unknown>) {
  const p = pagination(q);
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.contactId) where.contactId = String(q.contactId);
  if (q.assetId) where.assetId = String(q.assetId);
  if (q.ticketId) where.ticketId = String(q.ticketId);
  if (q.changeType) where.changeType = String(q.changeType);
  if (q.search) {
    const s = String(q.search).trim();
    where.OR = [
      { partName: { contains: s } },
      { partCode: { contains: s } },
      { oldSerialNo: { contains: s } },
      { newSerialNo: { contains: s } },
      { notes: { contains: s } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.sparePartChange.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: { changedAt: "desc" },
    }),
    prisma.sparePartChange.count({ where }),
  ]);
  const hydrated = await hydrate(t, items as unknown as Array<Record<string, unknown>>);
  return pageResult(hydrated, total, p.page, p.limit);
}

export async function get(t: string, id: string) {
  const row = await prisma.sparePartChange.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Spare part record");
  const [hydrated] = await hydrate(t, [row as unknown as Record<string, unknown>]);
  return hydrated;
}

export async function create(t: string, userId: string, d: Record<string, unknown>) {
  const contact = await prisma.contact.findFirst({
    where: { id: String(d.contactId), tenantId: t, deletedAt: null },
  });
  if (!contact) throw notFound("Customer");

  if (d.assetId) {
    const asset = await prisma.customerAsset.findFirst({
      where: {
        id: String(d.assetId),
        tenantId: t,
        contactId: contact.id,
        deletedAt: null,
      },
    });
    if (!asset) throw notFound("Machine / product");
  }

  const row = await prisma.sparePartChange.create({
    data: {
      id: newId(),
      tenantId: t,
      contactId: contact.id,
      assetId: d.assetId ? String(d.assetId) : null,
      ticketId: d.ticketId ? String(d.ticketId) : null,
      partName: String(d.partName).trim(),
      partCode: d.partCode ? String(d.partCode).trim() : null,
      changeType: (d.changeType as SparePartChangeType) || "REPLACED",
      quantity: Number(d.quantity) || 1,
      oldSerialNo: d.oldSerialNo ? String(d.oldSerialNo).trim() : null,
      newSerialNo: d.newSerialNo ? String(d.newSerialNo).trim() : null,
      changedAt: parseDate(d.changedAt),
      performedByUserId: d.performedByUserId ? String(d.performedByUserId) : userId,
      chargeAmount:
        d.chargeAmount != null && d.chargeAmount !== ""
          ? new Prisma.Decimal(Number(d.chargeAmount))
          : null,
      underWarranty: Boolean(d.underWarranty),
      notes: d.notes ? String(d.notes).trim() : null,
      customFields: d.customFields ?? undefined,
    },
  });
  return get(t, row.id);
}

export async function update(t: string, id: string, d: Record<string, unknown>) {
  const existing = await prisma.sparePartChange.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Spare part record");

  if (d.assetId) {
    const asset = await prisma.customerAsset.findFirst({
      where: {
        id: String(d.assetId),
        tenantId: t,
        contactId: existing.contactId,
        deletedAt: null,
      },
    });
    if (!asset) throw notFound("Machine / product");
  }

  await prisma.sparePartChange.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      ...(d.assetId !== undefined ? { assetId: d.assetId ? String(d.assetId) : null } : {}),
      ...(d.ticketId !== undefined ? { ticketId: d.ticketId ? String(d.ticketId) : null } : {}),
      ...(d.partName ? { partName: String(d.partName).trim() } : {}),
      ...("partCode" in d ? { partCode: d.partCode ? String(d.partCode).trim() : null } : {}),
      ...(d.changeType ? { changeType: d.changeType as SparePartChangeType } : {}),
      ...(d.quantity != null ? { quantity: Number(d.quantity) } : {}),
      ...("oldSerialNo" in d
        ? { oldSerialNo: d.oldSerialNo ? String(d.oldSerialNo).trim() : null }
        : {}),
      ...("newSerialNo" in d
        ? { newSerialNo: d.newSerialNo ? String(d.newSerialNo).trim() : null }
        : {}),
      ...("changedAt" in d ? { changedAt: parseDate(d.changedAt) } : {}),
      ...("performedByUserId" in d
        ? { performedByUserId: d.performedByUserId ? String(d.performedByUserId) : null }
        : {}),
      ...("chargeAmount" in d
        ? {
            chargeAmount:
              d.chargeAmount != null && d.chargeAmount !== ""
                ? new Prisma.Decimal(Number(d.chargeAmount))
                : null,
          }
        : {}),
      ...("underWarranty" in d ? { underWarranty: Boolean(d.underWarranty) } : {}),
      ...("notes" in d ? { notes: d.notes ? String(d.notes).trim() : null } : {}),
    },
  });
  return get(t, id);
}

export async function remove(t: string, id: string) {
  const r = await prisma.sparePartChange.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!r.count) throw notFound("Spare part record");
}
