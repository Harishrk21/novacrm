/**
 * Meta WhatsApp Cloud API client.
 *
 * Resolution order for credentials:
 * 1. Per-tenant Integration row (provider META_CLOUD) when tenantId is passed
 * 2. Process env (shared fallback for HMS / single-tenant demos)
 *
 * Never share one long-lived token across tenants in production — each client
 * should store their own phoneNumberId + token on the Integration row.
 */

import { prisma } from '../../config/database.js'
import { newId } from '../../common/utils/id.js'

export type CloudSendResult = {
  ok: boolean
  messageId?: string
  error?: string
  provider: 'META_CLOUD'
}

export type WhatsAppCloudCfg = {
  token: string
  phoneNumberId: string
  verifyToken: string
  businessAccountId: string
  appId: string
  appSecret: string
  apiVersion: string
  source: 'tenant' | 'env'
}

export function envCloudCfg(): WhatsAppCloudCfg {
  const token = process.env.WHATSAPP_TOKEN?.trim() || ''
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || ''
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || ''
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || ''
  const appId = process.env.WHATSAPP_APP_ID?.trim() || process.env.APP_ID?.trim() || ''
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || process.env.APP_SECRET?.trim() || ''
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0'
  return {
    token,
    phoneNumberId,
    verifyToken,
    businessAccountId,
    appId,
    appSecret,
    apiVersion,
    source: 'env',
  }
}

/** @deprecated prefer envCloudCfg / resolveTenantCloudCfg */
function cfg() {
  return envCloudCfg()
}

export async function resolveTenantCloudCfg(tenantId?: string | null): Promise<WhatsAppCloudCfg> {
  const fallback = envCloudCfg()
  if (!tenantId) return fallback
  const row = await prisma.integration.findUnique({
    where: { tenantId_provider: { tenantId, provider: 'META_CLOUD' } },
  })
  if (!row || row.status === 'DISCONNECTED') return fallback

  const config =
    row.config && typeof row.config === 'object' && !Array.isArray(row.config)
      ? (row.config as Record<string, unknown>)
      : {}
  let secrets: Record<string, unknown> = {}
  if (row.secretsEnc) {
    try {
      const raw = row.secretsEnc.startsWith('{')
        ? row.secretsEnc
        : Buffer.from(row.secretsEnc, 'base64').toString('utf8')
      secrets = JSON.parse(raw) as Record<string, unknown>
    } catch {
      secrets = {}
    }
  }

  const token = String(secrets.token ?? secrets.accessToken ?? '').trim()
  const phoneNumberId = String(
    config.phoneNumberId ?? secrets.phoneNumberId ?? '',
  ).trim()
  if (!token || !phoneNumberId) return fallback

  return {
    token,
    phoneNumberId,
    verifyToken: String(secrets.verifyToken ?? fallback.verifyToken).trim(),
    businessAccountId: String(
      config.businessAccountId ?? secrets.businessAccountId ?? fallback.businessAccountId,
    ).trim(),
    appId: String(config.appId ?? secrets.appId ?? fallback.appId).trim(),
    appSecret: String(secrets.appSecret ?? fallback.appSecret).trim(),
    apiVersion: String(config.apiVersion ?? fallback.apiVersion).trim() || 'v21.0',
    source: 'tenant',
  }
}

export function isWhatsAppCloudConfigured(c?: WhatsAppCloudCfg) {
  const x = c ?? envCloudCfg()
  return Boolean(x.token && x.phoneNumberId)
}

export function whatsappCloudStatus(c?: WhatsAppCloudCfg) {
  const x = c ?? envCloudCfg()
  return {
    configured: Boolean(x.token && x.phoneNumberId),
    phoneNumberId: x.phoneNumberId
      ? `${x.phoneNumberId.slice(0, 4)}…${x.phoneNumberId.slice(-4)}`
      : null,
    businessAccountId: x.businessAccountId || null,
    appId: x.appId || null,
    apiVersion: x.apiVersion,
    verifyTokenSet: Boolean(x.verifyToken),
    verifyToken: x.verifyToken || null,
    hasAppSecret: Boolean(x.appSecret),
    source: x.source,
  }
}

export function digitsE164(phone: string) {
  let d = phone.replace(/\D/g, '')
  if (d.length === 10) d = `91${d}`
  return d || null
}

