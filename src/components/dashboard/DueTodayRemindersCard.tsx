import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, ticketStatusColor, type BadgeColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeleteIconButton } from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/Modal'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import {
  activityKindLabel,
  formatActivityDueLabel,
  isActivityDueTodayOrOverdue,
  reminderFromActivity,
} from '@/lib/activityReminders'
import { can } from '@/lib/permissions'
import { formatServiceId } from '@/lib/serviceId'
import { BlockSkeleton } from '@/components/ui/Skeleton'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const OPEN_TICKET_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED'])

type FeedItem = {
  id: string
  title: string
  subtitle: string
  badge: string
  badgeColor: BadgeColor
  to: string
  sortAt: number
  source: 'activity' | 'lead' | 'ticket'
}

type Props = {
  hideWhenEmpty?: boolean
  className?: string
  title?: string
  subtitle?: string
  /** Mix live tickets (not closed) into the same list as dues */
  includeOpenTickets?: boolean
  /** `mine` = assigned to me; `desk` = active company queue */
  ticketMode?: 'mine' | 'desk'
  /** Sales: also mix lead follow-ups due today / overdue */
  includeLeadFollowups?: boolean
  primaryLinkLabel?: string
  primaryLinkTo?: string
}

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Show this many before "Show all" — keeps the home tiles/sections below in view. */
const COLLAPSED_ROWS = 5
/** Most rows the card ever holds; the rest live in Workqueue / Tickets. */
const MAX_ROWS = 30

/**
 * Home feed: Workqueue dues (and optional lead follow-ups) mixed with live open tickets.
 */
