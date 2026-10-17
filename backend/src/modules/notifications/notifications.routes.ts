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

/** In-app Open target — keep in sync with src/lib/notificationHref.ts */
function resolveNotificationHref(
  n: {
    type?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  },
  role?: string | null,
): string {
  const type = String(n.type ?? "").toUpperCase();
  const entityType = String(n.entityType ?? "").toLowerCase();
  const entityId = n.entityId ? String(n.entityId) : "";
  const roleCode = String(role ?? "").toUpperCase();
  const warehouseish =
    roleCode === "WAREHOUSE" || roleCode === "ADMIN" || roleCode === "MANAGER";
  const isLeadEntity =
    entityType === "lead" || entityType === "leads" || entityType === "enquiry";

  if (type === "REQUISITION_PENDING" || type === "REQUISITION_REJECTED") {
    if (entityId) {
      return `/sale-tracking?queue=requisitions&reqId=${encodeURIComponent(entityId)}`;
    }
    return "/sale-tracking?queue=requisitions";
  }

  if (
    type === "REQUISITION_APPROVED" ||
    type === "REQUISITION_INVENTORY" ||
    type === "REQUISITION_SHIPPED" ||
    type === "REQUISITION_FULFILLED" ||
    type === "REQUISITION_SALE_DC" ||
    type.includes("REQUISITION") ||
    entityType === "sales_requisition"
  ) {
    if (warehouseish) return "/erp/releases";
    if (isLeadEntity && entityId) return `/sale-tracking/${entityId}`;
    if (entityId) {
      return `/sale-tracking?queue=requisitions&reqId=${encodeURIComponent(entityId)}`;
    }
    return "/sale-tracking?queue=requisitions";
  }

  if (
    type === "LEAD_FOLLOWUP" ||
    type === "LEAD_FOLLOWUP_DUE" ||
    type.includes("FOLLOWUP")
  ) {
    if (entityId) return `/sale-tracking/${entityId}`;
    return "/workqueue";
  }

  if (
    isLeadEntity ||
    type.startsWith("LEAD_") ||
    type === "LEAD_DAY_UPDATE" ||
    type === "LEAD_STATUS_CHANGE"
  ) {
    if (entityId) return `/sale-tracking/${entityId}`;
    return "/sale-tracking";
  }

  if (entityType === "ticket" || type.includes("TICKET")) {
    if (entityId) return `/tickets/${entityId}`;
    return "/tickets";
  }

  if (entityType === "activity" || type.includes("TASK") || type.includes("CALL")) {
    if (isLeadEntity && entityId) return `/sale-tracking/${entityId}`;
    return "/workqueue";
  }

  if (entityType === "invoice_lead" && entityId) {
    return `/erp/invoices?open=1&contactId=${encodeURIComponent(entityId)}`;
  }
  if (entityType === "contact" && entityId) return `/contacts/${entityId}`;
  if (entityType === "deal" && entityId) return `/deals/${entityId}`;

  if (
    type === "DEMO_ISSUE" ||
    type === "DEMO_RETURN" ||
    type.startsWith("DEMO_") ||
    entityType === "stock_unit"
  ) {
    return "/erp/stock?view=demo";
  }

  return "/workqueue";
}

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
  const roleCode = q.auth?.role ?? null;

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
      expired:
        String(n.title ?? "").trim().startsWith("✓") ||
        String(n.title ?? "").trim().startsWith("✔"),
      href: resolveNotificationHref(n, roleCode),
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

notificationsRouter.delete("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const id = paramId(q);
  const deleted = await prisma.notification.deleteMany({
    where: { id, tenantId: t, userId: uid },
  });
  if (!deleted.count) throw notFound("Notification");
  return success(r, { id, deleted: true });
});

notificationsRouter.post("/clear-all", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const result = await prisma.notification.deleteMany({
    where: { tenantId: t, userId: uid },
  });
  return success(r, { deleted: result.count });
});
