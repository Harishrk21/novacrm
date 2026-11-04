import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  ListTodo,
  Play,
  RefreshCw,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, activityStatusColor, leadStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { formatServiceId } from '@/lib/serviceId'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { BlockSkeleton } from '@/components/ui/Skeleton'
import { saleIsCompleted } from '@/lib/salesFlow'
import { isServiceEngineer } from '@/lib/roles'
import { useFieldShell } from '@/hooks/useFieldShell'
import {
  activityKindLabel,
  activityReminderKind,
  activityWorkqueueNav,
  formatActivityDueLabel,
  isActivityDueTodayOrOverdue,
} from '@/lib/activityReminders'

type Row = Record<string, unknown>

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function sortSla(a: Row, b: Row) {
  const as = a.slaDueAt ? new Date(String(a.slaDueAt)).getTime() : Number.MAX_SAFE_INTEGER
  const bs = b.slaDueAt ? new Date(String(b.slaDueAt)).getTime() : Number.MAX_SAFE_INTEGER
  if (as !== bs) return as - bs
  return new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime()
}

export function EmployeeDashboardPage() {
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const fieldShell = useFieldShell()
  const engineer = isServiceEngineer(user?.role)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [leads, setLeads] = useState<Row[]>([])
  const [activities, setActivities] = useState<Row[]>([])
  const [tickets, setTickets] = useState<Row[]>([])
  const [claimable, setClaimable] = useState<Row[]>([])
  const [summary, setSummary] = useState({ open: 0, overdue: 0, resolvedToday: 0 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [completeOpen, setCompleteOpen] = useState(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isTenantSession() || !user?.id) {
      setLoading(false)
      return
    }
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    try {
      // Live API only — mine=1 returns jobs assigned to / received / delivered by this user.
      // Engineers also get claimable=1 so Ready-to-accept pool jobs appear on Home.
      const ticketParams: Record<string, string | number | undefined> = {
        limit: 100,
        sort: 'sla',
        mine: 1,
        ...(engineer ? { claimable: 1 } : {}),
      }
      const [leadsPage, actsPage, ticketsPage, sum] = await Promise.all([
        api.leads({ limit: 50, assignedToId: user.id }),
        api.activities({ limit: 100, assignedToId: user.id }),
        api.tickets(ticketParams),
        api.ticketsSummary(),
      ])
      setLeads(leadsPage.items)
      setActivities(actsPage.items)
      const items = ticketsPage.items ?? []
      if (engineer) {
        setTickets(items.filter((t) => Boolean(t.assignedToId)))
        setClaimable(
          items.filter((t) => String(t.status) === 'OPEN' && !t.assignedToId),
        )
      } else {
        setTickets(items)
        setClaimable([])
      }
      setSummary({
        open: sum.open,
        overdue: sum.overdue,
        resolvedToday: sum.resolvedToday,
      })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load your work',
      })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [addToast, engineer, user?.id])

  useEffect(() => {
    void load()
  }, [load])

  const openTickets = useMemo(
    () =>
      tickets
        .filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(t.status)))
        .slice()
        .sort(sortSla),
    [tickets],
  )

  const pendingActs = useMemo(
    () =>
      activities
        .filter((a) => ['PENDING', 'OVERDUE'].includes(String(a.status)))
        .slice()
        .sort((a, b) => {
          const as = a.scheduledAt ? new Date(String(a.scheduledAt)).getTime() : Number.MAX_SAFE_INTEGER
          const bs = b.scheduledAt ? new Date(String(b.scheduledAt)).getTime() : Number.MAX_SAFE_INTEGER
          return as - bs
        }),
    [activities],
  )

  const dueTodayActs = useMemo(
    () => pendingActs.filter((a) => isActivityDueTodayOrOverdue(a)),
    [pendingActs],
  )

  useEffect(() => {
    if (!openTickets.length) {
      setFocusId(null)
      return
    }
    if (!focusId || !openTickets.some((t) => String(t.id) === focusId)) {
      setFocusId(String(openTickets[0].id))
    }
  }, [openTickets, focusId])

  const current = openTickets.find((t) => String(t.id) === focusId) ?? openTickets[0] ?? null
  const queue = openTickets.filter((t) => String(t.id) !== String(current?.id))

  async function startWork() {
    if (!current) return
    setBusy(true)
    try {
      await api.updateTicket(String(current.id), { status: 'IN_PROGRESS' })
      addToast({ type: 'success', message: 'Work started' })
      await load({ silent: true })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not update ticket',
      })
    } finally {
      setBusy(false)
    }
  }

  async function completeService() {
    if (!current) return
    setCompleteOpen(false)
    setBusy(true)
    try {
      // OPEN cannot jump to RESOLVED — start first if needed
      if (String(current.status) === 'OPEN') {
        await api.updateTicket(String(current.id), {
          status: 'IN_PROGRESS',
          sendWhatsApp: false,
        })
      }
      const updated = await api.updateTicket(String(current.id), { status: 'RESOLVED' })
      addToast({ type: 'success', message: 'Service completed' })
      if (updated.whatsapp?.fallbackWaLink && !updated.whatsapp.notified) {
        window.open(updated.whatsapp.fallbackWaLink, '_blank', 'noopener,noreferrer')
      }
      await load({ silent: true })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not complete ticket',
      })
    } finally {
      setBusy(false)
    }
  }

  const stats = [
    {
      label: 'Open tickets',
      // Match queue: OPEN + IN_PROGRESS + PENDING (not OPEN-only summary)
      value: openTickets.length,
      icon: Ticket,
      to: '/tickets',
      tint: 'bg-amber-50 text-accent-amber',
    },
    ...(engineer
      ? [
          {
            label: 'Ready to accept',
            value: claimable.length,
            icon: UserPlus,
            to: '/tickets?queue=awaiting',
            tint: 'bg-red-50 text-accent-red',
          },
        ]
      : [
          {
            label: 'SLA overdue',
            value: summary.overdue,
            icon: CheckSquare,
            to: '/tickets?slaBreached=1',
            tint: 'bg-red-50 text-accent-red',
          },
        ]),
    {
      label: 'Resolved today',
      value: summary.resolvedToday,
      icon: CheckCircle2,
      to: '/tickets?status=RESOLVED',
      tint: 'bg-emerald-50 text-accent-green',
    },
    {
      label: 'Pending tasks',
      value: pendingActs.length,
      icon: CheckSquare,
      to: '/my-tasks',
      tint: 'bg-blue-50 text-accent-blue',
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {!fieldShell ? (
              <Avatar name={user?.name ?? 'User'} src={user?.avatarUrl} size="lg" />
            ) : null}
            <span>{`Hi, ${user?.name?.split(' ')[0] ?? 'there'}`}</span>
          </span>
        }
        breadcrumbs={
          fieldShell
            ? undefined
            : [{ label: 'Service desk' }, { label: 'My work' }]
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {engineer ? (
              <Link
                to="/tickets?queue=awaiting"
                className={fieldShell ? 'flex-1' : undefined}
              >
                <Button
                  variant="outline"
                  className={cn(
                    fieldShell ? 'w-full min-h-11' : undefined,
                    'border-red-400/70 text-red-700 hover:bg-red-50 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-950/40',
                  )}
                >
                  <ListTodo size={16} /> Ready to accept
                  {claimable.length > 0 ? (
                    <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                      {claimable.length}
                    </span>
                  ) : null}
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/contacts">
                  <Button variant="outline">
                    <Users size={16} /> Contacts
                  </Button>
                </Link>
                <Link to="/tickets?open=1">
                  <Button>
                    <Ticket size={16} /> New ticket
                  </Button>
                </Link>
              </>
            )}
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className={fieldShell ? 'min-h-11' : undefined}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        }
      />

      {!fieldShell ? <PageTip moduleKey="crm.employee" /> : null}

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

      <Card className="border-accent-blue/30 bg-gradient-to-br from-amber-50/90 to-card dark:from-amber-950/35 dark:to-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Focus — next service ticket</h2>
            <p className="text-sm text-text-secondary">
              {summary.resolvedToday} resolved today · {openTickets.length} still open
            </p>
          </div>
          {current ? (
            <Badge color={current.slaBreached ? 'red' : 'amber'}>
              {labelize(String(current.status))}
              {current.slaBreached ? ' · overdue' : ''}
            </Badge>
          ) : null}
        </div>

        {!loading && !current ? (
          <div className="rounded-[8px] border border-dashed border-border bg-card p-8 text-center">
            <CheckCircle2 className="mx-auto text-accent-green" size={28} />
            <p className="mt-2 font-medium text-text-primary">No open tickets assigned to you</p>
            <p className="mt-1 text-sm text-text-secondary">
              Look up a walk-in customer in Contacts, then create a service ticket.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-3">
              <Link to="/contacts" className="text-sm text-accent-blue hover:underline">
                Open Contacts →
              </Link>
              <Link to="/tickets?open=1" className="text-sm text-accent-blue hover:underline">
                New ticket →
              </Link>
            </div>
          </div>
        ) : current ? (
          <div className="rounded-[10px] border border-border bg-card p-5 shadow-sm">
            <h3 className="text-xl font-semibold text-text-primary">
              {formatServiceId(current.ticketNo != null ? String(current.ticketNo) : undefined)} —{' '}
              {String(current.subject)}
            </h3>
            {current.description ? (
              <p className="mt-2 line-clamp-3 text-sm text-text-secondary">{String(current.description)}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-text-secondary">
              <span>
                SLA:{' '}
                {current.slaDueAt ? formatDateTime(String(current.slaDueAt)) : 'No deadline'}
              </span>
              <span>Priority: {labelize(String(current.priority))}</span>
            </div>
            <div
              className={cn(
                'mt-5 flex flex-wrap gap-2',
                fieldShell && 'flex-col',
              )}
            >
              {String(current.status) === 'OPEN' ? (
                <Button
                  onClick={() => void startWork()}
                  disabled={busy}
                  className={fieldShell ? 'min-h-12 w-full text-base' : undefined}
                >
                  <Play size={18} /> {busy ? 'Updating…' : 'Start work'}
                </Button>
              ) : null}
              <Button
                onClick={() => setCompleteOpen(true)}
                disabled={busy}
                className={fieldShell ? 'min-h-12 w-full text-base' : undefined}
              >
                <CheckCircle2 size={18} /> Complete service
              </Button>
              <Link to={`/tickets/${current.id}`} className={fieldShell ? 'w-full' : undefined}>
                <Button
                  variant="outline"
                  className={fieldShell ? 'min-h-12 w-full text-base' : undefined}
                >
                  Open ticket
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <BlockSkeleton lines={5} className="p-0" />
        )}

        {queue.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Up next ({queue.length})
            </div>
            <div className="space-y-2">
              {queue.slice(0, 5).map((t, idx) => (
                <button
                  key={String(t.id)}
                  type="button"
                  onClick={() => setFocusId(String(t.id))}
                  className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-border bg-card px-3 py-2 text-left text-sm text-text-primary hover:border-accent-blue/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-primary">
                      {idx + 2}
                    </span>
                    <span className="truncate font-medium text-text-primary">
                      {formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)}{' '}
                      {String(t.subject)}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-text-secondary" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {engineer && claimable.length > 0 ? (
        <Card
          padding={false}
          className="border-red-400/70 bg-red-50/60 dark:border-red-500/40 dark:bg-red-950/25"
        >
          <div className="flex items-center justify-between border-b border-red-200/80 px-4 py-3 dark:border-red-900/50">
            <h2 className="font-semibold text-red-800 dark:text-red-200">
              Ready to accept ({claimable.length})
            </h2>
            <Link
              to="/tickets?queue=awaiting"
              className="text-sm font-medium text-red-700 hover:underline dark:text-red-300"
            >
              Open pool →
            </Link>
          </div>
          <div className="divide-y divide-red-200/60 dark:divide-red-900/40">
            {claimable.slice(0, 5).map((t) => (
              <Link
                key={String(t.id)}
                to={`/tickets/${t.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-red-100/70 dark:hover:bg-red-950/50"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-text-primary">
                    {formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)} —{' '}
                    {String(t.subject)}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {t.createdAt ? timeAgo(String(t.createdAt)) : 'Open pool'}
                  </div>
                </div>
                <Badge color="red" solid>
                  Accept
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">My jobs ({tickets.length})</h2>
            <Link to="/tickets" className="text-sm text-accent-blue hover:underline">
              All my tickets
            </Link>
          </div>
          <div className="divide-y divide-border">
            {tickets.slice(0, 8).map((t) => (
              <Link
                key={String(t.id)}
                to={`/tickets/${t.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)} — {String(t.subject)}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {t.slaDueAt ? `SLA ${formatDateTime(String(t.slaDueAt))}` : timeAgo(String(t.createdAt))}
                  </div>
                </div>
                <Badge color={String(t.slaBreached) === 'true' || t.slaBreached === true ? 'red' : 'amber'}>
                  {labelize(String(t.status))}
                </Badge>
              </Link>
            ))}
            {!loading && !tickets.length && (
              <p className="p-6 text-center text-sm text-text-secondary">
                {engineer
                  ? 'No jobs assigned to you yet. Check Ready to accept for open pool tickets.'
                  : 'No jobs assigned to you yet. When an admin assigns a ticket, it appears here live.'}
              </p>
            )}
          </div>
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="font-semibold">
                {dueTodayActs.length ? 'Due today' : 'Pending tasks'}
              </h2>
              {dueTodayActs.length > 0 ? (
                <p className="text-xs text-text-secondary">
                  Calls, tasks & meetings from Workqueue — {dueTodayActs.length} due
                </p>
              ) : null}
            </div>
            <Link to="/workqueue" className="text-sm text-accent-blue hover:underline">
              Workqueue
            </Link>
          </div>
          <div className="divide-y divide-border">
            {(dueTodayActs.length ? dueTodayActs : pendingActs).slice(0, 6).map((act) => {
              const kind = activityReminderKind(act.type)
              return (
                <Link
                  key={String(act.id)}
                  to={activityWorkqueueNav(kind)}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{String(act.title)}</div>
                    <div className="text-xs text-text-secondary">
                      {activityKindLabel(kind)}
                      {' · '}
                      {act.scheduledAt
                        ? formatActivityDueLabel(act.scheduledAt)
                        : timeAgo(String(act.createdAt))}
                    </div>
                  </div>
                  <Badge
                    color={
                      isActivityDueTodayOrOverdue(act)
                        ? 'amber'
                        : (activityStatusColor[String(act.status)] ?? 'slate')
                    }
                  >
                    {isActivityDueTodayOrOverdue(act) ? 'Due' : labelize(String(act.status))}
                  </Badge>
                </Link>
              )
            })}
            {!loading && !pendingActs.length && (
              <p className="p-6 text-center text-sm text-text-secondary">
                No pending calls, tasks or meetings. Create them from Workqueue — you&apos;ll see a reminder here on that day.
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card padding={false}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">My leads</h2>
          <Link to="/sale-tracking" className="text-sm text-accent-blue hover:underline">
            Open leads
          </Link>
        </div>
        <div className="divide-y divide-border">
          {leads
            .filter((lead) => !saleIsCompleted(lead))
            .slice(0, 5)
            .map((lead) => (
            <Link
              key={String(lead.id)}
              to="/sale-tracking"
              className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface"
            >
              <span className="flex min-w-0 items-center gap-2 truncate font-medium">
                <UserPlus size={16} className="shrink-0 text-text-secondary" />
                {String(lead.name)}
              </span>
              {saleIsCompleted(lead) ? (
                <Badge color="green">Completed</Badge>
              ) : (
                <Badge color={leadStatusColor[String(lead.status)] ?? 'slate'}>
                  {labelize(String(lead.status))}
                </Badge>
              )}
            </Link>
          ))}
          {!loading && !leads.filter((lead) => !saleIsCompleted(lead)).length && (
            <p className="p-6 text-center text-sm text-text-secondary">No open leads assigned.</p>
          )}
        </div>
      </Card>

      <Modal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title="Complete service?"
        subtitle={
          current
            ? `${formatServiceId(current.ticketNo != null ? String(current.ticketNo) : undefined)} — ${String(current.subject)}`
            : undefined
        }
        size="sm"
        accent="emerald"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void completeService()} disabled={busy}>
              <CheckCircle2 size={16} />
              {busy ? 'Saving…' : 'Mark complete'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          This marks the job as done and notifies the customer on WhatsApp when possible.
        </p>
      </Modal>
    </div>
  )
}

export default EmployeeDashboardPage
