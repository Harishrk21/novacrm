import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { AppError, notFound } from "../../common/errors.js";
import { isScopedEmployeeRole } from "../../common/utils/scope.js";
import { notifyTicketCompleted, notifyTicketPaidFully, notifyPaymentDue, refreshSlaBreached } from "./ticketNotify.service.js";
import { create as createInvoice } from "../invoices/invoices.service.js";
import { updateStatus as updateInvoiceStatus } from "../invoices/invoices.service.js";

const money = z.coerce.number().nonnegative().optional();
const dateStr = z.string().nullable().optional();

const body = z.object({
  subject: z.string().min(1).max(255),
  description: z.string().min(1).optional().default("Service job"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  contactId: z.string().min(1).max(36).nullable().optional(),
  accountId: z.string().min(1).max(36).nullable().optional(),
  assignedToId: z.string().min(1).max(36).nullable().optional(),
  productId: z.string().min(1).max(36).nullable().optional(),
  assetId: z.string().min(1).max(36).nullable().optional(),
  stampingDate: dateStr,
  nextDueDate: dateStr,
  odAmount: money,
  paymentTotal: money,
  advanceAmount: money,
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional(),
  receivedByUserId: z.string().min(1).max(36).nullable().optional(),
  deliveredByUserId: z.string().min(1).max(36).nullable().optional(),
  category: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  slaHours: z.coerce.number().int().positive().optional(),
  customFields: z.record(z.unknown()).optional(),
});
const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body, query: z.any(), params: z.any() });
const updateSchema = z.object({ body: body.partial(), query: z.any(), params });
const idSchema = z.object({ body: z.any(), query: z.any(), params });
const messageSchema = z.object({
  body: z.object({ content: z.string().min(1), isInternal: z.boolean().optional() }),
  query: z.any(),
  params,
});

const OPEN = ["OPEN", "IN_PROGRESS", "PENDING"] as const;

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function derivePaymentStatus(paymentTotal: number, advanceAmount: number): "UNPAID" | "PARTIAL" | "PAID" {
  if (paymentTotal <= 0 && advanceAmount <= 0) return "UNPAID";
  if (paymentTotal > 0 && advanceAmount >= paymentTotal) return "PAID";
  if (advanceAmount > 0) return "PARTIAL";
  return "UNPAID";
}

function serializeTicket<T extends Record<string, unknown>>(ticket: T) {
  const paymentTotal = num(ticket.paymentTotal);
  const advanceAmount = num(ticket.advanceAmount);
  const odAmount = num(ticket.odAmount);
  const paidAt = ticket.paidAt ? new Date(String(ticket.paidAt)).toISOString() : null;
  return {
    ...ticket,
    odAmount,
    paymentTotal,
    advanceAmount,
    balanceDue: Math.max(0, paymentTotal - advanceAmount),
    paymentStatus: ticket.paymentStatus ?? derivePaymentStatus(paymentTotal, advanceAmount),
    paidAt,
    stampingDate: ticket.stampingDate
      ? new Date(String(ticket.stampingDate)).toISOString().slice(0, 10)
      : null,
    nextDueDate: ticket.nextDueDate
      ? new Date(String(ticket.nextDueDate)).toISOString().slice(0, 10)
      : null,
  };
}

async function nextTicketNo(t: string) {
  let seq = await prisma.numberSequence.findUnique({
    where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "TICKET" } },
  });
  if (!seq) {
    seq = await prisma.numberSequence.create({
      data: { tenantId: t, sequenceKey: "TICKET", prefix: "TKT-", nextValue: 1, padding: 5 },
    });
  }
  await prisma.numberSequence.update({
    where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "TICKET" } },
    data: { nextValue: { increment: 1 } },
  });
  return seq.nextValue;
}

