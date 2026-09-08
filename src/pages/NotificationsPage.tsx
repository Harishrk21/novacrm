import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageTabs } from '@/components/ui/PageTabs'
import { timeAgo, cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useNotificationsStore } from '@/store/notificationsStore'
import { AiAssistCard } from '@/components/ai/AiAssistCard'
import { api } from '@/lib/api'

function typeColor(type: string) {
  if (type.includes('PENDING') || type.includes('CREATED')) return 'amber' as const
  if (type.includes('ASSIGNED') || type.includes('REASSIGNED')) return 'blue' as const
  if (type.includes('CLOSED') || type.includes('APPROV')) return 'green' as const
  if (type.includes('PROGRESS')) return 'purple' as const
  return 'gray' as const
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? '')
  const role = useAuthStore((s) => s.user?.role)
  const items = useNotificationsStore((s) => s.items)
  const unreadCount = useNotificationsStore((s) => s.unreadCount)
  const loading = useNotificationsStore((s) => s.loading)
  const load = useNotificationsStore((s) => s.load)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)
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
          <Button
            variant="outline"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead(userId)}
          >
            <CheckCheck size={16} /> Mark all read
          </Button>
        }
      />

      <p className="mb-4 text-sm text-text-secondary">
        Real-time updates for your role
        {role ? ` (${role.replaceAll('_', ' ')})` : ''} — ticket assignment, progress, and approvals.
      </p>

      {filtered[0] ? (
        <div className="mb-4">
          <AiAssistCard
            title="Notification AI"
            subtitle="Shorten / clarify the latest notification title. Does not send messages."
            actions={[
              {
                id: 'shorten',
                label: 'Clarify latest title',
                run: () =>
                  api.aiPolish({
                    text: `${filtered[0].title ?? ''}\n${filtered[0].message ?? ''}`,
                    action: 'shorten_title',
                  }),
              },
              {
                id: 'translate',
                label: 'Simplify / translate',
                run: () =>
                  api.aiPolish({
                    text: `${filtered[0].title ?? ''}\n${filtered[0].message ?? ''}`,
                    action: 'translate_simplify',
                    target: 'simple',
                  }),
              },
            ]}
          />
        </div>
      ) : null}

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
        <div className="mb-4 flex flex-wrap gap-2">
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
          <div className="p-8 text-center text-sm text-text-secondary">Loading notifications…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            subtitle="Ticket creates, assignments, progress updates, and approvals will appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-muted/40',
                    !n.isRead && 'bg-accent-soft/40',
                  )}
                  onClick={() => {
                    void markRead(n.id, userId)
                    if (n.href) navigate(n.href)
                  }}
                >
                  <div className="mt-0.5 rounded-full bg-muted p-2 text-text-secondary">
                    <Bell size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text-primary">{n.title}</span>
                      {!n.isRead ? <Badge color="blue">New</Badge> : null}
                      <Badge color={typeColor(n.type ?? n.kind)}>
                        {(n.type ?? n.kind).replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-text-secondary">{n.message}</p>
                    <div className="mt-1 text-xs text-text-secondary">{timeAgo(n.createdAt)}</div>
                  </div>
                  {n.href ? (
                    <Link
                      to={n.href}
                      className="shrink-0 text-xs font-medium text-accent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open
                    </Link>
                  ) : null}
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
