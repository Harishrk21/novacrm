import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";

export async function list(t: string, q: Record<string, unknown>) {
  const p = pagination(q);
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.search) {
    where.OR = [
      { name: { contains: String(q.search) } },
      { email: { contains: String(q.search) } },
      { phone: { contains: String(q.search) } },
      { mobile: { contains: String(q.search) } },
    ];
  }
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
      orderBy: { createdAt: "desc" },
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

  const [account, deals, tickets, notes, invoices] = await Promise.all([
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
    tickets,
    notes,
    invoices: invoicesDetailed,
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
  return prisma.contact.create({
    data: {
      ...d,
      id: newId(),
      tenantId: t,
      phoneNormalized: normalizePhone((d.phone as string) ?? (d.mobile as string)),
    } as never,
  });
}

export async function update(t: string, id: string, d: Record<string, unknown>) {
  await refs(t, d);
  const r = await prisma.contact.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      ...d,
      ...("phone" in d || "mobile" in d
        ? { phoneNormalized: normalizePhone((d.phone as string) ?? (d.mobile as string)) }
        : {}),
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
