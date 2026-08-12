import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";
import {
  allocateCustomerIdentity,
  assertContactIdentityAvailable,
} from "./customerIdentity.js";

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function withTicketBalance<T extends { odAmount?: unknown; paymentTotal?: unknown; advanceAmount?: unknown }>(
  ticket: T,
) {
  const paymentTotal = num(ticket.paymentTotal);
  const advanceAmount = num(ticket.advanceAmount);
  const odAmount = num(ticket.odAmount);
  return {
    ...ticket,
    odAmount,
    paymentTotal,
    advanceAmount,
    balanceDue: Math.max(0, paymentTotal - advanceAmount),
  };
}

function serializeAsset(asset: {
  stampingDate?: Date | string | null;
  nextDueDate?: Date | string | null;
  amcStartDate?: Date | string | null;
  amcEndDate?: Date | string | null;
  [key: string]: unknown;
}) {
  const slice = (v: Date | string | null | undefined) => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  return {
    ...asset,
    stampingDate: slice(asset.stampingDate),
    nextDueDate: slice(asset.nextDueDate),
    amcStartDate: slice(asset.amcStartDate),
    amcEndDate: slice(asset.amcEndDate),
  };
}

export async function list(t: string, q: Record<string, unknown>) {
  const p = pagination(q);
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.search) {
    const s = String(q.search).trim();
    where.OR = [
      { name: { contains: s } },
      { email: { contains: s } },
      { phone: { contains: s } },
      { mobile: { contains: s } },
      { customerCode: { contains: s } },
    ];
  }
  if (q.customerCode) where.customerCode = String(q.customerCode).trim().toUpperCase();
  if (q.accountId) where.accountId = String(q.accountId);
  if (q.ownerUserId) where.ownerUserId = String(q.ownerUserId);
  if (q.city) where.city = { contains: String(q.city) };
  if (q.state) where.state = { contains: String(q.state) };
  if (q.hasAccount === "1" || q.hasAccount === "true") where.accountId = { not: null };
  if (q.hasAccount === "0" || q.hasAccount === "false") where.accountId = null;
  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: [{ customerNo: "asc" }, { createdAt: "desc" }],
    }),
    prisma.contact.count({ where }),
  ]);
  return pageResult(items, total, p.page, p.limit);
}

