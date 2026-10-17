import { notificationHref } from '@/lib/notificationHref'

/** Resolved / superseded alerts (expireEntityNotifications prefixes title with ✓). */
export function isExpiredNotification(n: {
  title?: string | null
  expired?: boolean | null
}): boolean {
  if (n.expired) return true
  const t = String(n.title ?? '').trim()
  return t.startsWith('✓') || t.startsWith('✔')
}

/** Resolve the best in-app path at click time (never trust a stale stub). */
export function resolveOpenPath(
  n: {
    type?: string | null
    entityType?: string | null
    entityId?: string | null
    href?: string | null
    kind?: string | null
  },
  opts?: { role?: string | null },
): string {
  return notificationHref(
    {
      type: n.type ?? n.kind,
      entityType: n.entityType,
      entityId: n.entityId,
      href: n.href,
    },
    opts,
  )
}
