import { create } from 'zustand'
import { api, isTenantSession } from '@/lib/api'

export type AppNotification = {
  id: string
  title: string
  message: string
  createdAt: string
  isRead: boolean
  href?: string
  kind: 'TASK' | 'LEAD' | 'TICKET' | 'OVERDUE'
}

type State = {
  items: AppNotification[]
  loading: boolean
  lastFetchedAt: number | null
  load: (userId: string, role?: string) => Promise<void>
  markRead: (id: string, userId: string) => void
  markAllRead: (userId: string) => void
}

function readKey(userId: string) {
  return `novacrm_notif_read:${userId}`
}

function loadReadIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(readKey(userId))
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(userId: string, ids: Set<string>) {
  localStorage.setItem(readKey(userId), JSON.stringify([...ids]))
}

export const useNotificationsStore = create<State>((set, get) => ({
  items: [],
  loading: false,
  lastFetchedAt: null,

  load: async (userId, role) => {
    if (!isTenantSession() || !userId) {
      set({ items: [], lastFetchedAt: Date.now() })
      return
    }
    set({ loading: true })
    const isAdmin = !role || role === 'ADMIN'
    try {
      const [acts, leads, tickets] = await Promise.all([
        api.activities({
          limit: 40,
          ...(isAdmin ? {} : { assignedToId: userId }),
        }),
        api.leads({
          limit: 40,
          ...(isAdmin ? {} : { assignedToId: userId }),
        }),
        api.tickets({
          limit: 40,
          ...(isAdmin ? {} : { assignedToId: userId }),
        }),
      ])

      const readIds = loadReadIds(userId)
      const items: AppNotification[] = []

      for (const a of acts.items ?? []) {
        const status = String(a.status ?? '')
        const assignee = a.assignedToId ? String(a.assignedToId) : ''
        if (!['PENDING', 'OVERDUE'].includes(status)) continue
        if (!isAdmin && assignee !== userId) continue
        if (!assignee) continue
        const overdue = status === 'OVERDUE'
        items.push({
          id: `act-${String(a.id)}`,
          title: overdue ? 'Task overdue' : 'Open task',
          message: String(a.title ?? 'Activity'),
          createdAt: String(a.scheduledAt ?? a.updatedAt ?? a.createdAt ?? new Date().toISOString()),
          isRead: readIds.has(`act-${String(a.id)}`),
          href: isAdmin ? '/activities' : '/my-tasks',
          kind: overdue ? 'OVERDUE' : 'TASK',
        })
      }

      for (const l of leads.items ?? []) {
        const status = String(l.status ?? '')
        const assignee = l.assignedToId ? String(l.assignedToId) : ''
        if (!assignee) continue
        if (!isAdmin && assignee !== userId) continue
        if (['CONVERTED', 'LOST', 'UNQUALIFIED'].includes(status)) continue
        items.push({
          id: `lead-${String(l.id)}`,
          title: 'Lead assigned',
          message: `${String(l.name)}${l.company ? ` · ${String(l.company)}` : ''} (${status})`,
          createdAt: String(l.updatedAt ?? l.createdAt ?? new Date().toISOString()),
          isRead: readIds.has(`lead-${String(l.id)}`),
          href: '/sale-tracking',
          kind: 'LEAD',
        })
      }

      for (const t of tickets.items ?? []) {
        const status = String(t.status ?? '')
        const assignee = t.assignedToId ? String(t.assignedToId) : ''
        if (!assignee) continue
        if (!isAdmin && assignee !== userId) continue
        if (['RESOLVED', 'CLOSED'].includes(status)) continue
        const breached = Boolean(t.slaBreached)
        items.push({
          id: `ticket-${String(t.id)}`,
          title: breached ? 'Ticket SLA breached' : 'Open ticket',
          message: `#${String(t.ticketNo ?? '')} ${String(t.subject ?? 'Support')}`,
          createdAt: String(t.updatedAt ?? t.createdAt ?? new Date().toISOString()),
          isRead: readIds.has(`ticket-${String(t.id)}`),
          href: `/tickets/${String(t.id)}`,
          kind: 'TICKET',
        })
      }

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      set({ items: items.slice(0, 30), lastFetchedAt: Date.now(), loading: false })
    } catch {
      set({ loading: false, lastFetchedAt: Date.now() })
    }
  },

  markRead: (id, userId) => {
    const readIds = loadReadIds(userId)
    readIds.add(id)
    saveReadIds(userId, readIds)
    set({
      items: get().items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    })
  },

  markAllRead: (userId) => {
    const readIds = loadReadIds(userId)
    for (const n of get().items) readIds.add(n.id)
    saveReadIds(userId, readIds)
    set({ items: get().items.map((n) => ({ ...n, isRead: true })) })
  },
}))
