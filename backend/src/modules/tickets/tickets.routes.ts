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
import { isScopedEmployeeRole, canAssignTicketsRole, canApproveTicketsRole, canCreateTicketsRole, isServiceDeskRole } from "../../common/utils/scope.js";
import { notifyTicketCompleted, notifyTicketPaidFully, notifyPaymentDue, notifyTicketCreatedCustomer, notifyTicketAssignedEngineer, notifyTicketStatusUpdate, refreshSlaBreached } from "./ticketNotify.service.js";
import {
  assertCanClosePayment,
  assertCanInvoice,
  assertPaymentCollection,
  assertStatusTransition,
  isFreeJob,
  ticketCf,
} from "./ticketLifecycle.js";
import { createNotifications, notifyAdmins } from "../notifications/notify.service.js";
import { create as createInvoice } from "../invoices/invoices.service.js";
import { updateStatus as updateInvoiceStatus } from "../invoices/invoices.service.js";

const money = z.coerce.number().nonnegative().optional();
const dateStr = z.string().nullable().optional();
const paymentMethodEnum = z.enum(["CASH", "UPI", "NEFT", "RTGS", "CHEQUE", "CARD", "OTHER"]);

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
  paymentMethod: paymentMethodEnum.nullable().optional(),
  paymentReference: z.string().max(80).nullable().optional(),
  paymentProofUrl: z.string().max(500).nullable().optional(),
  signatureUrl: z.string().max(500).nullable().optional(),
  receivedByUserId: z.string().min(1).max(36).nullable().optional(),
  deliveredByUserId: z.string().min(1).max(36).nullable().optional(),
  category: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  slaHours: z.coerce.number().int().positive().optional(),
  customFields: z.record(z.unknown()).optional(),
  /** When true, send WhatsApp templates for this action (UI confirms first). */
  sendWhatsApp: z.boolean().optional(),
  /** Short note for status-update template {{4}} */
  whatsappNote: z.string().max(200).optional(),
});
const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body, query: z.any(), params: z.any() });
const updateSchema = z.object({ body: body.partial(), query: z.any(), params });
const idSchema = z.object({ body: z.any(), query: z.any(), params });
const markPaidSchema = z.object({
  body: z.object({
    paymentMethod: paymentMethodEnum,
    paymentReference: z.string().max(80).nullable().optional(),
    paymentProofUrl: z.string().max(500).nullable().optional(),
    sendWhatsApp: z.boolean().optional(),
    /** Prefer draft values from UI so mark-paid works without a separate Save. */
    paymentTotal: money.optional(),
    advanceAmount: money.optional(),
  }),
  query: z.any(),
  params,
});
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

/**
 * Amounts alone never mark a job PAID — that requires admin Mark paid (method/proof)
 * or free-job close. Advance > 0 → PARTIAL even when advance covers total.
 */
function derivePaymentStatus(paymentTotal: number, advanceAmount: number): "UNPAID" | "PARTIAL" {
  if (advanceAmount <= 0) return "UNPAID";
  return "PARTIAL";
}

function serializeTicket<T extends Record<string, unknown>>(ticket: T) {
  const paymentTotal = num(ticket.paymentTotal);
  const advanceAmount = num(ticket.advanceAmount);
  const odAmount = num(ticket.odAmount);
  const paidAt = ticket.paidAt ? new Date(String(ticket.paidAt)).toISOString() : null;
  const customerSignedAt = ticket.customerSignedAt
    ? new Date(String(ticket.customerSignedAt)).toISOString()
    : null;
  return {
    ...ticket,
    odAmount,
    paymentTotal,
    advanceAmount,
    balanceDue: Math.max(0, paymentTotal - advanceAmount),
    paymentStatus: ticket.paymentStatus ?? derivePaymentStatus(paymentTotal, advanceAmount),
    paidAt,
    paymentMethod: ticket.paymentMethod ?? null,
    paymentReference: ticket.paymentReference ?? null,
    paymentProofUrl: ticket.paymentProofUrl ?? null,
    serviceInvoiceId: ticket.serviceInvoiceId ?? null,
    signatureUrl: ticket.signatureUrl ?? null,
    customerSignedAt,
    stampingDate: ticket.stampingDate
      ? new Date(String(ticket.stampingDate)).toISOString().slice(0, 10)
      : null,
    nextDueDate: ticket.nextDueDate
      ? new Date(String(ticket.nextDueDate)).toISOString().slice(0, 10)
      : null,
  };
}

