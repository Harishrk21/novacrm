import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import { sendCustomerWhatsApp } from "../tickets/ticketNotify.service.js";
import {
  isWeighingMachine,
  openingStampQuarter,
  stampQuarterFromDate,
  stampQuarterLabel,
  type StampQuarter,
} from "../../common/hmsCoverage.js";
import { persistLapsedGc } from "./coverageLapse.js";

function assetStampQuarter(asset: {
  nextDueDate?: Date | null;
  stampingDate?: Date | null;
  customFields?: unknown;
}): { code: StampQuarter; year: number; label: string } {
  const cf =
    asset.customFields && typeof asset.customFields === "object" && !Array.isArray(asset.customFields)
      ? (asset.customFields as Record<string, unknown>)
      : {};
  const stored = String(cf.stampingQuarter ?? "").toUpperCase();
  const due = asset.nextDueDate ?? asset.stampingDate ?? new Date();
  const code = (["A", "B", "C", "D"].includes(stored)
    ? stored
    : stampQuarterFromDate(due)) as StampQuarter;
  const year = Number(cf.stampingQuarterYear) || due.getFullYear();
  return { code, year, label: stampQuarterLabel(code, year) };
}

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

function recentlyEnded(target: Date | null | undefined, now: Date, withinDays = 14) {
  if (!target) return false;
  const end = startOfDay(target).getTime();
  const from = startOfDay(addDays(now, -withinDays)).getTime();
  const today = startOfDay(now).getTime();
  return end >= from && end <= today;
}

/** Send WhatsApp reminders ~1 week before stamping due, AMC service (6 mo), and AMC end. */
export async function runServiceReminders() {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "TRIAL"] } },
    select: { id: true, name: true },
  });

  let maintSent = 0;
  let amcSent = 0;
  let serviceSent = 0;

  for (const tenant of tenants) {
    const assets = await prisma.customerAsset.findMany({
      where: { tenantId: tenant.id, deletedAt: null, remindersEnabled: true },
      take: 500,
    });
    await persistLapsedGc(assets);

    for (const asset of assets) {
      const contactId = asset.contactId;
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, tenantId: tenant.id, deletedAt: null },
        select: { id: true, name: true, phone: true, phoneNormalized: true },
      });
      if (!contact?.phone && !contact?.phoneNormalized) continue;

      const stampQ = assetStampQuarter(asset);
      const openingQ = openingStampQuarter(now);
      const quarterBatchDue =
        Boolean(openingQ) &&
        stampQ.code === openingQ &&
        stampQ.year === now.getFullYear() &&
        Boolean(asset.nextDueDate) &&
        !alreadySentRecently(asset.lastMaintReminderAt, now);

      // Stamping / next due (1 week before) + quarter-start batch (A/B/C/D)
      if (
        (inReminderWindow(asset.nextDueDate, now) || quarterBatchDue) &&
        !alreadySentRecently(asset.lastMaintReminderAt, now)
      ) {
        const due = asset.nextDueDate!.toISOString().slice(0, 10);
        const body = quarterBatchDue
          ? `Hi ${contact!.name.split(" ")[0] || contact!.name}, ${stampQ.label} stamping reminder: verification for ${asset.name} is due on ${due}. — ${tenant.name}`
          : `Hi ${contact!.name.split(" ")[0] || contact!.name}, reminder: stamping / verification for ${asset.name} is due on ${due} (${stampQ.label}, in about 1 week). — ${tenant.name}`;
        const result = await sendCustomerWhatsApp({
          tenantId: tenant.id,
          contactId,
          body,
          activityTitle: `Stamping reminder — ${asset.name}`,
          meta: { assetId: asset.id, kind: "stamp_reminder" },
        });
        if (result.notified || result.fallbackWaLink) {
          await prisma.customerAsset.update({
            where: { id: asset.id },
            data: { lastMaintReminderAt: now },
          });
          maintSent += 1;
        }
      }

      // AMC free service every 4 months
      if (
        asset.servicePlan === "AMC" &&
        inReminderWindow(asset.nextServiceDueDate, now) &&
        !alreadySentRecently(asset.lastServiceReminderAt, now)
      ) {
        const due = asset.nextServiceDueDate!.toISOString().slice(0, 10);
        const body = `Hi ${contact!.name.split(" ")[0] || contact!.name}, reminder: free AMC service for ${asset.name} is due on ${due} (in about 1 week). — ${tenant.name}`;
        const result = await sendCustomerWhatsApp({
          tenantId: tenant.id,
          contactId,
          body,
          activityTitle: `AMC service reminder — ${asset.name}`,
          meta: { assetId: asset.id, kind: "amc_service_reminder" },
        });
        if (result.notified || result.fallbackWaLink) {
          await prisma.customerAsset.update({
            where: { id: asset.id },
            data: { lastServiceReminderAt: now },
          });
          serviceSent += 1;
        }
      }

      // AMC contract end
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

      const first = contact!.name.split(" ")[0] || contact!.name;
      const weighing = isWeighingMachine(asset.machineType);

      // GC warranty ending soon — then machine moves to NGC
      if (
        asset.servicePlan === "GC" &&
        inReminderWindow(asset.warrantyEndDate, now) &&
        !alreadySentRecently(asset.lastAmcReminderAt, now)
      ) {
        const end = asset.warrantyEndDate!.toISOString().slice(0, 10);
        const body = weighing
          ? `Hi ${first}, reminder: 1-year guarantee (GC) for ${asset.name} ends on ${end}. It then moves to NGC. We can start a 1-year AMC after that (weighing only). — ${tenant.name}`
          : `Hi ${first}, reminder: 1-year guarantee (GC) for ${asset.name} ends on ${end}. It then moves to NGC — spare parts and service will be chargeable. — ${tenant.name}`;
        const result = await sendCustomerWhatsApp({
          tenantId: tenant.id,
          contactId,
          body,
          activityTitle: `GC ending — ${asset.name}`,
          meta: { assetId: asset.id, kind: "gc_ending_reminder" },
        });
        if (result.notified || result.fallbackWaLink) {
          await prisma.customerAsset.update({
            where: { id: asset.id },
            data: { lastAmcReminderAt: now },
          });
          amcSent += 1;
        }
      }

      // After GC year — weighing only: contact to convert to AMC
      if (
        weighing &&
        asset.servicePlan !== "AMC" &&
        recentlyEnded(asset.warrantyEndDate, now) &&
        !alreadySentRecently(asset.lastAmcReminderAt, now)
      ) {
        const body = `Hi ${first}, 1-year GC for ${asset.name} has ended — it is now NGC. We can start a 1-year AMC (free service every 6 months; parts charged). Reply if you would like to enroll. — ${tenant.name}`;
        const result = await sendCustomerWhatsApp({
          tenantId: tenant.id,
          contactId,
          body,
          activityTitle: `AMC offer after GC — ${asset.name}`,
          meta: { assetId: asset.id, kind: "amc_offer_after_gc" },
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

  logger.info("Service reminders run", { maintSent, amcSent, serviceSent });
  return { maintSent, amcSent, serviceSent };
}