async function syncAssetDates(
  t: string,
  assetId: string | null | undefined,
  stampingDate: Date | null,
  nextDueDate: Date | null,
) {
  if (!assetId) return;
  const data: Record<string, unknown> = {};
  if (stampingDate) data.stampingDate = stampingDate;
  if (nextDueDate) data.nextDueDate = nextDueDate;
  if (!Object.keys(data).length) return;
  await prisma.customerAsset.updateMany({
    where: { id: assetId, tenantId: t, deletedAt: null },
    data,
  });
}

async function ensureAccountForTicket(
  t: string,
  ticket: { accountId: string | null; contactId: string | null },
) {
  if (ticket.accountId) {
    const acc = await prisma.account.findFirst({
      where: { id: ticket.accountId, tenantId: t, deletedAt: null },
    });
    if (acc) return acc.id;
  }
  if (ticket.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: ticket.contactId, tenantId: t, deletedAt: null },
    });
    if (!contact) throw new AppError("Contact required to create invoice", 400);
    if (contact.accountId) {
      const acc = await prisma.account.findFirst({
        where: { id: contact.accountId, tenantId: t, deletedAt: null },
      });
      if (acc) return acc.id;
    }
    const accountId = newId();
    await prisma.account.create({
      data: {
        id: accountId,
        tenantId: t,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        city: contact.city,
        state: contact.state,
        accountType: "CUSTOMER",
      },
    });
    await prisma.contact.updateMany({
      where: { id: contact.id, tenantId: t },
      data: { accountId },
    });
    if (!ticket.accountId) {
      // best-effort link on ticket handled by caller if needed
    }
    return accountId;
  }
  throw new AppError("Link a customer or account before creating an invoice", 400);
}

