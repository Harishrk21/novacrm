import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Inbox, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageTabs } from '@/components/ui/PageTabs'
import { timeAgo, cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useNotificationsStore } from '@/store/notificationsStore'
import { useUIStore } from '@/store/uiStore'

function typeColor(type: string) {
  if (type.includes('PENDING') || type.includes('CREATED')) return 'amber' as const
  if (type.includes('ASSIGNED') || type.includes('REASSIGNED')) return 'blue' as const
  if (type.includes('CLOSED') || type.includes('APPROV')) return 'green' as const
  if (type.includes('PROGRESS')) return 'purple' as const
  return 'gray' as const
}

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
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => {
    void load(userId, role)
    const id = window.setInterval(() => void load(userId, role), 30000)
    return () => window.clearInterval(id)
  }, [userId, role, load])

  const filtered = useMemo(() => {
    return items.filter((n) => {
      if (tab === 'unread' && n.isRead) return false
      if (typeFilter && !(n.type ?? n.kind).includes(typeFilter)) return false
      return true
    })
  }, [items, tab, typeFilter])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const n of items) {
      const t = n.type || n.kind
      if (t) set.add(t)
    }
    return [...set].sort()
  }, [items])

  return (
    <div>
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

      <p className="mb-3 text-xs text-text-secondary">
        Ticket assignment, progress, and approvals for your role
        {role ? ` (${role.replaceAll('_', ' ')})` : ''}. Resolved items update in place and mark as
        read.
      </p>

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => setTab(id as 'all' | 'unread')}
        tabs={[
          { id: 'all', label: 'All', count: items.length },
          { id: 'unread', label: 'Unread', count: unreadCount },
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

      <Card padding={false}>
        {loading && items.length === 0 ? (
          <div className="p-6 text-center text-sm text-text-secondary">Loading notifications…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            subtitle="Ticket creates, assignments, progress updates, and approvals will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((n) => (
              <li key={n.id} className="flex items-center">
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition hover:bg-muted/40',
                    !n.isRead && 'bg-accent-soft/40',
                  )}
                  onClick={() => {
                    void markRead(n.id, userId)
                    if (n.href) navigate(n.href)
                  }}
                >
                  <Bell
                    size={13}
                    className={cn(
                      'shrink-0 text-text-secondary',
                      !n.isRead && 'text-accent-blue',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {n.title}
                      </span>
                      {!n.isRead ? (
                        <Badge color="blue" className="!px-1.5 !py-0 text-[10px]">
                          New
                        </Badge>
                      ) : null}
                      <Badge
                        color={typeColor(n.type ?? n.kind)}
                        className="!px-1.5 !py-0 text-[10px]"
                      >
                        {(n.type ?? n.kind).replaceAll('_', ' ')}
                      </Badge>
                      <span className="text-[11px] text-text-secondary">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="truncate text-xs text-text-secondary">{n.message}</p>
                  </div>
                  {n.href ? (
                    <Link
                      to={n.href}
                      className="shrink-0 text-[11px] font-medium text-accent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open
                    </Link>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="mr-2 shrink-0 rounded-[6px] p-1.5 text-text-secondary hover:bg-muted hover:text-accent-red"
                  title="Clear notification"
                  aria-label="Clear notification"
                  onClick={() => void clearOne(n.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default NotificationsPage
