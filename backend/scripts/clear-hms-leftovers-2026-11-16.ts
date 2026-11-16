/**
 * Harish 2026-11-16: "remove all the old notifications … all old notification, old unknown data should be
 * removed in all areas as we gonna test it" + "remove duplicate tips".
 * Keeps: the 5 sample customers and everything made through the real flows for them (sales, jobs,
 * payments for SVC-00060/61, renewals), products, machine stock, staff logins.
 * Removes (HMS only unless noted):
 *   - all notifications
 *   - old sales releases REQ-00001…00005 (their sales were deleted)
 *   - payment rows from before 14 Nov (old deleted bills / jobs)
 *   - WhatsApp conversations + messages (HMS has no WhatsApp)
 *   - team chat messages and private (DM) threads — default channels stay
 *   - work-history entries from before the sample data + test location pings
 *   - test spare item "Demo pack — Load cell 30kg" and the old "Testing" / "given" battery movements
 *   - duplicate platform tips (keeps the longer copy, hides the other) — platform-wide
 * Dry run by default; --apply writes. JSON backup first.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const CUT = new Date("2026-11-14T06:28:00Z"); // old dummy customers were cleared here
const APPLY = process.argv.includes("--apply");

async function main() {
  const liveLeadIds = new Set((await prisma.lead.findMany({ where: { tenantId: T, deletedAt: null }, select: { id: true } })).map((l) => l.id));
  const notifications = await prisma.notification.findMany({ where: { tenantId: T } });
  const oldReqs = (await prisma.salesRequisition.findMany({ where: { tenantId: T } })).filter((r) => !liveLeadIds.has(r.leadId));
  const oldPayments = await prisma.payment.findMany({ where: { tenantId: T, createdAt: { lt: CUT } } });
  const convs = await prisma.whatsappConversation.findMany({ where: { tenantId: T } });
  const waMsgs = await prisma.whatsappMessage.findMany({ where: { tenantId: T } });
  const teamMsgs = await prisma.teamMessage.findMany({ where: { tenantId: T } });
  const dmChannels = await prisma.teamChannel.findMany({ where: { tenantId: T, type: "DM" } });
  const oldAudit = await prisma.auditLog.findMany({
    where: { tenantId: T, OR: [{ createdAt: { lt: CUT } }, { action: "field.ping" }] },
  });
  const demoItem = await prisma.sparePartItem.findMany({ where: { tenantId: T, deletedAt: null, name: { contains: "Demo pack" } } });
  const oldSpareTxns = await prisma.spareStockTxn.findMany({
    where: {
      tenantId: T,
      deletedAt: null,
      OR: [{ createdAt: { lt: CUT } }, { sparePartId: { in: demoItem.map((d) => d.id) } }],
    },
  });
  const tips = await prisma.featureTip.findMany({ where: { tenantId: null, isActive: true } });
  const byTitle = new Map<string, typeof tips>();
  for (const t of tips) byTitle.set(t.title, [...(byTitle.get(t.title) ?? []), t]);
  const tipsToHide = [...byTitle.values()]
    .filter((g) => g.length > 1)
    .flatMap((g) => [...g].sort((a, b) => b.body.length - a.body.length).slice(1));

  console.log({
    notifications: notifications.length,
    oldReleases: oldReqs.map((r) => r.reqNumber),
    oldPayments: oldPayments.length,
    whatsappConversations: convs.length,
    whatsappMessages: waMsgs.length,
    teamMessages: teamMsgs.length,
    privateChatThreads: dmChannels.length,
    oldWorkHistory: oldAudit.length,
    testSpareItem: demoItem.map((d) => d.name),
    oldSpareMovements: oldSpareTxns.length,
    duplicateTipsToHide: tipsToHide.map((t) => t.title),
  });

  const dir = path.resolve("D:/NOVA+ATTENDANCE/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hms-leftovers-before-clear-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ notifications, oldReqs, oldPayments, convs, waMsgs, teamMsgs, dmChannels, oldAudit, demoItem, oldSpareTxns, tipsToHide }, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v, 2),
  );
  console.log("Backup:", file);
  if (!APPLY) {
    console.log("Dry run — nothing changed. Re-run with --apply.");
    return;
  }

  const now = new Date();
  const dmIds = dmChannels.map((c) => c.id);
  const r = await prisma.$transaction([
    prisma.notification.deleteMany({ where: { tenantId: T } }),
    prisma.salesRequisition.deleteMany({ where: { tenantId: T, id: { in: oldReqs.map((x) => x.id) } } }),
    prisma.payment.deleteMany({ where: { tenantId: T, id: { in: oldPayments.map((x) => x.id) } } }),
    prisma.whatsappMessage.deleteMany({ where: { tenantId: T } }),
    prisma.whatsappConversation.deleteMany({ where: { tenantId: T } }),
    prisma.teamMessage.deleteMany({ where: { tenantId: T } }),
    prisma.teamChannelMember.deleteMany({ where: { tenantId: T, channelId: { in: dmIds } } }),
    prisma.teamChannel.deleteMany({ where: { tenantId: T, id: { in: dmIds } } }),
    prisma.auditLog.deleteMany({ where: { id: { in: oldAudit.map((x) => x.id) } } }),
    prisma.spareStockTxn.updateMany({ where: { id: { in: oldSpareTxns.map((x) => x.id) } }, data: { deletedAt: now } }),
    prisma.sparePartItem.updateMany({ where: { id: { in: demoItem.map((x) => x.id) } }, data: { deletedAt: now, isActive: false } }),
    prisma.featureTip.updateMany({ where: { id: { in: tipsToHide.map((x) => x.id) } }, data: { isActive: false } }),
  ]);
  console.log("Applied:", r.map((x) => x.count).join(", "));
  // Unread counters on team channels for the remaining (default) channels reset with the messages gone
  await prisma.teamChannel.updateMany({ where: { tenantId: T }, data: { lastMessageAt: null } });
}

main().finally(() => prisma.$disconnect());
