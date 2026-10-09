import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";

const DEFAULT_CHANNELS = [
  { name: "General", slug: "general", description: "Company-wide discussion" },
  { name: "Sales", slug: "sales", description: "Sales team updates" },
  { name: "Service", slug: "service", description: "Service desk & engineers" },
  { name: "Announcements", slug: "announcements", description: "Official notices" },
] as const;

async function ensureDefaultChannels(tenantId: string, userId: string) {
  const existing = await prisma.teamChannel.findMany({
    where: {
      tenantId,
      slug: { in: DEFAULT_CHANNELS.map((c) => c.slug) },
    },
  });
  const bySlug = Object.fromEntries(existing.map((c) => [c.slug, c]));

  for (const ch of DEFAULT_CHANNELS) {
    let channel: (typeof existing)[number] | undefined = bySlug[ch.slug];
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
            createdById: userId,
          },
        });
      } catch {
        channel =
          (await prisma.teamChannel.findUnique({
            where: { tenantId_slug: { tenantId, slug: ch.slug } },
          })) ?? undefined;
      }
      if (!channel) continue;
    }
    await prisma.teamChannelMember.upsert({
      where: { channelId_userId: { channelId: channel.id, userId } },
      create: { id: newId(), tenantId, channelId: channel.id, userId },
      update: {},
    });
  }
}

async function ensureMembership(tenantId: string, channelId: string, userId: string) {
  await prisma.teamChannelMember.upsert({
    where: { channelId_userId: { channelId, userId } },
    create: { id: newId(), tenantId, channelId, userId },
    update: {},
  });
}

function dmSlug(a: string, b: string) {
  return `dm:${[a, b].sort().join(":")}`;
}

const postMessageBody = z.object({
  body: z.string().trim().min(1).max(4000),
  parentId: z.string().min(1).max(36).nullable().optional(),
});

const createChannelBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional(),
});

const dmBody = z.object({
  userId: z.string().min(1).max(36),
});

const idParams = z.object({ id: z.string().min(1).max(36) });

export const teamChatRouter = Router();
teamChatRouter.use(authenticate, requireTenant);

teamChatRouter.get("/channels", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  await ensureDefaultChannels(t, uid);

  const memberships = await prisma.teamChannelMember.findMany({
    where: { tenantId: t, userId: uid },
  });
  const channelIds = memberships.map((m) => m.channelId);
  if (!channelIds.length) return success(r, { items: [], unreadTotal: 0 });

  const channels = await prisma.teamChannel.findMany({
    where: { tenantId: t, id: { in: channelIds } },
    orderBy: [{ type: "asc" }, { lastMessageAt: "desc" }, { name: "asc" }],
  });

  const memMap = Object.fromEntries(memberships.map((m) => [m.channelId, m]));

  // Unread counts — one query instead of N
  const unreadByChannel: Record<string, number> = {};
  let unreadTotal = 0;
  const unreadMsgs = await prisma.teamMessage.findMany({
    where: {
      tenantId: t,
      channelId: { in: channelIds },
      deletedAt: null,
      senderId: { not: uid },
    },
    select: { channelId: true, createdAt: true },
  });
  for (const m of unreadMsgs) {
    const since = memMap[m.channelId]?.lastReadAt ?? new Date(0);
    if (m.createdAt > since) {
      unreadByChannel[m.channelId] = (unreadByChannel[m.channelId] ?? 0) + 1;
      unreadTotal += 1;
    }
  }

  // For DMs, resolve peer name
  const dmPeerIds = channels
    .filter((c) => c.type === "DM")
    .map((c) => c.slug.replace(/^dm:/, "").split(":").find((id) => id !== uid))
    .filter(Boolean) as string[];
  const peers = dmPeerIds.length
    ? await prisma.user.findMany({
        where: { tenantId: t, id: { in: dmPeerIds }, deletedAt: null },
        select: { id: true, name: true, avatarUrl: true, status: true },
      })
    : [];
  const peerMap = Object.fromEntries(peers.map((p) => [p.id, p]));

  const lastMessages = await prisma.teamMessage.findMany({
    where: { tenantId: t, channelId: { in: channelIds }, deletedAt: null, parentId: null },
    orderBy: { createdAt: "desc" },
    take: channelIds.length * 3,
  });
  const lastByChannel: Record<string, (typeof lastMessages)[0]> = {};
  for (const m of lastMessages) {
    if (!lastByChannel[m.channelId]) lastByChannel[m.channelId] = m;
  }

  const items = channels.map((ch) => {
    const peerId =
      ch.type === "DM"
        ? ch.slug.replace(/^dm:/, "").split(":").find((id) => id !== uid) ?? null
        : null;
    const peer = peerId ? peerMap[peerId] : null;
    const last = lastByChannel[ch.id];
    return {
      id: ch.id,
      type: ch.type,
      name: ch.type === "DM" && peer ? peer.name : ch.name,
      slug: ch.slug,
      description: ch.description,
      isDefault: ch.isDefault,
      pinnedAt: memMap[ch.id]?.pinnedAt ?? null,
      unread: unreadByChannel[ch.id] ?? 0,
      lastMessageAt: ch.lastMessageAt,
      lastMessage: last
        ? { id: last.id, body: last.body.slice(0, 120), senderId: last.senderId, createdAt: last.createdAt }
        : null,
      peer: peer
        ? { id: peer.id, name: peer.name, avatarUrl: peer.avatarUrl, status: peer.status }
        : null,
    };
  });

  // Pins first, then unread, then recent
  items.sort((a, b) => {
    const ap = a.pinnedAt ? 1 : 0;
    const bp = b.pinnedAt ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bt - at;
  });

  return success(r, { items, unreadTotal });
});