async function ensureServiceInvoice(
  t: string,
  userId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    contactId: string | null;
    accountId: string | null;
    productId: string | null;
    paymentTotal: unknown;
    odAmount: unknown;
    advanceAmount: unknown;
    paymentStatus: string;
  },
  markPaid: boolean,
): Promise<Record<string, unknown>> {
  const recent = await prisma.invoice.findMany({
    where: {
      tenantId: t,
      deletedAt: null,
      ...(ticket.contactId ? { contactId: ticket.contactId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const existing = recent.find((inv) => {
    const cf = inv.customFields as Record<string, unknown> | null;
    return cf && String(cf.ticketId ?? "") === ticket.id;
  });
  if (existing) {
    if (markPaid && existing.status !== "PAID") {
      await updateInvoiceStatus(t, existing.id, { status: "PAID" });
    } else if (!markPaid && existing.status === "DRAFT") {
      await updateInvoiceStatus(t, existing.id, { status: "SENT" });
    }
    const full = await prisma.invoice.findFirst({ where: { id: existing.id } });
    const lines = await prisma.invoiceLine.findMany({
      where: { tenantId: t, invoiceId: existing.id },
    });
    return {
      ...full!,
      lines,
      balanceDue: full!.grandTotal.sub(full!.amountPaid),
    };
  }

  const accountId = await ensureAccountForTicket(t, ticket);
  if (ticket.accountId !== accountId) {
    await prisma.ticket.updateMany({
      where: { id: ticket.id, tenantId: t },
      data: { accountId },
    });
  }

  const paymentTotal = Math.max(num(ticket.paymentTotal), num(ticket.advanceAmount), 0);
  const odAmount = num(ticket.odAmount);
  const serviceAmount = Math.max(0, paymentTotal - odAmount);
  const lines: Array<{
    productId?: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
    taxPercent: number;
  }> = [];
  if (serviceAmount > 0 || odAmount <= 0) {
    lines.push({
      productId: ticket.productId || null,
      description: `Service — ${ticket.subject} (TKT-${String(ticket.ticketNo).padStart(5, "0")})`,
      quantity: 1,
      unitPrice: serviceAmount > 0 ? serviceAmount : paymentTotal || 0,
      taxPercent: 0,
    });
  }
  if (odAmount > 0) {
    lines.push({
      productId: null,
      description: "OD / outstation charges",
      quantity: 1,
      unitPrice: odAmount,
      taxPercent: 0,
    });
  }
  if (!lines.length || lines.every((l) => l.unitPrice <= 0)) {
    throw new AppError("Set payment amounts before creating an invoice", 400);
  }

  const safeLines = lines.map((l) => ({ ...l, productId: null }));

  const invoice = await createInvoice(t, userId, {
    accountId,
    contactId: ticket.contactId,
    invoiceDate: new Date(),
    dueDate: new Date(),
    currency: "INR",
    discountTotal: 0,
    notes: `Service job TKT-${String(ticket.ticketNo).padStart(5, "0")}`,
    customFields: {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      source: "SERVICE_JOB",
    },
    lines: safeLines,
  });

  if (markPaid) {
    await updateInvoiceStatus(t, invoice.id, { status: "PAID" });
    const refreshed = await prisma.invoice.findFirst({ where: { id: invoice.id } });
    return {
      ...invoice,
      ...refreshed,
      status: "PAID",
      amountPaid: refreshed?.grandTotal ?? invoice.grandTotal,
    };
  }
  await updateInvoiceStatus(t, invoice.id, { status: "SENT" });
  return { ...invoice, status: "SENT" };
}

export const ticketsRouter = Router();
ticketsRouter.use(authenticate, requireTenant);

ticketsRouter.get("/summary", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  await refreshSlaBreached(t);
  const uid = q.auth!.userId;
  const scopeAnd: Prisma.TicketWhereInput[] = isScopedEmployeeRole(q.auth?.role)
    ? [
        {
          OR: [
            { assignedToId: uid },
            { receivedByUserId: uid },
            { deliveredByUserId: uid },
          ],
        },
      ]
    : [];
  const base: Prisma.TicketWhereInput = {
    tenantId: t,
    deletedAt: null,
    ...(scopeAnd.length ? { AND: scopeAnd } : {}),
  };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);

  const [open, overdue, unassigned, resolvedToday, byStatus, openJobs, assetsDue, onlyOpen] = await Promise.all([
    prisma.ticket.count({ where: { ...base, status: { in: [...OPEN] } } }),
    prisma.ticket.count({
      where: {
        ...base,
        status: { in: [...OPEN] },
        AND: [...scopeAnd, { OR: [{ slaBreached: true }, { slaDueAt: { lt: new Date() } }] }],
      },
    }),
    isScopedEmployeeRole(q.auth?.role)
      ? Promise.resolve(0)
      : prisma.ticket.count({
          where: { tenantId: t, deletedAt: null, status: { in: [...OPEN] }, assignedToId: null },
        }),
    prisma.ticket.count({
      where: {
        ...base,
        status: { in: ["RESOLVED", "CLOSED"] },
        AND: [...scopeAnd, { OR: [{ resolvedAt: { gte: start } }, { closedAt: { gte: start } }] }],
      },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: { ...base },
      _count: { _all: true },
    }),
    prisma.ticket.findMany({
      where: { ...base, status: { in: [...OPEN] } },
      select: { paymentTotal: true, advanceAmount: true },
    }),
    prisma.customerAsset.count({
      where: {
        tenantId: t,
        deletedAt: null,
        OR: [
          { nextDueDate: { lte: in30, not: null } },
          { amcEndDate: { lte: in30, not: null } },
        ],
      },
    }),
    prisma.ticket.count({ where: { ...base, status: "OPEN" } }),
  ]);

  const balanceOutstanding = openJobs.reduce(
    (s, j) => s + Math.max(0, num(j.paymentTotal) - num(j.advanceAmount)),
    0,
  );

  return success(r, {
    open: onlyOpen,
    activeQueue: open,
    overdue,
    unassigned,
    resolvedToday,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    balanceOutstanding,
    machinesDueSoon: assetsDue,
  });
});

ticketsRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  await refreshSlaBreached(t);
  const p = pagination(q.query);
  const uid = q.auth!.userId;
  const and: Prisma.TicketWhereInput[] = [];
  const where: Prisma.TicketWhereInput = { tenantId: t, deletedAt: null };

  if (q.query.status) where.status = String(q.query.status) as Prisma.TicketWhereInput["status"];
  if (q.query.priority) where.priority = String(q.query.priority) as Prisma.TicketWhereInput["priority"];
  if (q.query.contactId) where.contactId = String(q.query.contactId);
  if (q.query.assetId) where.assetId = String(q.query.assetId);
  if (q.query.slaBreached === "1" || q.query.slaBreached === "true") {
    where.slaBreached = true;
  }

  const mine =
    q.query.mine === "1" ||
    q.query.mine === "true" ||
    isScopedEmployeeRole(q.auth?.role);

  if (mine) {
    and.push({
      OR: [
        { assignedToId: uid },
        { receivedByUserId: uid },
        { deliveredByUserId: uid },
      ],
    });
  } else if (q.query.assignedToId === "unassigned") {
    where.assignedToId = null;
  } else if (q.query.assignedToId) {
    where.assignedToId = String(q.query.assignedToId);
  }

  if (q.query.search) {
    const s = String(q.query.search);
    and.push({
      OR: [{ subject: { contains: s } }, { description: { contains: s } }],
    });
  }

  if (and.length) where.AND = and;

  const orderBy =
    q.query.sort === "sla"
      ? [{ slaDueAt: "asc" as const }, { createdAt: "desc" as const }]
      : [{ createdAt: "desc" as const }];

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({ where, skip: p.skip, take: p.take, orderBy }),
    prisma.ticket.count({ where }),
  ]);

  const contactIds = [...new Set(items.map((i) => i.contactId).filter(Boolean))] as string[];
  const assetIds = [...new Set(items.map((i) => i.assetId).filter(Boolean))] as string[];
  const userIds = [
    ...new Set(
      items
        .flatMap((i) => [i.assignedToId, i.receivedByUserId, i.deliveredByUserId])
        .filter(Boolean),
    ),
  ] as string[];

  const [contacts, assets, users] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: t, id: { in: contactIds } },
          select: { id: true, name: true, phone: true, customerCode: true, area: true, location: true },
        })
      : [],
    assetIds.length
      ? prisma.customerAsset.findMany({
          where: { tenantId: t, id: { in: assetIds } },
          select: {
            id: true,
            name: true,
            machineType: true,
            serialNo: true,
            capacity: true,
            stampingDate: true,
            nextDueDate: true,
          },
        })
      : [],
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId: t, id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const enriched = items.map((row) => {
    const base = serializeTicket(row as unknown as Record<string, unknown>);
    return {
      ...base,
      contact: row.contactId ? contactMap[row.contactId] ?? null : null,
      asset: row.assetId
        ? {
            ...assetMap[row.assetId],
            stampingDate: assetMap[row.assetId]?.stampingDate
              ? assetMap[row.assetId]!.stampingDate!.toISOString().slice(0, 10)
              : null,
            nextDueDate: assetMap[row.assetId]?.nextDueDate
              ? assetMap[row.assetId]!.nextDueDate!.toISOString().slice(0, 10)
              : null,
          }
        : null,
      receivedByName: row.receivedByUserId ? userMap[row.receivedByUserId] ?? null : null,
      deliveredByName: row.deliveredByUserId ? userMap[row.deliveredByUserId] ?? null : null,
      assignedToName: row.assignedToId ? userMap[row.assignedToId] ?? null : null,
    };
  });

  return success(r, pageResult(enriched, total, p.page, p.limit));
});

ticketsRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body as z.infer<typeof body>;
  if (d.contactId && !(await prisma.contact.findFirst({ where: { id: d.contactId, tenantId: t, deletedAt: null } })))
    throw notFound("Contact");
  if (d.accountId && !(await prisma.account.findFirst({ where: { id: d.accountId, tenantId: t, deletedAt: null } })))
    throw notFound("Account");
  if (d.productId && !(await prisma.product.findFirst({ where: { id: d.productId, tenantId: t, deletedAt: null } })))
    throw notFound("Product");
  if (d.assetId && !(await prisma.customerAsset.findFirst({ where: { id: d.assetId, tenantId: t, deletedAt: null } })))
    throw notFound("Machine");
  for (const uid of [d.receivedByUserId, d.deliveredByUserId, d.assignedToId]) {
    if (uid && !(await prisma.user.findFirst({ where: { id: uid, tenantId: t, deletedAt: null } })))
      throw notFound("User");
  }

  const ticketNo = await nextTicketNo(t);
  const slaDueAt = d.slaHours ? new Date(Date.now() + d.slaHours * 3600_000) : null;
  const stampingDate = parseDate(d.stampingDate);
  const nextDueDate = parseDate(d.nextDueDate);
  const paymentTotal = d.paymentTotal ?? 0;
  const advanceAmount = d.advanceAmount ?? 0;
  const customFields = {
    ...(d.customFields ?? {}),
    ...(d.category ? { category: d.category } : {}),
    ...(d.channel ? { channel: d.channel } : {}),
    baseServiceCharge: paymentTotal,
    sparePartsTotal: 0,
  };

  const subject =
    d.subject?.trim() ||
    (d.assetId
      ? `Service — ${(await prisma.customerAsset.findFirst({ where: { id: d.assetId } }))?.name ?? "machine"}`
      : "Service job");

  const paymentStatus =
    d.paymentStatus ?? derivePaymentStatus(paymentTotal, advanceAmount);

  const row = await prisma.ticket.create({
    data: {
      id: newId(),
      tenantId: t,
      ticketNo,
      subject,
      description: d.description || "Service job",
      priority: d.priority ?? "MEDIUM",
      status: d.status ?? "OPEN",
      contactId: d.contactId ?? null,
      accountId: d.accountId ?? null,
      assignedToId: d.assignedToId ?? d.receivedByUserId ?? null,
      productId: d.productId ?? null,
      assetId: d.assetId ?? null,
      stampingDate,
      nextDueDate,
      odAmount: d.odAmount ?? 0,
      paymentTotal,
      advanceAmount,
      paymentStatus,
      paidAt: paymentStatus === "PAID" ? new Date() : null,
      receivedByUserId: d.receivedByUserId ?? d.assignedToId ?? null,
      deliveredByUserId: d.deliveredByUserId ?? null,
      slaDueAt,
      customFields,
    },
  });

  await syncAssetDates(t, row.assetId, stampingDate, nextDueDate);

  if (row.assignedToId) {
    await prisma.activity.create({
      data: {
        id: newId(),
        tenantId: t,
        type: "TASK",
        title: `Service job #${row.ticketNo} — ${row.subject}`,
        description: "Assigned to you — open My Tickets to start work.",
        status: "PENDING",
        scheduledAt: row.slaDueAt ?? new Date(),
        assignedToId: row.assignedToId,
        contactId: row.contactId,
        customFields: {
          auto_from: "ticket_create",
          ticketId: row.id,
          created_by: q.auth!.userId,
        },
      },
    });
  }

  return success(r, serializeTicket(row as unknown as Record<string, unknown>), "Service job created", 201);
});

ticketsRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  await refreshSlaBreached(t, [id]);
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  const messages = await prisma.ticketMessage.findMany({
    where: { tenantId: t, ticketId: id },
    orderBy: { createdAt: "asc" },
  });
  let product: { id: string; name: string; sku: string } | null = null;
  let contact: {
    id: string;
    name: string;
    phone: string | null;
    customerCode: string | null;
    street: string | null;
    doorNo: string | null;
    area: string | null;
    pincode: string | null;
    location: string | null;
  } | null = null;
  let account: { id: string; name: string } | null = null;
  let assignee: { id: string; name: string } | null = null;
  let asset: Record<string, unknown> | null = null;
  let receivedBy: { id: string; name: string } | null = null;
  let deliveredBy: { id: string; name: string } | null = null;

  if (ticket.productId) {
    product = await prisma.product.findFirst({
      where: { id: ticket.productId, tenantId: t },
      select: { id: true, name: true, sku: true },
    });
  }
  if (ticket.contactId) {
    contact = await prisma.contact.findFirst({
      where: { id: ticket.contactId, tenantId: t },
      select: {
        id: true,
        name: true,
        phone: true,
        customerCode: true,
        street: true,
        doorNo: true,
        area: true,
        pincode: true,
        location: true,
      },
    });
  }
  if (ticket.accountId) {
    account = await prisma.account.findFirst({
      where: { id: ticket.accountId, tenantId: t },
      select: { id: true, name: true },
    });
  }
  if (ticket.assignedToId) {
    assignee = await prisma.user.findFirst({
      where: { id: ticket.assignedToId, tenantId: t },
      select: { id: true, name: true },
    });
  }
  if (ticket.assetId) {
    const a = await prisma.customerAsset.findFirst({ where: { id: ticket.assetId, tenantId: t } });
    if (a) {
      asset = {
        ...a,
        stampingDate: a.stampingDate ? a.stampingDate.toISOString().slice(0, 10) : null,
        nextDueDate: a.nextDueDate ? a.nextDueDate.toISOString().slice(0, 10) : null,
        amcEndDate: a.amcEndDate ? a.amcEndDate.toISOString().slice(0, 10) : null,
        amcStartDate: a.amcStartDate ? a.amcStartDate.toISOString().slice(0, 10) : null,
        origin: a.origin,
      };
    }
  }
  if (ticket.receivedByUserId) {
    receivedBy = await prisma.user.findFirst({
      where: { id: ticket.receivedByUserId, tenantId: t },
      select: { id: true, name: true },
    });
  }
  if (ticket.deliveredByUserId) {
    deliveredBy = await prisma.user.findFirst({
      where: { id: ticket.deliveredByUserId, tenantId: t },
      select: { id: true, name: true },
    });
  }

  return success(r, {
    ...serializeTicket(ticket as unknown as Record<string, unknown>),
    messages,
    product,
    contact,
    account,
    assignee,
    asset,
    receivedBy,
    deliveredBy,
  });
});

ticketsRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const d = q.body as Record<string, unknown>;
  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!existing) throw notFound("Ticket");

  // Whitelist only Ticket columns — never spread raw body into Prisma (avoids silent/ partial failures)
  const data: Record<string, unknown> = {};
  const scalarKeys = [
    "subject",
    "description",
    "priority",
    "status",
    "contactId",
    "accountId",
    "assignedToId",
    "productId",
    "assetId",
    "odAmount",
    "paymentTotal",
    "advanceAmount",
    "paymentStatus",
    "receivedByUserId",
    "deliveredByUserId",
  ] as const;
  for (const key of scalarKeys) {
    if (key in d) data[key] = d[key];
  }

  const prevStatus = existing.status;
  const nextStatus = typeof d.status === "string" ? d.status : prevStatus;

  if (d.status === "RESOLVED") data.resolvedAt = new Date();
  if (d.status === "CLOSED") data.closedAt = new Date();
  if ("stampingDate" in d) data.stampingDate = parseDate(d.stampingDate);
  if ("nextDueDate" in d) data.nextDueDate = parseDate(d.nextDueDate);
  if ("category" in d || "channel" in d) {
    data.customFields = {
      ...((existing.customFields as object) ?? {}),
      ...((d.customFields as object) ?? {}),
      ...("category" in d ? { category: d.category ?? null } : {}),
      ...("channel" in d ? { channel: d.channel ?? null } : {}),
    };
  }

  const nextPaymentTotal = "paymentTotal" in d ? num(d.paymentTotal) : num(existing.paymentTotal);
  const nextAdvance = "advanceAmount" in d ? num(d.advanceAmount) : num(existing.advanceAmount);
  if ("paymentStatus" in d && typeof d.paymentStatus === "string") {
    data.paymentStatus = d.paymentStatus;
    if (d.paymentStatus === "PAID") {
      data.paidAt = new Date();
      if (nextPaymentTotal > nextAdvance) data.advanceAmount = nextPaymentTotal;
    } else if (existing.paymentStatus === "PAID") {
      data.paidAt = null;
    }
  } else if ("paymentTotal" in d || "advanceAmount" in d) {
    const derived = derivePaymentStatus(nextPaymentTotal, nextAdvance);
    data.paymentStatus = derived;
    data.paidAt = derived === "PAID" ? existing.paidAt ?? new Date() : null;
  }

  if (
    existing.slaDueAt &&
    existing.slaDueAt < new Date() &&
    ["OPEN", "IN_PROGRESS", "PENDING"].includes(String(nextStatus))
  ) {
    data.slaBreached = true;
  }

  // Always keep Assign to + Received by aligned when either changes
  if ("assignedToId" in d) {
    data.assignedToId = d.assignedToId ?? null;
    if (!("receivedByUserId" in d)) data.receivedByUserId = d.assignedToId ?? null;
  }
  if ("receivedByUserId" in d) {
    data.receivedByUserId = d.receivedByUserId ?? null;
    if (!("assignedToId" in d)) data.assignedToId = d.receivedByUserId ?? existing.assignedToId;
  }

  const prevAssignee = existing.assignedToId;

  const updated = await prisma.ticket.updateMany({ where: { id, tenantId: t, deletedAt: null }, data });
  if (!updated.count) throw notFound("Ticket");
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t } });
  if (!ticket) throw notFound("Ticket");

  // Notify assignee via My Tasks when ownership changes (never fail the assign itself)
  if (
    ticket.assignedToId &&
    ticket.assignedToId !== prevAssignee &&
    ["OPEN", "IN_PROGRESS", "PENDING"].includes(String(ticket.status))
  ) {
    try {
      await prisma.activity.create({
        data: {
          id: newId(),
          tenantId: t,
          type: "TASK",
          title: `Service job #${ticket.ticketNo} — ${ticket.subject}`.slice(0, 191),
          description: "Assigned to you — open My Tickets to start work.",
          status: "PENDING",
          scheduledAt: ticket.slaDueAt ?? new Date(),
          assignedToId: ticket.assignedToId,
          contactId: ticket.contactId,
          customFields: {
            auto_from: "ticket_assign",
            ticketId: ticket.id,
            created_by: q.auth!.userId,
          },
        },
      });
    } catch (err) {
      console.error("ticket assign follow-up failed", err);
    }
  }

  const stamp = "stampingDate" in d ? parseDate(d.stampingDate) : ticket.stampingDate;
  const due = "nextDueDate" in d ? parseDate(d.nextDueDate) : ticket.nextDueDate;
  const becameDone =
    (nextStatus === "RESOLVED" || nextStatus === "CLOSED") &&
    prevStatus !== "RESOLVED" &&
    prevStatus !== "CLOSED";
  if (becameDone || "stampingDate" in d || "nextDueDate" in d) {
    await syncAssetDates(t, ticket.assetId, stamp, due);
  }

  let whatsapp: Awaited<ReturnType<typeof notifyTicketCompleted>> | null = null;
  if (becameDone) {
    whatsapp = await notifyTicketCompleted(
      t,
      {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        subject: ticket.subject,
        contactId: ticket.contactId,
        assignedToId: ticket.assignedToId,
      },
      q.auth!.userId,
    );
  }

  return success(r, { ...serializeTicket(ticket as unknown as Record<string, unknown>), whatsapp });
});

