import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, Inbox, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageTabs } from '@/components/ui/PageTabs'
import { NotificationItem } from '@/components/notifications/NotificationItem'
import { isExpiredNotification, resolveOpenPath } from '@/lib/notificationOpen'
import { useAuthStore } from '@/store/authStore'
import { useNotificationsStore } from '@/store/notificationsStore'
import { useUIStore } from '@/store/uiStore'
import { TableSkeleton } from '@/components/ui/Skeleton'

type NotifTab = 'active' | 'unread' | 'expired'

export function NotificationsPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const userId = useAuthStore((s) => s.user?.id ?? '')
  const role = useAuthStore((s) => s.user?.role)
  const items = useNotificationsStore((s) => s.items)
  const unreadCount = useNotificationsStore((s) => s.unreadCount)
  const loading = useNotificationsStore((s) => s.loading)
  const load = useNotificationsStore((s) => s.load)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)
  const clearOne = useNotificationsStore((s) => s.clearOne)
  const clearAll = useNotificationsStore((s) => s.clearAll)
  const [tab, setTab] = useState<NotifTab>('active')
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => {
    void load(userId, role)
    const id = window.setInterval(() => void load(userId, role), 30000)
    return () => window.clearInterval(id)
  }, [userId, role, load])

  const { activeItems, unreadItems, expiredItems } = useMemo(() => {
    const active: typeof items = []
    const unread: typeof items = []
    const expired: typeof items = []
    for (const n of items) {
      if (isExpiredNotification(n)) expired.push(n)
      else {
        active.push(n)
        if (!n.isRead) unread.push(n)
      }
    }
    return { activeItems: active, unreadItems: unread, expiredItems: expired }
  }, [items])

  const filtered = useMemo(() => {
    const base =
      tab === 'expired' ? expiredItems : tab === 'unread' ? unreadItems : activeItems
    if (!typeFilter) return base
    return base.filter((n) => (n.type ?? n.kind).includes(typeFilter))
  }, [tab, activeItems, unreadItems, expiredItems, typeFilter])

  const types = useMemo(() => {
    const source =
      tab === 'expired' ? expiredItems : tab === 'unread' ? unreadItems : activeItems
    const set = new Set<string>()
    for (const n of source) {
      const t = n.type || n.kind
      if (t) set.add(t)
    }
    return [...set].sort()
  }, [tab, activeItems, unreadItems, expiredItems])

  function openNotification(n: (typeof items)[number]) {
    const path = resolveOpenPath(n, { role })
    void markRead(n.id, userId)
    navigate(path)
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Notifications"
        count={unreadCount}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Notifications' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={unreadCount === 0}
              onClick={() => void markAllRead(userId)}
            >
              <CheckCheck size={14} /> Mark all read
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0}
              onClick={() => {
                void clearAll().then(() => {
                  addToast({ type: 'success', message: 'All notifications cleared' })
                })
              }}
            >
              <Trash2 size={14} /> Clear all
            </Button>
          </div>
        }
      />

      <p className="mb-3 text-xs leading-relaxed text-text-secondary">
        Tap a notification or Open to go to the related screen. When a task is done, that alert moves
        to Expired / Old.
      </p>

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => setTab(id as NotifTab)}
        tabs={[
          { id: 'active', label: 'Active', count: activeItems.length },
          { id: 'unread', label: 'Unread', count: unreadItems.length },
          { id: 'expired', label: 'Expired / Old', count: expiredItems.length },
        ]}
      />

      {types.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={typeFilter === '' ? 'primary' : 'outline'}
            onClick={() => setTypeFilter('')}
          >
            All types
          </Button>
          {types.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={typeFilter === t ? 'primary' : 'outline'}
              onClick={() => setTypeFilter(t)}
            >
              {t.replaceAll('_', ' ')}
            </Button>
          ))}
        </div>
      ) : null}

      <Card padding={false} className="overflow-hidden">
        {loading && items.length === 0 ? (
          <TableSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title={
              tab === 'unread'
                ? 'No unread notifications'
                : tab === 'expired'
                  ? 'No expired notifications'
                  : 'No active notifications'
            }
            subtitle={
              tab === 'expired'
                ? 'Resolved alerts (done / superseded) appear here.'
                : 'Ticket creates, assignments, progress updates, and approvals will appear here.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((n) => {
              const expired = isExpiredNotification(n)
              return (
                <li key={n.id}>
                  <NotificationItem
                    n={n}
                    density="comfortable"
                    expired={expired}
                    showTypeBadge
                    onOpen={() => openNotification(n)}
                    onClear={() => {
                      void clearOne(n.id)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default NotificationsPage
