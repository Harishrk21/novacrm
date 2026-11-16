import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { createNotifications, userIdsByRoleCodes } from "../notifications/notify.service.js";
import { ticketCf } from "./ticketLifecycle.js";

/** Remind when a job has sat in the OPEN pool (nobody accepted) longer than this. */
const POOL_REMIND_HOURS = Math.max(1, Number(process.env.POOL_REMIND_HOURS) || 2);
/** Don't repeat the same job's reminder more often than this. */
const REPEAT_HOURS = 4;

/**
 * Hourly: OPEN + unassigned service jobs older than POOL_REMIND_HOURS →
 * bell to admin / manager / service desk ("assign someone") and to engineers ("still available").
 * Stamps customFields.poolReminderAt so each job is nudged at most every REPEAT_HOURS.
 */
export async function runPoolReminders() {
  const now = Date.now();
  const olderThan = new Date(now - POOL_REMIND_HOURS * 3_600_000);
  const tickets = await prisma.ticket.findMany({
    where: { deletedAt: null, status: "OPEN", assignedToId: null, createdAt: { lt: olderThan } },
    select: { id: true, tenantId: true, ticketNo: true, subject: true, createdAt: true, customFields: true },
    take: 200,
  });
  let reminded = 0;
  const roleCache = new Map<string, { approvers: string[]; engineers: string[] }>();
  for (const t of tickets) {
    const cf = ticketCf(t.customFields);
    const last = cf.poolReminderAt ? Date.parse(String(cf.poolReminderAt)) : 0;
    if (last && now - last < REPEAT_HOURS * 3_600_000) continue;

    let people = roleCache.get(t.tenantId);
    if (!people) {
      const [approvers, engineers] = await Promise.all([
        userIdsByRoleCodes(t.tenantId, ["ADMIN", "MANAGER", "SERVICE_DESK"]),
        userIdsByRoleCodes(t.tenantId, ["SERVICE_ENGINEER"]),
      ]);
      people = { approvers, engineers };
      roleCache.set(t.tenantId, people);
    }
    const hours = Math.floor((now - t.createdAt.getTime()) / 3_600_000);
    const svc = `SVC-${String(t.ticketNo).padStart(5, "0")}`;
    await createNotifications([
      ...people.approvers.map((userId) => ({
        tenantId: t.tenantId,
        userId,
        title: `Not accepted for ${hours} h — ${svc}`,
        message: `${t.subject} is still in the open pool. Assign an engineer.`,
        type: "TICKET_POOL_REMINDER",
        entityType: "ticket",
        entityId: t.id,
      })),
      ...people.engineers.map((userId) => ({
        tenantId: t.tenantId,
        userId,
        title: `Job waiting ${hours} h — ${svc}`,
        message: `${t.subject} — first to Accept gets it.`,
        type: "TICKET_AVAILABLE",
        entityType: "ticket",
        entityId: t.id,
      })),
    ]);
    await prisma.ticket.update({
      where: { id: t.id },
      data: { customFields: { ...cf, poolReminderAt: new Date(now).toISOString() } as Prisma.InputJsonValue },
    });
    reminded++;
  }
  logger.info("Pool reminders run", { checked: tickets.length, reminded, afterHours: POOL_REMIND_HOURS });
  return { reminded };
}
