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
import {
  whatsappCloudStatus,
  verifyMetaWebhookChallenge,
  isWhatsAppCloudConfigured,
  sendCloudText,
} from '../whatsapp/cloudApi.js'

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

integrationsRouter.get('/whatsapp/cloud/status', authenticate, requireTenant, async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId!
    const status = whatsappCloudStatus()
    if (status.configured) {
      await prisma.integration.upsert({
        where: { tenantId_provider: { tenantId, provider: 'META_CLOUD' } },
        create: {
          id: newId(),
          tenantId,
          provider: 'META_CLOUD',
          status: 'CONNECTED',
          config: {
            phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
            businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null,
            apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
          },
          lastSyncedAt: new Date(),
        },
        update: {
          status: 'CONNECTED',
          config: {
            phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
            businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null,
            apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
          },
          lastSyncedAt: new Date(),
        },
      })
    }
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3001')
    const publicBase = (process.env.PUBLIC_API_URL || '').trim().replace(/\/$/, '')
    const webhookUrlHint = publicBase
      ? `${publicBase}/api/integrations/whatsapp/cloud/webhook`
      : `${proto}://${host}/api/integrations/whatsapp/cloud/webhook`
    return success(res, {
      ...status,
      webhookPath: '/api/integrations/whatsapp/cloud/webhook',
      webhookUrlHint,
      note: 'Templates must be approved in Meta WhatsApp Manager before business-initiated sends outside 24h. For local Meta verify, expose this URL via HTTPS tunnel.',
    })
  } catch (e) {
    next(e)
  }
})

/** Meta webhook verification (subscribe) */
integrationsRouter.get('/whatsapp/cloud/webhook', (req, res) => {
  const result = verifyMetaWebhookChallenge({
    mode: String(req.query['hub.mode'] ?? ''),
    token: String(req.query['hub.verify_token'] ?? ''),
    challenge: String(req.query['hub.challenge'] ?? ''),
  })
  if (result.ok) {
    res.status(200).send(result.challenge)
    return
  }
  res.status(403).send('Forbidden')
})

/** Meta inbound / delivery events */
integrationsRouter.post('/whatsapp/cloud/webhook', async (req, res) => {
  // Always 200 quickly so Meta does not retry aggressively
  res.status(200).json({ received: true })
  try {
    const body = req.body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              from?: string
              id?: string
              text?: { body?: string }
              type?: string
            }>
            contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
            statuses?: Array<{ id?: string; status?: string }>
          }
        }>
      }>
    }
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value
        if (!value?.messages?.length) continue
        const contactName = value.contacts?.[0]?.profile?.name
        for (const msg of value.messages) {
          if (!msg.from || !msg.text?.body) continue
          const phoneNorm = normalizePhone(msg.from) || msg.from.replace(/\D/g, '')
          const integ = await prisma.integration.findFirst({
            where: { provider: 'META_CLOUD', status: 'CONNECTED' },
          })
          // Fall back to first active tenant if no META_CLOUD integration row yet
          let tenantId = integ?.tenantId
          if (!tenantId) {
            const tenant = await prisma.tenant.findFirst({
              where: { deletedAt: null, status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
            })
            tenantId = tenant?.id
          }
          if (!tenantId) continue

          const contact = await prisma.contact.findFirst({
            where: { tenantId, phoneNormalized: { contains: phoneNorm }, deletedAt: null },
          })
          let conversation = await prisma.whatsappConversation.findFirst({
            where: { tenantId, phoneNormalized: phoneNorm },
          })
          if (!conversation) {
            conversation = await prisma.whatsappConversation.create({
              data: {
                id: newId(),
                tenantId,
                provider: 'META_CLOUD',
                phone: msg.from,
                phoneNormalized: phoneNorm,
                contactId: contact?.id,
                contactName: contactName ?? contact?.name ?? msg.from,
                lastMessage: msg.text.body,
                unreadCount: 1,
              },
            })
          } else {
            await prisma.whatsappConversation.update({
              where: { id: conversation.id },
              data: {
                lastMessage: msg.text.body,
                unreadCount: { increment: 1 },
                contactId: contact?.id ?? conversation.contactId,
              },
            })
          }
          await prisma.whatsappMessage.create({
            data: {
              id: newId(),
              tenantId,
              conversationId: conversation.id,
              direction: 'INBOUND',
              body: msg.text.body,
              status: 'DELIVERED',
              externalId: msg.id ?? null,
            },
          })
        }
      }
    }
  } catch (err) {
    console.error('meta whatsapp webhook handler', err)
  }
})

integrationsRouter.post(
  '/whatsapp/cloud/test',
  authenticate,
  requireTenant,
  async (req, res, next) => {
    try {
      if (!isWhatsAppCloudConfigured()) {
        throw new AppError('WhatsApp Cloud API is not configured in server .env', 400)
      }
      const to = String((req.body as { to?: string })?.to ?? '').trim()
      if (!to) throw new AppError('Provide { "to": "91XXXXXXXXXX" }', 400)
      const result = await sendCloudText(
        to,
        'HMS CRM test: WhatsApp Cloud API is connected. You can create Utility templates in Meta next.',
      )
      if (!result.ok) throw new AppError(result.error || 'Send failed', 502)
      return success(res, result, 'Test message sent')
    } catch (e) {
      next(e)
    }
  },
)

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

      let externalId: string | null = null
      let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
      if (isWhatsAppCloudConfigured()) {
        const cloud = await sendCloudText(conversation.phone, req.body.body)
        if (!cloud.ok) throw new AppError(cloud.error || 'WhatsApp Cloud send failed', 502)
        externalId = cloud.messageId ?? null
      }

      const message = await prisma.whatsappMessage.create({
        data: {
          id: newId(),
          tenantId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          body: req.body.body,
          status: deliveryStatus,
          externalId,
          sentByUserId: req.auth!.userId,
        },
      })
      await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessage: req.body.body,
          unreadCount: 0,
          provider: isWhatsAppCloudConfigured() ? 'META_CLOUD' : conversation.provider,
        },
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
