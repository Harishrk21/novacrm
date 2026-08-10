import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/database.js'
import { newId } from '../../common/utils/id.js'
import { normalizePhone } from '../../common/utils/phone.js'
import { success } from '../../common/utils/response.js'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { requireTenant } from '../../middleware/tenant.middleware.js'
import { cacheDelPattern } from '../../config/redis.js'
import { AppError } from '../../common/errors.js'

export const integrationsRouter = Router()

const askmeisterConnectSchema = z.object({
  body: z.object({
    workspaceUrl: z.string().url().optional(),
    apiKey: z.string().min(8),
    workspaceName: z.string().optional(),
    phoneNumberId: z.string().optional(),
  }),
})

const webhookSchema = z.object({
  body: z.object({
    tenantSlug: z.string().optional(),
    tenantId: z.string().optional(),
    from: z.string().min(8),
    to: z.string().optional(),
    body: z.string().min(1),
    externalId: z.string().optional(),
    contactName: z.string().optional(),
  }),
})

integrationsRouter.post(
  '/askmeister/connect',
  authenticate,
  requireTenant,
  validate(askmeisterConnectSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId!
      const { apiKey, workspaceUrl, workspaceName, phoneNumberId } = req.body
      const row = await prisma.integration.upsert({
        where: { tenantId_provider: { tenantId, provider: 'ASKMEISTER' } },
        create: {
          id: newId(),
          tenantId,
          provider: 'ASKMEISTER',
          status: 'CONNECTED',
          config: {
            workspaceUrl: workspaceUrl ?? 'https://app.askmeister.com',
            workspaceName: workspaceName ?? 'AskMeister',
            phoneNumberId: phoneNumberId ?? null,
          },
          secretsEnc: apiKey,
          lastSyncedAt: new Date(),
        },
        update: {
          status: 'CONNECTED',
          config: {
            workspaceUrl: workspaceUrl ?? 'https://app.askmeister.com',
            workspaceName: workspaceName ?? 'AskMeister',
            phoneNumberId: phoneNumberId ?? null,
          },
          secretsEnc: apiKey,
          lastSyncedAt: new Date(),
        },
      })
      await cacheDelPattern(`tenant:${tenantId}:*`)
      return success(res, { provider: row.provider, status: row.status, config: row.config }, 'AskMeister connected')
    } catch (e) {
      next(e)
    }
  },
)

integrationsRouter.get('/status', authenticate, requireTenant, async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId!
    const rows = await prisma.integration.findMany({ where: { tenantId } })
    return success(
      res,
      rows.map((r) => ({
        provider: r.provider,
        status: r.status,
        lastSyncedAt: r.lastSyncedAt,
        config: r.config,
      })),
    )
  } catch (e) {
    next(e)
  }
})

integrationsRouter.post('/askmeister/disconnect', authenticate, requireTenant, async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId!
    await prisma.integration.updateMany({
      where: { tenantId, provider: 'ASKMEISTER' },
      data: { status: 'DISCONNECTED', secretsEnc: null },
    })
    return success(res, { disconnected: true }, 'AskMeister disconnected')
  } catch (e) {
    next(e)
  }
})

