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
import { AppError, notFound } from "../../common/errors.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { isScopedEmployeeRole } from "../../common/utils/scope.js";

const body = z.object({
  type: z.enum(["CALL", "EMAIL", "MEETING", "TASK", "NOTE", "WHATSAPP", "VISIT", "DEMO"]),
  title: z.string().min(1).max(191),
  description: z.string().nullable().optional(),
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "OVERDUE"]).optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  durationMinutes: z.coerce.number().int().nonnegative().nullable().optional(),
  outcome: z.string().nullable().optional(),
  leadId: z.string().min(1).max(36).nullable().optional(),
  contactId: z.string().min(1).max(36).nullable().optional(),
  dealId: z.string().min(1).max(36).nullable().optional(),
  accountId: z.string().min(1).max(36).nullable().optional(),
  assignedToId: z.string().min(1).max(36).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body, query: z.any(), params: z.any() });
const updateSchema = z.object({ body: body.partial(), query: z.any(), params });
const idSchema = z.object({ body: z.any(), query: z.any(), params });

export const activitiesRouter = Router();
activitiesRouter.use(authenticate, requireTenant);

activitiesRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const p = pagination(q.query);
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.query.type) where.type = String(q.query.type);
  if (q.query.status) where.status = String(q.query.status);
  if (q.query.assignedToId) where.assignedToId = String(q.query.assignedToId);
  if (q.query.mine === "1" || q.query.mine === "true") {
    where.assignedToId = q.auth!.userId;
  }
  // Agents only ever see their own queue (cannot browse teammates)
  if (isScopedEmployeeRole(q.auth?.role)) {
    where.assignedToId = q.auth!.userId;
  }
  if (q.query.contactId) where.contactId = String(q.query.contactId);
  if (q.query.dealId) where.dealId = String(q.query.dealId);

  const [items, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.activity.count({ where }),
  ]);

  const userIds = [...new Set(items.map((i) => i.assignedToId).filter(Boolean))] as string[];
  const contactIds = [...new Set(items.map((i) => i.contactId).filter(Boolean))] as string[];
  const dealIds = [...new Set(items.map((i) => i.dealId).filter(Boolean))] as string[];
  const [users, contacts, deals] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId: t, id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [],
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: t, id: { in: contactIds } },
          select: { id: true, name: true },
        })
      : [],
    dealIds.length
      ? prisma.deal.findMany({
          where: { tenantId: t, id: { in: dealIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const cMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const dMap = Object.fromEntries(deals.map((d) => [d.id, d]));

  return success(
    r,
    pageResult(
      items.map((item) => ({
        ...item,
        assignee: item.assignedToId ? uMap[item.assignedToId] ?? null : null,
        contact: item.contactId ? cMap[item.contactId] ?? null : null,
        deal: item.dealId ? dMap[item.dealId] ?? null : null,
      })),
      total,
      p.page,
      p.limit,
    ),
  );
});

activitiesRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body as z.infer<typeof body>;
  if (d.assignedToId) {
    const u = await prisma.user.findFirst({
      where: { id: d.assignedToId, tenantId: t, deletedAt: null },
    });
    if (!u) throw notFound("Assignee");
  }
  if (d.contactId) {
    const c = await prisma.contact.findFirst({
      where: { id: d.contactId, tenantId: t, deletedAt: null },
    });
    if (!c) throw notFound("Contact");
  }
  if (d.dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: d.dealId, tenantId: t, deletedAt: null },
    });
    if (!deal) throw notFound("Deal");
  }
  const row = await prisma.activity.create({
    data: {
      id: newId(),
      tenantId: t,
      type: d.type,
      title: d.title.trim(),
      description: d.description,
      status: d.status ?? "PENDING",
      scheduledAt: d.scheduledAt,
      durationMinutes: d.durationMinutes,
      outcome: d.outcome,
      leadId: d.leadId,
      contactId: d.contactId,
      dealId: d.dealId,
      accountId: d.accountId,
      assignedToId: d.assignedToId ?? q.auth!.userId,
      customFields: (d.customFields as object | undefined) ?? undefined,
    },
  });
  return success(r, row, "Activity created", 201);
});

activitiesRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const d = q.body as Partial<z.infer<typeof body>>;
  const data: Record<string, unknown> = { ...d };
  if (d.status === "COMPLETED" && !("completedAt" in d)) {
    data.completedAt = new Date();
  }
  const updated = await prisma.activity.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data,
  });
  if (!updated.count) throw notFound("Activity");
  const row = await prisma.activity.findFirst({ where: { id, tenantId: t } });
  return success(r, row);
});

activitiesRouter.post("/:id/complete", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const existing = await prisma.activity.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("Activity");
  if (
    isScopedEmployeeRole(q.auth?.role) &&
    existing.assignedToId &&
    existing.assignedToId !== q.auth!.userId
  ) {
    throw new AppError("You can only complete tasks assigned to you", 403);
  }
  const updated = await prisma.activity.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (!updated.count) throw notFound("Activity");
  return success(r, await prisma.activity.findFirst({ where: { id, tenantId: t } }), "Completed");
});

activitiesRouter.delete("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const updated = await prisma.activity.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!updated.count) throw notFound("Activity");
  return success(r, null, "Activity deleted");
});
