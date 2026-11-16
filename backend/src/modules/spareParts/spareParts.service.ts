import { Prisma, SparePartChangeType } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { AppError, notFound } from "../../common/errors.js";

function parseDate(v: unknown): Date {
  if (!v || v === "") return new Date();
  const d = new Date(String(v).slice(0, 10) + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function validateTicketRef(t: string, ticketId: string, contactId: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: t, deletedAt: null },
  });
  if (!ticket) throw notFound("Service job");
  if (ticket.contactId && ticket.contactId !== contactId) {
    throw new AppError("Service job belongs to a different customer", 400);
  }
  return ticket;
}

async function syncTicketPaymentFromSpares(t: string, ticketId: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: t, deletedAt: null },
  });
  if (!ticket) return;

  const spares = await prisma.sparePartChange.findMany({
    where: { tenantId: t, ticketId, deletedAt: null },
  });
  const spareTotal = spares.reduce((sum, row) => {
    if (row.underWarranty) return sum;
    return sum + Number(row.chargeAmount ?? 0) * Number(row.quantity ?? 1);
  }, 0);

  const cf =
    ticket.customFields && typeof ticket.customFields === "object" && !Array.isArray(ticket.customFields)
      ? (ticket.customFields as Record<string, unknown>)
      : {};
  let base = Number(cf.baseServiceCharge);
  if (!Number.isFinite(base)) {
    base = Math.max(0, Number(ticket.paymentTotal) - spareTotal);
  }
  const paymentTotal = base + spareTotal;

  await prisma.ticket.updateMany({
    where: { id: ticketId, tenantId: t },
    data: {
      paymentTotal,
      customFields: { ...cf, baseServiceCharge: base, sparePartsTotal: spareTotal },
    },
  });
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

  if (d.ticketId) {
    await validateTicketRef(t, String(d.ticketId), contact.id);
  }

  if (d.performedByUserId) {
    const performer = await prisma.user.findFirst({
      where: { id: String(d.performedByUserId), tenantId: t, deletedAt: null, status: "ACTIVE" },
    });
    if (!performer) throw notFound("Technician");
  }

  // A part fitted from our spare stock comes out of that stock against this job (keeps stock right).
  // Matched by the catalogue id, or by the exact catalogue name typed on the job.
  const changeType = ((d.changeType as SparePartChangeType) || "REPLACED") as SparePartChangeType;
  const quantity = Number(d.quantity) || 1;
  let stockOut: { txnId: string; sparePartId: string } | null = null;
  // Parts the engineer already collected at the counter (issued to them, not yet fitted) are used first —
  // the counter issue already took them out of stock, so they must not be deducted twice.
  const fromHand: Array<{ txnId: string; qty: number }> = [];
  if (changeType === "REPLACED" || changeType === "INSTALLED") {
    let item = d.sparePartId
      ? await prisma.sparePartItem.findFirst({ where: { id: String(d.sparePartId), tenantId: t, deletedAt: null } })
      : null;
    if (!item) {
      // Same name can exist for weighing and billing (e.g. "Battery") — pick by the job's machine, then by
      // what the engineer holds
      const named = await prisma.sparePartItem.findMany({
        where: { tenantId: t, deletedAt: null, isActive: true, name: String(d.partName ?? "").trim() },
      });
      if (named.length > 1 && d.assetId) {
        const asset = await prisma.customerAsset.findFirst({ where: { id: String(d.assetId), tenantId: t }, select: { machineType: true } });
        const family = asset?.machineType === "WEIGHING" ? "WEIGHING" : asset ? "BILLING" : null;
        item = named.find((n) => String(n.machineFamily) === family) ?? null;
      }
      if (!item && named.length > 1) {
        const engineerId = d.performedByUserId ? String(d.performedByUserId) : userId;
        const held = await prisma.spareStockTxn.findFirst({
          where: { tenantId: t, txnType: "OUT", deletedAt: null, issuedToUserId: engineerId, sparePartId: { in: named.map((n) => n.id) } },
          orderBy: { txnDate: "desc" },
        });
        item = named.find((n) => n.id === held?.sparePartId) ?? null;
      }
      item = item ?? named[0] ?? null;
    }
    if (item) {
      const ticket = d.ticketId
        ? await prisma.ticket.findFirst({ where: { id: String(d.ticketId), tenantId: t }, select: { ticketNo: true } })
        : null;
      const jobRef = ticket ? `SVC-${String(ticket.ticketNo).padStart(5, "0")}` : "job";
      const engineerId = d.performedByUserId ? String(d.performedByUserId) : userId;
      let remaining = quantity;
      const handTxns = await prisma.spareStockTxn.findMany({
        where: { tenantId: t, sparePartId: item.id, txnType: "OUT", deletedAt: null, issuedToUserId: engineerId },
        orderBy: { txnDate: "asc" },
      });
      for (const tx of handTxns) {
        if (remaining <= 0) break;
        const tcf = (tx.customFields && typeof tx.customFields === "object" ? tx.customFields : {}) as Record<string, unknown>;
        if (tcf.source === "job") continue; // a stock-out made by a job, not a counter issue
        const used = Number(tcf.usedQty ?? 0) || 0;
        const left = Number(tx.quantity) - used;
        if (left <= 0) continue;
        const take = Math.min(left, remaining);
        await prisma.spareStockTxn.update({
          where: { id: tx.id },
          data: {
            customFields: {
              ...tcf,
              usedQty: used + take,
              usedOn: [...(Array.isArray(tcf.usedOn) ? (tcf.usedOn as unknown[]) : []), { ticketId: d.ticketId ?? null, job: jobRef, qty: take }],
            } as Prisma.InputJsonValue,
          },
        });
        fromHand.push({ txnId: tx.id, qty: take });
        remaining -= take;
      }
      if (remaining > 0) {
        const spareStock = await import("../spareStock/spareStock.service.js");
        const out = await spareStock.issue(t, userId, {
          sparePartId: item.id,
          quantity: remaining,
          issuedToUserId: engineerId,
          ticketId: d.ticketId ? String(d.ticketId) : null,
          reason: `Fitted on ${jobRef} — ${contact.name}`,
        });
        await prisma.spareStockTxn.update({
          where: { id: out.txn.id },
          data: { customFields: { ...((out.txn.customFields ?? {}) as Record<string, unknown>), source: "job" } as Prisma.InputJsonValue },
        });
        stockOut = { txnId: out.txn.id, sparePartId: item.id };
      } else {
        stockOut = { txnId: "", sparePartId: item.id };
      }
    }
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
      changeType,
      quantity,
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
      customFields: {
        ...((d.customFields && typeof d.customFields === "object" ? d.customFields : {}) as Record<string, unknown>),
        ...(stockOut ? { spareStockTxnId: stockOut.txnId || null, sparePartId: stockOut.sparePartId } : {}),
        ...(fromHand.length ? { fromHand } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  if (row.ticketId) await syncTicketPaymentFromSpares(t, row.ticketId);
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

  if (d.ticketId) {
    await validateTicketRef(t, String(d.ticketId), existing.contactId);
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
  const ticketId = d.ticketId !== undefined ? (d.ticketId ? String(d.ticketId) : null) : existing.ticketId;
  if (ticketId) await syncTicketPaymentFromSpares(t, ticketId);
  if (existing.ticketId && existing.ticketId !== ticketId) {
    await syncTicketPaymentFromSpares(t, existing.ticketId);
  }
  return get(t, id);
}

export async function remove(t: string, id: string) {
  const existing = await prisma.sparePartChange.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Spare part record");
  const r = await prisma.sparePartChange.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!r.count) throw notFound("Spare part record");
  // Put the part back: parts taken from the engineer's hand go back to their hand; a job stock-out is cancelled
  const ecf = (existing.customFields ?? {}) as Record<string, unknown>;
  for (const h of Array.isArray(ecf.fromHand) ? (ecf.fromHand as Array<{ txnId: string; qty: number }>) : []) {
    const tx = await prisma.spareStockTxn.findFirst({ where: { id: h.txnId, tenantId: t } });
    if (!tx) continue;
    const tcf = (tx.customFields && typeof tx.customFields === "object" ? tx.customFields : {}) as Record<string, unknown>;
    await prisma.spareStockTxn.update({
      where: { id: tx.id },
      data: { customFields: { ...tcf, usedQty: Math.max(0, (Number(tcf.usedQty ?? 0) || 0) - h.qty) } as Prisma.InputJsonValue },
    });
  }
  const txnId = ecf.spareStockTxnId;
  if (txnId) {
    await prisma.spareStockTxn.updateMany({
      where: { id: String(txnId), tenantId: t, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
  if (existing.ticketId) await syncTicketPaymentFromSpares(t, existing.ticketId);
}
