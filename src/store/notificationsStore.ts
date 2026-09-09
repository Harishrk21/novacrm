import { create } from 'zustand'
import { api, getAuth, isTenantSession } from '@/lib/api'

export type AppNotification = {
  id: string
  title: string
  message: string
  createdAt: string
  isRead: boolean
  href?: string
  kind: string
  type?: string
  entityType?: string | null
  entityId?: string | null
}

type State = {
  items: AppNotification[]
  unreadCount: number
  loading: boolean
  lastFetchedAt: number | null
  load: (_userId?: string, _role?: string) => Promise<void>
  markRead: (id: string, _userId?: string) => Promise<void>
  markAllRead: (_userId?: string) => Promise<void>
  clearOne: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  prependLive: (n: Partial<AppNotification> & { title: string; message: string }) => void
}

function mapKind(type: string) {
  if (type.includes('LEAD')) return 'LEAD'
  if (type.includes('OVERDUE') || type.includes('SLA')) return 'OVERDUE'
  if (type.includes('TASK')) return 'TASK'
  return 'TICKET'
}

export const useNotificationsStore = create<State>((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,
  lastFetchedAt: null,

  load: async () => {
    if (!isTenantSession()) {
      set({ items: [], unreadCount: 0, lastFetchedAt: Date.now() })
      return
    }
    set({ loading: true })
    try {
      const res = await api.notifications({ limit: 50 })
      const items: AppNotification[] = (res.items ?? []).map((n) => ({
        id: String(n.id),
        title: String(n.title),
        message: String(n.message),
        createdAt: String(n.createdAt),
        isRead: Boolean(n.isRead),
        href: n.href
        ? String(n.href)
        : n.entityType === 'lead' && n.entityId
          ? `/sale-tracking/${n.entityId}`
          : n.entityType === 'invoice_lead' && n.entityId
            ? `/erp/invoices?open=1&contactId=${n.entityId}`
            : n.entityType === 'ticket' && n.entityId
              ? `/tickets/${n.entityId}`
              : undefined,
        kind: mapKind(String(n.type ?? 'TICKET')),
        type: String(n.type ?? ''),
        entityType: n.entityType ? String(n.entityType) : null,
        entityId: n.entityId ? String(n.entityId) : null,
      }))
      set({
        items,
        unreadCount: Number(res.unreadCount ?? items.filter((i) => !i.isRead).length),
        lastFetchedAt: Date.now(),
        loading: false,
      })
    } catch {
      set({ loading: false, lastFetchedAt: Date.now() })
    }
  },

  markRead: async (id) => {
    const prev = get().items
    set({
      items: prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      unreadCount: Math.max(0, get().unreadCount - (prev.find((n) => n.id === id && !n.isRead) ? 1 : 0)),
    })
    try {
      await api.markNotificationRead(id)
    } catch {
      /* keep optimistic */
    }
  },

  markAllRead: async () => {
    set({ items: get().items.map((n) => ({ ...n, isRead: true })), unreadCount: 0 })
    try {
      await api.markAllNotificationsRead()
    } catch {
      /* keep optimistic */
    }
  },

  clearOne: async (id) => {
    const prev = get().items
    const target = prev.find((n) => n.id === id)
    set({
      items: prev.filter((n) => n.id !== id),
      unreadCount: Math.max(
        0,
        get().unreadCount - (target && !target.isRead ? 1 : 0),
      ),
    })
    // Live socket stubs are not persisted yet
    if (id.startsWith('live-')) return
    try {
      await api.deleteNotification(id)
    } catch {
      /* keep optimistic removal */
    }
  },

  clearAll: async () => {
    set({ items: [], unreadCount: 0 })
    try {
      await api.clearAllNotifications()
    } catch {
      /* keep optimistic */
    }
  },

  prependLive: (n) => {
    const id = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const item: AppNotification = {
      id,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt ?? new Date().toISOString(),
      isRead: false,
      href:
        n.entityType === 'ticket' && n.entityId
          ? `/tickets/${n.entityId}`
          : n.entityType === 'lead' && n.entityId
            ? `/sale-tracking/${n.entityId}`
            : n.entityType === 'invoice_lead' && n.entityId
              ? `/erp/invoices?open=1&contactId=${n.entityId}`
              : '/notifications',
      kind: mapKind(String(n.type ?? n.kind ?? 'TICKET')),
      type: n.type,
      entityType: n.entityType,
      entityId: n.entityId,
    }
    set({
      items: [item, ...get().items].slice(0, 50),
      unreadCount: get().unreadCount + 1,
    })
  },
}))

/** Connect socket when authenticated; returns cleanup. */
export function connectNotificationsSocket(
  onEvent?: (payload: Record<string, unknown>) => void,
) {
  const auth = getAuth()
  if (!auth?.accessToken || auth.kind !== 'tenant') return () => undefined

  let socket: { disconnect: () => void; on: (e: string, fn: (p: unknown) => void) => void } | null =
    null
  let cancelled = false

  void import('socket.io-client').then(({ io }) => {
    if (cancelled) return
    const base = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api').replace(/\/api\/?$/, '')
    const s = io(base, {
      auth: { token: auth.accessToken },
      transports: ['websocket', 'polling'],
    })
    socket = s
    s.on('notification', (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
      useNotificationsStore.getState().prependLive({
        title: String(p.title ?? 'Notification'),
        message: String(p.message ?? ''),
        type: String(p.type ?? 'TICKET'),
        entityType: p.entityType ? String(p.entityType) : null,
        entityId: p.entityId ? String(p.entityId) : null,
        createdAt: String(p.createdAt ?? new Date().toISOString()),
      })
      void import('@/lib/notificationSound').then(({ playNotificationBell }) => {
        playNotificationBell()
      })
      onEvent?.(p)
      // Refresh from server shortly so IDs persist for mark-read
      window.setTimeout(() => void useNotificationsStore.getState().load(), 800)
    })
  })

  return () => {
    cancelled = true
    socket?.disconnect()
  }
}
