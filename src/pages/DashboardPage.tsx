import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
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
import { FlowStepBar } from '@/components/ui/FlowStepBar'
import { api, isTenantSession } from '@/lib/api'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { APP_NAME } from '@/lib/branding'
import { isSalesExecutive } from '@/lib/roles'
import { resolveInventoryAreas } from '@/lib/inventoryAreas'
import {
  INVENTORY_FLOW_STEPS,
  inventoryActiveStepIndex,
  inventoryStepDoneFlags,
} from '@/lib/inventoryFlow'
import { formatServiceId } from '@/lib/serviceId'
import { cn, formatDate } from '@/lib/utils'
import { BlockSkeleton, PageSkeleton, TableSkeleton, Skeleton } from '@/components/ui/Skeleton'

const AdminAnalyticsDashboard = lazy(() =>
  import('@/pages/AdminAnalyticsDashboard').then((m) => ({ default: m.AdminAnalyticsDashboard })),
)
const EmployeeDashboardPage = lazy(() =>
  import('@/pages/EmployeeDashboardPage').then((m) => ({ default: m.EmployeeDashboardPage })),
)

export function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role)
  if (role === 'ADMIN') {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <AdminAnalyticsDashboard />
      </Suspense>
    )
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
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EmployeeDashboardPage />
    </Suspense>
  )
}

function SalesExecutiveHomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState({
    open: 0,
    followupsDue: 0,
    followupsWeek: 0,
    demo: 0,
    converted: 0,
    awaitingShip: 0,
    completed: 0,
  })
  const [openEnquiries, setOpenEnquiries] = useState<Array<Record<string, unknown>>>([])
  const [dueFollowups, setDueFollowups] = useState<Array<Record<string, unknown>>>([])
  const [weekFollowups, setWeekFollowups] = useState<Array<Record<string, unknown>>>([])
  const [pipeline, setPipeline] = useState<Array<{ label: string; count: number; to: string; color: string }>>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isTenantSession() || !user?.id) {
        setLoading(false)
        return
      }
      try {
        const [leadPage, actPage] = await Promise.all([
          api.leads({ limit: 100, assignedToId: user.id }),
          api.activities({ limit: 50, assignedToId: user.id }).catch(() => ({ items: [] })),
        ])
        if (cancelled) return
        const items = leadPage.items ?? []
        const open = items.filter(
          (l) => !['LOST', 'CONVERTED', 'UNQUALIFIED'].includes(String(l.status)),
        )
        const endToday = new Date()
        endToday.setHours(23, 59, 59, 999)
        const startToday = new Date()
        startToday.setHours(0, 0, 0, 0)
        const weekEnd = new Date(startToday)
        weekEnd.setDate(weekEnd.getDate() + 7)
        weekEnd.setHours(23, 59, 59, 999)

        const followIso = (l: Record<string, unknown>) => {
          const cf = (l.customFields as Record<string, unknown> | null) ?? {}
          if (cf.reminder_at) return String(cf.reminder_at)
          if (cf.follow_up_date) return `${String(cf.follow_up_date).slice(0, 10)}T10:00:00`
          return null
        }

        const dueFromLeads = open.filter((l) => {
          const iso = followIso(l)
          if (!iso) return false
          const d = new Date(iso)
          return !Number.isNaN(d.getTime()) && d.getTime() <= endToday.getTime()
        })
        const weekFromLeads = open.filter((l) => {
          const iso = followIso(l)
          if (!iso) return false
          const d = new Date(iso)
          return !Number.isNaN(d.getTime()) && d >= startToday && d <= weekEnd
        })
        const openActs = (actPage.items ?? []).filter((a) =>
          ['PENDING', 'OVERDUE'].includes(String(a.status)),
        )
        const dueActs = openActs.filter((a) => {
          if (!a.scheduledAt) return true
          return new Date(String(a.scheduledAt)).getTime() <= endToday.getTime()
        })
        const awaitingShip = items.filter((l) => {
          const cf = (l.customFields as Record<string, unknown> | null) ?? {}
          const rel =
            cf.inventoryRelease && typeof cf.inventoryRelease === 'object'
              ? (cf.inventoryRelease as Record<string, unknown>)
              : null
          return Boolean(cf.stockReducedAt || rel?.stockReducedAt) && !rel?.shippedAt && !l.shippedAt
        })
        const completed = items.filter((l) => {
          const cf = (l.customFields as Record<string, unknown> | null) ?? {}
          return Boolean(cf.saleCompletedAt)
        })

        setCounts({
          open: open.length,
          followupsDue: Math.max(dueFromLeads.length, dueActs.length),
          followupsWeek: weekFromLeads.length,
          demo: items.filter((l) => String(l.status) === 'DEMO').length,
          converted: items.filter((l) => String(l.status) === 'CONVERTED').length,
          awaitingShip: awaitingShip.length,
          completed: completed.length,
        })
        setPipeline([
          {
            label: 'New',
            count: items.filter((l) => String(l.status) === 'NEW').length,
            to: '/sale-tracking?status=NEW',
            color: 'bg-sky-500',
          },
          {
            label: 'Contacted',
            count: items.filter((l) => String(l.status) === 'CONTACTED').length,
            to: '/sale-tracking?status=CONTACTED',
            color: 'bg-violet-500',
          },
          {
            label: 'Qualified',
            count: items.filter((l) => String(l.status) === 'QUALIFIED').length,
            to: '/sale-tracking?status=QUALIFIED',
            color: 'bg-amber-500',
          },
          {
            label: 'Demo',
            count: items.filter((l) => String(l.status) === 'DEMO').length,
            to: '/sale-tracking?status=DEMO',
            color: 'bg-orange-500',
          },
          {
            label: 'Converted',
            count: items.filter((l) => String(l.status) === 'CONVERTED').length,
            to: '/sale-tracking?status=CONVERTED',
            color: 'bg-emerald-500',
          },
        ])
        setOpenEnquiries(
          [...open]
            .sort(
              (a, b) =>
                new Date(String(b.createdAt ?? 0)).getTime() -
                new Date(String(a.createdAt ?? 0)).getTime(),
            )
            .slice(0, 8),
        )
        setDueFollowups(
          [...dueFromLeads]
            .sort((a, b) => String(followIso(a)).localeCompare(String(followIso(b))))
            .slice(0, 8),
        )
        setWeekFollowups(
          [...weekFromLeads]
            .sort((a, b) => String(followIso(a)).localeCompare(String(followIso(b))))
            .slice(0, 8),
        )
      } catch (e) {
        if (!cancelled) {
          addToast({
            type: 'error',
            message: e instanceof Error ? e.message : 'Could not load sales desk home',
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

  const quickActions = [
    {
      title: 'New enquiry',
      body: 'Create lead + follow-up date',
      to: '/sale-tracking?open=1',
      icon: <Plus size={18} />,
    },
    {
      title: 'Follow-ups due',
      body: `${counts.followupsDue} today / overdue`,
      to: '/workqueue',
      icon: <Clock size={18} />,
    },
    {
      title: 'My workqueue',
      body: 'Calls, tasks, meetings',
      to: '/workqueue',
      icon: <ListTodo size={18} />,
    },
    {
      title: 'All my leads',
      body: `${counts.open} open`,
      to: '/sale-tracking',
      icon: <Users size={18} />,
    },
    {
      title: 'Customers',
      body: 'Contacts & machines',
      to: '/contacts',
      icon: <UserRound size={18} />,
    },
    {
      title: 'Notifications',
      body: 'Ship / stock updates',
      to: '/notifications',
      icon: <Ticket size={18} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Hi ${user?.name?.split(' ')[0] ?? 'there'} — sales desk`}
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/workqueue')}>
              <ListTodo size={16} /> Workqueue
            </Button>
            <Button onClick={() => navigate('/sale-tracking?open=1')}>
              <Plus size={16} /> New enquiry
            </Button>
          </div>
        }
      />

      {/* KPI strip — all clickable */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[
          { label: 'Open leads', value: counts.open, to: '/sale-tracking', hint: 'Active pipeline' },
          {
            label: 'Due today',
            value: counts.followupsDue,
            to: '/workqueue',
            hint: 'Call now',
            alert: counts.followupsDue > 0,
          },
          {
            label: 'This week',
            value: counts.followupsWeek,
            to: '/workqueue',
            hint: 'Upcoming FUs',
          },
          { label: 'Demos', value: counts.demo, to: '/sale-tracking?status=DEMO', hint: 'On demo' },
          {
            label: 'Converted',
            value: counts.converted,
            to: '/sale-tracking?status=CONVERTED',
            hint: 'Won',
          },
          {
            label: 'Awaiting ship',
            value: counts.awaitingShip,
            to: '/sale-tracking',
            hint: 'Stock out done',
          },
          {
            label: 'Completed',
            value: counts.completed,
            to: '/sale-tracking?status=COMPLETED',
            hint: 'Payment marked complete',
          },
        ].map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => navigate(s.to)}
            className={cn(
              'rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-accent-blue/50 hover:shadow-md',
              s.alert && 'border-amber-400/70 bg-amber-50/50 dark:bg-amber-950/20',
            )}
          >
            <div className="text-[11px] font-medium text-text-secondary">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
              {loading ? <Skeleton width={36} height={28} /> : s.value}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-accent-blue">
              {s.hint} <ArrowRight size={12} />
            </div>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-text-primary">Quick actions</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((a) => (
            <button
              key={a.title}
              type="button"
              onClick={() => navigate(a.to)}
              className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-accent-blue/50 hover:bg-muted/30"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
                {a.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{a.title}</span>
                <span className="block text-xs text-text-secondary">{a.body}</span>
              </span>
              <ArrowRight size={16} className="ml-auto mt-1 shrink-0 text-text-secondary" />
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">My pipeline</h2>
            <p className="text-xs text-text-secondary">Tap a stage to open filtered leads</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/sale-tracking')}>
            Open sale tracking
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          {pipeline.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => navigate(p.to)}
              className="rounded-lg border border-border px-3 py-3 text-left transition hover:border-accent-blue/40 hover:bg-muted/40"
            >
              <div className={cn('mb-2 h-1.5 w-full rounded-full', p.color)} />
              <div className="text-xs text-text-secondary">{p.label}</div>
              <div className="text-xl font-semibold tabular-nums">
                {loading ? '—' : p.count}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Follow-ups due today</h2>
              <p className="text-xs text-text-secondary">Today & overdue — call these first</p>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-accent-blue hover:underline"
              onClick={() => navigate('/workqueue')}
            >
              Workqueue →
            </button>
          </div>
          {loading ? (
            <BlockSkeleton lines={4} />
          ) : dueFollowups.length === 0 ? (
            <div className="space-y-3 p-4">
              <p className="text-sm text-text-secondary">
                Nothing due today.
                {weekFollowups.length > 0
                  ? ` ${weekFollowups.length} follow-up(s) coming up this week.`
                  : ' Set a follow-up date on new enquiries.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/workqueue')}>
                  Open workqueue
                </Button>
                <Button size="sm" onClick={() => navigate('/sale-tracking?open=1')}>
                  New enquiry
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {dueFollowups.map((l) => {
                const cf = (l.customFields as Record<string, unknown> | null) ?? {}
                const due = cf.reminder_at
                  ? String(cf.reminder_at).replace('T', ' ').slice(0, 16)
                  : String(cf.follow_up_date ?? '').slice(0, 10)
                return (
                  <li key={String(l.id)}>
                    <button
                      type="button"
                      onClick={() => navigate(`/sale-tracking/${String(l.id)}`)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {String(l.name)}
                        </div>
                        <div className="truncate text-xs text-text-secondary">
                          {[l.phone, l.company].filter(Boolean).map(String).join(' · ') || 'Enquiry'}
                        </div>
                      </div>
                      <Badge color="amber">{due || 'Due'}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">My open leads</h2>
              <p className="text-xs text-text-secondary">Tap a row to open the sale</p>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-accent-blue hover:underline"
              onClick={() => navigate('/sale-tracking')}
            >
              All leads →
            </button>
          </div>
          {loading ? (
            <BlockSkeleton lines={4} />
          ) : openEnquiries.length === 0 ? (
            <div className="space-y-3 p-4">
              <p className="text-sm text-text-secondary">
                No open leads yet. Create an enquiry to start your pipeline.
              </p>
              <Button size="sm" onClick={() => navigate('/sale-tracking?open=1')}>
                <Plus size={14} /> New lead
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {openEnquiries.map((l) => (
                <li key={String(l.id)}>
                  <button
                    type="button"
                    onClick={() => navigate(`/sale-tracking/${String(l.id)}`)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {String(l.name)}
                      </div>
                      <div className="truncate text-xs text-text-secondary">
                        {[l.phone, l.company].filter(Boolean).map(String).join(' · ') || '—'}
                      </div>
                    </div>
                    <Badge color={String(l.status) === 'DEMO' ? 'amber' : 'blue'}>
                      {String(l.status)}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {weekFollowups.length > 0 && dueFollowups.length === 0 ? (
        <Card padding={false}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Upcoming this week</h2>
            <button
              type="button"
              className="text-xs font-medium text-accent-blue hover:underline"
              onClick={() => navigate('/workqueue')}
            >
              View all →
            </button>
          </div>
          <ul className="divide-y divide-border sm:grid sm:grid-cols-2 sm:divide-y-0">
            {weekFollowups.map((l) => {
              const cf = (l.customFields as Record<string, unknown> | null) ?? {}
              const due = String(cf.follow_up_date ?? cf.reminder_at ?? '').slice(0, 10)
              return (
                <li key={String(l.id)} className="sm:border-b sm:border-border">
                  <button
                    type="button"
                    onClick={() => navigate(`/sale-tracking/${String(l.id)}`)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface"
                  >
                    <span className="truncate text-sm font-medium">{String(l.name)}</span>
                    <Badge color="gray">{due}</Badge>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

function WarehouseHomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [inStock, setInStock] = useState(0)
  const [demoOut, setDemoOut] = useState(0)
  const [releases, setReleases] = useState<Array<Record<string, unknown>>>([])
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([])
  const [focusReqId, setFocusReqId] = useState<string | null>(null)

  const load = async (soft = false) => {
    if (!isTenantSession()) {
      setLoading(false)
      return
    }
    if (soft) setRefreshing(true)
    else setLoading(true)
    try {
      const [ws, reqRes, hist] = await Promise.all([
        areas.machines || areas.sparesBilling || areas.sparesWeighing
          ? api.inventoryWorkspace().catch(() => null)
          : Promise.resolve(null),
        api.requisitions({ limit: 40, queue: 'fulfill', status: 'APPROVED,FULFILLED' }).catch(() => ({
          items: [] as Array<Record<string, unknown>>,
        })),
        api.inventoryHistory({ limit: 10 }).catch(() => [] as Array<Record<string, unknown>>),
      ])
      const units = ws?.units ?? []
      setInStock(units.filter((u) => String(u.status) === 'IN_STOCK').length)
      setDemoOut(units.filter((u) => String(u.status) === 'DEMO').length)
      const rows = (reqRes.items ?? []).filter((r) => {
        const st = String(r.status)
        return st === 'APPROVED' || (st === 'FULFILLED' && !r.shippedAt)
      })
      setReleases(rows)
      setHistory(Array.isArray(hist) ? hist : [])
      if (!focusReqId && rows[0]) setFocusReqId(String(rows[0].id))
    } catch {
      addToast({ type: 'error', message: 'Could not load warehouse dashboard' })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(true), 90_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll live stats
  }, [])

  const awaiting = releases.filter((r) => String(r.status) === 'APPROVED')
  const awaitShip = releases.filter((r) => String(r.status) === 'FULFILLED' && !r.shippedAt)
  const focus =
    releases.find((r) => String(r.id) === focusReqId) ?? awaiting[0] ?? releases[0] ?? null
  const stepFlags = inventoryStepDoneFlags(
    focus
      ? {
          status: String(focus.status),
          shippedAt: focus.shippedAt ? String(focus.shippedAt) : null,
          serialNo: focus.serialNo ? String(focus.serialNo) : null,
          stockUnitId: focus.stockUnitId ? String(focus.stockUnitId) : null,
          productName: focus.productName ? String(focus.productName) : null,
          customFields:
            focus.customFields && typeof focus.customFields === 'object'
              ? (focus.customFields as Record<string, unknown>)
              : null,
        }
      : null,
  )
  const activeStep = inventoryActiveStepIndex(stepFlags)

  const kpis: Array<{
    label: string
    value: number
    to: string
    tone: 'amber' | 'blue' | 'green' | 'purple'
    hint: string
  }> = [
    {
      label: 'Awaiting release',
      value: awaiting.length,
      to: '/erp/releases',
      tone: 'amber',
      hint: 'Approved — reduce stock',
    },
    {
      label: 'Ready to ship',
      value: awaitShip.length,
      to: '/erp/releases',
      tone: 'blue',
      hint: 'Stock out done',
    },
    {
      label: 'In stock',
      value: inStock,
      to: '/erp/stock',
      tone: 'green',
      hint: 'Serials on hand',
    },
    {
      label: 'Demo out',
      value: demoOut,
      to: '/erp/inventory?tab=demo',
      tone: 'purple',
      hint: 'Units on demo',
    },
  ]

  const toneClass: Record<string, string> = {
    amber: 'border-amber-200/80 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20',
    blue: 'border-sky-200/80 bg-sky-50/60 dark:border-sky-900/40 dark:bg-sky-950/20',
    green: 'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20',
    purple: 'border-[color:var(--color-accent-purple)]/30 bg-[color:var(--color-accent-soft)]',
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory home"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? 'Refreshing…' : 'Refresh live'}
          </Button>
        }
      />

      {!areas.machines && !areas.sparesBilling && !areas.sparesWeighing ? (
        <Card className="border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-950">
          No inventory areas assigned. Ask your admin to enable Machines and/or Spare stock under
          Users → Inventory visibility.
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-gradient-to-r from-[color:var(--color-panel-from)] to-[color:var(--color-panel-to)] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Sale release steps</h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                Your job ends at stock out + ship. Proforma and payments are handled by sales.
              </p>
            </div>
            <Link
              to="/erp/releases"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent-blue hover:underline"
            >
              Open full queue <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-3">
            <FlowStepBar
              steps={INVENTORY_FLOW_STEPS}
              doneFlags={stepFlags}
              onStepClick={() =>
                navigate(
                  focusReqId
                    ? `/erp/releases?reqId=${encodeURIComponent(focusReqId)}`
                    : '/erp/releases',
                )
              }
            />
          </div>
          {focus ? (
            <p className="mt-2 text-[11px] text-text-secondary">
              Tracking{' '}
              <span className="font-mono font-semibold text-text-primary">
                {String(focus.reqNumber ?? '—')}
              </span>
              {' · '}
              {String(
                (focus.contact as { name?: string } | null)?.name ??
                  (focus.lead as { name?: string } | null)?.name ??
                  'Customer',
              )}
              {' · '}
              {String(focus.productName ?? 'Product')}
              {' — current: '}
              <span className="font-medium text-text-primary">
                {INVENTORY_FLOW_STEPS[activeStep]?.label ?? 'Done'}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-text-secondary">
              No open releases. When sales notifies inventory, the queue appears here live.
            </p>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-8 w-12" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Link key={k.label} to={k.to}>
              <Card
                className={cn(
                  'h-full p-4 transition hover:shadow-[var(--shadow-hover)]',
                  toneClass[k.tone],
                )}
              >
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  {k.label}
                </div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-text-primary">{k.value}</div>
                <p className="mt-1 text-xs text-text-secondary">{k.hint}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card padding={false} className="lg:col-span-3">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Live release queue</h3>
              <p className="text-[11px] text-text-secondary">
                Click a row to open Approved releases and work that REQ
              </p>
            </div>
            <Badge color={awaiting.length ? 'amber' : 'gray'}>{releases.length} open</Badge>
          </div>
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={4} />
            </div>
          ) : releases.length === 0 ? (
            <div className="p-6 text-sm text-text-secondary">
              Nothing waiting. Sales must notify inventory after admin approval.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {releases.slice(0, 8).map((r) => {
                const id = String(r.id)
                const st = String(r.status)
                const contact = r.contact as { name?: string; customerCode?: string } | null
                const lead = r.lead as { name?: string } | null
                const selected = id === String(focus?.id ?? '')
                const workTo = `/erp/releases?reqId=${encodeURIComponent(id)}`
                return (
                  <li key={id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setFocusReqId(id)
                        navigate(workTo)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setFocusReqId(id)
                          navigate(workTo)
                        }
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60',
                        selected && 'bg-[color:var(--color-accent-soft)]',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {String(r.reqNumber ?? '—')}
                          </span>
                          <Badge color={st === 'FULFILLED' ? 'green' : 'amber'}>
                            {st === 'FULFILLED' ? 'STOCK OUT' : 'APPROVED'}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate text-sm text-text-primary">
                          {contact?.name ?? lead?.name ?? '—'}
                          {contact?.customerCode ? (
                            <span className="text-text-secondary"> · {contact.customerCode}</span>
                          ) : null}
                        </div>
                        <div className="truncate text-[11px] text-text-secondary">
                          {String(r.productName ?? '—')}
                          {r.serialNo ? ` · S/No ${String(r.serialNo)}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-accent-blue">
                        Work →
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card padding={false} className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Stock timeline</h3>
              <p className="text-[11px] text-text-secondary">Latest reduce / add moves</p>
            </div>
            <Link
              to="/erp/stock?view=history"
              className="text-xs font-semibold text-accent-blue hover:underline"
            >
              Full history
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : history.length === 0 ? (
            <div className="p-6 text-sm text-text-secondary">No movements yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {history.slice(0, 8).map((h, i) => {
                const serial = (h.stockUnit as { serialNo?: string } | null)?.serialNo
                const product = (h.product as { name?: string } | null)?.name
                return (
                  <li key={String(h.id ?? i)} className="px-4 py-2.5 text-xs">
                    <div className="font-medium text-text-primary">
                      {String(h.action ?? h.movementType ?? 'MOVE')}
                      {product ? ` · ${product}` : ''}
                      {serial ? ` · ${serial}` : ''}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-text-secondary">
                      {String(h.notes ?? h.reduceReason ?? '—').slice(0, 90)}
                    </div>
                    <div className="mt-0.5 text-text-secondary">
                      {h.movedAt ? formatDate(String(h.movedAt)) : ''}
                      {h.quantity != null ? ` · qty ${String(h.quantity)}` : ''}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(areas.machines
          ? [
              { to: '/erp/stock/move?mode=reduce', title: 'Reduce stock', body: 'Manual serial out' },
              { to: '/erp/stock/move', title: 'Add stock', body: 'Receive serials' },
              { to: '/erp/inventory', title: 'All units', body: 'Serial search & demo' },
              { to: '/erp/products', title: 'Products', body: 'Catalog & SKUs' },
            ]
          : []
        )
          .concat(
            areas.sparesBilling || areas.sparesWeighing
              ? [{ to: '/erp/spare-stock', title: 'Spare stock', body: 'Billing / weighing spares' }]
              : [],
          )
          .map((c) => (
            <Link key={c.to + c.title} to={c.to}>
              <Card className="h-full p-4 transition hover:border-accent-blue/40">
                <div className="text-sm font-semibold text-text-primary">{c.title}</div>
                <p className="mt-1 text-xs text-text-secondary">{c.body}</p>
              </Card>
            </Link>
          ))}
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
    pendingApproval: 0,
    resolvedToday: 0,
  })
  const [recent, setRecent] = useState<Array<Record<string, unknown>>>([])
  const [pendingApproval, setPendingApproval] = useState<Array<Record<string, unknown>>>([])
  const [unassigned, setUnassigned] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isTenantSession()) {
        setLoading(false)
        return
      }
      try {
        const [tSum, tickets, unassignedPage, resolvedPage] = await Promise.all([
          api.ticketsSummary(),
          api.tickets({ limit: 10, sort: 'sla' }),
          api.tickets({ limit: 6, assignedToId: 'unassigned', sort: 'sla' }),
          api.tickets({ limit: 8, status: 'RESOLVED', sort: 'newest' }),
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
          pendingApproval: Number(byStatus.RESOLVED ?? 0),
          resolvedToday: tSum.resolvedToday,
        })
        setRecent(
          (tickets.items ?? [])
            .filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED'].includes(String(t.status)))
            .slice(0, 8),
        )
        setPendingApproval((resolvedPage.items ?? []).slice(0, 6))
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
      label: 'Pending approval',
      value: summary.pendingApproval,
      hint: summary.pendingApproval > 0 ? 'Engineer marked complete' : 'None waiting',
      to: '/tickets?queue=approval',
      icon: CheckCircle2,
      tint: 'from-emerald-500/15 to-transparent text-emerald-700 dark:text-emerald-300',
      ring: 'hover:ring-emerald-400/40',
      alert: summary.pendingApproval > 0,
    },
    {
      label: 'Unassigned',
      value: summary.unassigned,
      hint: 'Waiting for assign',
      to: '/tickets?queue=awaiting',
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
              Log the call → create OPEN ticket → engineer Accepts. You Mark complete, collect
              payment, and close.
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
                    {loading ? <Skeleton width={56} height={28} /> : s.value}
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
            <TableSkeleton rows={4} />
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
                <h2 className="text-sm font-semibold text-text-primary">Pending approval</h2>
                <p className="text-xs text-text-secondary">
                  Engineer marked complete — collect payment & close
                </p>
              </div>
              <Link
                to="/tickets?queue=approval"
                className="text-xs font-medium text-accent-blue hover:underline"
              >
                View all
              </Link>
            </div>
            {loading ? (
              <BlockSkeleton lines={4} />
            ) : pendingApproval.length === 0 ? (
              <p className="p-4 text-sm text-text-secondary">No tickets waiting for approval.</p>
            ) : (
              <ul className="divide-y divide-border">
                {pendingApproval.map((t) => (
                  <li key={String(t.id)}>
                    <Link
                      to={`/tickets/${String(t.id)}`}
                      className="block px-4 py-2.5 transition hover:bg-surface"
                    >
                      <div className="font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        {formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)}
                      </div>
                      <div className="truncate text-sm font-medium text-text-primary">
                        {String(t.subject)}
                      </div>
                      <div className="truncate text-xs text-text-secondary">
                        {(t.contact as { name?: string } | null)?.name ?? 'No customer'}
                        {' · '}
                        Resolved — approve & close
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding={false}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Needs assignment</h2>
                <p className="text-xs text-text-secondary">OPEN jobs with no engineer yet</p>
              </div>
              <Link
                to="/tickets?queue=awaiting"
                className="text-xs font-medium text-accent-blue hover:underline"
              >
                View all
              </Link>
            </div>
            {loading ? (
              <BlockSkeleton lines={3} />
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
              {loading ? <Skeleton width={24} height={14} inline /> : summary.resolvedToday} completed today · follow OPEN → CLOSED
            </p>
          </Card>
        </Link>
      </div>
    </div>
  )
}
