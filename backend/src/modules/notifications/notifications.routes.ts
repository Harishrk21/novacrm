import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { notFound } from "../../common/errors.js";

const listQuery = z.object({
  unreadOnly: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

const listSchema = z.object({ body: z.any(), query: listQuery, params: z.any() });
const idSchema = z.object({
  body: z.any(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const notificationsRouter = Router();
notificationsRouter.use(authenticate, requireTenant);

notificationsRouter.get("/", validate(listSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const unreadOnly = String(q.query.unreadOnly ?? "") === "true" || q.query.unreadOnly === "1";
  const limit = Math.min(100, Number(q.query.limit ?? 50) || 50);
  const where = {
    tenantId: t,
    userId: uid,
    ...(unreadOnly ? { isRead: false } : {}),
  };
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { tenantId: t, userId: uid, isRead: false } }),
  ]);
  return success(r, {
    unreadCount,
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      entityType: n.entityType,
      entityId: n.entityId,
      isRead: n.isRead,
      readAt: n.readAt,
      createdAt: n.createdAt,
      href:
        n.entityType === "ticket" && n.entityId
          ? `/tickets/${n.entityId}`
          : n.entityType === "lead" && n.entityId
            ? `/sale-tracking/${n.entityId}`
            : n.entityType === "invoice_lead" && n.entityId
              ? `/erp/invoices?open=1&contactId=${n.entityId}`
              : "/notifications",
    })),
  });
});

notificationsRouter.patch("/:id/read", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const id = paramId(q);
  const updated = await prisma.notification.updateMany({
    where: { id, tenantId: t, userId: uid },
    data: { isRead: true, readAt: new Date() },
  });
  if (!updated.count) throw notFound("Notification");
  return success(r, { id, isRead: true });
});

notificationsRouter.post("/read-all", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const result = await prisma.notification.updateMany({
    where: { tenantId: t, userId: uid, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return success(r, { updated: result.count });
});
