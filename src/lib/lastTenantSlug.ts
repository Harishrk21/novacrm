/** Remember last company workspace so expired sessions reopen branded login. */
const KEY = 'novacrm-last-tenant-slug'

export function rememberTenantSlug(slug?: string | null) {
  const s = (slug || '').trim().toLowerCase()
  if (!s) return
  try {
    localStorage.setItem(KEY, s)
  } catch {
    /* ignore */
  }
}

export function readLastTenantSlug(): string | null {
  try {
    const s = (localStorage.getItem(KEY) || '').trim().toLowerCase()
    return s || null
  } catch {
    return null
  }
}

export function tenantLoginPath(slug?: string | null): string {
  const s = (slug || readLastTenantSlug() || '').trim().toLowerCase()
  if (!s || s === 'admin' || s === 'platform') return '/login'
  return `/login/${encodeURIComponent(s)}`
}