integrationsRouter.post('/whatsapp/webhook', validate(webhookSchema), async (req, res, next) => {
  try {
    const { from, body, externalId, contactName, tenantSlug, tenantId: bodyTenantId } = req.body
    let tenantId = bodyTenantId as string | undefined
    if (!tenantId && tenantSlug) {
      const t = await prisma.tenant.findFirst({ where: { slug: tenantSlug, deletedAt: null } })
      tenantId = t?.id
    }
    if (!tenantId) {
      const integ = await prisma.integration.findFirst({
        where: { provider: 'ASKMEISTER', status: 'CONNECTED' },
      })
      tenantId = integ?.tenantId
    }
    if (!tenantId) throw new AppError('tenantSlug or tenantId required', 400)
    const tid: string = tenantId

    const phoneNorm = normalizePhone(from)
    if (!phoneNorm) throw new AppError('Invalid phone number', 400)

    const contact = await prisma.contact.findFirst({
      where: { tenantId: tid, phoneNormalized: { contains: phoneNorm }, deletedAt: null },
    })
    const lead = !contact
      ? await prisma.lead.findFirst({
          where: { tenantId: tid, phoneNormalized: { contains: phoneNorm }, deletedAt: null },
        })
      : null

    let conversation = await prisma.whatsappConversation.findFirst({
      where: { tenantId: tid, phoneNormalized: phoneNorm },
    })
    if (!conversation) {
      conversation = await prisma.whatsappConversation.create({
        data: {
          id: newId(),
          tenantId: tid,
          provider: 'ASKMEISTER',
          phone: from,
          phoneNormalized: phoneNorm,
          contactId: contact?.id,
          leadId: lead?.id,
          contactName: contactName ?? contact?.name ?? lead?.name ?? from,
          lastMessage: body,
          unreadCount: 1,
        },
      })
    } else {
      conversation = await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessage: body,
          unreadCount: { increment: 1 },
          contactId: contact?.id ?? conversation.contactId,
          leadId: lead?.id ?? conversation.leadId,
        },
      })
    }

    const message = await prisma.whatsappMessage.create({
      data: {
        id: newId(),
        tenantId: tid,
        conversationId: conversation.id,
        direction: 'INBOUND',
        body,
        status: 'DELIVERED',
        externalId: externalId ?? null,
      },
    })

    await prisma.activity.create({
      data: {
        id: newId(),
        tenantId: tid,
        type: 'WHATSAPP',
        title: `WhatsApp from ${conversation.contactName ?? from}`,
        description: body,
        status: 'COMPLETED',
        completedAt: new Date(),
        contactId: contact?.id,
        leadId: lead?.id,
      },
    })

    const io = req.app.get('io') as { to: (room: string) => { emit: (e: string, p: unknown) => void } } | undefined
    io?.to(`tenant:${tid}`).emit('whatsapp:message', {
      conversationId: conversation.id,
      message,
      contactId: contact?.id,
    })

    return success(res, {
      received: true,
      conversationId: conversation.id,
      contactFound: Boolean(contact),
      leadFound: Boolean(lead),
    })
  } catch (e) {
    next(e)
  }
})

integrationsRouter.get('/whatsapp/conversations', authenticate, requireTenant, async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId!
    const rows = await prisma.whatsappConversation.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return success(res, rows)
  } catch (e) {
    next(e)
  }
})

integrationsRouter.get(
  '/whatsapp/conversations/:id/messages',
  authenticate,
  requireTenant,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId!
      const conversationId = String(req.params.id)
      const rows = await prisma.whatsappMessage.findMany({
        where: { tenantId, conversationId },
        orderBy: { createdAt: 'asc' },
      })
      return success(res, rows)
    } catch (e) {
      next(e)
    }
  },
)

const sendSchema = z.object({
  body: z.object({ body: z.string().min(1) }),
  params: z.object({ id: z.string().min(1) }),
})

integrationsRouter.post(
  '/whatsapp/conversations/:id/messages',
  authenticate,
  requireTenant,
  validate(sendSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId!
      const conversationId = String(req.params.id)
      const conversation = await prisma.whatsappConversation.findFirst({
        where: { id: conversationId, tenantId },
      })
      if (!conversation) throw new AppError('Conversation not found', 404)

      const message = await prisma.whatsappMessage.create({
        data: {
          id: newId(),
          tenantId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          body: req.body.body,
          status: 'SENT',
          sentByUserId: req.auth!.userId,
        },
      })
      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: { lastMessage: req.body.body, unreadCount: 0 },
      })
      await prisma.activity.create({
        data: {
          id: newId(),
          tenantId,
          type: 'WHATSAPP',
          title: `WhatsApp to ${conversation.contactName ?? conversation.phone}`,
          description: req.body.body,
          status: 'COMPLETED',
          completedAt: new Date(),
          contactId: conversation.contactId,
          leadId: conversation.leadId,
          assignedToId: req.auth!.userId,
        },
      })
      return success(res, message, 'Message sent', 201)
    } catch (e) {
      next(e)
    }
  },
)