ticketsRouter.post("/:id/mark-paid", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!existing) throw notFound("Ticket");

  const paymentTotal = Math.max(num(existing.paymentTotal), num(existing.advanceAmount));
  await prisma.ticket.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      paymentStatus: "PAID",
      paymentTotal,
      advanceAmount: paymentTotal,
      paidAt: new Date(),
    },
  });
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t } });
  if (!ticket) throw notFound("Ticket");

  let invoice: Record<string, unknown> | null = null;
  let invoiceError: string | null = null;
  try {
    invoice = await ensureServiceInvoice(t, q.auth!.userId!, ticket, true);
  } catch (err) {
    invoiceError = err instanceof Error ? err.message : "Could not create invoice";
  }

  const whatsapp = await notifyTicketPaidFully(
    t,
    {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      subject: ticket.subject,
      contactId: ticket.contactId,
      assignedToId: ticket.assignedToId,
      paymentTotal: num(ticket.paymentTotal),
    },
    q.auth!.userId,
    invoice?.invoiceNumber ? String(invoice.invoiceNumber) : null,
  );

  return success(
    r,
    {
      ...serializeTicket(ticket as unknown as Record<string, unknown>),
      whatsapp,
      invoice,
      invoiceError,
    },
    "Marked paid in full",
  );
});