teamChatRouter.post(
  "/channels",
  validate(z.object({ body: createChannelBody, query: z.any(), params: z.any() })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const uid = q.auth!.userId!;
    const { name, description } = createChannelBody.parse(q.body);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    if (!slug) throw new AppError("Invalid channel name", 400);
    const exists = await prisma.teamChannel.findUnique({
      where: { tenantId_slug: { tenantId: t, slug } },
    });
    if (exists) throw new AppError("Channel already exists", 409);
    const id = newId();
    const ch = await prisma.teamChannel.create({
      data: {
        id,
        tenantId: t,
        type: "CHANNEL",
        name,
        slug,
        description: description ?? null,
        createdById: uid,
      },
    });
    await prisma.teamChannelMember.create({
      data: { id: newId(), tenantId: t, channelId: id, userId: uid },
    });
    // Auto-add all active users
    const users = await prisma.user.findMany({
      where: { tenantId: t, deletedAt: null, status: "ACTIVE", id: { not: uid } },
      select: { id: true },
    });
    if (users.length) {
      await prisma.teamChannelMember.createMany({
        data: users.map((u) => ({
          id: newId(),
          tenantId: t,
          channelId: id,
          userId: u.id,
        })),
      });
    }
    return success(r, ch, "Channel created", 201);
  },
);

