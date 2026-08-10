import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Briefcase,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Phone,
  RefreshCw,
  Ticket,
  UserPlus,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, activityStatusColor, leadStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

type Row = Record<string, unknown>

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function sortPending(a: Row, b: Row) {
  const as = a.scheduledAt ? new Date(String(a.scheduledAt)).getTime() : Number.MAX_SAFE_INTEGER
  const bs = b.scheduledAt ? new Date(String(b.scheduledAt)).getTime() : Number.MAX_SAFE_INTEGER
  if (as !== bs) return as - bs
  return new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime()
}

export function EmployeeDashboardPage() {
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [leads, setLeads] = useState<Row[]>([])
  const [deals, setDeals] = useState<Row[]>([])
  const [activities, setActivities] = useState<Row[]>([])
  const [tickets, setTickets] = useState<Row[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isTenantSession() || !user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [leadsPage, dealsPage, actsPage, ticketsPage] = await Promise.all([
        api.leads({ limit: 50, assignedToId: user.id }),
        api.deals({ limit: 50, ownerUserId: user.id }),
        api.activities({ limit: 100, assignedToId: user.id }),
        api.tickets({ limit: 50, assignedToId: user.id }),
      ])
      setLeads(leadsPage.items)
      setDeals(dealsPage.items)
      setActivities(actsPage.items)
      setTickets(ticketsPage.items)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load your work',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, user?.id])

  useEffect(() => {
    void load()
  }, [load])

  const pendingActs = useMemo(
    () =>
      activities
        .filter((a) => ['PENDING', 'OVERDUE'].includes(String(a.status)))
        .slice()
        .sort(sortPending),
    [activities],
  )

  const completedToday = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return activities.filter(
      (a) =>
        String(a.status) === 'COMPLETED' &&
        a.completedAt &&
        new Date(String(a.completedAt)) >= start,
    ).length
  }, [activities])

  useEffect(() => {
    if (!pendingActs.length) {
      setFocusId(null)
      return
    }
    if (!focusId || !pendingActs.some((a) => String(a.id) === focusId)) {
      setFocusId(String(pendingActs[0].id))
    }
  }, [pendingActs, focusId])

  const currentTask = pendingActs.find((a) => String(a.id) === focusId) ?? pendingActs[0] ?? null
  const queue = pendingActs.filter((a) => String(a.id) !== String(currentTask?.id))
  const openTickets = tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(String(t.status)))
  const openDeals = deals.filter((d) => !d.closedAt)
  const pipelineValue = openDeals.reduce((sum, d) => sum + num(d.amount), 0)

  async function completeCurrent() {
    if (!currentTask) return
    setCompleting(true)
    try {
      await api.completeActivity(String(currentTask.id))
      const remaining = pendingActs.filter((a) => String(a.id) !== String(currentTask.id))
      const next = remaining[0]
      addToast({
        type: 'success',
        message: next
          ? `Done — next up: ${String(next.title)}`
          : 'All assigned tasks completed. Nice work!',
      })
      setFocusId(next ? String(next.id) : null)
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not complete task',
      })
    } finally {
      setCompleting(false)
    }
  }

  function relatedLink(task: Row) {
    if (task.dealId) return { to: `/deals/${task.dealId}`, label: 'Open linked deal' }
    if (task.contactId) return { to: `/contacts/${task.contactId}`, label: 'Open contact' }
    if (task.accountId) return { to: `/accounts/${task.accountId}`, label: 'Open account' }
    if (task.leadId) return { to: '/leads', label: 'View leads' }
    return null
  }

  const stats = [
    { label: 'My leads', value: leads.length, icon: UserPlus, to: '/leads', tint: 'bg-blue-50 text-accent-blue' },
    { label: 'Open deals', value: openDeals.length, icon: Briefcase, to: '/deals', tint: 'bg-violet-50 text-accent-purple' },
    {
      label: 'Pending tasks',
      value: pendingActs.length,
      icon: CheckSquare,
      to: '/my-tasks',
      tint: 'bg-amber-50 text-accent-amber',
    },
    {
      label: 'Open tickets',
      value: openTickets.length,
      icon: Ticket,
      to: '/tickets',
      tint: 'bg-emerald-50 text-accent-green',
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hi, ${user?.name?.split(' ')[0] ?? 'there'}`}
        breadcrumbs={[{ label: 'Employee desk' }, { label: 'My work' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/my-tasks">
              <Button variant="outline">
                <CheckSquare size={16} /> My Tasks
              </Button>
            </Link>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        }
      />

      <PageTip moduleKey="crm.employee" />

      <div className="rounded-[10px] border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">Employee desk</span> — this is not the company
        analytics dashboard. You only see work assigned to you. Complete tasks so your admin can track Team
        work.{' '}
        <Link to="/help" className="font-medium text-accent-blue hover:underline">
          How it works →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to}>
            <Card className="transition hover:border-accent-blue/40">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${s.tint}`}>
                  <s.icon size={18} />
                </div>
                <div>
                  <div className="text-2xl font-semibold text-text-primary">{s.value}</div>
                  <div className="text-sm text-text-secondary">{s.label}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-accent-blue/30 bg-gradient-to-br from-blue-50/80 to-white">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Focus — current task</h2>
            <p className="text-sm text-text-secondary">
              {completedToday} completed today · {pendingActs.length} still open
            </p>
          </div>
          {currentTask ? (
            <Badge color={activityStatusColor[String(currentTask.status)] ?? 'amber'}>
              {labelize(String(currentTask.type))} · {labelize(String(currentTask.status))}
            </Badge>
          ) : null}
        </div>

        {!loading && !currentTask ? (
          <div className="rounded-[8px] border border-dashed border-border bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto text-accent-green" size={28} />
            <p className="mt-2 font-medium">No pending tasks assigned to you</p>
            <p className="mt-1 text-sm text-text-secondary">
              When an admin assigns a lead or activity to you, it appears here and under My Tasks.
            </p>
            <Link to="/my-tasks" className="mt-3 inline-block text-sm text-accent-blue hover:underline">
              Open My Tasks →
            </Link>
          </div>
        ) : currentTask ? (
          <div className="rounded-[10px] border border-border bg-white p-5 shadow-sm">
            <h3 className="text-xl font-semibold text-text-primary">{String(currentTask.title)}</h3>
            {currentTask.description ? (
              <p className="mt-2 text-sm text-text-secondary">{String(currentTask.description)}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-text-secondary">
              <span>
                Due:{' '}
                {currentTask.scheduledAt
                  ? formatDateTime(String(currentTask.scheduledAt))
                  : 'No schedule'}
              </span>
              {currentTask.durationMinutes != null ? (
                <span>{num(currentTask.durationMinutes)} min</span>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => void completeCurrent()} disabled={completing}>
                <CheckCircle2 size={16} />
                {completing ? 'Completing…' : 'Mark completed → next'}
              </Button>
              {relatedLink(currentTask) ? (
                <Link to={relatedLink(currentTask)!.to}>
                  <Button variant="outline">{relatedLink(currentTask)!.label}</Button>
                </Link>
              ) : null}
              <Link to="/my-tasks">
                <Button variant="ghost">All my tasks</Button>
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">Loading your queue…</p>
        )}

        {queue.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Up next ({queue.length})
            </div>
            <div className="space-y-2">
              {queue.slice(0, 5).map((act, idx) => (
                <button
                  key={String(act.id)}
                  type="button"
                  onClick={() => setFocusId(String(act.id))}
                  className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-border bg-white px-3 py-2 text-left text-sm hover:border-accent-blue/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {idx + 2}
                    </span>
                    <span className="truncate font-medium">{String(act.title)}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-text-secondary" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-sm text-text-secondary">My open pipeline</div>
            <div className="text-2xl font-semibold text-text-primary">{formatCurrency(pipelineValue)}</div>
          </div>
          <Link to="/deals" className="text-sm font-medium text-accent-blue hover:underline">
            View my deals →
          </Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">My leads</h2>
            <Link to="/leads" className="text-sm text-accent-blue hover:underline">
              All
            </Link>
          </div>
          <div className="divide-y divide-border">
            {leads.slice(0, 6).map((lead) => (
              <Link
                key={String(lead.id)}
                to="/leads"
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{String(lead.name)}</div>
                  <div className="truncate text-sm text-text-secondary">
                    {String(lead.company ?? lead.city ?? '—')}
                  </div>
                </div>
                <Badge color={leadStatusColor[String(lead.status)] ?? 'slate'}>
                  {labelize(String(lead.status))}
                </Badge>
              </Link>
            ))}
            {!loading && !leads.length && (
              <p className="p-8 text-center text-sm text-text-secondary">No leads assigned to you yet.</p>
            )}
          </div>
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">Recent activities</h2>
            <Link to="/my-tasks" className="text-sm text-accent-blue hover:underline">
              All
            </Link>
          </div>
          <div className="divide-y divide-border">
            {activities.slice(0, 6).map((act) => (
              <button
                key={String(act.id)}
                type="button"
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface"
                onClick={() => {
                  if (['PENDING', 'OVERDUE'].includes(String(act.status))) {
                    setFocusId(String(act.id))
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                }}
              >
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[6px] bg-slate-100 text-text-secondary">
                  <Phone size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{String(act.title)}</span>
                    <Badge color={activityStatusColor[String(act.status)] ?? 'slate'}>
                      {labelize(String(act.status))}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {act.scheduledAt
                      ? formatDateTime(String(act.scheduledAt))
                      : timeAgo(String(act.createdAt))}
                  </div>
                </div>
              </button>
            ))}
            {!loading && !activities.length && (
              <p className="p-8 text-center text-sm text-text-secondary">No activities on your plate.</p>
            )}
          </div>
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">My deals</h2>
            <Link to="/deals" className="text-sm text-accent-blue hover:underline">
              All
            </Link>
          </div>
          <div className="divide-y divide-border">
            {deals.slice(0, 6).map((deal) => (
              <Link
                key={String(deal.id)}
                to={`/deals/${deal.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{String(deal.name)}</div>
                  <div className="text-sm text-text-secondary">{formatCurrency(num(deal.amount))}</div>
                </div>
                <Avatar name={user?.name ?? 'Me'} size="sm" />
              </Link>
            ))}
            {!loading && !deals.length && (
              <p className="p-8 text-center text-sm text-text-secondary">No deals owned by you.</p>
            )}
          </div>
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">My tickets</h2>
            <Link to="/tickets" className="text-sm text-accent-blue hover:underline">
              All
            </Link>
          </div>
          <div className="divide-y divide-border">
            {tickets.slice(0, 6).map((t) => (
              <Link
                key={String(t.id)}
                to={`/tickets/${t.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{String(t.subject)}</div>
                  <div className="text-sm text-text-secondary">
                    {labelize(String(t.priority ?? 'MEDIUM'))}
                  </div>
                </div>
                <Badge color="blue">{labelize(String(t.status))}</Badge>
              </Link>
            ))}
            {!loading && !tickets.length && (
              <p className="p-8 text-center text-sm text-text-secondary">No tickets assigned to you.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

export default EmployeeDashboardPage
