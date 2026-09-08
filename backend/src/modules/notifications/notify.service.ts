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

function getIo(req?: Request): Server | null {
  try {
    return (req?.app?.get("io") as Server | undefined) ?? null;
  } catch {
    return null;
  }
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
