import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Briefcase,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Play,
  RefreshCw,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Badge, activityStatusColor, leadStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import { formatCurrency, formatDateTime, timeAgo } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [leads, setLeads] = useState<Row[]>([])
  const [deals, setDeals] = useState<Row[]>([])
  const [activities, setActivities] = useState<Row[]>([])
  const [tickets, setTickets] = useState<Row[]>([])
  const [summary, setSummary] = useState({ open: 0, overdue: 0, resolvedToday: 0 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [completeOpen, setCompleteOpen] = useState(false)

  const load = useCallback(async () => {
    if (!isTenantSession() || !user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [leadsPage, dealsPage, actsPage, ticketsPage, sum] = await Promise.all([
        api.leads({ limit: 50, assignedToId: user.id }),
        api.deals({ limit: 50, ownerUserId: user.id }),
        api.activities({ limit: 100, assignedToId: user.id }),
        api.tickets({ limit: 100, assignedToId: user.id, sort: 'sla' }),
        api.ticketsSummary(),
      ])
      setLeads(leadsPage.items)
      setDeals(dealsPage.items)
      setActivities(actsPage.items)
      setTickets(ticketsPage.items)
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
      setLoading(false)
    }
  }, [addToast, user?.id])

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
  const openDeals = deals.filter((d) => !d.closedAt)
  const pipelineValue = openDeals.reduce((sum, d) => sum + num(d.amount), 0)

  async function startWork() {
    if (!current) return
    setBusy(true)
    try {
      await api.updateTicket(String(current.id), { status: 'IN_PROGRESS' })
      addToast({ type: 'success', message: 'Work started' })
      await load()
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
      const updated = await api.updateTicket(String(current.id), { status: 'RESOLVED' })
      addToast({ type: 'success', message: 'Service completed' })
      if (updated.whatsapp?.fallbackWaLink && !updated.whatsapp.notified) {
        window.open(updated.whatsapp.fallbackWaLink, '_blank', 'noopener,noreferrer')
      }
      await load()
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
      value: summary.open || openTickets.length,
      icon: Ticket,
      to: '/tickets',
      tint: 'bg-amber-50 text-accent-amber',
    },
    {
      label: 'SLA overdue',
      value: summary.overdue,
      icon: CheckSquare,
      to: '/tickets?slaBreached=1',
      tint: 'bg-red-50 text-accent-red',
    },
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
        title={`Hi, ${user?.name?.split(' ')[0] ?? 'there'}`}
        breadcrumbs={[{ label: 'Service desk' }, { label: 'My work' }]}
        actions={
          <div className="flex flex-wrap gap-2">
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
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        }
      />

      <PageTip moduleKey="crm.employee" />

      <div className="rounded-[10px] border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">Service desk</span> — look up the customer in
        Contacts, work your tickets by SLA, then Complete service (WhatsApp notifies the customer).{' '}
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

      <Card className="border-accent-blue/30 bg-gradient-to-br from-amber-50/80 to-white">
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
          <div className="rounded-[8px] border border-dashed border-border bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto text-accent-green" size={28} />
            <p className="mt-2 font-medium">No open tickets assigned to you</p>
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
          <div className="rounded-[10px] border border-border bg-white p-5 shadow-sm">
            <h3 className="text-xl font-semibold text-text-primary">
              #{String(current.ticketNo)} — {String(current.subject)}
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
            <div className="mt-5 flex flex-wrap gap-2">
              {String(current.status) === 'OPEN' ? (
                <Button onClick={() => void startWork()} disabled={busy}>
                  <Play size={16} /> {busy ? 'Updating…' : 'Start work'}
                </Button>
              ) : null}
              <Button onClick={() => setCompleteOpen(true)} disabled={busy}>
                <CheckCircle2 size={16} /> Complete service
              </Button>
              <Link to={`/tickets/${current.id}`}>
                <Button variant="outline">Open ticket</Button>
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
              {queue.slice(0, 5).map((t, idx) => (
                <button
                  key={String(t.id)}
                  type="button"
                  onClick={() => setFocusId(String(t.id))}
                  className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-border bg-white px-3 py-2 text-left text-sm hover:border-accent-blue/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {idx + 2}
                    </span>
                    <span className="truncate font-medium">
                      #{String(t.ticketNo)} {String(t.subject)}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-text-secondary" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">Pending tasks</h2>
            <Link to="/my-tasks" className="text-sm text-accent-blue hover:underline">
              All
            </Link>
          </div>
          <div className="divide-y divide-border">
            {pendingActs.slice(0, 5).map((act) => (
              <Link
                key={String(act.id)}
                to="/my-tasks"
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{String(act.title)}</div>
                  <div className="text-xs text-text-secondary">
                    {act.scheduledAt ? formatDateTime(String(act.scheduledAt)) : timeAgo(String(act.createdAt))}
                  </div>
                </div>
                <Badge color={activityStatusColor[String(act.status)] ?? 'slate'}>
                  {labelize(String(act.status))}
                </Badge>
              </Link>
            ))}
            {!loading && !pendingActs.length && (
              <p className="p-6 text-center text-sm text-text-secondary">No pending tasks.</p>
            )}
          </div>
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">Sales (secondary)</h2>
            <Link to="/leads" className="text-sm text-accent-blue hover:underline">
              Leads
            </Link>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-text-secondary">
                <UserPlus size={16} /> My leads
              </span>
              <span className="font-semibold">{leads.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-text-secondary">
                <Briefcase size={16} /> Open deals
              </span>
              <span className="font-semibold">{openDeals.length}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-text-secondary">Pipeline value</span>
              <span className="font-semibold">{formatCurrency(pipelineValue)}</span>
            </div>
            {leads.slice(0, 3).map((lead) => (
              <Link
                key={String(lead.id)}
                to="/leads"
                className="flex items-center justify-between gap-2 rounded-[6px] border border-border px-3 py-2 hover:bg-surface"
              >
                <span className="truncate font-medium">{String(lead.name)}</span>
                <Badge color={leadStatusColor[String(lead.status)] ?? 'slate'}>
                  {labelize(String(lead.status))}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Modal
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        title="Complete service?"
        subtitle={
          current
            ? `Ticket #${String(current.ticketNo)} — ${String(current.subject)}`
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
