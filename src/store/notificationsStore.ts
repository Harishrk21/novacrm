import { create } from 'zustand'
import { api, getAuth, isTenantSession } from '@/lib/api'
import { notificationHref } from '@/lib/notificationHref'

/** Fired when a brand-new notification should pop the header bell + sound. */
export const NOTIFICATION_ARRIVED_EVENT = 'hms:notification-arrived'

let lastArrivedEmitAt = 0
let lastLivePrependAt = 0

export function emitNotificationArrived(detail?: {
  title?: string
  message?: string
  id?: string
}) {
  if (typeof window === 'undefined') return
  const now = Date.now()
  // Avoid double popup when socket + poll refresh the same alert
  if (now - lastArrivedEmitAt < 2500) return
  lastArrivedEmitAt = now
  window.dispatchEvent(
    new CustomEvent(NOTIFICATION_ARRIVED_EVENT, { detail: detail ?? {} }),
  )
}

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
    const prevIds = new Set(get().items.map((i) => i.id))
    const hadFetch = get().lastFetchedAt != null
    set({ loading: true })
    try {
      const res = await api.notifications({ limit: 50 })
      const items: AppNotification[] = (res.items ?? []).map((n) => ({
        id: String(n.id),
        title: String(n.title),
        message: String(n.message),
        createdAt: String(n.createdAt),
        isRead: Boolean(n.isRead),
        href: notificationHref({
          type: n.type ? String(n.type) : null,
          entityType: n.entityType ? String(n.entityType) : null,
          entityId: n.entityId ? String(n.entityId) : null,
          href: n.href ? String(n.href) : null,
        }),
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
      // Poll path: if a new unread row appeared (socket missed), alert from header
      if (hadFetch && Date.now() - lastLivePrependAt > 3000) {
        const fresh = items.find((n) => !n.isRead && !prevIds.has(n.id) && !n.id.startsWith('live-'))
        if (fresh) {
          void import('@/lib/notificationSound').then(({ playNotificationBell }) => {
            playNotificationBell()
          })
          emitNotificationArrived({
            id: fresh.id,
            title: fresh.title,
            message: fresh.message,
          })
        }
      }
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
      href: notificationHref({
        type: n.type,
        entityType: n.entityType,
        entityId: n.entityId,
        href: n.href,
      }),
      kind: mapKind(String(n.type ?? n.kind ?? 'TICKET')),
      type: n.type,
      entityType: n.entityType,
      entityId: n.entityId,
    }
    lastLivePrependAt = Date.now()
    set({
      items: [item, ...get().items].slice(0, 50),
      unreadCount: get().unreadCount + 1,
    })
    emitNotificationArrived({ id, title: item.title, message: item.message })
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
    // Assign / approve / task-done — refresh list + unread badge in real time
    const refresh = () => {
      void useNotificationsStore.getState().load()
    }
    s.on('notification:updated', (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        ids?: string[]
        removed?: boolean
      }
      if (Array.isArray(p.ids) && p.ids.length) {
        const state = useNotificationsStore.getState()
        const idSet = new Set(p.ids)
        if (p.removed) {
          const next = state.items.filter((n) => !idSet.has(n.id))
          setOptimistic(next)
        } else {
          const next = state.items.map((n) =>
            idSet.has(n.id) ? { ...n, isRead: true } : n,
          )
          setOptimistic(next)
        }
      }
      refresh()
    })
    s.on('notification:expired', (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        ids?: string[]
        removed?: boolean
        entityId?: string | null
      }
      const state = useNotificationsStore.getState()
      if (Array.isArray(p.ids) && p.ids.length) {
        const idSet = new Set(p.ids)
        const next = p.removed
          ? state.items.filter((n) => !idSet.has(n.id))
          : state.items.map((n) => (idSet.has(n.id) ? { ...n, isRead: true } : n))
        setOptimistic(next)
      } else if (p.entityId) {
        // Live stubs may not have server ids yet — drop by entity
        const next = state.items.filter(
          (n) => !(n.entityId === p.entityId && !n.isRead),
        )
        setOptimistic(next)
      }
      refresh()
    })
  })

  function setOptimistic(items: AppNotification[]) {
    useNotificationsStore.setState({
      items,
      unreadCount: items.filter((i) => !i.isRead).length,
    })
  }

  return () => {
    cancelled = true
    socket?.disconnect()
  }
}
