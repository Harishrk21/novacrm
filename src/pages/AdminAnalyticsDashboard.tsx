import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CheckSquare,
  CircleDollarSign,
  Clock,
  Package,
  RefreshCw,
  Target,
  Ticket,
  TrendingUp,
  Users,
  Warehouse,
  FileText,
  LayoutDashboard,
  AlertTriangle,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { PALETTES } from '@/lib/theme'
import { api, isTenantSession, ApiClientError } from '@/lib/api'
import { formatCurrency, formatDate, timeAgo } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'
import { AskDashboardPanel } from '@/components/ai/AskDashboardPanel'
import { formatServiceId } from '@/lib/serviceId'

type Analytics = Awaited<ReturnType<typeof api.analytics>>

const POVS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, accent: 'sky' },
  { id: 'service', label: 'Service', icon: Ticket, accent: 'blue' },
  { id: 'sales', label: 'Sales', icon: TrendingUp, accent: 'emerald' },
  { id: 'stock', label: 'Stock & billing', icon: Warehouse, accent: 'teal' },
  { id: 'team', label: 'Team', icon: Target, accent: 'rose' },
] as const

type PovId = (typeof POVS)[number]['id']

const ACCENT: Record<string, { chip: string; bar: string; soft: string; text: string; ring: string }> = {
  sky: {
    chip: 'bg-sky-500 text-white shadow-sky-500/30',
    bar: '#0EA5E9',
    soft: 'from-sky-500/15 to-sky-500/5 border-sky-200/80 dark:border-sky-800/50',
    text: 'text-sky-700 dark:text-sky-300',
    ring: 'ring-sky-500/40',
  },
  blue: {
    chip: 'bg-blue-600 text-white shadow-blue-600/30',
    bar: '#2563EB',
    soft: 'from-blue-500/15 to-blue-500/5 border-blue-200/80 dark:border-blue-800/50',
    text: 'text-blue-700 dark:text-blue-300',
    ring: 'ring-blue-500/40',
  },
  emerald: {
    chip: 'bg-emerald-600 text-white shadow-emerald-600/30',
    bar: '#059669',
    soft: 'from-emerald-500/15 to-emerald-500/5 border-emerald-200/80 dark:border-emerald-800/50',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-500/40',
  },
  violet: {
    chip: 'bg-indigo-600 text-white shadow-indigo-600/30',
    bar: '#4F46E5',
    soft: 'from-indigo-500/15 to-indigo-500/5 border-indigo-200/80 dark:border-indigo-800/50',
    text: 'text-indigo-700 dark:text-indigo-300',
    ring: 'ring-indigo-500/40',
  },
  amber: {
    chip: 'bg-amber-500 text-white shadow-amber-500/30',
    bar: '#D97706',
    soft: 'from-amber-500/15 to-amber-500/5 border-amber-200/80 dark:border-amber-800/50',
    text: 'text-amber-800 dark:text-amber-300',
    ring: 'ring-amber-500/40',
  },
  cyan: {
    chip: 'bg-cyan-600 text-white shadow-cyan-600/30',
    bar: '#0891B2',
    soft: 'from-cyan-500/15 to-cyan-500/5 border-cyan-200/80 dark:border-cyan-800/50',
    text: 'text-cyan-800 dark:text-cyan-300',
    ring: 'ring-cyan-500/40',
  },
  teal: {
    chip: 'bg-teal-600 text-white shadow-teal-600/30',
    bar: '#0D9488',
    soft: 'from-teal-500/15 to-teal-500/5 border-teal-200/80 dark:border-teal-800/50',
    text: 'text-teal-800 dark:text-teal-300',
    ring: 'ring-teal-500/40',
  },
  rose: {
    chip: 'bg-rose-600 text-white shadow-rose-600/30',
    bar: '#E11D48',
    soft: 'from-rose-500/15 to-rose-500/5 border-rose-200/80 dark:border-rose-800/50',
    text: 'text-rose-700 dark:text-rose-300',
    ring: 'ring-rose-500/40',
  },
}

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function growthLabel(n: number | undefined) {
  const v = Number(n ?? 0)
  return `${v >= 0 ? '+' : ''}${v}%`
}

