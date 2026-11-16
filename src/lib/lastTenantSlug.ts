import { PLATFORM_LOGIN_PATH } from '@/lib/branding'

/** Remember last company workspace so expired sessions reopen branded login. */
const KEY = 'novacrm-last-tenant-slug'

/**
 * DB slug → public login slug, for tenants whose database slug predates their brand.
 * HMS Enterprises is stored as `precision-scales-india` but staff sign in at /login/hms
 * (the API resolves `hms` back to the same tenant). Every other client: slug as-is.
 */
const PUBLIC_LOGIN_SLUGS: Record<string, string> = {
  'precision-scales-india': 'hms',
}

export function publicLoginSlug(slug?: string | null): string {
  const s = (slug || '').trim().toLowerCase()
  return PUBLIC_LOGIN_SLUGS[s] ?? s
}

export function rememberTenantSlug(slug?: string | null) {
  const s = publicLoginSlug(slug)
  if (!s) return
  try {
    localStorage.setItem(KEY, s)
  } catch {
    /* ignore */
  }
}

export function readLastTenantSlug(): string | null {
  try {
    const s = publicLoginSlug(localStorage.getItem(KEY))
    return s || null
  } catch {
    return null
  }
}

/** Company login page — /login/{slug}; falls back to the last company used on this device. */
export function tenantLoginPath(slug?: string | null): string {
  const s = publicLoginSlug(slug) || readLastTenantSlug() || ''
  if (!s || s === 'admin' || s === 'platform') return '/login'
  return `/login/${encodeURIComponent(s)}`
}

/** Where a signed-out user belongs: platform admins → /login/admin, staff → their company login. */
export function loginPathFor(kind: 'platform' | 'tenant' | null | undefined, slug?: string | null): string {
  return kind === 'platform' ? PLATFORM_LOGIN_PATH : tenantLoginPath(slug)
}
