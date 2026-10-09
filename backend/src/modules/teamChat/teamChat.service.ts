import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { logger } from "../../config/logger.js";

const DEFAULT_CHANNELS = [
  { name: "General", slug: "general", description: "Company-wide discussion" },
  { name: "Sales", slug: "sales", description: "Sales team updates" },
  { name: "Service", slug: "service", description: "Service desk & engineers" },
  { name: "Announcements", slug: "announcements", description: "Official notices" },
] as const;

/** Ensure default channels exist; optionally upsert membership for the given users. */
export async function ensureDefaultChannels(tenantId: string, userIds: string | string[]) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const existing = await prisma.teamChannel.findMany({
    where: {
      tenantId,
      slug: { in: DEFAULT_CHANNELS.map((c) => c.slug) },
    },
  });
  const bySlug = Object.fromEntries(existing.map((c) => [c.slug, c]));
  const creator = ids[0];

  for (const ch of DEFAULT_CHANNELS) {
    let channel = bySlug[ch.slug];
    if (!channel) {
      const id = newId();
      try {
        channel = await prisma.teamChannel.create({
          data: {
            id,
            tenantId,
            type: "CHANNEL",
            name: ch.name,
            slug: ch.slug,
            description: ch.description,
            isDefault: true,
            createdById: creator ?? null,
          },
        });
      } catch {
        channel =
          (await prisma.teamChannel.findUnique({
            where: { tenantId_slug: { tenantId, slug: ch.slug } },
          })) ?? undefined!;
      }
      if (!channel) continue;
    }
    for (const userId of ids) {
      if (!userId) continue;
      await prisma.teamChannelMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId } },
        create: { id: newId(), tenantId, channelId: channel.id, userId },
        update: {},
      });
    }
  }
}

/**
 * Post a message into a default channel by slug (e.g. "service").
 * Ensures channel + membership for sender and any extra user ids.
 */
export async function postTeamChatBySlug(opts: {
  tenantId: string;
  slug: string;
  senderId: string;
  body: string;
  ensureUserIds?: string[];
}) {
  const memberIds = [...new Set([opts.senderId, ...(opts.ensureUserIds ?? [])])].filter(Boolean);
  await ensureDefaultChannels(opts.tenantId, memberIds);

  const channel = await prisma.teamChannel.findUnique({
    where: { tenantId_slug: { tenantId: opts.tenantId, slug: opts.slug } },
  });
  if (!channel) {
    logger.warn("Team chat channel missing after ensure", { slug: opts.slug, tenantId: opts.tenantId });
    return null;
  }

  for (const userId of memberIds) {
    await prisma.teamChannelMember.upsert({
      where: { channelId_userId: { channelId: channel.id, userId } },
      create: { id: newId(), tenantId: opts.tenantId, channelId: channel.id, userId },
      update: {},
    });
  }

  const msg = await prisma.teamMessage.create({
    data: {
      id: newId(),
      tenantId: opts.tenantId,
      channelId: channel.id,
      senderId: opts.senderId,
      body: opts.body.slice(0, 4000),
    },
  });
  await prisma.teamChannel.update({
    where: { id: channel.id },
    data: { lastMessageAt: msg.createdAt },
  });
  return { channelId: channel.id, messageId: msg.id };
}