function kpiNum(kpis: Record<string, number> | undefined, key: string) {
  return Number(kpis?.[key] ?? 0) || 0
}

export function AdminAnalyticsDashboard() {
  const palette = useUIStore((s) => s.palette)
  const chartColors = PALETTES[palette].chart
  const addToast = useUIStore((s) => s.addToast)
  const openHowItWorks = useUIStore((s) => s.openHowItWorks)

  const [pov, setPov] = useState<PovId>('overview')
  const [range, setRange] = useState('month')
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [recentTickets, setRecentTickets] = useState<Array<Record<string, unknown>>>([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isTenantSession()) {
      setLoading(false)
      setLive(false)
      setAnalytics(null)
      setRecentTickets([])
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [summary, tickets] = await Promise.all([
          api.analytics({ range }),
          api.tickets({ limit: 12, sort: 'sla' }),
        ])
        if (cancelled) return
        setAnalytics(summary)
        setRecentTickets(
          (tickets.items ?? [])
            .filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(t.status)))
            .slice(0, 8),
        )
        setLive(true)
      } catch (e) {
        if (!cancelled) {
          setLive(false)
          setAnalytics(null)
          addToast({
            type: 'error',
            message: e instanceof ApiClientError ? e.message : 'Could not load analytics from database',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [range, reloadKey, addToast])

  useEffect(() => {
    if (!isTenantSession()) return
    const id = window.setInterval(() => setReloadKey((k) => k + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const k = analytics?.kpis
  const target = Number(analytics?.salesTargets?.revenueTarget ?? 0) || 0
  const progressRevenue =
    kpiNum(k, 'serviceCollectedInRange') + kpiNum(k, 'invoiceRevenueInRange')
  const targetPct = target > 0 ? Math.min(100, Math.round((progressRevenue / target) * 100)) : 0

  const ticketStatusData = useMemo(
    () =>
      (analytics?.ticketsByStatus ?? []).map((r, i) => ({
        name: labelize(r.name),
        value: r.value,
        fill: chartColors[i % chartColors.length],
      })),
    [analytics?.ticketsByStatus, chartColors],
  )

  const priorityData = useMemo(
    () =>
      (analytics?.ticketsByPriority ?? []).map((r, i) => ({
        name: labelize(r.name),
        value: r.value,
        fill: chartColors[i % chartColors.length],
      })),
    [analytics?.ticketsByPriority, chartColors],
  )

  const activePov = POVS.find((p) => p.id === pov) ?? POVS[0]
  const accent = ACCENT[activePov.accent]

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Ops snapshot"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/reports">
              <Button size="sm">
                <FileText size={14} /> Full reports
              </Button>
            </Link>
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="w-36"
              options={[
                { value: 'week', label: 'Last 7 days' },
                { value: 'month', label: 'This month' },
                { value: 'quarter', label: 'This quarter' },
                { value: 'year', label: 'This year' },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => openHowItWorks()}>
              <BookOpen size={14} /> Guide
            </Button>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((x) => x + 1)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
            </Button>
          </div>
        }
      />

      <AskDashboardPanel range={range} />

      {/* Live status + POV switcher */}
      <div className="overflow-hidden rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-[#0B1F3A] to-[#1e3a5f] px-4 py-3 text-white">
          <div>
            <div className="text-sm font-semibold tracking-tight">Company command centre</div>
            <p className="mt-0.5 text-xs text-sky-100/80">
              Service · sales enquiries · proformas · stock — live from your database
              {analytics?.generatedAt ? ` · updated ${timeAgo(String(analytics.generatedAt))}` : ''}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                live ? 'bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-300/40' : 'bg-white/10 text-white/70'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-300 animate-pulse' : 'bg-white/40'}`} />
              {live ? 'Live DB' : loading ? 'Loading…' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto p-2">
          {POVS.map((p) => {
            const Icon = p.icon
            const a = ACCENT[p.accent]
            const on = pov === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPov(p.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-[8px] px-3 py-2 text-sm font-medium transition ${
                  on
                    ? `${a.chip} shadow-md`
                    : 'bg-muted/60 text-text-secondary hover:bg-muted hover:text-text-primary'
                }`}
              >
                <Icon size={15} />
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && !analytics ? (
        <Card className="py-16 text-center text-sm text-text-secondary">Loading analytics from database…</Card>
      ) : !live || !analytics ? (
        <Card className="py-16 text-center text-sm text-text-secondary">
          Sign in to a company workspace to see live analytics.
        </Card>
      ) : (
        <div className="space-y-5">
          {pov === 'overview' && (
            <OverviewPov
              analytics={analytics}
              chartColors={chartColors}
              ticketStatusData={ticketStatusData}
              target={target}
              targetPct={targetPct}
            />
          )}
          {pov === 'service' && (
            <ServicePov
              analytics={analytics}
              chartColors={chartColors}
              ticketStatusData={ticketStatusData}
              priorityData={priorityData}
              recentTickets={recentTickets}
            />
          )}
          {pov === 'sales' && (
            <SalesPov analytics={analytics} chartColors={chartColors} target={target} targetPct={targetPct} />
          )}
          {pov === 'stock' && <StockPov analytics={analytics} />}
          {pov === 'team' && <TeamPov analytics={analytics} />}
        </div>
      )}

      {/* Soft accent strip matching active POV */}
      <div className={`h-1 rounded-full bg-gradient-to-r ${accent.soft}`} aria-hidden />
    </div>
  )
}

/* ─── Shared building blocks ─────────────────────────────────────────── */

function SectionHead({
  title,
  subtitle,
  action,
  accent = 'blue',
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  accent?: keyof typeof ACCENT
}) {
  const a = ACCENT[accent]
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className={`text-sm font-semibold tracking-tight ${a.text}`}>{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

function MetricTile({
  label,
  value,
  hint,
  tone,
  icon,
  to,
  delta,
  deltaUp,
}: {
  label: string
  value: string
  hint?: string
  tone: 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'teal' | 'cyan' | 'slate'
  icon: ReactNode
  to?: string
  delta?: string
  deltaUp?: boolean
}) {
  const tones: Record<string, string> = {
    blue: 'border-blue-200/90 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/50 dark:to-card dark:border-blue-900/50',
    emerald:
      'border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-card dark:border-emerald-900/50',
    amber:
      'border-amber-200/90 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-card dark:border-amber-900/50',
    rose: 'border-rose-200/90 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/40 dark:to-card dark:border-rose-900/50',
    indigo:
      'border-indigo-200/90 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-card dark:border-indigo-900/50',
    teal: 'border-teal-200/90 bg-gradient-to-br from-teal-50 to-white dark:from-teal-950/40 dark:to-card dark:border-teal-900/50',
    cyan: 'border-cyan-200/90 bg-gradient-to-br from-cyan-50 to-white dark:from-cyan-950/40 dark:to-card dark:border-cyan-900/50',
    slate:
      'border-slate-200/90 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/40 dark:to-card dark:border-slate-700/50',
  }
  const iconTone: Record<string, string> = {
    blue: 'bg-blue-600 text-white',
    emerald: 'bg-emerald-600 text-white',
    amber: 'bg-amber-500 text-white',
    rose: 'bg-rose-600 text-white',
    indigo: 'bg-indigo-600 text-white',
    teal: 'bg-teal-600 text-white',
    cyan: 'bg-cyan-600 text-white',
    slate: 'bg-slate-700 text-white',
  }
  const inner = (
    <div
      className={`rounded-[12px] border p-4 shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-hover)] ${tones[tone]} ${to ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${iconTone[tone]}`}>{icon}</div>
        {delta != null ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
              deltaUp ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {deltaUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {delta}
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-text-primary">{value}</div>
      {hint ? <div className="mt-1 text-xs text-text-secondary">{hint}</div> : null}
    </div>
  )
  if (!to) return inner
  return (
    <Link to={to} className="block rounded-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40">
      {inner}
    </Link>
  )
}

function Panel({
  title,
  subtitle,
  children,
  action,
  className = '',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Card className={`overflow-hidden ${className}`} padding={false}>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-text-secondary">{children}</p>
}

function ProgressTrack({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  )
}

/* ─── POV: Overview (HMS live ops — not seed deal pipeline) ──────────── */

function OverviewPov({
  analytics,
  chartColors,
  ticketStatusData,
  target,
  targetPct,
}: {
  analytics: Analytics
  chartColors: string[]
  ticketStatusData: Array<{ name: string; value: number; fill: string }>
  target: number
  targetPct: number
}) {
  const k = analytics.kpis
  const attention =
    (analytics as { attentionTickets?: Array<Record<string, unknown>> }).attentionTickets ?? []
  const enquiryByStatus =
    (analytics as { enquiryByStatus?: Array<{ name: string; value: number; code?: string }> })
      .enquiryByStatus ?? []
  const stockByStatus =
    (analytics as { stockByStatus?: Array<{ name: string; value: number }> }).stockByStatus ?? []
  const monthly = (analytics.monthlyRevenue ?? []) as Array<{
    month: string
    proforma?: number
    servicePaid?: number
    current?: number
  }>

  return (
    <>
      <SectionHead
        title="Operations snapshot"
        subtitle="Live from service tickets, sale enquiries, proformas & serial stock — not demo deal amounts"
        accent="sky"
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          to="/tickets?unassigned=1"
          label="Awaiting assign"
          value={String(kpiNum(k, 'awaitingAssignment'))}
          hint={`${kpiNum(k, 'openTickets')} open · ${kpiNum(k, 'slaBreached')} SLA breach`}
          tone="rose"
          icon={<AlertTriangle size={16} />}
        />
        <MetricTile
          to="/tickets?status=RESOLVED"
          label="Awaiting approval"
          value={String(kpiNum(k, 'awaitingApproval'))}
          hint="Engineer complete — admin pay & close"
          tone="amber"
          icon={<CheckSquare size={16} />}
        />
        <MetricTile
          to="/tickets"
          label="Balance outstanding"
          value={formatCurrency(kpiNum(k, 'balanceOutstanding'))}
          hint="Open jobs · total − advance"
          tone="amber"
          icon={<CircleDollarSign size={16} />}
        />
        <MetricTile
          to="/tickets"
          label="Service collected"
          value={formatCurrency(kpiNum(k, 'serviceCollected'))}
          hint={`${formatCurrency(kpiNum(k, 'serviceCollectedInRange'))} in selected range`}
          tone="emerald"
          icon={<CircleDollarSign size={16} />}
        />
        <MetricTile
          to="/sale-tracking"
          label="Sale enquiries"
          value={String(kpiNum(k, 'totalLeads'))}
          hint={`${kpiNum(k, 'enquiriesPending')} pending · ${kpiNum(k, 'enquiriesDemo')} on demo · ${kpiNum(k, 'enquiriesConverted')} converted`}
          tone="indigo"
          icon={<Users size={16} />}
          delta={growthLabel(k.leadGrowth)}
          deltaUp={kpiNum(k, 'leadGrowth') >= 0}
        />
        <MetricTile
          to="/erp/invoices"
          label="Proforma total"
          value={formatCurrency(kpiNum(k, 'invoiceRevenue'))}
          hint={`${kpiNum(k, 'invoiceCount')} invoices · ${formatCurrency(kpiNum(k, 'invoiceRevenueInRange'))} in range`}
          tone="cyan"
          icon={<FileText size={16} />}
        />
        <MetricTile
          to="/erp/inventory?tab=demo"
          label="Demo units out"
          value={String(kpiNum(k, 'demoOut'))}
          hint={`${kpiNum(k, 'inStock')} in stock · serial inventory`}
          tone="teal"
          icon={<Package size={16} />}
        />
        <MetricTile
          to="/contacts"
          label="Customers"
          value={String(kpiNum(k, 'contacts'))}
          hint={`${kpiNum(k, 'machinesDueSoon')} machines due in 30 days`}
          tone="slate"
          icon={<Users size={16} />}
        />
      </div>

      {target > 0 ? (
        <Panel title="Revenue target" subtitle="Company setting · compared to service collections + proforma in range">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-text-secondary">
              Target {formatCurrency(target)} · progress on paid service + proforma (range)
            </span>
            <span className="font-semibold tabular-nums">{targetPct}%</span>
          </div>
          <div className="mt-2">
            <ProgressTrack pct={targetPct} color="#059669" />
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel
          title="Ticket trend"
          subtitle="Created vs resolved (last 7 months)"
          action={
            <Link to="/tickets" className="text-xs font-medium text-accent-blue hover:underline">
              Queue →
            </Link>
          }
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.ticketMonthly ?? []}>
                <defs>
                  <linearGradient id="cCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="created" name="Created" stroke="#2563EB" fill="url(#cCreated)" />
                <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#10B981" fill="url(#cResolved)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Billing mix" subtitle="Proforma invoices + paid service jobs by month">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Bar dataKey="proforma" name="Proforma" fill="#06B6D4" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="servicePaid" name="Service paid" fill="#059669" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="Sale enquiries"
          subtitle="Pending · demo · converted · closed"
          action={
            <Link to="/sale-tracking" className="text-xs font-medium text-accent-blue hover:underline">
              Sale tracking →
            </Link>
          }
        >
          {enquiryByStatus.every((r) => r.value === 0) ? (
            <EmptyHint>No sale enquiries yet</EmptyHint>
          ) : (
            <div className="space-y-3">
              {enquiryByStatus.map((row, i) => {
                const max = Math.max(...enquiryByStatus.map((f) => f.value), 1)
                const pct = Math.round((row.value / max) * 100)
                return (
                  <div key={row.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-text-primary">{row.name}</span>
                      <span className="tabular-nums text-text-secondary">{row.value}</span>
                    </div>
                    <ProgressTrack pct={pct} color={chartColors[i % chartColors.length]} />
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Needs attention"
          subtitle="Open / in-progress jobs by SLA urgency"
          action={
            <Link to="/tickets?slaBreached=1" className="text-xs font-medium text-rose-600 hover:underline">
              SLA breaches →
            </Link>
          }
        >
          <div className="space-y-2">
            {attention.length === 0 ? (
              <EmptyHint>No open service tickets</EmptyHint>
            ) : (
              attention.map((t) => {
                const id = String(t.id)
                const breached = Boolean(t.slaBreached)
                return (
                  <Link
                    key={id}
                    to={`/tickets/${id}`}
                    className="flex items-start justify-between gap-2 rounded-[8px] border border-border bg-surface/80 px-3 py-2 text-sm transition hover:border-accent-blue/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {formatServiceId(t.ticketNo)} · {String(t.subject)}
                      </div>
                      <div className="mt-0.5 text-xs text-text-secondary">
                        {labelize(String(t.status))}
                        {t.slaDueAt ? ` · due ${formatDate(String(t.slaDueAt))}` : ''}
                        {Number(t.balanceDue) > 0 ? ` · bal ${formatCurrency(Number(t.balanceDue))}` : ''}
                      </div>
                    </div>
                    <Badge
                      color={
                        breached
                          ? 'red'
                          : String(t.priority) === 'HIGH' || String(t.priority) === 'CRITICAL'
                            ? 'amber'
                            : 'blue'
                      }
                    >
                      {breached ? 'SLA' : String(t.priority)}
                    </Badge>
                  </Link>
                )
              })
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Tickets by status">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ticketStatusData} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {ticketStatusData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Serial stock" subtitle="Units by status">
            {stockByStatus.length === 0 ? (
              <EmptyHint>No serial stock yet</EmptyHint>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stockByStatus.map((s) => (
                  <div
                    key={s.name}
                    className="rounded-[8px] border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <div className="text-[11px] text-text-secondary">{labelize(s.name)}</div>
                    <div className="text-lg font-semibold tabular-nums">{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}

/* ─── POV: Service ───────────────────────────────────────────────────── */

function ServicePov({
  analytics,
  chartColors,
  ticketStatusData,
  priorityData,
  recentTickets,
}: {
  analytics: Analytics
  chartColors: string[]
  ticketStatusData: Array<{ name: string; value: number; fill: string }>
  priorityData: Array<{ name: string; value: number; fill: string }>
  recentTickets: Array<Record<string, unknown>>
}) {
  const k = analytics.kpis
  return (
    <>
      <SectionHead title="Service desk" subtitle="Tickets, SLA, collections & machine due dates" accent="blue" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile to="/tickets?status=OPEN" label="Open" value={String(kpiNum(k, 'openTickets'))} tone="blue" icon={<Ticket size={16} />} hint={`${kpiNum(k, 'tickets')} total tickets`} />
        <MetricTile to="/tickets?slaBreached=1" label="SLA breached" value={String(kpiNum(k, 'slaBreached'))} tone="rose" icon={<AlertTriangle size={16} />} hint={`${kpiNum(k, 'unassignedTickets')} unassigned`} />
        <MetricTile to="/tickets" label="Avg resolution" value={kpiNum(k, 'avgResolutionHours') ? `${kpiNum(k, 'avgResolutionHours')}h` : '—'} tone="indigo" icon={<Clock size={16} />} hint={`${kpiNum(k, 'resolvedTickets')} resolved all-time`} />
        <MetricTile to="/tickets" label="Outstanding" value={formatCurrency(kpiNum(k, 'balanceOutstanding'))} tone="amber" icon={<CircleDollarSign size={16} />} hint={`${kpiNum(k, 'machinesDueSoon')} machines due · ${kpiNum(k, 'machinesStampingDue')} stamping`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By status">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ticketStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {ticketStatusData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="By priority">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78}>
                  {priorityData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Created / resolved / breached" subtitle="Monthly ticket volume">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.ticketMonthly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="created" stroke="#2563EB" fill="#2563EB33" name="Created" />
                <Area type="monotone" dataKey="resolved" stroke="#10B981" fill="#10B98133" name="Resolved" />
                <Area type="monotone" dataKey="breached" stroke="#EF4444" fill="#EF444433" name="Breached" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="By category">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.ticketsByCategory ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill={chartColors[2]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Engineer workload" subtitle="From assigned tickets in DB">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th className="pb-2 font-medium">Assignee</th>
                <th className="pb-2 font-medium">Total</th>
                <th className="pb-2 font-medium">Open</th>
                <th className="pb-2 font-medium">Resolved</th>
                <th className="pb-2 font-medium">Breached</th>
                <th className="pb-2 font-medium">Load</th>
              </tr>
            </thead>
            <tbody>
              {(analytics.ticketsByAssignee ?? []).map((row) => {
                const max = Math.max(...(analytics.ticketsByAssignee ?? []).map((r) => r.open), 1)
                return (
                  <tr key={row.id} className="border-b border-border/70 last:border-0">
                    <td className="py-2.5">
                      <span className="flex items-center gap-2">
                        <Avatar name={row.name} size="sm" />
                        <span className="font-medium">{row.name}</span>
                      </span>
                    </td>
                    <td className="py-2.5 tabular-nums">{row.total}</td>
                    <td className="py-2.5 tabular-nums">{row.open}</td>
                    <td className="py-2.5 tabular-nums">{row.resolved}</td>
                    <td className="py-2.5 tabular-nums text-rose-600">{row.breached}</td>
                    <td className="py-2.5 w-40">
                      <ProgressTrack pct={(row.open / max) * 100} color="#2563EB" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(analytics.ticketsByAssignee ?? []).length === 0 ? <EmptyHint>No assigned tickets yet</EmptyHint> : null}
        </div>
      </Panel>

      <Panel title="Active queue" action={<Link to="/tickets" className="text-xs text-accent-blue hover:underline">All tickets →</Link>}>
        <div className="grid gap-2 sm:grid-cols-2">
          {recentTickets.map((t) => (
            <Link
              key={String(t.id)}
              to={`/tickets/${String(t.id)}`}
              className="rounded-[8px] border border-border px-3 py-2 text-sm hover:border-accent-blue/40"
            >
              <div className="font-medium truncate">{formatServiceId(t.ticketNo)} · {String(t.subject)}</div>
              <div className="mt-1 text-xs text-text-secondary">{labelize(String(t.status))} · {String(t.priority)}</div>
            </Link>
          ))}
          {recentTickets.length === 0 ? <EmptyHint>Queue empty</EmptyHint> : null}
        </div>
      </Panel>
    </>
  )
}

/* ─── POV: Sales ─────────────────────────────────────────────────────── */

function SalesPov({
  analytics,
  chartColors,
  target,
  targetPct,
}: {
  analytics: Analytics
  chartColors: string[]
  target: number
  targetPct: number
}) {
  const k = analytics.kpis
  return (
    <>
      <SectionHead title="Sales & enquiries" subtitle="Sale tracking · demos · proforma (GST stays in Tally)" accent="emerald" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Pending enquiries"
          value={String(kpiNum(k, 'enquiriesPending'))}
          tone="indigo"
          icon={<Users size={16} />}
          hint={`${kpiNum(k, 'totalLeads')} total · ${kpiNum(k, 'conversionRate')}% converted`}
          to="/sale-tracking?status=NEW"
        />
        <MetricTile
          label="Active demos"
          value={String(kpiNum(k, 'enquiriesDemo'))}
          tone="amber"
          icon={<Package size={16} />}
          hint={`${kpiNum(k, 'demoOut')} serials out on demo`}
          to="/sale-tracking?status=DEMO"
        />
        <MetricTile
          label="Converted"
          value={String(kpiNum(k, 'enquiriesConverted'))}
          tone="emerald"
          icon={<TrendingUp size={16} />}
          hint="Ready for proforma / warehouse"
          to="/sale-tracking?status=CONVERTED"
        />
        <MetricTile
          label="Proforma total"
          value={formatCurrency(kpiNum(k, 'invoiceRevenue'))}
          tone="cyan"
          icon={<FileText size={16} />}
          hint={`${kpiNum(k, 'invoiceCount')} documents`}
          to="/erp/invoices"
        />
      </div>

      {target > 0 ? (
        <Card className={`border bg-gradient-to-r ${ACCENT.emerald.soft}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                Revenue target (service paid + proforma in range)
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums">
                {formatCurrency(kpiNum(k, 'serviceCollectedInRange') + kpiNum(k, 'invoiceRevenueInRange'))}{' '}
                <span className="text-sm font-normal text-text-secondary">/ {formatCurrency(target)}</span>
              </div>
            </div>
            <div className="w-full max-w-xs sm:w-64">
              <ProgressTrack pct={targetPct} color="#059669" />
              <div className="mt-1 text-right text-xs text-text-secondary">{targetPct}% achieved</div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Billing mix by month">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.monthlyRevenue ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Bar dataKey="proforma" name="Proforma" fill="#06B6D4" radius={[4, 4, 0, 0]} stackId="a" />
                <Bar dataKey="servicePaid" name="Service paid" fill="#059669" radius={[4, 4, 0, 0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Recent enquiries">
          <div className="space-y-2">
            {(analytics.recentLeads ?? []).length === 0 ? (
              <EmptyHint>No enquiries yet</EmptyHint>
            ) : (
              (analytics.recentLeads ?? []).map((l) => (
                <Link
                  key={l.id}
                  to={`/sale-tracking/${l.id}`}
                  className="flex items-center justify-between gap-2 rounded-[8px] border border-border px-3 py-2 text-sm hover:border-accent-blue/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name}</div>
                    <div className="text-xs text-text-secondary">
                      {[l.company, l.city].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <Badge color="blue">{labelize(l.status)}</Badge>
                </Link>
              ))
            )}
          </div>
        </Panel>
      </div>
    </>
  )
}


function StockPov({ analytics }: { analytics: Analytics }) {
  const k = analytics.kpis
  const stockByStatus =
    (analytics as { stockByStatus?: Array<{ name: string; value: number }> }).stockByStatus ?? []
  return (
    <>
      <SectionHead
        title="Stock & billing"
        subtitle="Serial inventory and CRM proformas (final GST bills stay in Tally)"
        accent="teal"
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          to="/erp/inventory"
          label="In stock"
          value={String(kpiNum(k, 'inStock'))}
          tone="teal"
          icon={<Package size={16} />}
          hint={`${kpiNum(k, 'products')} products`}
        />
        <MetricTile
          to="/erp/inventory?tab=demo"
          label="Demo out"
          value={String(kpiNum(k, 'demoOut'))}
          tone="amber"
          icon={<Warehouse size={16} />}
        />
        <MetricTile
          to="/erp/invoices"
          label="Proformas"
          value={String(kpiNum(k, 'invoiceCount'))}
          tone="cyan"
          icon={<FileText size={16} />}
          hint={formatCurrency(kpiNum(k, 'invoiceRevenue'))}
        />
        <MetricTile
          to="/tickets"
          label="Service collected"
          value={formatCurrency(kpiNum(k, 'serviceCollected'))}
          tone="emerald"
          icon={<CircleDollarSign size={16} />}
        />
      </div>
      <Panel title="Serials by status">
        {stockByStatus.length === 0 ? (
          <EmptyHint>No stock units yet</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-3">
            {stockByStatus.map((s) => (
              <div key={s.name} className="min-w-[120px] rounded-[10px] border border-border px-4 py-3">
                <div className="text-xs text-text-secondary">{labelize(s.name)}</div>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}

function TeamPov({ analytics }: { analytics: Analytics }) {
  const rows = analytics.ticketsByAssignee ?? []
  const maxOpen = Math.max(...rows.map((t) => t.open), 1)
  return (
    <>
      <SectionHead title="Team workload" subtitle="Service tickets by assignee (live)" accent="rose" />
      <Panel title="Engineer / desk queue">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-text-secondary">
                <th className="px-2 py-2.5 font-medium">#</th>
                <th className="px-2 py-2.5 font-medium">Person</th>
                <th className="px-2 py-2.5 font-medium">Open</th>
                <th className="px-2 py-2.5 font-medium">Resolved</th>
                <th className="px-2 py-2.5 font-medium">SLA breach</th>
                <th className="px-2 py-2.5 font-medium">Total</th>
                <th className="px-2 py-2.5 font-medium">Open load</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-text-secondary">
                    No assigned tickets yet
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={row.id} className="border-b border-border/70 last:border-0 hover:bg-surface">
                    <td className="px-2 py-3 tabular-nums text-text-secondary">{i + 1}</td>
                    <td className="px-2 py-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={row.name} size="sm" />
                        <span className="font-medium">{row.name}</span>
                      </span>
                    </td>
                    <td className="px-2 py-3 tabular-nums">{row.open}</td>
                    <td className="px-2 py-3 tabular-nums">{row.resolved}</td>
                    <td className="px-2 py-3 tabular-nums text-rose-600">{row.breached}</td>
                    <td className="px-2 py-3 tabular-nums">{row.total}</td>
                    <td className="min-w-[120px] px-2 py-3">
                      <ProgressTrack pct={Math.round((row.open / maxOpen) * 100)} color="#E11D48" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