async function nextPaymentNo(t: string) {
  return prisma.$transaction(async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "PAYMENT" } },
    });
    if (!seq) {
      await tx.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: "PAYMENT",
          prefix: "PAY-",
          nextValue: 2,
          padding: 5,
        },
      });
      return "PAY-00001";
    }
    const n = seq.nextValue;
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "PAYMENT" } },
      data: { nextValue: n + 1 },
    });
    return `PAY-${String(n).padStart(seq.padding || 5, "0")}`;
  });
}

async function nextTicketNo(t: string) {
  return prisma.$transaction(async (tx) => {
    const maxRow = await tx.ticket.aggregate({
      where: { tenantId: t },
      _max: { ticketNo: true },
    });
    const minNext = (maxRow._max.ticketNo ?? 0) + 1;

    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "TICKET" } },
    });
    if (!seq) {
      await tx.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: "TICKET",
          prefix: "TKT-",
          nextValue: minNext + 1,
          padding: 5,
        },
      });
      return minNext;
    }

    const ticketNo = Math.max(seq.nextValue, minNext);
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "TICKET" } },
      data: { nextValue: ticketNo + 1 },
    });
    return ticketNo;
  });
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
    const soft = await prisma.account.findFirst({
      where: { id: ticket.accountId, tenantId: t, deletedAt: { not: null } },
    });
    if (soft) {
      await prisma.account.update({ where: { id: soft.id }, data: { deletedAt: null } });
      return soft.id;
    }
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
      const soft = await prisma.account.findFirst({
        where: { id: contact.accountId, tenantId: t, deletedAt: { not: null } },
      });
      if (soft) {
        await prisma.account.update({ where: { id: soft.id }, data: { deletedAt: null } });
        return soft.id;
      }
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
    serviceInvoiceId?: string | null;
  },
  markPaid: boolean,
): Promise<Record<string, unknown>> {
  let existing =
    ticket.serviceInvoiceId
      ? await prisma.invoice.findFirst({
          where: { id: ticket.serviceInvoiceId, tenantId: t, deletedAt: null },
        })
      : null;
  if (!existing) {
    existing = await prisma.invoice.findFirst({
      where: { tenantId: t, deletedAt: null, serviceTicketId: ticket.id },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!existing) {
    const recent = await prisma.invoice.findMany({
      where: {
        tenantId: t,
        deletedAt: null,
        ...(ticket.contactId ? { contactId: ticket.contactId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    existing =
      recent.find((inv) => {
        const cf = inv.customFields as Record<string, unknown> | null;
        return cf && String(cf.ticketId ?? "") === ticket.id;
      }) ?? null;
  }
  if (existing) {
    if (markPaid && existing.status !== "PAID") {
      await updateInvoiceStatus(t, existing.id, { status: "PAID" });
    } else if (!markPaid && existing.status === "DRAFT") {
      await updateInvoiceStatus(t, existing.id, { status: "SENT" });
    }
    if (!existing.serviceTicketId) {
      await prisma.invoice.updateMany({
        where: { id: existing.id, tenantId: t },
        data: { serviceTicketId: ticket.id },
      });
    }
    if (ticket.serviceInvoiceId !== existing.id) {
      await prisma.ticket.updateMany({
        where: { id: ticket.id, tenantId: t },
        data: { serviceInvoiceId: existing.id },
      });
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
      description: `Service — ${ticket.subject} (SVC-${String(ticket.ticketNo).padStart(5, "0")})`,
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
    serviceTicketId: ticket.id,
    invoiceDate: new Date(),
    dueDate: new Date(),
    currency: "INR",
    discountTotal: 0,
    notes: `Service job SVC-${String(ticket.ticketNo).padStart(5, "0")}`,
    customFields: {
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo,
      source: "SERVICE_JOB",
    },
    lines: safeLines,
  });

  await prisma.ticket.updateMany({
    where: { id: ticket.id, tenantId: t },
    data: { serviceInvoiceId: String(invoice.id) },
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
  const role = q.auth?.role;
  if (!canCreateTicketsRole(role)) {
    throw new AppError("Your role cannot create service tickets", 403);
  }
  const d = q.body as z.infer<typeof body>;
  const sendWhatsApp = d.sendWhatsApp === true;
  const whatsappNote = d.whatsappNote;
  delete (d as { sendWhatsApp?: boolean }).sendWhatsApp;
  delete (d as { whatsappNote?: string }).whatsappNote;
  // Service desk always creates OPEN tickets with no assignee
  if (isServiceDeskRole(role)) {
    d.assignedToId = null;
    d.receivedByUserId = null;
    d.deliveredByUserId = null;
    d.status = "OPEN";
  }
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
    created_by: q.auth!.userId,
  };

  const subject =
    d.subject?.trim() ||
    (d.assetId
      ? `Service — ${(await prisma.customerAsset.findFirst({ where: { id: d.assetId } }))?.name ?? "machine"}`
      : "Service job");

  const paymentStatus =
    d.paymentStatus ?? derivePaymentStatus(paymentTotal, advanceAmount);

  const assignedToId = isServiceDeskRole(role) ? null : (d.assignedToId ?? d.receivedByUserId ?? null);
  const initialStatus = isServiceDeskRole(role)
    ? "OPEN"
    : assignedToId
      ? "IN_PROGRESS"
      : (d.status ?? "OPEN");

  const row = await prisma.ticket.create({
    data: {
      id: newId(),
      tenantId: t,
      ticketNo,
      subject,
      description: d.description || "Service job",
      priority: d.priority ?? "MEDIUM",
      status: initialStatus,
      contactId: d.contactId ?? null,
      accountId: d.accountId ?? null,
      assignedToId,
      productId: d.productId ?? null,
      assetId: d.assetId ?? null,
      stampingDate,
      nextDueDate,
      odAmount: d.odAmount ?? 0,
      paymentTotal,
      advanceAmount,
      paymentStatus,
      paidAt: paymentStatus === "PAID" ? new Date() : null,
      receivedByUserId: isServiceDeskRole(role) ? null : (d.receivedByUserId ?? d.assignedToId ?? null),
      deliveredByUserId: isServiceDeskRole(role) ? null : (d.deliveredByUserId ?? null),
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
        title: `Service SVC-${String(row.ticketNo).padStart(5, "0")} — ${row.subject}`,
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
    await createNotifications(
      [
        {
          tenantId: t,
          userId: row.assignedToId,
          title: "Ticket assigned to you",
          message: `SVC-${String(row.ticketNo).padStart(5, "0")} ${row.subject}`,
          type: "TICKET_ASSIGNED",
          entityType: "ticket",
          entityId: row.id,
        },
      ],
      q,
    );
    try {
      if (sendWhatsApp) {
        await notifyTicketAssignedEngineer(
          t,
          {
            id: row.id,
            ticketNo: row.ticketNo,
            subject: row.subject,
            contactId: row.contactId,
            assignedToId: row.assignedToId,
          },
          q.auth!.userId,
        );
      }
    } catch (err) {
      console.error("ticket create whatsapp engineer failed", err);
    }
  } else {
    await notifyAdmins(
      t,
      {
        title: "New ticket awaiting assignment",
        message: `SVC-${String(row.ticketNo).padStart(5, "0")} ${row.subject} — assign a service engineer`,
        type: "TICKET_CREATED",
        entityType: "ticket",
        entityId: row.id,
      },
      q,
    );
  }

  let whatsappCustomer: Awaited<ReturnType<typeof notifyTicketCreatedCustomer>> | null = null;
  if (sendWhatsApp && row.contactId) {
    try {
      whatsappCustomer = await notifyTicketCreatedCustomer(
        t,
        {
          id: row.id,
          ticketNo: row.ticketNo,
          subject: row.subject,
          contactId: row.contactId,
        },
        q.auth!.userId,
      );
    } catch (err) {
      console.error("ticket create whatsapp customer failed", err);
    }
  }

  return success(
    r,
    { ...serializeTicket(row as unknown as Record<string, unknown>), whatsapp: whatsappCustomer },
    "Service job created",
    201,
  );
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
  const role = q.auth?.role;
  const d = q.body as Record<string, unknown>;
  const sendWhatsApp = d.sendWhatsApp === true;
  const whatsappNote = typeof d.whatsappNote === "string" ? d.whatsappNote : "";
  delete d.sendWhatsApp;
  delete d.whatsappNote;
  let engineerWhatsapp: Awaited<ReturnType<typeof notifyTicketAssignedEngineer>> | null = null;
  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!existing) throw notFound("Ticket");

  // Role gates
  if ("assignedToId" in d || "receivedByUserId" in d) {
    if (!canAssignTicketsRole(role)) {
      throw new AppError("Only admin can assign tickets", 403);
    }
  }
  if (d.status === "CLOSED" && !canApproveTicketsRole(role)) {
    throw new AppError("Only admin can approve and close completed service", 403);
  }
  if (isScopedEmployeeRole(role)) {
    // Engineer may update payment amounts (advance / total / OD) but cannot reassign,
    // mark PAID, or close the ticket.
    delete d.assignedToId;
    delete d.receivedByUserId;
    delete d.deliveredByUserId;
    delete d.paymentStatus;
    delete d.paymentMethod;
    delete d.paymentReference;
    delete d.paymentProofUrl;
    if (d.status && !["IN_PROGRESS", "PENDING", "RESOLVED"].includes(String(d.status))) {
      throw new AppError("Engineers can set In progress, Waiting, or Mark complete only", 403);
    }
  }
  if (isServiceDeskRole(role)) {
    delete d.assignedToId;
    delete d.receivedByUserId;
    delete d.deliveredByUserId;
    delete d.paymentStatus;
    delete d.paymentMethod;
    if (d.status === "CLOSED" || d.status === "RESOLVED") {
      throw new AppError("Service desk cannot complete or close tickets", 403);
    }
  }

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
    "paymentMethod",
    "paymentReference",
    "paymentProofUrl",
    "signatureUrl",
    "receivedByUserId",
    "deliveredByUserId",
  ] as const;
  for (const key of scalarKeys) {
    if (key in d) data[key] = d[key];
  }

  const prevStatus = existing.status;
  let nextStatus = typeof d.status === "string" ? d.status : prevStatus;

  // Admin assign → move to IN_PROGRESS when assigning from OPEN
  if (
    canAssignTicketsRole(role) &&
    "assignedToId" in d &&
    d.assignedToId &&
    !("status" in d) &&
    existing.status === "OPEN"
  ) {
    data.status = "IN_PROGRESS";
    nextStatus = "IN_PROGRESS";
  }

  const nextAssignee =
    "assignedToId" in d
      ? (d.assignedToId as string | null)
      : "receivedByUserId" in d
        ? ((d.receivedByUserId as string | null) ?? existing.assignedToId)
        : existing.assignedToId;

  if ("status" in d || data.status) {
    assertStatusTransition(prevStatus, String(nextStatus), {
      assignedToId: nextAssignee,
      isAdmin: canApproveTicketsRole(role),
    });
  }

  if (nextStatus === "CLOSED") {
    const payTotal = "paymentTotal" in d ? num(d.paymentTotal) : num(existing.paymentTotal);
    const adv = "advanceAmount" in d ? num(d.advanceAmount) : num(existing.advanceAmount);
    const payStatus =
      "paymentStatus" in d && typeof d.paymentStatus === "string"
        ? d.paymentStatus
        : String(existing.paymentStatus);
    assertCanClosePayment({
      paymentStatus: payStatus,
      paymentTotal: payTotal,
      advanceAmount: adv,
    });
    if (isFreeJob(payTotal, adv) && payStatus !== "PAID") {
      data.paymentStatus = "PAID";
      data.paidAt = new Date();
    }
  }

  if (d.status === "RESOLVED") data.resolvedAt = new Date();
  if (d.status === "CLOSED" || data.status === "CLOSED") data.closedAt = new Date();
  if ("signatureUrl" in d && d.signatureUrl) {
    data.customerSignedAt = new Date();
  }
  if ("stampingDate" in d) data.stampingDate = parseDate(d.stampingDate);
  if ("nextDueDate" in d) data.nextDueDate = parseDate(d.nextDueDate);

  const existingCf = ticketCf(existing.customFields);
  if ("category" in d || "channel" in d || "customFields" in d || "paymentTotal" in d) {
    const mergedCf: Record<string, unknown> = {
      ...existingCf,
      ...((d.customFields as Record<string, unknown> | undefined) ?? {}),
      ...("category" in d ? { category: d.category ?? null } : {}),
      ...("channel" in d ? { channel: d.channel ?? null } : {}),
    };
    if ("paymentTotal" in d) {
      const spareTotal = Number(mergedCf.sparePartsTotal) || 0;
      mergedCf.baseServiceCharge = Math.max(0, num(d.paymentTotal) - spareTotal);
      mergedCf.sparePartsTotal = spareTotal;
    }
    // Day notes: ensure ISO `at` for timeline
    if (Array.isArray(mergedCf.dayNotes)) {
      mergedCf.dayNotes = (mergedCf.dayNotes as Array<Record<string, unknown>>).map((n) => ({
        ...n,
        at: n.at ?? n.createdAt ?? (n.date ? `${String(n.date)}T12:00:00.000Z` : new Date().toISOString()),
      }));
    }
    data.customFields = mergedCf;
  }

  const nextPaymentTotal = "paymentTotal" in d ? num(d.paymentTotal) : num(existing.paymentTotal);
  const nextAdvance = "advanceAmount" in d ? num(d.advanceAmount) : num(existing.advanceAmount);
  if ("paymentStatus" in d && typeof d.paymentStatus === "string") {
    data.paymentStatus = d.paymentStatus;
    if (d.paymentStatus === "PAID") {
      assertPaymentCollection({
        paymentMethod:
          ("paymentMethod" in d ? (d.paymentMethod as string | null) : existing.paymentMethod) ?? null,
        paymentReference:
          ("paymentReference" in d
            ? (d.paymentReference as string | null)
            : existing.paymentReference) ?? null,
        paymentProofUrl:
          ("paymentProofUrl" in d
            ? (d.paymentProofUrl as string | null)
            : existing.paymentProofUrl) ?? null,
        paymentTotal: nextPaymentTotal,
      });
      data.paidAt = new Date();
      if (nextPaymentTotal > nextAdvance) data.advanceAmount = nextPaymentTotal;
    } else if (existing.paymentStatus === "PAID") {
      data.paidAt = null;
    }
  } else if ("paymentTotal" in d || "advanceAmount" in d) {
    // Never escalate to PAID from typing amounts — use POST /mark-paid
    if (existing.paymentStatus !== "PAID") {
      data.paymentStatus = derivePaymentStatus(nextPaymentTotal, nextAdvance);
      data.paidAt = null;
    }
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
          title: `Service SVC-${String(ticket.ticketNo).padStart(5, "0")} — ${ticket.subject}`.slice(0, 191),
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
    const notifRows = [
      {
        tenantId: t,
        userId: ticket.assignedToId,
        title: prevAssignee ? "Ticket reassigned to you" : "Ticket assigned to you",
        message: `SVC-${String(ticket.ticketNo).padStart(5, "0")} ${ticket.subject}`,
        type: prevAssignee ? "TICKET_REASSIGNED" : "TICKET_ASSIGNED",
        entityType: "ticket",
        entityId: ticket.id,
      },
    ];
    if (prevAssignee && prevAssignee !== ticket.assignedToId) {
      notifRows.push({
        tenantId: t,
        userId: prevAssignee,
        title: "Ticket reassigned away",
        message: `SVC-${String(ticket.ticketNo).padStart(5, "0")} was reassigned to another engineer`,
        type: "TICKET_REASSIGNED",
        entityType: "ticket",
        entityId: ticket.id,
      });
    }
    await createNotifications(notifRows, q);
    try {
      if (sendWhatsApp) {
        engineerWhatsapp = await notifyTicketAssignedEngineer(
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
    } catch (err) {
      console.error("ticket assign whatsapp engineer failed", err);
    }
  }

  // Engineer / status progress → admins
  if (
    "customFields" in d &&
    prevStatus !== "RESOLVED" &&
    prevStatus !== "CLOSED" &&
    ticket.status !== "RESOLVED" &&
    ticket.status !== "CLOSED"
  ) {
    await notifyAdmins(
      t,
      {
        title: "Ticket progress updated",
        message: `SVC-${String(ticket.ticketNo).padStart(5, "0")} — engineer updated work notes`,
        type: "TICKET_PROGRESS",
        entityType: "ticket",
        entityId: ticket.id,
      },
      q,
    );
  }

  if (ticket.status === "RESOLVED" && prevStatus !== "RESOLVED" && prevStatus !== "CLOSED") {
    await notifyAdmins(
      t,
      {
        title: "Pending approval",
        message: `SVC-${String(ticket.ticketNo).padStart(5, "0")} ${ticket.subject} — engineer marked complete`,
        type: "TICKET_PENDING_APPROVAL",
        entityType: "ticket",
        entityId: ticket.id,
      },
      q,
    );
  }

  if (ticket.status === "CLOSED" && prevStatus !== "CLOSED") {
    const closeNotifs = [];
    if (ticket.assignedToId) {
      closeNotifs.push({
        tenantId: t,
        userId: ticket.assignedToId,
        title: "Ticket approved & closed",
        message: `SVC-${String(ticket.ticketNo).padStart(5, "0")} — admin approved completion`,
        type: "TICKET_CLOSED",
        entityType: "ticket",
        entityId: ticket.id,
      });
    }
    const cf = (ticket.customFields as Record<string, unknown> | null) ?? {};
    const createdBy = typeof cf.created_by === "string" ? cf.created_by : null;
    if (createdBy && createdBy !== ticket.assignedToId) {
      closeNotifs.push({
        tenantId: t,
        userId: createdBy,
        title: "Ticket closed",
        message: `SVC-${String(ticket.ticketNo).padStart(5, "0")} — service completed and approved`,
        type: "TICKET_CLOSED",
        entityType: "ticket",
        entityId: ticket.id,
      });
    }
    if (closeNotifs.length) await createNotifications(closeNotifs, q);
  }

  const stamp = "stampingDate" in d ? parseDate(d.stampingDate) : ticket.stampingDate;
  const due = "nextDueDate" in d ? parseDate(d.nextDueDate) : ticket.nextDueDate;
  const becameResolved =
    ticket.status === "RESOLVED" && prevStatus !== "RESOLVED" && prevStatus !== "CLOSED";
  const becameClosed = ticket.status === "CLOSED" && prevStatus !== "CLOSED";
  if (becameResolved || becameClosed || "stampingDate" in d || "nextDueDate" in d) {
    await syncAssetDates(t, ticket.assetId, stamp, due);
  }

  // Customer WhatsApp — only when UI confirmed sendWhatsApp
  let whatsapp: Awaited<ReturnType<typeof notifyTicketCompleted>> | null = null;
  if (sendWhatsApp) {
    if (becameClosed) {
      whatsapp = await notifyTicketCompleted(
        t,
        {
          id: ticket.id,
          ticketNo: ticket.ticketNo,
          subject: ticket.subject,
          contactId: ticket.contactId,
          assignedToId: ticket.assignedToId,
          paymentTotal: num(ticket.paymentTotal),
          description: ticket.description,
        },
        q.auth!.userId,
        whatsappNote || ticket.subject,
      );
    } else if ("status" in d && prevStatus !== ticket.status && ticket.status !== "CLOSED") {
      whatsapp = await notifyTicketStatusUpdate(
        t,
        {
          id: ticket.id,
          ticketNo: ticket.ticketNo,
          subject: ticket.subject,
          status: ticket.status,
          contactId: ticket.contactId,
          assignedToId: ticket.assignedToId,
        },
        whatsappNote || `Status updated to ${ticket.status}`,
        q.auth!.userId,
      );
    }
  }

  return success(r, {
    ...serializeTicket(ticket as unknown as Record<string, unknown>),
    whatsapp,
    engineerWhatsapp,
  });
});

ticketsRouter.post("/:id/mark-paid", validate(markPaidSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  if (!canApproveTicketsRole(q.auth?.role)) {
    throw new AppError("Only admin can mark tickets paid in full", 403);
  }
  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!existing) throw notFound("Ticket");

  const bodyPay = q.body as {
    paymentMethod: "CASH" | "UPI" | "NEFT" | "RTGS" | "CHEQUE" | "CARD" | "OTHER";
    paymentReference?: string | null;
    paymentProofUrl?: string | null;
    sendWhatsApp?: boolean;
    paymentTotal?: number;
    advanceAmount?: number;
  };
  const sendWhatsApp = bodyPay.sendWhatsApp === true;
  const paymentTotal = Math.max(
    bodyPay.paymentTotal != null ? num(bodyPay.paymentTotal) : num(existing.paymentTotal),
    bodyPay.advanceAmount != null ? num(bodyPay.advanceAmount) : num(existing.advanceAmount),
    0,
  );
  const advanceAmount =
    bodyPay.advanceAmount != null
      ? Math.min(num(bodyPay.advanceAmount), paymentTotal)
      : Math.min(num(existing.advanceAmount), paymentTotal);
  assertPaymentCollection({
    paymentMethod: bodyPay.paymentMethod,
    paymentReference: bodyPay.paymentReference,
    paymentProofUrl: bodyPay.paymentProofUrl,
    paymentTotal,
  });

  await prisma.ticket.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      paymentStatus: "PAID",
      paymentTotal,
      advanceAmount: paymentTotal, // fully paid — advance equals total
      odAmount: 0,
      paidAt: new Date(),
      paymentMethod: bodyPay.paymentMethod,
      paymentReference: bodyPay.paymentReference?.trim() || null,
      paymentProofUrl: bodyPay.paymentProofUrl?.trim() || null,
    },
  });
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t } });
  if (!ticket) throw notFound("Ticket");

  let invoice: Record<string, unknown> | null = null;
  let invoiceError: string | null = null;
  try {
    if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
      invoice = await ensureServiceInvoice(t, q.auth!.userId!, ticket, true);
    }
  } catch (err) {
    invoiceError = err instanceof Error ? err.message : "Could not create invoice";
  }

  try {
    const paymentNumber = await nextPaymentNo(t);
    await prisma.payment.create({
      data: {
        id: newId(),
        tenantId: t,
        paymentNumber,
        invoiceId: invoice?.id ? String(invoice.id) : ticket.serviceInvoiceId,
        accountId: ticket.accountId,
        direction: "INBOUND",
        method: bodyPay.paymentMethod,
        amount: paymentTotal,
        currency: "INR",
        paidAt: new Date(),
        referenceNo: bodyPay.paymentReference?.trim() || null,
        notes: `Service SVC-${String(ticket.ticketNo).padStart(5, "0")}${
          bodyPay.paymentProofUrl ? ` · proof: ${bodyPay.paymentProofUrl}` : ""
        }`.slice(0, 255),
        createdById: q.auth!.userId!,
      },
    });
  } catch (err) {
    console.error("service payment ledger write failed", err);
  }

  const whatsapp =
    sendWhatsApp
      ? await notifyTicketPaidFully(
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
        )
      : null;

  return success(
    r,
    {
      ...serializeTicket(ticket as unknown as Record<string, unknown>),
      whatsapp,
      invoice,
      invoiceError:
        invoiceError ||
        (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED"
          ? "Marked paid — create invoice after job is marked complete"
          : null),
    },
    "Marked paid in full",
  );
});

ticketsRouter.post("/:id/payment-due", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  if (!canApproveTicketsRole(q.auth?.role)) {
    throw new AppError("Only admin can send payment-due notices", 403);
  }
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  // Template 5 (payment_due_customer) intentionally not used
  const whatsapp = await notifyPaymentDue();
  return success(
    r,
    { ...serializeTicket(ticket as unknown as Record<string, unknown>), whatsapp },
    "Payment-due WhatsApp template is disabled",
  );
});

ticketsRouter.post("/:id/invoice", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  if (!canApproveTicketsRole(q.auth?.role)) {
    throw new AppError("Only admin can create and send invoices", 403);
  }
  const sendWhatsApp = (q.body as { sendWhatsApp?: boolean })?.sendWhatsApp === true;
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  assertCanInvoice({
    status: ticket.status,
    paymentTotal: num(ticket.paymentTotal),
    advanceAmount: num(ticket.advanceAmount),
  });
  const paid = ticket.paymentStatus === "PAID";
  const invoice = await ensureServiceInvoice(t, q.auth!.userId!, ticket, paid);
  let whatsapp: Awaited<ReturnType<typeof notifyTicketPaidFully>> | null = null;
  if (sendWhatsApp && paid) {
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
  }
  return success(
    r,
    { ...serializeTicket(ticket as unknown as Record<string, unknown>), invoice, whatsapp },
    paid ? "Invoice created" : "Invoice created (payment still due — payment-due WhatsApp disabled)",
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
  if (!canApproveTicketsRole(q.auth?.role)) {
    throw new AppError("Only admin can delete service tickets", 403);
  }
  const updated = await prisma.ticket.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!updated.count) throw notFound("Ticket");
  return success(r, null, "Service job deleted");
});
