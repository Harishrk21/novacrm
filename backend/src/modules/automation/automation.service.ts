import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { logger } from "../../config/logger.js";
import { sendPhoneWhatsApp } from "../tickets/ticketNotify.service.js";

/**
 * Runs tenant automation rules stored in tenants.settings.automationRules
 * and/or automation_rules table. Currently supports:
 * - overdue_task_reminder (creates notification)
 * - unverified_lead_nudge (WhatsApp / activity — only for verified=false leads older than N hours)
 */
export async function runAutomationPass() {
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true, settings: true, plan: true },
  });

  let nudges = 0;
  let overdue = 0;

  for (const tenant of tenants) {
    const settings =
      tenant.settings && typeof tenant.settings === "object" && !Array.isArray(tenant.settings)
        ? (tenant.settings as Record<string, unknown>)
        : {};
    const rules = Array.isArray(settings.automationRules)
      ? (settings.automationRules as Array<{ id?: string; name?: string; enabled?: boolean }>)
      : [];

    const overdueOn = rules.some(
      (r) => r.enabled && String(r.name ?? "").toLowerCase().includes("overdue"),
    );
    const leadNudgeOn = rules.some(
      (r) =>
        r.enabled &&
        (String(r.name ?? "").toLowerCase().includes("lead") ||
          String(r.name ?? "").toLowerCase().includes("follow")),
    );

    // Table-backed rules (future Setup)
    const dbRules = await prisma.automationRule.findMany({
      where: { tenantId: tenant.id, isActive: true },
      take: 50,
    });

    if (overdueOn || dbRules.some((r) => r.actionType === "OVERDUE_TASK_NOTIFY")) {
      const now = new Date();
      const tasks = await prisma.activity.findMany({
        where: {
          tenantId: tenant.id,
          deletedAt: null,
          status: "PENDING",
          scheduledAt: { lt: now },
          assignedToId: { not: null },
        },
        take: 40,
      });
      for (const task of tasks) {
        if (!task.assignedToId) continue;
        await prisma.activity.update({
          where: { id: task.id },
          data: { status: "OVERDUE" },
        });
        await prisma.notification.create({
          data: {
            id: newId(),
            tenantId: tenant.id,
            userId: task.assignedToId,
            title: "Overdue task",
            message: task.title.slice(0, 200),
            type: "activity_overdue",
            entityType: "activity",
            entityId: task.id,
          },
        });
        overdue += 1;
      }
    }

    if (leadNudgeOn || dbRules.some((r) => r.actionType === "LEAD_FOLLOWUP_WHATSAPP")) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const leads = await prisma.lead.findMany({
        where: {
          tenantId: tenant.id,
          deletedAt: null,
          status: { in: ["NEW", "CONTACTED"] },
          createdAt: { lt: cutoff },
        },
        take: 30,
      });
      for (const lead of leads) {
        const cf =
          lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
            ? (lead.customFields as Record<string, unknown>)
            : {};
        if (cf.verified === false) continue; // wait until sales confirms
        if (cf.followUpNudgeSent) continue;
        if (!lead.phone && !lead.phoneNormalized) continue;

        const body = `Hi ${lead.name.split(" ")[0] || lead.name}, just following up on your enquiry with ${tenant.name}. Reply here or call us anytime.`;
        try {
          if (lead.phone || lead.phoneNormalized) {
            await sendPhoneWhatsApp({
              tenantId: tenant.id,
              phone: lead.phone || lead.phoneNormalized || "",
              contactName: lead.name,
              leadId: lead.id,
              body,
              activityTitle: `Follow-up nudge — ${lead.name}`,
              meta: { leadId: lead.id, kind: "sales_followup" },
            });
          }
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              customFields: { ...cf, followUpNudgeSent: true, followUpNudgeAt: new Date().toISOString() },
            },
          });
          nudges += 1;
        } catch {
          /* continue */
        }
      }
    }

    for (const rule of dbRules) {
      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { runCount: { increment: 1 } },
      });
    }
  }

  logger.info("Automation pass", { nudges, overdue });
  return { nudges, overdue };
}