export async function get(t: string, id: string) {
  const x = await prisma.contact.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!x) throw notFound("Contact");

  const invoiceWhere = {
    tenantId: t,
    deletedAt: null,
    OR: [
      { contactId: id },
      ...(x.accountId ? [{ accountId: x.accountId }] : []),
    ],
  };

  const [account, deals, tickets, notes, invoices, assets] = await Promise.all([
    x.accountId
      ? prisma.account.findFirst({ where: { id: x.accountId, tenantId: t, deletedAt: null } })
      : null,
    prisma.deal.findMany({
      where: { tenantId: t, contactId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.ticket.findMany({
      where: { tenantId: t, contactId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.note.findMany({
      where: { tenantId: t, entityType: "CONTACT", entityId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.invoice.findMany({
      where: invoiceWhere,
      orderBy: { invoiceDate: "desc" },
      take: 50,
    }),
    prisma.customerAsset.findMany({
      where: { tenantId: t, contactId: id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);

  const invoiceIds = invoices.map((inv) => inv.id);
  const lines = invoiceIds.length
    ? await prisma.invoiceLine.findMany({
        where: { tenantId: t, invoiceId: { in: invoiceIds } },
      })
    : [];

  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))] as string[];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { tenantId: t, id: { in: productIds }, deletedAt: null },
        select: { id: true, sku: true, name: true, imageUrl: true },
      })
    : [];
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const invoicesDetailed = invoices.map((inv) => {
    const invLines = lines
      .filter((l) => l.invoiceId === inv.id)
      .map((l) => ({
        ...l,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxPercent: Number(l.taxPercent),
        lineTotal: Number(l.lineTotal),
        product: l.productId ? productMap[l.productId] ?? null : null,
      }));
    return {
      ...inv,
      subtotal: Number(inv.subtotal),
      taxTotal: Number(inv.taxTotal),
      discountTotal: Number(inv.discountTotal),
      grandTotal: Number(inv.grandTotal),
      amountPaid: Number(inv.amountPaid),
      balanceDue: Number(inv.grandTotal) - Number(inv.amountPaid),
      lines: invLines,
    };
  });

  const purchaseSummary = {
    invoiceCount: invoicesDetailed.length,
    totalBilled: invoicesDetailed.reduce((s, i) => s + i.grandTotal, 0),
    totalPaid: invoicesDetailed.reduce((s, i) => s + i.amountPaid, 0),
    productsBought: [
      ...new Map(
        invoicesDetailed
          .flatMap((i) => i.lines)
          .filter((l) => l.product)
          .map((l) => [
            l.product!.id,
            {
              id: l.product!.id,
              sku: l.product!.sku,
              name: l.product!.name,
              imageUrl: l.product!.imageUrl,
              qty: 0,
              amount: 0,
            },
          ]),
      ).values(),
    ].map((row) => {
      const matching = invoicesDetailed
        .flatMap((i) => i.lines)
        .filter((l) => l.productId === row.id);
      return {
        ...row,
        qty: matching.reduce((s, l) => s + Number(l.quantity), 0),
        amount: matching.reduce((s, l) => s + Number(l.lineTotal), 0),
      };
    }),
  };

  return {
    ...x,
    account,
    deals,
    tickets: tickets.map(withTicketBalance),
    notes,
    invoices: invoicesDetailed,
    assets: assets.map(serializeAsset),
    purchaseSummary,
  };
}

async function refs(t: string, d: Record<string, unknown>) {
  if (
    d.accountId &&
    !(await prisma.account.findFirst({
      where: { id: String(d.accountId), tenantId: t, deletedAt: null },
    }))
  ) {
    throw notFound("Account");
  }
  if (
    d.ownerUserId &&
    !(await prisma.user.findFirst({
      where: { id: String(d.ownerUserId), tenantId: t, deletedAt: null },
    }))
  ) {
    throw notFound("Owner");
  }
}

export async function create(t: string, d: Record<string, unknown>) {
  await refs(t, d);
  const { phoneNormalized, email } = await assertContactIdentityAvailable(t, {
    phone: d.phone as string | null | undefined,
    mobile: d.mobile as string | null | undefined,
    email: d.email as string | null | undefined,
    requirePhone: true,
  });

  return prisma.$transaction(async (tx) => {
    const identity = await allocateCustomerIdentity(t, tx);
    return tx.contact.create({
      data: {
        ...d,
        id: newId(),
        tenantId: t,
        customerNo: identity.customerNo,
        customerCode: identity.customerCode,
        email: email ?? (d.email as string | null | undefined) ?? null,
        phoneNormalized,
      } as never,
    });
  });
}

export async function update(t: string, id: string, d: Record<string, unknown>) {
  await refs(t, d);
  const existing = await prisma.contact.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Contact");

  const nextPhone =
    "phone" in d || "mobile" in d
      ? ((d.phone as string | null | undefined) ??
        (d.mobile as string | null | undefined) ??
        existing.phone ??
        existing.mobile)
      : (existing.phone ?? existing.mobile);
  const nextEmail = "email" in d ? (d.email as string | null | undefined) : existing.email;

  const { phoneNormalized, email } = await assertContactIdentityAvailable(
    t,
    {
      phone: nextPhone,
      mobile: null,
      email: nextEmail,
      excludeId: id,
      // Updates may keep contacts that predate phone requirement, but cannot clear phone if already set
      requirePhone: Boolean(existing.phoneNormalized || nextPhone),
    },
  );

  const { customerNo: _n, customerCode: _c, ...safe } = d as Record<string, unknown> & {
    customerNo?: unknown;
    customerCode?: unknown;
  };

  const r = await prisma.contact.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      ...safe,
      ...("email" in d ? { email } : {}),
      ...("phone" in d || "mobile" in d ? { phoneNormalized } : {}),
    } as never,
  });
  if (!r.count) throw notFound("Contact");
  return get(t, id);
}

export async function remove(t: string, id: string) {
  const r = await prisma.contact.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!r.count) throw notFound("Contact");
}

export const phone = (t: string, p: string) =>
  prisma.contact.findMany({
    where: { tenantId: t, phoneNormalized: normalizePhone(p), deletedAt: null },
    take: 20,
  });

export async function addNote(t: string, contactId: string, userId: string, content: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId: t, deletedAt: null },
  });
  if (!contact) throw notFound("Contact");
  return prisma.note.create({
    data: {
      id: newId(),
      tenantId: t,
      content: content.trim(),
      entityType: "CONTACT",
      entityId: contactId,
      createdById: userId,
    },
  });
}

export async function updateNote(t: string, contactId: string, noteId: string, content: string) {
  const updated = await prisma.note.updateMany({
    where: {
      id: noteId,
      tenantId: t,
      entityType: "CONTACT",
      entityId: contactId,
      deletedAt: null,
    },
    data: { content: content.trim() },
  });
  if (!updated.count) throw notFound("Note");
  return prisma.note.findFirst({ where: { id: noteId, tenantId: t } });
}

export async function removeNote(t: string, contactId: string, noteId: string) {
  const updated = await prisma.note.updateMany({
    where: {
      id: noteId,
      tenantId: t,
      entityType: "CONTACT",
      entityId: contactId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  if (!updated.count) throw notFound("Note");
}

/** Ensure every existing contact has a customer code (one-time / safe to re-run). */
export async function backfillCustomerCodes(t?: string) {
  const tenants = t
    ? [{ id: t }]
    : await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });

  let updated = 0;
  for (const tenant of tenants) {
    const missing = await prisma.contact.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null,
        OR: [{ customerCode: null }, { customerNo: null }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    for (const row of missing) {
      await prisma.$transaction(async (tx) => {
        const identity = await allocateCustomerIdentity(tenant.id, tx);
        await tx.contact.update({
          where: { id: row.id },
          data: {
            customerNo: identity.customerNo,
            customerCode: identity.customerCode,
          },
        });
      });
      updated += 1;
    }
  }
  return { updated };
}
