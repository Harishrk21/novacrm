import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { sendCustomerWhatsApp } from "../tickets/ticketNotify.service.js";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function inReminderWindow(target: Date | null | undefined, now: Date) {
  if (!target) return false;
  const t = startOfDay(target).getTime();
  const from = startOfDay(addDays(now, 6)).getTime();
  const to = startOfDay(addDays(now, 8)).getTime();
  return t >= from && t < to;
}

function alreadySentRecently(last: Date | null | undefined, now: Date) {
  if (!last) return false;
  return now.getTime() - last.getTime() < 6 * 24 * 60 * 60 * 1000;
}

/** Send WhatsApp reminders ~1 week before maintenance due and AMC end. */
export async function runServiceReminders() {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true },
  });

  let maintSent = 0;
  let amcSent = 0;

  for (const tenant of tenants) {
    const assets = await prisma.customerAsset.findMany({
      where: { tenantId: tenant.id, deletedAt: null, remindersEnabled: true },
      take: 500,
    });

    for (const asset of assets) {
      const contactId = asset.contactId;
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, tenantId: tenant.id, deletedAt: null },
        select: { id: true, name: true, phone: true, phoneNormalized: true },
      });
      if (!contact?.phone && !contact?.phoneNormalized) continue;

      // Maintenance / next due (all plans)
      if (
        inReminderWindow(asset.nextDueDate, now) &&
        !alreadySentRecently(asset.lastMaintReminderAt, now)
      ) {
        const due = asset.nextDueDate!.toISOString().slice(0, 10);
        const body = `Hi ${contact!.name.split(" ")[0] || contact!.name}, reminder: maintenance for ${asset.name} is due on ${due} (in about 1 week). — ${tenant.name}`;
        const result = await sendCustomerWhatsApp({
          tenantId: tenant.id,
          contactId,
          body,
          activityTitle: `Maintenance reminder — ${asset.name}`,
          meta: { assetId: asset.id, kind: "maint_reminder" },
        });
        if (result.notified || result.fallbackWaLink) {
          await prisma.customerAsset.update({
            where: { id: asset.id },
            data: { lastMaintReminderAt: now },
          });
          maintSent += 1;
        }
      }

      // AMC end (AMC machines only)
      if (
        asset.servicePlan === "AMC" &&
        inReminderWindow(asset.amcEndDate, now) &&
        !alreadySentRecently(asset.lastAmcReminderAt, now)
      ) {
        const end = asset.amcEndDate!.toISOString().slice(0, 10);
        const body = `Hi ${contact!.name.split(" ")[0] || contact!.name}, reminder: AMC for ${asset.name} ends on ${end} (in about 1 week). Renew to stay covered. — ${tenant.name}`;
        const result = await sendCustomerWhatsApp({
          tenantId: tenant.id,
          contactId,
          body,
          activityTitle: `AMC reminder — ${asset.name}`,
          meta: { assetId: asset.id, kind: "amc_reminder" },
        });
        if (result.notified || result.fallbackWaLink) {
          await prisma.customerAsset.update({
            where: { id: asset.id },
            data: { lastAmcReminderAt: now },
          });
          amcSent += 1;
        }
      }
    }
  }

  logger.info("Service reminders run", { maintSent, amcSent });
  return { maintSent, amcSent };
}
