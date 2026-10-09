import type { Request } from "express";
import type { Server } from "socket.io";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { logger } from "../../config/logger.js";

export type NotifyInput = {
  tenantId: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
};

/** Bound from server.ts so services without `req` can still push live updates. */
let boundIo: Server | null = null;

export function bindNotificationIo(io: Server) {
  boundIo = io;
}

function getIo(req?: Request): Server | null {
  try {
    const fromReq = (req?.app?.get("io") as Server | undefined) ?? null;
    return fromReq ?? boundIo;
  } catch {
    return boundIo;
  }
}

/** Match both `lead` and `Lead` (legacy casing). */
function entityTypeVariants(entityType: string): string[] {
  const base = entityType.trim();
  if (!base) return [entityType];
  const lower = base.toLowerCase();
  const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([base, lower, titled])];
}

export async function createNotifications(
  items: NotifyInput[],
  req?: Request,
): Promise<void> {
  if (!items.length) return;
  const unique = new Map<string, NotifyInput>();
  for (const item of items) {
    if (!item.userId) continue;
    unique.set(`${item.userId}:${item.type}:${item.entityId ?? ""}:${item.title}`, item);
  }
  const rows = [...unique.values()];
  try {
    await prisma.notification.createMany({
      data: rows.map((n) => ({
        id: newId(),
        tenantId: n.tenantId,
        userId: n.userId,
        title: n.title.slice(0, 160),
        message: n.message.slice(0, 512),
        type: n.type.slice(0, 64),
        entityType: n.entityType ?? null,
        entityId: n.entityId ?? null,
      })),
    });
  } catch (err) {
    logger.warn("Failed to persist notifications", { err });
    return;
  }

  const io = getIo(req);
  if (!io) return;
  for (const n of rows) {
    io.to(`user:${n.userId}`).emit("notification", {
      title: n.title,
      message: n.message,
      type: n.type,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * Update earlier workflow notifications for an entity (e.g. awaiting assign → engineer assigned)
 * and mark them read so the inbox stays current.
 */
export async function resolveEntityNotifications(
  opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    /** Only match these types (e.g. TICKET_CREATED, TICKET_PENDING_APPROVAL) */
    types?: string[];
    title?: string;
    message?: string;
    /** Replace type so filters / badges reflect the new status */
    nextType?: string;
    markRead?: boolean;
  },
  req?: Request,
): Promise<number> {
  const where = {
    tenantId: opts.tenantId,
    entityType: { in: entityTypeVariants(opts.entityType) },
    entityId: opts.entityId,
    ...(opts.types?.length ? { type: { in: opts.types } } : {}),
  };
  const existing = await prisma.notification.findMany({
    where,
    select: { id: true, userId: true },
  });
  if (!existing.length) return 0;

  const data: {
    title?: string;
    message?: string;
    type?: string;
    isRead?: boolean;
    readAt?: Date;
  } = {};
  if (opts.title) data.title = opts.title.slice(0, 160);
  if (opts.message) data.message = opts.message.slice(0, 512);
  if (opts.nextType) data.type = opts.nextType.slice(0, 64);
  if (opts.markRead !== false) {
    data.isRead = true;
    data.readAt = new Date();
  }

  await prisma.notification.updateMany({
    where: { id: { in: existing.map((r) => r.id) } },
    data,
  });

  emitLifecycle(existing.map((r) => r.userId), {
    event: "notification:updated",
    entityType: opts.entityType,
    entityId: opts.entityId,
    title: opts.title ?? null,
    type: opts.nextType ?? null,
    ids: existing.map((r) => r.id),
  }, req);
  return existing.length;
}

/**
 * When the related task is done — clear actionable alerts from the inbox in real time.
 * - mode "resolve" (default): mark read + rewrite as Done
 * - mode "remove": delete rows (best for pool / pending alerts)
 */
export async function expireEntityNotifications(
  opts: {
    tenantId: string;
    entityType: string;
    entityId: string;
    types?: string[];
    /** resolve = keep as read history; remove = delete from inbox */
    mode?: "resolve" | "remove";
    title?: string;
    message?: string;
    nextType?: string;
  },
  req?: Request,
): Promise<number> {
  const mode = opts.mode ?? "resolve";
  const where = {
    tenantId: opts.tenantId,
    entityType: { in: entityTypeVariants(opts.entityType) },
    entityId: opts.entityId,
    ...(opts.types?.length ? { type: { in: opts.types } } : {}),
  };
  const existing = await prisma.notification.findMany({
    where,
    select: { id: true, userId: true },
  });
  if (!existing.length) return 0;

  const ids = existing.map((r) => r.id);
  if (mode === "remove") {
    await prisma.notification.deleteMany({ where: { id: { in: ids } } });
  } else {
    const doneTitle = (opts.title ?? "Done").slice(0, 160);
    await prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: {
        isRead: true,
        readAt: new Date(),
        title: doneTitle.startsWith("✓") ? doneTitle : `✓ ${doneTitle}`,
        ...(opts.message ? { message: opts.message.slice(0, 512) } : {}),
        ...(opts.nextType ? { type: opts.nextType.slice(0, 64) } : {}),
      },
    });
  }

  emitLifecycle(existing.map((r) => r.userId), {
    event: "notification:expired",
    entityType: opts.entityType,
    entityId: opts.entityId,
    title: opts.title ?? null,
    type: opts.nextType ?? null,
    ids,
    removed: mode === "remove",
  }, req);
  return existing.length;
}

function emitLifecycle(
  userIds: string[],
  payload: {
    event: "notification:updated" | "notification:expired";
    entityType: string;
    entityId: string;
    title: string | null;
    type: string | null;
    ids: string[];
    removed?: boolean;
  },
  req?: Request,
) {
  const io = getIo(req);
  if (!io) return;
  for (const userId of [...new Set(userIds)]) {
    io.to(`user:${userId}`).emit(payload.event, {
      entityType: payload.entityType,
      entityId: payload.entityId,
      title: payload.title,
      type: payload.type,
      ids: payload.ids,
      removed: payload.removed ?? false,
    });
  }
}

export async function userIdsByRoleCodes(tenantId: string, codes: string[]) {
  const roles = await prisma.role.findMany({
    where: { tenantId, code: { in: codes }, deletedAt: null },
    select: { id: true },
  });
  if (!roles.length) return [] as string[];
  const users = await prisma.user.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: "ACTIVE",
      roleId: { in: roles.map((r) => r.id) },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function notifyAdmins(
  tenantId: string,
  payload: Omit<NotifyInput, "tenantId" | "userId">,
  req?: Request,
) {
  const ids = await userIdsByRoleCodes(tenantId, ["ADMIN", "MANAGER"]);
  await createNotifications(
    ids.map((userId) => ({ ...payload, tenantId, userId })),
    req,
  );
}

/** Admin + manager + service desk — engineer marked complete, needs Approve & close */
export async function notifyTicketApprovers(
  tenantId: string,
  payload: Omit<NotifyInput, "tenantId" | "userId">,
  req?: Request,
) {
  const ids = await userIdsByRoleCodes(tenantId, ["ADMIN", "MANAGER", "SERVICE_DESK"]);
  await createNotifications(
    ids.map((userId) => ({ ...payload, tenantId, userId })),
    req,
  );
}

/** Admin + warehouse/billing — proforma / sale-ready notifications */
export async function notifyBillingTeam(
  tenantId: string,
  payload: Omit<NotifyInput, "tenantId" | "userId">,
  req?: Request,
) {
  const ids = await userIdsByRoleCodes(tenantId, ["ADMIN", "MANAGER", "WAREHOUSE"]);
  await createNotifications(
    ids.map((userId) => ({ ...payload, tenantId, userId })),
    req,
  );
}

/** Service engineers only — open job pool / claim alerts */
export async function notifyServiceEngineers(
  tenantId: string,
  payload: Omit<NotifyInput, "tenantId" | "userId">,
  req?: Request,
) {
  const ids = await userIdsByRoleCodes(tenantId, ["SERVICE_ENGINEER"]);
  await createNotifications(
    ids.map((userId) => ({ ...payload, tenantId, userId })),
    req,
  );
  return ids;
}

/** Service desk + engineers + admins — intake handoffs from sales */
export async function notifyServiceTeam(
  tenantId: string,
  payload: Omit<NotifyInput, "tenantId" | "userId">,
  req?: Request,
) {
  const ids = await userIdsByRoleCodes(tenantId, [
    "SERVICE_DESK",
    "SERVICE_ENGINEER",
    "ADMIN",
    "MANAGER",
  ]);
  await createNotifications(
    ids.map((userId) => ({ ...payload, tenantId, userId })),
    req,
  );
  return ids;
}
