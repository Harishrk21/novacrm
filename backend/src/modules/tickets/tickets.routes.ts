import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
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

const body = z.object({
  subject: z.string().min(1).max(255),
  description: z.string().min(1),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  contactId: z.string().min(1).max(36).nullable().optional(),
  accountId: z.string().min(1).max(36).nullable().optional(),
  assignedToId: z.string().min(1).max(36).nullable().optional(),
  productId: z.string().min(1).max(36).nullable().optional(),
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

export const ticketsRouter = Router();
ticketsRouter.use(authenticate, requireTenant);

ticketsRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const p = pagination(q.query);
  const where: any = { tenantId: t, deletedAt: null };
  if (q.query.status) where.status = q.query.status;
  if (q.query.priority) where.priority = q.query.priority;
  if (q.query.assignedToId) where.assignedToId = String(q.query.assignedToId);
  if (isScopedEmployeeRole(q.auth?.role)) {
    where.assignedToId = q.auth!.userId;
  }
  if (q.query.search) {
    where.OR = [
      { subject: { contains: String(q.query.search) } },
      { description: { contains: String(q.query.search) } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.ticket.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: "desc" } }),
    prisma.ticket.count({ where }),
  ]);
  return success(r, pageResult(items, total, p.page, p.limit));
});

ticketsRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body as z.infer<typeof body> & { category?: string; channel?: string; slaHours?: number };
  if (d.contactId && !(await prisma.contact.findFirst({ where: { id: d.contactId, tenantId: t, deletedAt: null } })))
    throw notFound("Contact");
  if (d.accountId && !(await prisma.account.findFirst({ where: { id: d.accountId, tenantId: t, deletedAt: null } })))
    throw notFound("Account");
  if (d.productId && !(await prisma.product.findFirst({ where: { id: d.productId, tenantId: t, deletedAt: null } })))
    throw notFound("Product");
  const ticketNo = await nextTicketNo(t);
  const slaDueAt = d.slaHours ? new Date(Date.now() + d.slaHours * 3600_000) : null;
  const customFields = {
    ...(d.customFields ?? {}),
    ...(d.category ? { category: d.category } : {}),
    ...(d.channel ? { channel: d.channel } : {}),
  };
  const { category: _c, channel: _ch, slaHours: _s, ...rest } = d;
  const row = await prisma.ticket.create({
    data: {
      ...rest,
      id: newId(),
      tenantId: t,
      ticketNo,
      slaDueAt,
      customFields,
      description: d.description,
      subject: d.subject,
    },
  });
  return success(r, row, "Ticket created", 201);
});

ticketsRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!ticket) throw notFound("Ticket");
  const messages = await prisma.ticketMessage.findMany({
    where: { tenantId: t, ticketId: id },
    orderBy: { createdAt: "asc" },
  });
  return success(r, { ...ticket, messages });
});

ticketsRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const d = q.body as any;
  const data: any = { ...d };
  if (d.status === "RESOLVED") data.resolvedAt = new Date();
  if (d.status === "CLOSED") data.closedAt = new Date();
  if (d.category || d.channel) {
    const existing = await prisma.ticket.findFirst({ where: { id, tenantId: t, deletedAt: null } });
    if (!existing) throw notFound("Ticket");
    data.customFields = {
      ...((existing.customFields as object) ?? {}),
      ...(d.category ? { category: d.category } : {}),
      ...(d.channel ? { channel: d.channel } : {}),
      ...(d.customFields ?? {}),
    };
    delete data.category;
    delete data.channel;
  }
  delete data.slaHours;
  const updated = await prisma.ticket.updateMany({ where: { id, tenantId: t, deletedAt: null }, data });
  if (!updated.count) throw notFound("Ticket");
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: t } });
  return success(r, ticket);
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
