import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock3, Filter, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Badge, activityStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

type Row = Record<string, unknown>
type Tab = 'open' | 'done' | 'all'

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function sortOpen(a: Row, b: Row) {
  const as = a.scheduledAt ? new Date(String(a.scheduledAt)).getTime() : Number.MAX_SAFE_INTEGER
  const bs = b.scheduledAt ? new Date(String(b.scheduledAt)).getTime() : Number.MAX_SAFE_INTEGER
  if (as !== bs) return as - bs
  return new Date(String(a.createdAt)).getTime() - new Date(String(b.createdAt)).getTime()
}

function related(task: Row) {
  const cf = (task.customFields as Record<string, unknown> | null) ?? null
  const ticketId = cf?.ticketId ? String(cf.ticketId) : ''
  if (ticketId) return { to: `/tickets/${ticketId}`, label: 'Ticket' }
  if (task.contactId) return { to: `/contacts/${task.contactId}`, label: 'Customer' }
  if (task.accountId) return { to: `/accounts/${task.accountId}`, label: 'Account' }
  if (task.leadId) return { to: '/leads', label: 'Lead' }
  return null
}

export function MyTasksPage() {
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const [items, setItems] = useState<Row[]>([])
  const [tickets, setTickets] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('open')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [outcome, setOutcome] = useState('')

  const load = useCallback(async () => {
    if (!isTenantSession() || !user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [page, ticketPage] = await Promise.all([
        api.activities({ limit: 200, assignedToId: user.id }),
        api.tickets({ limit: 100, mine: 1, sort: 'sla' }),
      ])
      setItems(page.items)
      setTickets(
        (ticketPage.items ?? []).filter((t) =>
          ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(t.status)),
        ),
      )
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load tasks',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, user?.id])

  useEffect(() => {
    void load()
  }, [load])

  const openItems = useMemo(
    () =>
      items
        .filter((a) => ['PENDING', 'OVERDUE'].includes(String(a.status)))
        .slice()
        .sort(sortOpen),
    [items],
  )
  const doneItems = useMemo(
    () =>
      items
        .filter((a) => String(a.status) === 'COMPLETED')
        .slice()
        .sort(
          (a, b) =>
            new Date(String(b.completedAt ?? b.updatedAt ?? b.createdAt)).getTime() -
            new Date(String(a.completedAt ?? a.updatedAt ?? a.createdAt)).getTime(),
        ),
    [items],
  )

  const visible = tab === 'open' ? openItems : tab === 'done' ? doneItems : items

  async function markComplete(task: Row) {
    const id = String(task.id)
    setBusyId(id)
    try {
      if (outcome.trim()) {
        await api.updateActivity(id, { outcome: outcome.trim() })
      }
      await api.completeActivity(id)
      addToast({ type: 'success', message: `Completed: ${String(task.title)}` })
      setExpanded(null)
      setOutcome('')
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not complete task',
      })
    } finally {
      setBusyId(null)
    }
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'open', label: 'Open', count: openItems.length },
    { id: 'done', label: 'Completed', count: doneItems.length },
    { id: 'all', label: 'All', count: items.length },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Tasks"
        breadcrumbs={[{ label: 'My work', to: '/' }, { label: 'My Tasks' }]}
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />
      <PageTip moduleKey="crm.employee" />

      <p className="text-sm text-text-secondary">
        Live work assigned to you — service tickets and follow-up tasks from the database (not demo data).
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-amber-50 text-accent-amber">
              <Clock3 size={18} />
            </div>
            <div>
              <div className="text-2xl font-semibold">{tickets.length}</div>
              <div className="text-sm text-text-secondary">Open tickets</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-blue-50 text-accent-blue">
              <Clock3 size={18} />
            </div>
            <div>
              <div className="text-2xl font-semibold">{openItems.length}</div>
              <div className="text-sm text-text-secondary">Open tasks</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-emerald-50 text-accent-green">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <div className="text-2xl font-semibold">{doneItems.length}</div>
              <div className="text-sm text-text-secondary">Completed tasks</div>
            </div>
          </div>
        </Card>
      </div>

      {tickets.length > 0 ? (
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">Assigned service tickets</h2>
            <Link to="/tickets" className="text-sm text-accent-blue hover:underline">
              My tickets →
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {tickets.map((t) => (
              <li key={String(t.id)}>
                <Link
                  to={`/tickets/${t.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      #{String(t.ticketNo)} — {String(t.subject)}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {t.slaDueAt ? `SLA ${formatDateTime(String(t.slaDueAt))}` : timeAgo(String(t.createdAt))}
                    </div>
                  </div>
                  <Badge color={t.slaBreached ? 'red' : 'amber'}>{labelize(String(t.status))}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padding={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Filter size={16} className="text-text-secondary" />
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-[6px] px-3 py-1.5 text-sm font-medium',
                tab === t.id ? 'bg-accent-blue text-white' : 'bg-surface text-text-secondary hover:text-text-primary',
              )}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-text-secondary">Loading your tasks…</p>
        ) : !visible.length ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="mx-auto text-accent-green" size={28} />
            <p className="mt-2 font-medium">
              {tab === 'open' ? 'No open tasks right now' : 'Nothing in this list yet'}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              When your admin assigns a lead or activity to you, it shows up here automatically.
            </p>
            <Link to="/" className="mt-3 inline-block text-sm text-accent-blue hover:underline">
              Back to My Work →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((task) => {
              const id = String(task.id)
              const isOpen = ['PENDING', 'OVERDUE'].includes(String(task.status))
              const rel = related(task)
              const isExpanded = expanded === id
              return (
                <li key={id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-text-primary">{String(task.title)}</h3>
                        <Badge color={activityStatusColor[String(task.status)] ?? 'slate'}>
                          {labelize(String(task.status))}
                        </Badge>
                        <Badge color="blue">{labelize(String(task.type))}</Badge>
                      </div>
                      {task.description ? (
                        <p className="mt-1 text-sm text-text-secondary">{String(task.description)}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-secondary">
                        <span>
                          Due:{' '}
                          {task.scheduledAt
                            ? formatDateTime(String(task.scheduledAt))
                            : 'No schedule'}
                        </span>
                        {task.durationMinutes != null ? <span>{num(task.durationMinutes)} min</span> : null}
                        <span>Updated {timeAgo(String(task.updatedAt ?? task.createdAt))}</span>
                        {rel ? (
                          <Link to={rel.to} className="text-accent-blue hover:underline">
                            Open {rel.label}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    {isOpen ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setExpanded(isExpanded ? null : id)
                            setOutcome('')
                          }}
                        >
                          {isExpanded ? 'Cancel' : 'Complete…'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === id}
                          onClick={() => void markComplete(task)}
                        >
                          <CheckCircle2 size={14} />
                          {busyId === id ? 'Saving…' : 'Mark complete'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {isExpanded && isOpen ? (
                    <div className="mt-3 rounded-[8px] border border-border bg-surface p-3">
                      <label className="block text-sm font-medium text-text-secondary">
                        Outcome / notes (optional)
                        <textarea
                          className="mt-1 min-h-20 w-full rounded-[6px] border border-border bg-card p-2 text-sm text-text-primary"
                          value={outcome}
                          onChange={(e) => setOutcome(e.target.value)}
                          placeholder="e.g. Called customer, demo scheduled for Friday"
                        />
                      </label>
                      <Button
                        className="mt-2"
                        disabled={busyId === id}
                        onClick={() => void markComplete(task)}
                      >
                        <CheckCircle2 size={16} />
                        {busyId === id ? 'Saving…' : 'Save & mark complete'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default MyTasksPage
