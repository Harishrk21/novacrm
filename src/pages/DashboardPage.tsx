import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  ListTodo,
  Plus,
  Ticket,
  UserRound,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { api, isTenantSession } from '@/lib/api'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { EmployeeDashboardPage } from '@/pages/EmployeeDashboardPage'
import { AdminAnalyticsDashboard } from '@/pages/AdminAnalyticsDashboard'
import { APP_NAME } from '@/lib/branding'
import { isSalesExecutive } from '@/lib/roles'
import { formatServiceId } from '@/lib/serviceId'
import { cn } from '@/lib/utils'

export function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role)
  if (role === 'ADMIN') {
    return <AdminAnalyticsDashboard />
  }
  if (role === 'WAREHOUSE') {
    return <WarehouseHomePage />
  }
  if (role === 'SERVICE_DESK') {
    return <ServiceDeskHomePage />
  }
  if (isSalesExecutive(role)) {
    return <SalesExecutiveHomePage />
  }
  return <EmployeeDashboardPage />
}

function SalesExecutiveHomePage() {
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState({ pending: 0, demo: 0, converted: 0, needUpdate: 0 })
  const [demos, setDemos] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isTenantSession() || !user?.id) {
        setLoading(false)
        return
      }
      try {
        const page = await api.leads({ limit: 200, assignedToId: user.id })
        if (cancelled) return
        const items = page.items ?? []
        const demoRows = items.filter((l) => String(l.status) === 'DEMO')
        const today = new Date().toISOString().slice(0, 10)
        const needUpdate = demoRows.filter((l) => {
          const cf = (l.customFields as Record<string, unknown> | null) ?? {}
          const last = String(cf.demoLastUpdateAt ?? '').slice(0, 10)
          return last !== today
        }).length
        setCounts({
          pending: items.filter((l) => String(l.status) === 'NEW').length,
          demo: demoRows.length,
          converted: items.filter((l) => String(l.status) === 'CONVERTED').length,
          needUpdate,
        })
        setDemos(demoRows.slice(0, 8))
      } catch (e) {
        if (!cancelled) {
          addToast({
            type: 'error',
            message: e instanceof Error ? e.message : 'Could not load sales home',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addToast, user?.id])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
        actions={
          <Link to="/sale-tracking?open=1">
            <Button>New sale enquiry</Button>
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Pending', value: counts.pending, to: '/sale-tracking?status=NEW' },
          { label: 'Active demos', value: counts.demo, to: '/sale-tracking?status=DEMO' },
          { label: 'Need today’s update', value: counts.needUpdate, to: '/sale-tracking?status=DEMO' },
          { label: 'Converted', value: counts.converted, to: '/sale-tracking?status=CONVERTED' },
        ].map((s) => (
          <Link key={s.label} to={s.to}>
            <Card className="p-4 transition hover:border-accent-blue/40">
              <div className="text-xs text-text-secondary">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold text-text-primary">
                {loading ? '—' : s.value}
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <Card padding={false}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Active demos</h2>
            <p className="text-xs text-text-secondary">Open an enquiry to post today’s update</p>
          </div>
          <Link to="/sale-tracking?status=DEMO" className="text-xs font-medium text-accent-blue hover:underline">
            Sale tracking
          </Link>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : demos.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">No active demos — create an enquiry when a customer asks for one.</p>
        ) : (
          <ul className="divide-y divide-border">
            {demos.map((l) => {
              const cf = (l.customFields as Record<string, unknown> | null) ?? {}
              return (
                <li key={String(l.id)}>
                  <Link
                    to={`/sale-tracking/${String(l.id)}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary">{String(l.name)}</div>
                      <div className="truncate text-xs text-text-secondary">
                        {[l.company, cf.demoSerialNo ? `S/No ${cf.demoSerialNo}` : null]
                          .filter(Boolean)
                          .map(String)
                          .join(' · ') || 'Demo'}
                      </div>
                    </div>
                    <Badge color="amber">Demo</Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function WarehouseHomePage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Warehouse & billing"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/erp/inventory">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <div className="text-sm font-semibold text-text-primary">Inventory</div>
            <p className="mt-1 text-xs text-text-secondary">Serial stock, demo units, returns</p>
          </Card>
        </Link>
        <Link to="/erp/inventory?tab=demo">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <div className="text-sm font-semibold text-text-primary">Demo inventory</div>
            <p className="mt-1 text-xs text-text-secondary">Units out on demo + DC</p>
          </Card>
        </Link>
        <Link to="/erp/invoices">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <div className="text-sm font-semibold text-text-primary">Proforma invoices</div>
            <p className="mt-1 text-xs text-text-secondary">Create & print proforma for customers</p>
          </Card>
        </Link>
        <Link to="/erp/products">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <div className="text-sm font-semibold text-text-primary">Products</div>
            <p className="mt-1 text-xs text-text-secondary">Catalog & SKUs</p>
          </Card>
        </Link>
      </div>
    </div>
  )
}

function ServiceDeskHomePage() {
  const addToast = useUIStore((s) => s.addToast)
  const user = useAuthStore((s) => s.user)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState({
    open: 0,
    activeQueue: 0,
    overdue: 0,
    unassigned: 0,
    resolvedToday: 0,
  })
  const [recent, setRecent] = useState<Array<Record<string, unknown>>>([])
  const [unassigned, setUnassigned] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isTenantSession()) {
        setLoading(false)
        return
      }
      try {
        const [tSum, tickets, unassignedPage] = await Promise.all([
          api.ticketsSummary(),
          api.tickets({ limit: 10, sort: 'sla' }),
          api.tickets({ limit: 6, assignedToId: 'unassigned', sort: 'sla' }),
        ])
        if (cancelled) return
        const byStatus = tSum.byStatus ?? {}
        setSummary({
          open: Number(tSum.open ?? byStatus.OPEN ?? 0),
          activeQueue: Number(
            tSum.activeQueue ??
              (byStatus.OPEN ?? 0) + (byStatus.IN_PROGRESS ?? 0) + (byStatus.PENDING ?? 0),
          ),
          overdue: tSum.overdue,
          unassigned: tSum.unassigned,
          resolvedToday: tSum.resolvedToday,
        })
        setRecent(
          (tickets.items ?? [])
            .filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(t.status)))
            .slice(0, 8),
        )
        setUnassigned(
          (unassignedPage.items ?? [])
            .filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(t.status)))
            .slice(0, 6),
        )
      } catch (e) {
        if (!cancelled) {
          addToast({
            type: 'error',
            message: e instanceof Error ? e.message : 'Could not load desk home',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addToast])

  const metrics = [
    {
      label: 'Open',
      value: summary.open,
      hint: 'Awaiting start',
      to: '/tickets?status=OPEN',
      icon: CircleDot,
      tint: 'from-sky-500/15 to-transparent text-sky-700 dark:text-sky-300',
      ring: 'hover:ring-sky-400/40',
    },
    {
      label: 'Active queue',
      value: summary.activeQueue,
      hint: 'Open · in progress · pending',
      to: '/tickets',
      icon: ListTodo,
      tint: 'from-indigo-500/15 to-transparent text-indigo-700 dark:text-indigo-300',
      ring: 'hover:ring-indigo-400/40',
    },
    {
      label: 'Overdue SLA',
      value: summary.overdue,
      hint: summary.overdue > 0 ? 'Needs follow-up' : 'All on time',
      to: '/tickets?slaBreached=1',
      icon: AlertTriangle,
      tint: 'from-rose-500/15 to-transparent text-rose-700 dark:text-rose-300',
      ring: 'hover:ring-rose-400/40',
      alert: summary.overdue > 0,
    },
    {
      label: 'Unassigned',
      value: summary.unassigned,
      hint: 'Waiting for admin assign',
      to: '/tickets?unassigned=1',
      icon: UserRound,
      tint: 'from-amber-500/15 to-transparent text-amber-800 dark:text-amber-300',
      ring: 'hover:ring-amber-400/40',
      alert: summary.unassigned > 0,
    },
  ] as const

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service desk"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/contacts">
              <Button variant="outline" size="sm">
                <Users size={14} /> Customers
              </Button>
            </Link>
            <Link to="/tickets?open=1">
              <Button size="sm">
                <Plus size={14} /> New ticket
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="border-sky-200/70 bg-gradient-to-r from-sky-50/70 via-card to-card p-4 dark:border-sky-900/40 dark:from-sky-950/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Log the customer call, pick the machine, capture the issue — admin assigns the
              engineer next.
            </p>
          </div>
          <ol className="flex flex-wrap gap-1.5 text-[11px] font-medium text-text-secondary">
            {['1. Customer', '2. Machine', '3. Issue log', '4. Create OPEN'].map((step) => (
              <li
                key={step}
                className="rounded-md border border-border/80 bg-card/80 px-2 py-1 text-text-primary"
              >
                {step}
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((s) => {
          const Icon = s.icon
          return (
            <Link
              key={s.label}
              to={s.to}
              className={cn(
                'relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition',
                'bg-gradient-to-br hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40',
                s.tint,
                s.ring,
                'ring-0 hover:ring-2',
                'alert' in s && s.alert ? 'border-rose-300/50 dark:border-rose-800/50' : '',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                    {s.label}
                  </p>
                  <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
                    {loading ? '…' : s.value}
                  </p>
                  <p className="mt-1 text-[10px] font-medium text-text-secondary">{s.hint}</p>
                </div>
                <div className="flex size-10 items-center justify-center rounded-xl bg-card/80 ring-1 ring-border/60">
                  <Icon size={18} className="opacity-80" />
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card padding={false} className="lg:col-span-3">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Active queue</h2>
              <p className="text-xs text-text-secondary">Recent open jobs — click to open detail</p>
            </div>
            <Link to="/tickets" className="text-xs font-medium text-accent-blue hover:underline">
              All tickets
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/70" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-5">
              <p className="text-sm text-text-secondary">
                No open tickets yet. Create one when a customer calls.
              </p>
              <Link to="/tickets?open=1">
                <Button size="sm">
                  <Plus size={14} /> New ticket
                </Button>
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((t) => {
                const st = String(t.status)
                const contact = t.contact as
                  | { name?: string; customerCode?: string; phone?: string }
                  | null
                  | undefined
                const asset = t.asset as { name?: string; serialNo?: string } | null | undefined
                const breached = Boolean(t.slaBreached)
                const assignee = t.assignedToName ? String(t.assignedToName) : 'Awaiting assign'
                return (
                  <li key={String(t.id)}>
                    <Link
                      to={`/tickets/${String(t.id)}`}
                      className="flex items-start justify-between gap-3 px-4 py-2.5 transition hover:bg-surface"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] font-semibold text-accent-blue">
                            {formatServiceId(
                              t.ticketNo != null ? String(t.ticketNo) : undefined,
                            )}
                          </span>
                          {breached ? (
                            <Badge color="red" className="!px-1.5 !py-0 text-[10px]">
                              SLA overdue
                            </Badge>
                          ) : null}
                          <Badge
                            color={ticketStatusColor[st] ?? 'gray'}
                            className="!px-1.5 !py-0 text-[10px]"
                          >
                            {st.replaceAll('_', ' ')}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate text-sm font-medium text-text-primary">
                          {String(t.subject)}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-text-secondary">
                          {contact?.name ?? 'No customer'}
                          {contact?.customerCode ? ` · ${contact.customerCode}` : ''}
                          {asset?.name ? ` · ${asset.name}` : ''}
                          {' · '}
                          {assignee}
                        </div>
                      </div>
                      <ArrowRight
                        size={14}
                        className="mt-1 shrink-0 text-text-secondary opacity-50"
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card padding={false}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Needs assignment</h2>
                <p className="text-xs text-text-secondary">No engineer yet — admin will assign</p>
              </div>
              <Link
                to="/tickets?unassigned=1"
                className="text-xs font-medium text-accent-blue hover:underline"
              >
                View all
              </Link>
            </div>
            {loading ? (
              <p className="p-4 text-sm text-text-secondary">Loading…</p>
            ) : unassigned.length === 0 ? (
              <p className="p-4 text-sm text-text-secondary">All open jobs have an engineer.</p>
            ) : (
              <ul className="divide-y divide-border">
                {unassigned.map((t) => (
                  <li key={String(t.id)}>
                    <Link
                      to={`/tickets/${String(t.id)}`}
                      className="block px-4 py-2.5 transition hover:bg-surface"
                    >
                      <div className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                        {formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)}
                      </div>
                      <div className="truncate text-sm font-medium text-text-primary">
                        {String(t.subject)}
                      </div>
                      <div className="truncate text-xs text-text-secondary">
                        {(t.contact as { name?: string } | null)?.name ?? 'No customer'}
                        {' · '}
                        Awaiting assign
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="bg-gradient-to-br from-emerald-50/50 to-card p-4 dark:from-emerald-950/20">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  Completed today
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                  {loading ? '…' : summary.resolvedToday}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  Jobs closed or resolved today
                </p>
              </div>
              <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={22} />
            </div>
            <Link
              to="/tickets?status=CLOSED"
              className="mt-3 inline-flex text-xs font-medium text-accent-blue hover:underline"
            >
              View completed tickets
            </Link>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/tickets?open=1">
          <Card className="h-full border-accent-blue/20 p-4 transition hover:border-accent-blue/50 hover:shadow-[var(--shadow-card)]">
            <div className="flex size-9 items-center justify-center rounded-lg bg-sky-500/10 text-accent-blue">
              <Ticket size={18} />
            </div>
            <div className="mt-2.5 text-sm font-semibold text-text-primary">Create ticket</div>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Customer → machine → issue log → OPEN for admin
            </p>
          </Card>
        </Link>
        <Link to="/contacts">
          <Card className="h-full p-4 transition hover:border-accent-blue/50 hover:shadow-[var(--shadow-card)]">
            <div className="flex size-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <Users size={18} />
            </div>
            <div className="mt-2.5 text-sm font-semibold text-text-primary">Find / add customer</div>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Search by name, phone, or CUS ID before logging a job
            </p>
          </Card>
        </Link>
        <Link to="/tickets">
          <Card className="h-full p-4 transition hover:border-accent-blue/50 hover:shadow-[var(--shadow-card)]">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-300">
              <Clock size={18} />
            </div>
            <div className="mt-2.5 text-sm font-semibold text-text-primary">Track all tickets</div>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              {loading ? '…' : summary.resolvedToday} completed today · follow OPEN → CLOSED
            </p>
          </Card>
        </Link>
      </div>
    </div>
  )
}