ticketsRouter.post("/:id/payment-due", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  if (ticket.paymentStatus === "PAID") {
    throw new AppError("This job is already paid in full", 400);
  }
  const whatsapp = await notifyPaymentDue(
    t,
    {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      subject: ticket.subject,
      contactId: ticket.contactId,
      assignedToId: ticket.assignedToId,
      paymentTotal: num(ticket.paymentTotal),
      advanceAmount: num(ticket.advanceAmount),
    },
    q.auth!.userId,
  );
  return success(r, { ...serializeTicket(ticket as unknown as Record<string, unknown>), whatsapp }, "Payment due sent");
});

ticketsRouter.post("/:id/invoice", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  const paid = ticket.paymentStatus === "PAID";
  const invoice = await ensureServiceInvoice(t, q.auth!.userId!, ticket, paid);
  let whatsapp: Awaited<ReturnType<typeof notifyTicketPaidFully>> | null = null;
  if (paid) {
    whatsapp = await notifyTicketPaidFully(
      t,
      {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        subject: ticket.subject,
        contactId: ticket.contactId,
        assignedToId: ticket.assignedToId,
        paymentTotal: num(ticket.paymentTotal),
      },
      q.auth!.userId,
      invoice.invoiceNumber != null ? String(invoice.invoiceNumber) : null,
    );
  } else {
    whatsapp = await notifyPaymentDue(
      t,
      {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        subject: ticket.subject,
        contactId: ticket.contactId,
        assignedToId: ticket.assignedToId,
        paymentTotal: num(ticket.paymentTotal),
        advanceAmount: num(ticket.advanceAmount),
      },
      q.auth!.userId,
    );
  }
  return success(
    r,
    { ...serializeTicket(ticket as unknown as Record<string, unknown>), invoice, whatsapp },
    paid ? "Invoice created & payment receipt sent" : "Invoice created & payment due sent",
  );
});

ticketsRouter.post("/:id/messages", validate(messageSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  const user = await prisma.user.findFirst({ where: { id: q.auth!.userId!, tenantId: t } });
  if (!user) throw new AppError("User required", 401);
  const msg = await prisma.ticketMessage.create({
    data: {
      id: newId(),
      tenantId: t,
      ticketId: id,
      content: q.body.content,
      isInternal: q.body.isInternal ?? false,
      authorUserId: user.id,
      authorName: user.name,
    },
  });
  return success(r, msg, "Message added", 201);
});

ticketsRouter.delete("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const updated = await prisma.ticket.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!updated.count) throw notFound("Ticket");
  return success(r, null, "Service job deleted");
});