export function DueTodayRemindersCard({
  hideWhenEmpty = false,
  className,
  title = 'Due today',
  subtitle = 'Your calls, tasks & meetings from Workqueue — today & overdue',
  includeOpenTickets = false,
  ticketMode = 'mine',
  includeLeadFollowups = false,
  primaryLinkLabel = 'Workqueue →',
  primaryLinkTo = '/workqueue',
}: Props) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const canDelete = can(user?.role, 'activities:delete')
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<FeedItem[]>([])
  const [total, setTotal] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent)
      if (!isTenantSession() || !userId) {
        if (!silent) setLoading(false)
        setItems([])
        setTotal(0)
        return
      }
      if (!silent) setLoading(true)
      try {
        const ticketParams: Record<string, string | number | undefined> =
          ticketMode === 'desk'
            ? { limit: 40, sort: 'sla' }
            : { limit: 40, sort: 'sla', assignedToId: userId }

        const [actPage, ticketPage, leadPage] = await Promise.all([
          api.activities({ limit: 100, assignedToId: userId }).catch(() => ({
            items: [] as Array<Record<string, unknown>>,
          })),
          // Sales / warehouse have no tickets:view — skip instead of a 403
          includeOpenTickets && can(user?.role, 'tickets:view')
            ? api.tickets(ticketParams).catch(() => ({ items: [] as Array<Record<string, unknown>> }))
            : Promise.resolve({ items: [] as Array<Record<string, unknown>> }),
          includeLeadFollowups
            ? api.leads({ limit: 100, assignedToId: userId }).catch(() => ({
                items: [] as Array<Record<string, unknown>>,
              }))
            : Promise.resolve({ items: [] as Array<Record<string, unknown>> }),
        ])

        const feed: FeedItem[] = []
        const todayStart = startOfToday()
        const dueColor = (dueAt: number): BadgeColor => (dueAt && dueAt < todayStart ? 'red' : 'amber')

        for (const a of actPage.items ?? []) {
          if (!isActivityDueTodayOrOverdue(a)) continue
          const r = reminderFromActivity(a)
          feed.push({
            id: r.id,
            title: r.title,
            subtitle: r.subtitle,
            badge: r.dueLabel,
            badgeColor: dueColor(r.dueAt || 0),
            to: r.to,
            sortAt: r.dueAt || 0,
            source: 'activity',
          })
        }

        if (includeLeadFollowups) {
          const end = endOfToday()
          for (const l of leadPage.items ?? []) {
            if (['LOST', 'CONVERTED', 'UNQUALIFIED'].includes(String(l.status))) continue
            const cf = (l.customFields as Record<string, unknown> | null) ?? {}
            const iso = cf.reminder_at
              ? String(cf.reminder_at)
              : cf.follow_up_date
                ? `${String(cf.follow_up_date).slice(0, 10)}T10:00:00`
                : null
            if (!iso) continue
            const dueAt = new Date(iso).getTime()
            if (Number.isNaN(dueAt) || dueAt > end.getTime()) continue
            feed.push({
              id: `lead:${String(l.id)}`,
              title: String(l.name),
              subtitle:
                [l.phone, l.company].filter(Boolean).map(String).join(' · ') || 'Enquiry follow-up',
              badge: cf.reminder_at
                ? formatActivityDueLabel(cf.reminder_at)
                : String(cf.follow_up_date ?? '').slice(0, 10) || 'Due',
              badgeColor: dueColor(dueAt),
              to: `/sale-tracking/${String(l.id)}`,
              sortAt: dueAt,
              source: 'lead',
            })
          }
        }

        if (includeOpenTickets) {
          for (const t of ticketPage.items ?? []) {
            const status = String(t.status)
            if (!OPEN_TICKET_STATUSES.has(status)) continue
            if (ticketMode === 'mine' && String(t.assignedToId ?? '') !== String(userId)) continue
            const slaMs = t.slaDueAt ? new Date(String(t.slaDueAt)).getTime() : Number.NaN
            const createdMs = t.createdAt ? new Date(String(t.createdAt)).getTime() : Date.now()
            const svc = formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)
            const breached = Boolean(t.slaBreached)
            feed.push({
              id: `ticket:${String(t.id)}`,
              title: `${svc} — ${String(t.subject ?? 'Service job')}`,
              subtitle: [
                labelize(status),
                t.slaDueAt ? `SLA ${formatActivityDueLabel(t.slaDueAt)}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
              badge: breached ? 'SLA' : labelize(status),
              badgeColor: breached
                ? 'red'
                : ((ticketStatusColor[status] as BadgeColor | undefined) ?? 'sky'),
              to: `/tickets/${String(t.id)}`,
              // Tickets sort with dues: overdue SLA first, else created time
              sortAt: Number.isFinite(slaMs) ? slaMs : createdMs,
              source: 'ticket',
            })
          }
        }

        feed.sort((a, b) => a.sortAt - b.sortAt)
        setTotal(feed.length)
        setItems(feed.slice(0, MAX_ROWS))
      } catch {
        if (!silent) {
          setItems([])
          setTotal(0)
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [userId, includeOpenTickets, includeLeadFollowups, ticketMode],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function runDelete(rawId: string) {
    const id = rawId.startsWith('act:') ? rawId.slice(4) : rawId
    setBusyDelete(true)
    try {
      await api.deleteActivity(id)
      addToast({ type: 'success', message: 'Deleted' })
      setDeleteId(null)
      await load({ silent: true })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not delete',
      })
    } finally {
      setBusyDelete(false)
    }
  }

  if (!loading && hideWhenEmpty && items.length === 0) return null

  const showTickets = includeOpenTickets && can(user?.role, 'tickets:view')
  const emptyHint = showTickets
    ? 'Nothing due and no open tickets. Workqueue reminders and live jobs show up here together.'
    : 'Nothing due today. Create a call, task or meeting from Workqueue — it appears here on that day for your login.'

  const overdueCount = items.filter((r) => r.badgeColor === 'red').length
  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS)
  const hiddenCount = items.length - visible.length
  const showDeleteColumn = canDelete && items.some((r) => r.source === 'activity')

  return (
    <>
      <Card padding={false} className={className}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
              {total > 0 ? <Badge color="gray">{total}</Badge> : null}
              {overdueCount > 0 ? <Badge color="red">{overdueCount} overdue</Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-accent-blue hover:underline"
            onClick={() => navigate(primaryLinkTo)}
          >
            {primaryLinkLabel}
          </button>
        </div>
        {loading && items.length === 0 ? (
          <BlockSkeleton lines={3} />
        ) : items.length === 0 ? (
          <div className="space-y-3 p-4">
            <p className="text-sm text-text-secondary">{emptyHint}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate('/workqueue')}>
                Open workqueue
              </Button>
              {showTickets ? (
                <Button size="sm" variant="outline" onClick={() => navigate('/tickets')}>
                  Open tickets
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
          <ul
            className={cn(
              'divide-y divide-border',
              // Expanded list scrolls inside the card instead of pushing the page down
              expanded && 'max-h-[26rem] overflow-y-auto overscroll-contain',
            )}
          >
            {visible.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => navigate(r.to)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:opacity-90"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{r.title}</div>
                    <div className="truncate text-xs text-text-secondary">
                      {r.source === 'ticket'
                        ? r.subtitle
                        : r.source === 'lead'
                          ? `Follow-up · ${r.subtitle}`
                          : r.subtitle || activityKindLabel('task')}
                    </div>
                  </div>
                  <Badge color={r.badgeColor}>{r.badge}</Badge>
                </button>
                {showDeleteColumn ? (
                  // Fixed-width slot so badges line up whether or not a row can be deleted
                  <div className="flex w-8 shrink-0 justify-center">
                    {r.source === 'activity' ? (
                      <DeleteIconButton disabled={busyDelete} onClick={() => setDeleteId(r.id)} />
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 || expanded || total > items.length ? (
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
              {hiddenCount > 0 || expanded ? (
                <button
                  type="button"
                  className="font-medium text-accent-blue hover:underline"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? 'Show less' : `Show all ${items.length}`}
                </button>
              ) : (
                <span />
              )}
              {total > items.length ? (
                <button
                  type="button"
                  className="text-text-secondary hover:text-accent-blue hover:underline"
                  onClick={() => navigate(primaryLinkTo)}
                >
                  +{total - items.length} more in {primaryLinkLabel.replace(/\s*→\s*$/, '')}
                </button>
              ) : null}
            </div>
          ) : null}
          </>
        )}
      </Card>
      <ConfirmModal
        open={Boolean(deleteId)}
        onClose={() => !busyDelete && setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) void runDelete(deleteId)
        }}
        title="Delete this reminder?"
        body="This removes the call, task or meeting from your queue."
        confirmLabel={busyDelete ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        closeOnConfirm={false}
      />
    </>
  )
}
