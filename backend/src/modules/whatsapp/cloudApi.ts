/**
 * Meta WhatsApp Cloud API client.
 * Credentials come from env (see backend/.env) — never commit real tokens.
 * Free-form text only works inside the 24h customer-care window;
 * business-initiated alerts need approved Utility templates.
 */

export type CloudSendResult = {
  ok: boolean
  messageId?: string
  error?: string
  provider: 'META_CLOUD'
}

function cfg() {
  const token = process.env.WHATSAPP_TOKEN?.trim() || ''
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || ''
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || ''
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || ''
  const appId = process.env.WHATSAPP_APP_ID?.trim() || process.env.APP_ID?.trim() || ''
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || process.env.APP_SECRET?.trim() || ''
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0'
  return { token, phoneNumberId, verifyToken, businessAccountId, appId, appSecret, apiVersion }
}

export function isWhatsAppCloudConfigured() {
  const { token, phoneNumberId } = cfg()
  return Boolean(token && phoneNumberId)
}

export function whatsappCloudStatus() {
  const c = cfg()
  return {
    configured: Boolean(c.token && c.phoneNumberId),
    phoneNumberId: c.phoneNumberId ? `${c.phoneNumberId.slice(0, 4)}…${c.phoneNumberId.slice(-4)}` : null,
    businessAccountId: c.businessAccountId || null,
    appId: c.appId || null,
    apiVersion: c.apiVersion,
    verifyTokenSet: Boolean(c.verifyToken),
    /** Shown in admin UI so Meta webhook verify can be pasted — not the Graph access token. */
    verifyToken: c.verifyToken || null,
    hasAppSecret: Boolean(c.appSecret),
  }
}

export function digitsE164(phone: string) {
  let d = phone.replace(/\D/g, '')
  if (d.length === 10) d = `91${d}`
  return d || null
}

async function graphPost(path: string, body: Record<string, unknown>): Promise<CloudSendResult> {
  const { token, phoneNumberId, apiVersion } = cfg()
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

/** Session / free-form text (only valid within 24h window after customer message). */
export async function sendCloudText(toPhone: string, body: string): Promise<CloudSendResult> {
  const to = digitsE164(toPhone)
  if (!to) return { ok: false, error: 'invalid_phone', provider: 'META_CLOUD' }
  return graphPost('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: body.slice(0, 4096) },
  })
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
}): Promise<CloudSendResult> {
  const to = digitsE164(opts.toPhone)
  if (!to) return { ok: false, error: 'invalid_phone', provider: 'META_CLOUD' }
  const languages = Array.from(
    new Set(
      [opts.languageCode || 'en', process.env.WHATSAPP_TEMPLATE_LANG?.trim() || '', 'en', 'en_US'].filter(
        Boolean,
      ),
    ),
  )
  let last: CloudSendResult = { ok: false, error: 'template_send_failed', provider: 'META_CLOUD' }
  for (const languageCode of languages) {
    last = await graphPost('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: opts.templateName,
        language: { code: languageCode },
        ...(opts.components?.length ? { components: opts.components } : {}),
      },
    })
    if (last.ok) return last
  }
  return last
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
}): { ok: true; challenge: string } | { ok: false } {
  const { verifyToken } = cfg()
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