async function graphPost(
  path: string,
  body: Record<string, unknown>,
  cloud?: WhatsAppCloudCfg,
): Promise<CloudSendResult> {
  const { token, phoneNumberId, apiVersion } = cloud ?? envCloudCfg()
  if (!token || !phoneNumberId) {
    return { ok: false, error: 'whatsapp_cloud_not_configured', provider: 'META_CLOUD' }
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>
      error?: { message?: string; code?: number }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `HTTP ${res.status}`,
        provider: 'META_CLOUD',
      }
    }
    return {
      ok: true,
      messageId: json.messages?.[0]?.id,
      provider: 'META_CLOUD',
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'send_failed',
      provider: 'META_CLOUD',
    }
  }
}

export type SendOpts = { tenantId?: string }

/** Session / free-form text (only valid within 24h window after customer message). */
export async function sendCloudText(
  toPhone: string,
  body: string,
  opts?: SendOpts,
): Promise<CloudSendResult> {
  const to = digitsE164(toPhone)
  if (!to) return { ok: false, error: 'invalid_phone', provider: 'META_CLOUD' }
  const cloud = await resolveTenantCloudCfg(opts?.tenantId)
  return graphPost(
    '/messages',
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: body.slice(0, 4096) },
    },
    cloud,
  )
}

/**
 * Utility / approved template message (required for business-initiated outside 24h).
 * `components` follows Meta Cloud API template component shape.
 */
export async function sendCloudTemplate(opts: {
  toPhone: string
  templateName: string
  languageCode?: string
  components?: Array<Record<string, unknown>>
  tenantId?: string
}): Promise<CloudSendResult> {
  const to = digitsE164(opts.toPhone)
  if (!to) return { ok: false, error: 'invalid_phone', provider: 'META_CLOUD' }
  const cloud = await resolveTenantCloudCfg(opts.tenantId)
  const languages = Array.from(
    new Set(
      [opts.languageCode || 'en', process.env.WHATSAPP_TEMPLATE_LANG?.trim() || '', 'en', 'en_US'].filter(
        Boolean,
      ),
    ),
  )
  let last: CloudSendResult = { ok: false, error: 'template_send_failed', provider: 'META_CLOUD' }
  for (const languageCode of languages) {
    last = await graphPost(
      '/messages',
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: opts.templateName,
          language: { code: languageCode },
          ...(opts.components?.length ? { components: opts.components } : {}),
        },
      },
      cloud,
    )
    if (last.ok) return last
  }
  return last
}

/** Persist per-tenant Meta Cloud credentials (foundation — secrets stored as base64 JSON). */
export async function upsertTenantWhatsAppCloud(
  tenantId: string,
  input: {
    token: string
    phoneNumberId: string
    verifyToken?: string
    businessAccountId?: string
    appId?: string
    appSecret?: string
    apiVersion?: string
  },
) {
  const secretsPayload = Buffer.from(
    JSON.stringify({
      token: input.token.trim(),
      verifyToken: input.verifyToken?.trim() || undefined,
      appSecret: input.appSecret?.trim() || undefined,
    }),
    'utf8',
  ).toString('base64')

  return prisma.integration.upsert({
    where: { tenantId_provider: { tenantId, provider: 'META_CLOUD' } },
    create: {
      id: newId(),
      tenantId,
      provider: 'META_CLOUD',
      status: 'CONNECTED',
      config: {
        phoneNumberId: input.phoneNumberId.trim(),
        businessAccountId: input.businessAccountId?.trim() || null,
        appId: input.appId?.trim() || null,
        apiVersion: input.apiVersion?.trim() || 'v21.0',
      },
      secretsEnc: secretsPayload,
      lastSyncedAt: new Date(),
    },
    update: {
      status: 'CONNECTED',
      config: {
        phoneNumberId: input.phoneNumberId.trim(),
        businessAccountId: input.businessAccountId?.trim() || null,
        appId: input.appId?.trim() || null,
        apiVersion: input.apiVersion?.trim() || 'v21.0',
      },
      secretsEnc: secretsPayload,
      lastSyncedAt: new Date(),
    },
  })
}

/** Build body components for templates that use {{1}} {{2}} … positional params. */
export function templateBodyParams(values: string[]) {
  return [
    {
      type: 'body',
      parameters: values.map((text) => ({ type: 'text', text: String(text).slice(0, 1024) || '—' })),
    },
  ]
}

export function verifyMetaWebhookChallenge(opts: {
  mode?: string
  token?: string
  challenge?: string
  verifyTokenOverride?: string
}): { ok: true; challenge: string } | { ok: false } {
  const verifyToken = opts.verifyTokenOverride || cfg().verifyToken
  if (
    opts.mode === 'subscribe' &&
    verifyToken &&
    opts.token === verifyToken &&
    opts.challenge
  ) {
    return { ok: true, challenge: opts.challenge }
  }
  return { ok: false }
}