teamChatRouter.post(
  "/dms",
  validate(z.object({ body: dmBody, query: z.any(), params: z.any() })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const uid = q.auth!.userId!;
    const { userId } = dmBody.parse(q.body);
    if (userId === uid) throw new AppError("Cannot DM yourself", 400);
    const peer = await prisma.user.findFirst({
      where: { id: userId, tenantId: t, deletedAt: null },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (!peer) throw notFound("User");
    const slug = dmSlug(uid, userId);

    let ch = await prisma.teamChannel.findUnique({
      where: { tenantId_slug: { tenantId: t, slug } },
    });

    if (!ch) {
      const id = newId();
      try {
        ch = await prisma.teamChannel.create({
          data: {
            id,
            tenantId: t,
            type: "DM",
            name: peer.name,
            slug,
            createdById: uid,
          },
        });
      } catch (err) {
        // Concurrent open — channel already created
        ch = await prisma.teamChannel.findUnique({
          where: { tenantId_slug: { tenantId: t, slug } },
        });
        if (!ch) throw err;
      }
    }

    await ensureMembership(t, ch.id, uid);
    await ensureMembership(t, ch.id, userId);

    return success(r, {
      id: ch.id,
      type: ch.type,
      name: peer.name,
      slug: ch.slug,
      peer: { id: peer.id, name: peer.name, avatarUrl: peer.avatarUrl },
    });
  },
);

teamChatRouter.get(
  "/channels/:id/messages",
  validate(
    z.object({
      body: z.any(),
      query: z.object({
        limit: z.coerce.number().min(1).max(100).optional(),
        before: z.string().optional(),
        parentId: z.string().optional(),
      }),
      params: idParams,
    }),
  ),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const uid = q.auth!.userId!;
    const id = paramId(q);
    const ch = await prisma.teamChannel.findFirst({ where: { id, tenantId: t } });
    if (!ch) throw notFound("Channel");
    await ensureMembership(t, id, uid);

    const limit = Math.min(100, Number(q.query.limit ?? 50) || 50);
    const parentId = q.query.parentId ? String(q.query.parentId) : null;
    const before = q.query.before ? new Date(String(q.query.before)) : null;

    const items = await prisma.teamMessage.findMany({
      where: {
        tenantId: t,
        channelId: id,
        deletedAt: null,
        parentId: parentId,
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const senderIds = [...new Set(items.map((m) => m.senderId))];
    const senders = senderIds.length
      ? await prisma.user.findMany({
          where: { tenantId: t, id: { in: senderIds } },
          select: { id: true, name: true, avatarUrl: true },
        })
      : [];
    const sMap = Object.fromEntries(senders.map((s) => [s.id, s]));

    // Reply counts for root messages
    const rootIds = items.filter((m) => !m.parentId).map((m) => m.id);
    const replyCounts: Record<string, number> = {};
    if (rootIds.length && !parentId) {
      const grouped = await prisma.teamMessage.groupBy({
        by: ["parentId"],
        where: { tenantId: t, parentId: { in: rootIds }, deletedAt: null },
        _count: { _all: true },
      });
      for (const g of grouped) {
        if (g.parentId) replyCounts[g.parentId] = g._count._all;
      }
    }

    // Mark read
    await prisma.teamChannelMember.updateMany({
      where: { channelId: id, userId: uid, tenantId: t },
      data: { lastReadAt: new Date() },
    });

    return success(r, {
      items: items
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          body: m.body,
          parentId: m.parentId,
          createdAt: m.createdAt,
          sender: sMap[m.senderId] ?? { id: m.senderId, name: "Unknown", avatarUrl: null },
          replyCount: replyCounts[m.id] ?? 0,
        })),
    });
  },
);

teamChatRouter.post(
  "/channels/:id/messages",
  validate(z.object({ body: postMessageBody, query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const uid = q.auth!.userId!;
    const id = paramId(q);
    const { body, parentId } = postMessageBody.parse(q.body);
    const ch = await prisma.teamChannel.findFirst({ where: { id, tenantId: t } });
    if (!ch) throw notFound("Channel");
    await ensureMembership(t, id, uid);

    if (parentId) {
      const parent = await prisma.teamMessage.findFirst({
        where: { id: parentId, tenantId: t, channelId: id, deletedAt: null },
      });
      if (!parent) throw notFound("Parent message");
    }

    const msgId = newId();
    const now = new Date();
    const msg = await prisma.teamMessage.create({
      data: {
        id: msgId,
        tenantId: t,
        channelId: id,
        senderId: uid,
        body,
        parentId: parentId ?? null,
        createdAt: now,
      },
    });
    await prisma.teamChannel.update({
      where: { id },
      data: { lastMessageAt: now },
    });
    await prisma.teamChannelMember.updateMany({
      where: { channelId: id, userId: uid, tenantId: t },
      data: { lastReadAt: now },
    });

    const sender = await prisma.user.findFirst({
      where: { id: uid, tenantId: t },
      select: { id: true, name: true, avatarUrl: true },
    });

    return success(
      r,
      {
        id: msg.id,
        body: msg.body,
        parentId: msg.parentId,
        createdAt: msg.createdAt,
        sender: sender ?? { id: uid, name: "You", avatarUrl: null },
        replyCount: 0,
      },
      "Sent",
      201,
    );
  },
);

teamChatRouter.post(
  "/channels/:id/pin",
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const uid = q.auth!.userId!;
    const id = paramId(q);
    const ch = await prisma.teamChannel.findFirst({ where: { id, tenantId: t } });
    if (!ch) throw notFound("Channel");
    await ensureMembership(t, id, uid);
    const mem = await prisma.teamChannelMember.findUnique({
      where: { channelId_userId: { channelId: id, userId: uid } },
    });
    const pinnedAt = mem?.pinnedAt ? null : new Date();
    await prisma.teamChannelMember.update({
      where: { channelId_userId: { channelId: id, userId: uid } },
      data: { pinnedAt },
    });
    return success(r, { id, pinned: Boolean(pinnedAt) });
  },
);

teamChatRouter.get("/threads", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const memberships = await prisma.teamChannelMember.findMany({
    where: { tenantId: t, userId: uid },
    select: { channelId: true },
  });
  const channelIds = memberships.map((m) => m.channelId);
  if (!channelIds.length) return success(r, { items: [] });

  const replies = await prisma.teamMessage.findMany({
    where: {
      tenantId: t,
      channelId: { in: channelIds },
      deletedAt: null,
      parentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const parentIds = [...new Set(replies.map((m) => m.parentId!).filter(Boolean))];
  const parents = parentIds.length
    ? await prisma.teamMessage.findMany({
        where: { id: { in: parentIds }, tenantId: t, deletedAt: null },
      })
    : [];
  const pMap = Object.fromEntries(parents.map((p) => [p.id, p]));
  const channels = await prisma.teamChannel.findMany({
    where: { id: { in: channelIds }, tenantId: t },
    select: { id: true, name: true, type: true },
  });
  const cMap = Object.fromEntries(channels.map((c) => [c.id, c]));
  const senderIds = [...new Set([...replies, ...parents].map((m) => m.senderId))];
  const senders = senderIds.length
    ? await prisma.user.findMany({
        where: { tenantId: t, id: { in: senderIds } },
        select: { id: true, name: true, avatarUrl: true },
      })
    : [];
  const sMap = Object.fromEntries(senders.map((s) => [s.id, s]));

  const seen = new Set<string>();
  const items = [];
  for (const reply of replies) {
    const pid = reply.parentId!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const parent = pMap[pid];
    if (!parent) continue;
    items.push({
      id: parent.id,
      channelId: parent.channelId,
      channelName: cMap[parent.channelId]?.name ?? "Channel",
      body: parent.body.slice(0, 160),
      createdAt: parent.createdAt,
      lastReplyAt: reply.createdAt,
      sender: sMap[parent.senderId] ?? { id: parent.senderId, name: "Unknown", avatarUrl: null },
      lastReply: {
        body: reply.body.slice(0, 120),
        sender: sMap[reply.senderId] ?? { id: reply.senderId, name: "Unknown", avatarUrl: null },
        createdAt: reply.createdAt,
      },
    });
    if (items.length >= 20) break;
  }

  return success(r, { items });
});

teamChatRouter.get("/teammates", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const uid = q.auth!.userId!;
  const users = await prisma.user.findMany({
    where: { tenantId: t, deletedAt: null, status: { in: ["ACTIVE", "INVITED"] }, id: { not: uid } },
    select: { id: true, name: true, email: true, avatarUrl: true, status: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return success(r, { items: users });
});
