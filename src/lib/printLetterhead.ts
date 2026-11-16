/**
 * Shared letterhead for every printable document (proforma, service bill, DC, job sheet,
 * service report, purchase order): company logo + registered details from the workspace
 * profile, HMS brand colours (red / charcoal), white page that prints cleanly.
 */
import { api, isTenantSession } from '@/lib/api'
import { HMS_LOGO_URL } from '@/lib/branding'
import { useAuthStore } from '@/store/authStore'

export type PrintCompany = {
  name: string
  logoUrl: string | null
  addressLines: string[]
  gstin: string | null
  phone: string | null
  email: string | null
  website: string | null
}

let cached: (PrintCompany & { tenantId: string }) | null = null

function currentTenantId() {
  return useAuthStore.getState().user?.tenantId ?? null
}
let inflight: Promise<PrintCompany | null> | null = null

function titleCase(s: string) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
}

/** Fetch the workspace profile once (called on app start; prints read the cache synchronously). */
export function primePrintCompany(): Promise<PrintCompany | null> {
  if (cached && cached.tenantId === currentTenantId()) return Promise.resolve(cached)
  if (inflight) return inflight
  if (!isTenantSession()) return Promise.resolve(null)
  inflight = api
    .myTenant()
    .then((t) => {
      const raw = t as typeof t & { logoUrl?: string | null; addressLine2?: string | null }
      const place = [raw.city ? titleCase(raw.city) : null, raw.state].filter(Boolean).join(', ')
      const cityLine = raw.postalCode ? `${place}${place ? ' – ' : ''}${raw.postalCode}` : place
      cached = {
        tenantId: raw.id,
        name: raw.name,
        logoUrl: raw.logoUrl ? absoluteUrl(raw.logoUrl) : null,
        addressLines: [raw.addressLine1, raw.addressLine2, cityLine].filter(
          (x): x is string => Boolean(x && String(x).trim()),
        ),
        gstin: raw.gstin ?? null,
        phone: raw.phone ?? null,
        email: raw.email ?? null,
        website: raw.website ?? null,
      }
      return cached
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function clearPrintCompany() {
  cached = null
}

/** Profile from the workspace, with per-document overrides (e.g. a DC's seller block). */
export function printCompany(fallback?: {
  name?: string | null
  phone?: string | null
  email?: string | null
  gstin?: string | null
  address?: string | null
}): PrintCompany {
  const own = cached && cached.tenantId === currentTenantId() ? cached : null
  const base: PrintCompany = own ?? {
    name: fallback?.name || 'HMS Enterprises',
    logoUrl: null,
    addressLines: [],
    gstin: null,
    phone: null,
    email: null,
    website: null,
  }
  const isHms = /\bHMS\b/i.test(base.name)
  return {
    ...base,
    name: base.name || fallback?.name || 'HMS Enterprises',
    logoUrl: base.logoUrl ?? (isHms ? absoluteUrl(HMS_LOGO_URL) : null),
    addressLines: base.addressLines.length
      ? base.addressLines
      : fallback?.address
        ? [fallback.address]
        : [],
    gstin: base.gstin || fallback?.gstin || null,
    phone: base.phone || fallback?.phone || null,
    email: base.email || fallback?.email || null,
  }
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** "2026-11-12" / ISO → "12 Nov 2026". Leaves other text untouched. */
export function fmtDate(v: unknown): string {
  if (v == null || v === '') return '—'
  const s = String(v)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function words99(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}
function words999(n: number) {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? words99(r) : ''].filter(Boolean).join(' ')
}

/** Indian numbering: 17110 → "Rupees Seventeen Thousand One Hundred Ten Only". */
export function amountInWordsInr(amount: number): string {
  const rupees = Math.floor(Math.abs(amount || 0))
  const paise = Math.round((Math.abs(amount || 0) - rupees) * 100)
  if (!rupees && !paise) return 'Rupees Zero Only'
  const parts: string[] = []
  const crore = Math.floor(rupees / 1_00_00_000)
  const lakh = Math.floor((rupees % 1_00_00_000) / 1_00_000)
  const thousand = Math.floor((rupees % 1_00_000) / 1000)
  const rest = rupees % 1000
  if (crore) parts.push(`${words999(crore)} Crore`)
  if (lakh) parts.push(`${words99(lakh)} Lakh`)
  if (thousand) parts.push(`${words99(thousand)} Thousand`)
  if (rest) parts.push(words999(rest))
  const r = parts.join(' ')
  return `Rupees ${r || 'Zero'}${paise ? ` and ${words99(paise)} Paise` : ''} Only`
}

/**
 * Appended after each document's own <style>: white letterhead, brand red accent,
 * charcoal table heads, flat (ink-friendly) panels. Overrides the older gradient themes.
 */
export const LETTERHEAD_CSS = `
  :root{--brand:#B91C1C;--brand2:#B91C1C;--soft:#fafafa;--line:#e4e4e7;--ink:#18181b;--muted:#52525b}
  body{background:#f4f4f5!important;font-family:"Segoe UI",Arial,sans-serif}
  .sheet{border-radius:4px!important;box-shadow:0 4px 24px rgba(0,0,0,.08)!important}
  .hero{display:none!important}
  .lh{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:26px 32px 16px;border-bottom:3px solid #B91C1C;background:#fff}
  .lh-left{min-width:0}
  .lh-logo{height:54px;width:auto;max-width:240px;object-fit:contain;display:block}
  .lh-name{font-size:22px;font-weight:800;color:#18181b}
  .lh-co{margin-top:8px;font-size:11.5px;color:#3f3f46;line-height:1.55}
  .lh-co b{color:#18181b}
  .lh-doc{text-align:right;flex-shrink:0}
  .lh-title{font-size:19px;font-weight:800;letter-spacing:.1em;color:#B91C1C;text-transform:uppercase}
  .lh-sub{font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a;text-transform:uppercase;margin-top:2px}
  .lh-meta{margin-top:10px;border-collapse:collapse;margin-left:auto}
  .lh-meta tr{background:none!important}
  .lh-meta td{padding:2px 0 2px 14px;font-size:12px;border:0!important;background:none!important;text-align:right;white-space:nowrap}
  .lh-meta td:first-child{color:#71717a}
  .lh-meta td:last-child{font-weight:700;color:#18181b}
  .lh-badge{display:inline-block;margin-top:8px;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid #fecaca;background:#fef2f2;color:#B91C1C}
  .lh-badge.ok{border-color:#bbf7d0;background:#f0fdf4;color:#15803d}
  thead th, th{background:#1f1f22!important;color:#fff!important;background-image:none!important}
  .party,.party.from,.party.to,.box,.box.customer,.box.machine{background:#fafafa!important;background-image:none!important;border-color:#e4e4e7!important}
  .party .label,.party.from .label,.party.to .label,.label{color:#B91C1C!important}
  .fact{background:#fafafa!important;border-color:#e4e4e7!important}
  .banner{background:#fafafa!important;border-color:#e4e4e7!important;color:#3f3f46!important}
  .totals .grand{border-top-color:#B91C1C!important}
  .btn-print{background:#B91C1C!important;color:#fff!important}
  .words{margin-top:10px;font-size:12px;color:#3f3f46}
  .words b{color:#18181b}
  .lh-foot{margin:26px 32px 0;padding:10px 0 18px;border-top:1px solid #e4e4e7;font-size:10.5px;color:#71717a;text-align:center;line-height:1.5}
  @media print{body{background:#fff!important}.sheet{box-shadow:none!important}.lh,thead th,th,.lh-badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`

export function letterheadHtml(opts: {
  company: PrintCompany
  title: string
  subtitle?: string
  number: string
  meta?: Array<[string, string | null | undefined]>
  badge?: { text: string; ok?: boolean } | null
}): string {
  const c = opts.company
  const coLines = [
    ...c.addressLines.map(escapeHtml),
    c.gstin ? `<b>GSTIN:</b> ${escapeHtml(c.gstin)}` : '',
    [c.phone ? `<b>Ph:</b> ${escapeHtml(c.phone)}` : '', c.email ? escapeHtml(c.email) : '', c.website ? escapeHtml(c.website) : '']
      .filter(Boolean)
      .join(' &nbsp;·&nbsp; '),
  ].filter(Boolean)
  const meta = (opts.meta ?? []).filter(([, v]) => v != null && String(v).trim() !== '' && v !== '—')
  return `<div class="lh">
    <div class="lh-left">
      ${c.logoUrl ? `<img class="lh-logo" src="${escapeHtml(c.logoUrl)}" alt="${escapeHtml(c.name)}"/>` : `<div class="lh-name">${escapeHtml(c.name)}</div>`}
      <div class="lh-co">${c.logoUrl ? `<b>${escapeHtml(c.name)}</b><br/>` : ''}${coLines.join('<br/>')}</div>
    </div>
    <div class="lh-doc">
      <div class="lh-title">${escapeHtml(opts.title)}</div>
      ${opts.subtitle ? `<div class="lh-sub">${escapeHtml(opts.subtitle)}</div>` : ''}
      <table class="lh-meta"><tbody>
        <tr><td>No.</td><td>${escapeHtml(opts.number)}</td></tr>
        ${meta.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}
      </tbody></table>
      ${opts.badge ? `<span class="lh-badge${opts.badge.ok ? ' ok' : ''}">${escapeHtml(opts.badge.text)}</span>` : ''}
    </div>
  </div>`
}

export function letterFooterHtml(company: PrintCompany, note?: string): string {
  return `<div class="lh-foot">${note ? `${escapeHtml(note)}<br/>` : ''}${escapeHtml(company.name)}${
    company.addressLines.length ? ` · ${escapeHtml(company.addressLines.join(', '))}` : ''
  }${company.gstin ? ` · GSTIN ${escapeHtml(company.gstin)}` : ''}<br/>This is a computer-generated document.</div>`
}
