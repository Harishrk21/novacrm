import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  CheckSquare,
  CircleDollarSign,
  Clock,
  Mail,
  Phone,
  RefreshCw,
  Target,
  Ticket,
  TrendingUp,
  Users,
  FileText,
  UserX,
} from 'lucide-react'
import {
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
import { Badge, dealStageColor, leadSourceColor, leadStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { PALETTES } from '@/lib/theme'
import { api, isTenantSession, num } from '@/lib/api'
import { formatCurrency, formatDate, timeAgo } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { EmployeeDashboardPage } from '@/pages/EmployeeDashboardPage'
import type { Account, Activity, Contact, Deal, DealStage, Lead, LeadSource, LeadStatus, User } from '@/types'

const FUNNEL_STAGES: DealStage[] = ['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON']
const DASHBOARDS = [
  { id: 'service', label: 'Service desk' },
  { id: 'sales', label: 'Sales Analytics' },
  { id: 'leads', label: 'Lead Analytics' },
  { id: 'activity', label: 'Activity Stats' },
  { id: 'pipeline', label: 'Deal Insights' },
] as const

type DashId = (typeof DASHBOARDS)[number]['id']

const activityIcons = {
  CALL: { icon: Phone, color: 'bg-blue-500' },
  EMAIL: { icon: Mail, color: 'bg-emerald-500' },
  MEETING: { icon: Calendar, color: 'bg-violet-500' },
  TASK: { icon: CheckSquare, color: 'bg-amber-500' },
  NOTE: { icon: CheckSquare, color: 'bg-slate-400' },
  WHATSAPP: { icon: Phone, color: 'bg-green-500' },
}

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function mapStageCode(code: string): DealStage {
  const c = code.toUpperCase()
  if (c.includes('WON') || c === 'CLOSED_WON') return 'WON'
  if (c.includes('LOST')) return 'LOST'
  if (c.includes('NEGOT')) return 'NEGOTIATION'
  if (c.includes('QUOTE') || c.includes('PROPOSAL') || c.includes('QUOTATION')) return 'PROPOSAL'
  if (c.includes('QUALIF') || c.includes('SURVEY') || c.includes('SITE')) return 'QUALIFIED'
  return 'PROSPECT'
}

export function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role)
  // Only company ADMINS see the analytics client dashboard.
  // Agents / managers / read-only get the employee My Work desk.
  if (role === 'ADMIN') {
    return <AdminDashboardPage />
  }
  return <EmployeeDashboardPage />
}

function AdminDashboardPage() {
  const palette = useUIStore((state) => state.palette)
  const chartColors = PALETTES[palette].chart
  const [dash, setDash] = useState<DashId>('service')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [range, setRange] = useState('month')
  const [live, setLive] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [erp, setErp] = useState({ products: 0, invoices: 0, tickets: 0, stockRows: 0 })
  const [ticketSummary, setTicketSummary] = useState({
    open: 0,
    activeQueue: 0,
    overdue: 0,
    unassigned: 0,
    resolvedToday: 0,
    balanceOutstanding: 0,
    machinesDueSoon: 0,
    byStatus: {} as Record<string, number>,
  })
  const [recentTickets, setRecentTickets] = useState<Array<Record<string, unknown>>>([])
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.analytics>> | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isTenantSession()) {
      setLive(false)
      setLeads([])
      setDeals([])
      setActivities([])
      setAccounts([])
      setContacts([])
      setUsers([])
      setAnalytics(null)
      setErp({ products: 0, invoices: 0, tickets: 0, stockRows: 0 })
      setTicketSummary({ open: 0, activeQueue: 0, overdue: 0, unassigned: 0, resolvedToday: 0, balanceOutstanding: 0, machinesDueSoon: 0, byStatus: {} })
      setRecentTickets([])
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const [leadRes, dealRes, accountRes, contactRes, lookups, products, invoices, tickets, stock, summary, actsPage, tSum] =
          await Promise.all([
            api.leads({ limit: 200 }),
            api.deals({ limit: 200 }),
            api.accounts({ limit: 200 }),
            api.contacts({ limit: 200 }),
            api.lookups(),
            api.products({ limit: 100 }),
            api.invoices({ limit: 100 }),
            api.tickets({ limit: 100, sort: 'sla' }),
            api.inventory(),
            api.analytics(range),
            api.activities({ limit: 100 }),
            api.ticketsSummary(),
          ])
        if (cancelled) return

        const byStatus = tSum.byStatus ?? {}
        const openOnly = Number(tSum.open ?? byStatus.OPEN ?? 0)
        const activeQueue = Number(
          tSum.activeQueue ??
            (byStatus.OPEN ?? 0) + (byStatus.IN_PROGRESS ?? 0) + (byStatus.PENDING ?? 0),
        )
        setTicketSummary({
          open: openOnly,
          activeQueue,
          overdue: tSum.overdue,
          unassigned: tSum.unassigned,
          resolvedToday: tSum.resolvedToday,
          balanceOutstanding: Number(tSum.balanceOutstanding ?? 0),
          machinesDueSoon: Number(tSum.machinesDueSoon ?? 0),
          byStatus,
        })
        setRecentTickets(
          (tickets.items ?? [])
            .filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(String(t.status)))
            .slice(0, 8),
        )

        const stageById = Object.fromEntries(lookups.stages.map((s) => [s.id, s]))
        const sourceById = Object.fromEntries(lookups.sources.map((s) => [s.id, s.name]))

        const mappedLeads: Lead[] = (leadRes.items ?? []).map((row) => {
          const srcName = sourceById[String(row.sourceId ?? '')] ?? 'OTHER'
          const sourceKey = srcName.toUpperCase().replace(/[^A-Z]+/g, '_') as LeadSource
          return {
            id: String(row.id),
            name: String(row.name),
            email: row.email ? String(row.email) : undefined,
            phone: row.phone ? String(row.phone) : undefined,
            company: row.company ? String(row.company) : undefined,
            city: row.city ? String(row.city) : undefined,
            state: row.state ? String(row.state) : undefined,
            country: String(row.country ?? 'IN'),
            source: (['WEB', 'REFERRAL', 'COLD_CALL', 'SOCIAL', 'CAMPAIGN', 'EVENT', 'PARTNER', 'OTHER'].includes(
              sourceKey,
            )
              ? sourceKey
              : 'OTHER') as LeadSource,
            status: String(row.status) as LeadStatus,
            score: num(row.score),
            tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
            assignedToId: row.assignedToId ? String(row.assignedToId) : undefined,
            createdById: String(row.createdById ?? ''),
            createdAt: String(row.createdAt ?? new Date().toISOString()),
            updatedAt: String(row.updatedAt ?? new Date().toISOString()),
          }
        })

        const mappedDeals: Deal[] = (dealRes.items ?? []).map((row) => {
          const stage = stageById[String(row.stageId ?? '')]
          return {
            id: String(row.id),
            name: String(row.name),
            value: num(row.amount),
            stage: stage ? mapStageCode(stage.code) : 'PROSPECT',
            probability: num(row.probability ?? stage?.probability ?? 20),
            expectedCloseDate: row.expectedCloseDate ? String(row.expectedCloseDate) : undefined,
            contactId: row.contactId ? String(row.contactId) : undefined,
            accountId: row.accountId ? String(row.accountId) : undefined,
            ownerId: row.ownerUserId ? String(row.ownerUserId) : undefined,
            priority: 'MEDIUM',
            daysInStage: 0,
            createdAt: String(row.createdAt ?? new Date().toISOString()),
            updatedAt: String(row.updatedAt ?? new Date().toISOString()),
          }
        })

        setLeads(mappedLeads)
        setDeals(mappedDeals)
        setAccounts(
          (accountRes.items ?? []).map((a) => ({
            id: String(a.id),
            name: String(a.name),
            industry: a.industry ? String(a.industry) : undefined,
            website: a.website ? String(a.website) : undefined,
            phone: a.phone ? String(a.phone) : undefined,
            email: a.email ? String(a.email) : undefined,
            city: a.city ? String(a.city) : undefined,
            state: a.state ? String(a.state) : undefined,
            country: String(a.country ?? 'IN'),
            ownerId: a.ownerUserId ? String(a.ownerUserId) : undefined,
            createdAt: String(a.createdAt ?? ''),
            updatedAt: String(a.updatedAt ?? ''),
          })),
        )
        setContacts(
          (contactRes.items ?? []).map((c) => ({
            id: String(c.id),
            name: String(c.name),
            email: c.email ? String(c.email) : undefined,
            phone: c.phone ? String(c.phone) : undefined,
            title: c.title ? String(c.title) : undefined,
            city: c.city ? String(c.city) : undefined,
            state: c.state ? String(c.state) : undefined,
            country: String(c.country ?? 'IN'),
            accountId: c.accountId ? String(c.accountId) : undefined,
            ownerId: c.ownerUserId ? String(c.ownerUserId) : undefined,
            tags: [],
            createdAt: String(c.createdAt ?? ''),
            updatedAt: String(c.updatedAt ?? ''),
          })),
        )
        setUsers(
          lookups.users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: 'AGENT',
            status: 'ACTIVE',
            timezone: 'Asia/Kolkata',
            createdAt: new Date().toISOString(),
          })),
        )
        setActivities(
          (actsPage.items ?? []).map((row) => {
            const a = row as Record<string, unknown>
            const rawStatus = String(a.status ?? 'PENDING')
            const status = (
              ['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE'].includes(rawStatus) ? rawStatus : 'PENDING'
            ) as Activity['status']
            const rawType = String(a.type ?? 'TASK')
            const type = (
              ['CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE', 'WHATSAPP'].includes(rawType) ? rawType : 'TASK'
            ) as Activity['type']
            return {
              id: String(a.id),
              type,
              title: String(a.title ?? 'Activity'),
              status,
              assignedToId: a.assignedToId ? String(a.assignedToId) : undefined,
              completedAt: a.completedAt ? String(a.completedAt) : undefined,
              scheduledAt: a.scheduledAt ? String(a.scheduledAt) : undefined,
              createdAt: String(a.createdAt ?? new Date().toISOString()),
              updatedAt: String(a.updatedAt ?? a.createdAt ?? new Date().toISOString()),
            }
          }),
        )
        setAnalytics(summary)
        setErp({
          products: Number(products.meta?.total ?? products.items?.length ?? 0),
          invoices: Number(invoices.meta?.total ?? invoices.items?.length ?? 0),
          tickets: Number(tickets.meta?.total ?? tickets.items?.length ?? 0),
          stockRows: Array.isArray(stock) ? stock.length : Number((stock as { meta?: { total?: number } })?.meta?.total ?? 0),
        })
        setLive(true)
      } catch {
        setLive(false)
        setLeads([])
        setDeals([])
        setActivities([])
        setAccounts([])
        setContacts([])
        setUsers([])
        setAnalytics(null)
        setErp({ products: 0, invoices: 0, tickets: 0, stockRows: 0 })
        setTicketSummary({ open: 0, activeQueue: 0, overdue: 0, unassigned: 0, resolvedToday: 0, balanceOutstanding: 0, machinesDueSoon: 0, byStatus: {} })
        setRecentTickets([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [range, reloadKey])

  useEffect(() => {
    if (!isTenantSession()) return
    const id = window.setInterval(() => setReloadKey((k) => k + 1), 45000)
    return () => window.clearInterval(id)
  }, [])

  const filteredDeals = useMemo(
    () => (ownerFilter === 'all' ? deals : deals.filter((d) => d.ownerId === ownerFilter)),
    [deals, ownerFilter],
  )
  const filteredLeads = useMemo(
    () => (ownerFilter === 'all' ? leads : leads.filter((l) => l.assignedToId === ownerFilter)),
    [leads, ownerFilter],
  )
  const filteredActivities = useMemo(
    () => (ownerFilter === 'all' ? activities : activities.filter((a) => a.assignedToId === ownerFilter)),
    [activities, ownerFilter],
  )

  const openDeals = filteredDeals.filter((d) => !['WON', 'LOST'].includes(d.stage))
  const wonDeals = filteredDeals.filter((d) => d.stage === 'WON')
  const wonRevenue = wonDeals.reduce((s, d) => s + d.value, 0)
  const openRevenue = openDeals.reduce((s, d) => s + d.value, 0)
  const pipelineValue = filteredDeals
    .filter((d) => d.stage !== 'LOST')
    .reduce((s, d) => s + d.value * (d.probability / 100), 0)
  const revenueTarget = Number(analytics?.salesTargets?.revenueTarget ?? 0) || 0
  const targetPct = revenueTarget > 0 ? Math.min(100, Math.round((wonRevenue / revenueTarget) * 100)) : 0
  const leadGrowthLabel = analytics ? `${analytics.kpis.leadGrowth >= 0 ? '+' : ''}${analytics.kpis.leadGrowth}%` : '+0%'
  const dealGrowthLabel = analytics ? `${analytics.kpis.dealGrowth >= 0 ? '+' : ''}${analytics.kpis.dealGrowth}%` : '+0%'
  const qualified = filteredLeads.filter((l) => l.status === 'QUALIFIED' || l.status === 'CONVERTED').length
  const conversionRate = analytics
    ? String(analytics.kpis.conversionRate)
    : filteredLeads.length
      ? ((qualified / filteredLeads.length) * 100).toFixed(1)
      : '0'

  const stageFunnel = (analytics?.funnel?.length
    ? analytics.funnel
        .filter((f) => !f.isLost)
        .map((f, i) => ({
          stage: f.stage,
          count: f.count,
          displayCount: f.count,
          value: f.value,
          width: f.width,
          color: f.color || chartColors[i % chartColors.length],
          conversion: f.conversion,
        }))
    : FUNNEL_STAGES.map((stage, i) => {
        const stageDeals = filteredDeals.filter((d) => d.stage === stage)
        const count = stageDeals.length
        const value = stageDeals.reduce((s, d) => s + d.value, 0)
        const prev =
          i === 0 ? Math.max(count, 1) : filteredDeals.filter((d) => d.stage === FUNNEL_STAGES[i - 1]).length || 1
        return {
          stage: labelize(stage),
          count,
          displayCount: count,
          value,
          width: `${Math.max(28, 100 - i * 14)}%`,
          color: chartColors[i % chartColors.length],
          conversion: i === 0 ? 100 : Math.round((count / Math.max(prev, 1)) * 100),
        }
      }))

  const leadsByStatus = (Object.keys(leadStatusColor) as LeadStatus[]).map((status) => ({
    status: labelize(status),
    count: filteredLeads.filter((l) => l.status === status).length,
  })).filter((d) => d.count > 0)

  const leadsBySource = (Object.keys(leadSourceColor) as LeadSource[]).map((source) => ({
    name: labelize(source),
    value: filteredLeads.filter((l) => l.source === source).length,
  })).filter((d) => d.value > 0)

  const revenueByCity = (analytics?.byCity ?? [])
    .filter((c) => c.revenue > 0 || c.leads > 0)
    .map((c) => ({ city: c.city, revenue: c.revenue, leads: c.leads, accounts: c.accounts }))
    .sort((a, b) => b.revenue - a.revenue)

  const revenueByIndustry = [...accounts]
    .map((acc) => {
      const value = filteredDeals
        .filter((d) => d.accountId === acc.id && d.stage === 'WON')
        .reduce((s, d) => s + d.value, 0)
      return { industry: acc.industry ?? 'Other', value }
    })
    .reduce<Record<string, number>>((acc, row) => {
      acc[row.industry] = (acc[row.industry] ?? 0) + row.value
      return acc
    }, {})
  const industryBars = Object.entries(revenueByIndustry)
    .map(([industry, value]) => ({ industry, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const industryComparator = [...new Set(accounts.map((a) => a.industry).filter(Boolean) as string[])]
    .map((industry) => {
      const accIds = accounts.filter((a) => a.industry === industry).map((a) => a.id)
      const related = filteredDeals.filter((d) => d.accountId && accIds.includes(d.accountId))
      return {
        industry,
        won: related.filter((d) => d.stage === 'WON').length,
        open: related.filter((d) => !['WON', 'LOST'].includes(d.stage)).length,
        lost: related.filter((d) => d.stage === 'LOST').length,
      }
    })
    .filter((r) => r.won + r.open + r.lost > 0)

  const avgCallMinutes = Number(analytics?.kpis?.avgCallMinutes ?? 0) || 0
  const pendingTasks = filteredActivities.filter((a) => a.type === 'TASK' && a.status === 'PENDING').length
  const completedTasks = filteredActivities.filter((a) => a.type === 'TASK' && a.status === 'COMPLETED').length
  const overdueTasks = filteredActivities.filter((a) => a.status === 'OVERDUE').length
  const activityByType = analytics?.activityByType ?? []
  const activityMonthly = analytics?.activityMonthly ?? []

  const topDeals = [...filteredDeals]
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const latestDeals = [...filteredDeals]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)

  const leaderboard = users
    .filter((u) => ['AGENT', 'MANAGER', 'ADMIN'].includes(u.role))
    .map((u) => {
      const owned = filteredDeals.filter((d) => d.ownerId === u.id)
      const revenue = owned.filter((d) => d.stage === 'WON').reduce((s, d) => s + d.value, 0)
      const expected = owned
        .filter((d) => !['WON', 'LOST'].includes(d.stage))
        .reduce((s, d) => s + d.value * (d.probability / 100), 0)
      return { user: u, revenue, expected, closed: owned.filter((d) => d.stage === 'WON').length }
    })
    .sort((a, b) => b.expected - a.expected)
    .slice(0, 5)

  const recentActivities = [...filteredActivities]
    .sort((a, b) => (b.scheduledAt ?? b.createdAt).localeCompare(a.scheduledAt ?? a.createdAt))
    .slice(0, 8)

  const conversionFunnel = [
    { label: 'Leads Created', value: filteredLeads.length, color: chartColors[4] },
    { label: 'Leads Converted', value: filteredLeads.filter((l) => l.status === 'CONVERTED').length, color: chartColors[3] },
    { label: 'Deals Created', value: filteredDeals.length, color: chartColors[2] },
    { label: 'Deals Won', value: wonDeals.length, color: chartColors[0] },
  ]

  const dashTitle = DASHBOARDS.find((d) => d.id === dash)?.label ?? 'Dashboard'
  const newLeads = filteredLeads.filter((l) => l.status === 'NEW').length
  const contactedLeads = filteredLeads.filter((l) => l.status === 'CONTACTED').length
  const lostDeals = filteredDeals.filter((d) => d.stage === 'LOST').length
  const completedActs = filteredActivities.filter((a) => a.status === 'COMPLETED').length
  const openActs = filteredActivities.filter((a) => a.status === 'PENDING' || a.status === 'OVERDUE').length
  const invoiceRevenue = Number(analytics?.kpis?.invoiceRevenue ?? 0) || 0
  const invoiceCount = Number(analytics?.kpis?.invoiceCount ?? erp.invoices) || erp.invoices

  const dashHint: Record<(typeof DASHBOARDS)[number]['id'], string> = {
    service: 'Open service tickets, SLA breaches, and today’s resolutions. Click a KPI to open the queue.',
    sales: 'Revenue, open deals, invoices & conversion. Filter by user or date above.',
    leads: 'Lead volume by status & source. Assign owners on Leads, then Convert when ready.',
    activity: 'Team follow-ups. Assign tasks in Activities — agents complete them on My Work.',
    pipeline: 'Deal stages & forecast. Move cards on Deals; Won → Create invoice.',
  }

  const statusBars = [
    { label: 'Open', key: 'OPEN', color: chartColors[4] },
    { label: 'In progress', key: 'IN_PROGRESS', color: chartColors[2] },
    { label: 'Pending', key: 'PENDING', color: chartColors[3] },
    { label: 'Resolved', key: 'RESOLVED', color: chartColors[0] },
    { label: 'Closed', key: 'CLOSED', color: chartColors[1] },
  ].map((s) => ({ ...s, value: ticketSummary.byStatus[s.key] ?? 0 }))

  return (
    <div className="space-y-5">
      <PageHeader
        title={dashTitle}
        breadcrumbs={[{ label: 'Home' }, { label: 'Dashboard' }, { label: dashTitle }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="w-40"
              options={[
                { value: 'all', label: 'All Users' },
                ...users.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="w-36"
              options={[
                { value: 'month', label: 'This Month' },
                { value: 'quarter', label: 'This Quarter' },
                { value: 'year', label: 'This Year' },
              ]}
            />
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        }
      />

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
        <span>{dashHint[dash]}</span>
        <Link to="/help" className="font-medium text-accent-blue hover:underline">
          How it works →
        </Link>
      </p>

      {live && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-accent-green">Live totals from your database (not sample data)</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Products', value: erp.products },
            { label: 'Stock rows', value: erp.stockRows },
            { label: 'Invoices', value: erp.invoices },
            { label: 'Tickets', value: erp.tickets },
          ].map((item) => (
            <Card key={item.label} className="flex items-center justify-between py-3">
              <span className="text-sm text-text-secondary">{item.label}</span>
              <span className="text-xl font-semibold tabular-nums">{item.value}</span>
            </Card>
          ))}
          </div>
        </div>
      )}

      <div className="flex gap-5">
        {/* Dashboard switcher sidebar */}
        <aside className="hidden w-48 shrink-0 xl:block">
          <Card className="sticky top-0 p-2">
            <div className="mb-2 px-2 text-[10px] font-semibold tracking-wider text-text-secondary">
              DASHBOARDS
            </div>
            {DASHBOARDS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDash(d.id)}
                className={`mb-0.5 flex w-full rounded-[6px] px-3 py-2 text-left text-sm transition-colors duration-150 ${
                  dash === d.id
                    ? 'bg-blue-50 font-medium text-accent-blue'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
              >
                {d.label}
              </button>
            ))}
          </Card>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          {/* Mobile dash tabs */}
          <div className="flex gap-2 overflow-x-auto xl:hidden">
            {DASHBOARDS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDash(d.id)}
                className={`shrink-0 rounded-[6px] px-3 py-1.5 text-sm ${
                  dash === d.id ? 'bg-accent-blue text-white' : 'bg-card border border-border text-text-secondary'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* KPI row — changes with dashboard tab */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {dash === 'service' && (
              <>
                <KpiCard
                  to="/tickets?status=OPEN"
                  label="Open tickets"
                  value={String(ticketSummary.open)}
                  change={
                    ticketSummary.activeQueue > ticketSummary.open
                      ? `${ticketSummary.activeQueue} active`
                      : '—'
                  }
                  up
                  icon={<Ticket size={18} />}
                  iconBg="bg-blue-50 text-accent-blue"
                  sub={`${ticketSummary.byStatus.IN_PROGRESS ?? 0} in progress · ${ticketSummary.byStatus.PENDING ?? 0} pending`}
                />
                <KpiCard
                  to="/tickets"
                  label="Balance outstanding"
                  value={formatCurrency(ticketSummary.balanceOutstanding)}
                  change={ticketSummary.balanceOutstanding > 0 ? 'Collect' : 'Clear'}
                  up={ticketSummary.balanceOutstanding === 0}
                  icon={<CircleDollarSign size={18} />}
                  iconBg="bg-amber-50 text-accent-amber"
                  sub="Payment − advance on open jobs"
                />
                <KpiCard
                  to="/tickets?slaBreached=1"
                  label="Overdue SLA"
                  value={String(ticketSummary.overdue)}
                  change={ticketSummary.overdue > 0 ? 'Action' : 'OK'}
                  up={ticketSummary.overdue === 0}
                  icon={<Clock size={18} />}
                  iconBg="bg-red-50 text-accent-red"
                  sub="Past due, still open"
                />
                <KpiCard
                  to="/contacts"
                  label="Machines due (30d)"
                  value={String(ticketSummary.machinesDueSoon)}
                  change={ticketSummary.machinesDueSoon > 0 ? 'Follow up' : 'OK'}
                  up={ticketSummary.machinesDueSoon === 0}
                  icon={<Calendar size={18} />}
                  iconBg="bg-violet-50 text-accent-purple"
                  sub="Next due, stamping or AMC end within 30 days"
                />
              </>
            )}
            {dash === 'sales' && (
              <>
                <KpiCard
                  to="/deals"
                  label="Won revenue"
                  value={formatCurrency(wonRevenue)}
                  change={dealGrowthLabel}
                  up={!analytics || analytics.kpis.dealGrowth >= 0}
                  icon={<TrendingUp size={18} />}
                  iconBg="bg-emerald-50 text-accent-green"
                  sub={revenueTarget > 0 ? `Target ${formatCurrency(revenueTarget)}` : `${wonDeals.length} won deals`}
                />
                <KpiCard
                  to="/deals"
                  label="Open pipeline"
                  value={formatCurrency(openRevenue)}
                  change={dealGrowthLabel}
                  up={!analytics || analytics.kpis.dealGrowth >= 0}
                  icon={<Briefcase size={18} />}
                  iconBg="bg-amber-50 text-accent-amber"
                  sub={`${openDeals.length} open deals`}
                />
                <KpiCard
                  to="/erp/invoices"
                  label="Invoices"
                  value={String(invoiceCount)}
                  change={`${erp.invoices} total`}
                  up
                  icon={<FileText size={18} />}
                  iconBg="bg-blue-50 text-accent-blue"
                  sub={formatCurrency(invoiceRevenue)}
                />
                <KpiCard
                  to="/leads"
                  label="Conversion"
                  value={`${conversionRate}%`}
                  change={leadGrowthLabel}
                  up={!analytics || analytics.kpis.leadGrowth >= 0}
                  icon={<Users size={18} />}
                  iconBg="bg-violet-50 text-accent-purple"
                  sub={`Weighted ${formatCurrency(pipelineValue)}`}
                />
              </>
            )}
            {dash === 'leads' && (
              <>
                <KpiCard
                  to="/leads"
                  label="Total leads"
                  value={String(filteredLeads.length)}
                  change={leadGrowthLabel}
                  up={!analytics || analytics.kpis.leadGrowth >= 0}
                  icon={<Users size={18} />}
                  iconBg="bg-blue-50 text-accent-blue"
                  sub={`${newLeads} new`}
                />
                <KpiCard
                  to="/leads?status=QUALIFIED"
                  label="Qualified"
                  value={String(qualified)}
                  change={leadGrowthLabel}
                  up
                  icon={<CheckSquare size={18} />}
                  iconBg="bg-emerald-50 text-accent-green"
                  sub={`${contactedLeads} contacted`}
                />
                <KpiCard
                  to="/leads?status=CONVERTED"
                  label="Converted"
                  value={String(filteredLeads.filter((l) => l.status === 'CONVERTED').length)}
                  change={leadGrowthLabel}
                  up
                  icon={<TrendingUp size={18} />}
                  iconBg="bg-violet-50 text-accent-purple"
                  sub={`${conversionRate}% rate`}
                />
                <KpiCard
                  to="/leads?status=LOST"
                  label="Unqualified / lost"
                  value={String(
                    filteredLeads.filter((l) => l.status === 'UNQUALIFIED' || l.status === 'LOST').length,
                  )}
                  change="—"
                  up={false}
                  icon={<Users size={18} />}
                  iconBg="bg-red-50 text-accent-red"
                  sub="Stopped before deal"
                />
              </>
            )}
            {dash === 'activity' && (
              <>
                <KpiCard
                  to="/activities"
                  label="Open tasks"
                  value={String(openActs)}
                  change={`${overdueTasks} overdue`}
                  up={overdueTasks === 0}
                  icon={<CheckSquare size={18} />}
                  iconBg="bg-amber-50 text-accent-amber"
                  sub={`${pendingTasks} pending tasks`}
                />
                <KpiCard
                  to="/activities"
                  label="Completed"
                  value={String(completedActs)}
                  change={`${completedTasks} tasks`}
                  up
                  icon={<CheckSquare size={18} />}
                  iconBg="bg-emerald-50 text-accent-green"
                  sub="Marked done by team"
                />
                <KpiCard
                  to="/activities"
                  label="Avg call"
                  value={avgCallMinutes > 0 ? `${avgCallMinutes}` : '—'}
                  change="min"
                  up
                  icon={<Phone size={18} />}
                  iconBg="bg-blue-50 text-accent-blue"
                  sub={`${Number(analytics?.kpis?.callCount ?? 0)} calls`}
                />
                <KpiCard
                  to="/activities"
                  label="Activity volume"
                  value={String(filteredActivities.length)}
                  change={`${activityByType.length} types`}
                  up
                  icon={<TrendingUp size={18} />}
                  iconBg="bg-violet-50 text-accent-purple"
                  sub="Calls, emails, tasks…"
                />
              </>
            )}
            {dash === 'pipeline' && (
              <>
                <KpiCard
                  to="/deals"
                  label="Open deals"
                  value={String(openDeals.length)}
                  change={dealGrowthLabel}
                  up={!analytics || analytics.kpis.dealGrowth >= 0}
                  icon={<Briefcase size={18} />}
                  iconBg="bg-amber-50 text-accent-amber"
                  sub={formatCurrency(openRevenue)}
                />
                <KpiCard
                  to="/deals"
                  label="Won deals"
                  value={String(wonDeals.length)}
                  change={formatCurrency(wonRevenue)}
                  up
                  icon={<TrendingUp size={18} />}
                  iconBg="bg-emerald-50 text-accent-green"
                  sub="Closed-won value"
                />
                <KpiCard
                  to="/deals"
                  label="Lost deals"
                  value={String(lostDeals)}
                  change="—"
                  up={false}
                  icon={<Briefcase size={18} />}
                  iconBg="bg-red-50 text-accent-red"
                  sub="No invoice path"
                />
                <KpiCard
                  to="/deals"
                  label="Weighted forecast"
                  value={formatCurrency(pipelineValue)}
                  change={`${conversionRate}% win rate`}
                  up
                  icon={<Target size={18} />}
                  iconBg="bg-blue-50 text-accent-blue"
                  sub="Amount × probability"
                />
              </>
            )}
          </div>

          {dash === 'service' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <WidgetTitle title="Tickets by status" icon={<Ticket size={14} />} />
                  <Link to="/tickets" className="text-xs text-accent-blue hover:underline">
                    Open queue
                  </Link>
                </div>
                {live ? (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={statusBars}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {statusBars.map((s) => (
                            <Cell key={s.key} fill={s.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">Sign in to a company workspace to see live ticket stats.</p>
                )}
              </Card>
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <WidgetTitle title="SLA queue (soonest due)" icon={<Clock size={14} />} />
                  <Link to="/tickets?slaBreached=1" className="text-xs text-accent-blue hover:underline">
                    Overdue only
                  </Link>
                </div>
                <div className="space-y-2">
                  {!live || recentTickets.length === 0 ? (
                    <p className="text-sm text-text-secondary">
                      No open service tickets. Find a customer in{' '}
                      <Link to="/contacts" className="text-accent-blue hover:underline">
                        Contacts
                      </Link>{' '}
                      and create a ticket.
                    </p>
                  ) : (
                    recentTickets.map((t) => {
                      const id = String(t.id)
                      const breached = Boolean(t.slaBreached)
                      return (
                        <Link
                          key={id}
                          to={`/tickets/${id}`}
                          className="block rounded-[8px] border border-border bg-surface px-3 py-2 text-sm hover:border-accent-blue/40"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                #{String(t.ticketNo)} · {String(t.subject)}
                              </div>
                              <div className="mt-0.5 text-xs text-text-secondary">
                                {String(t.status).replaceAll('_', ' ')}
                                {t.slaDueAt ? ` · due ${formatDate(String(t.slaDueAt))}` : ''}
                              </div>
                            </div>
                            <Badge color={breached ? 'red' : t.priority === 'CRITICAL' || t.priority === 'HIGH' ? 'amber' : 'blue'}>
                              {breached ? 'SLA' : String(t.priority)}
                            </Badge>
                          </div>
                        </Link>
                      )
                    })
                  )}
                </div>
              </Card>
            </div>
          )}

          {live && (dash === 'sales' || dash === 'activity') && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <WidgetTitle title="Team work in progress" icon={<CheckSquare size={14} />} />
                  <Link to="/activities" className="text-xs text-accent-blue hover:underline">
                    Manage
                  </Link>
                </div>
                <div className="space-y-2">
                  {(() => {
                    const openActs = filteredActivities
                      .filter((a) => a.status === 'PENDING' || a.status === 'OVERDUE')
                      .slice(0, 6)
                    const openAssignedLeads = filteredLeads
                      .filter(
                        (l) =>
                          Boolean(l.assignedToId) &&
                          !['CONVERTED', 'LOST', 'UNQUALIFIED'].includes(l.status),
                      )
                      .slice(0, 6)
                    const rows: Array<{
                      key: string
                      title: string
                      ownerId?: string
                      badge: string
                      badgeColor: 'amber' | 'red' | 'blue'
                      to: string
                    }> = [
                      ...openActs.map((a) => ({
                        key: `a-${a.id}`,
                        title: a.title,
                        ownerId: a.assignedToId,
                        badge: a.status,
                        badgeColor: (a.status === 'OVERDUE' ? 'red' : 'amber') as 'amber' | 'red',
                        to: '/activities',
                      })),
                      ...openAssignedLeads.map((l) => ({
                        key: `l-${l.id}`,
                        title: `Lead: ${l.name}${l.company ? ` · ${l.company}` : ''}`,
                        ownerId: l.assignedToId,
                        badge: 'ASSIGNED',
                        badgeColor: 'blue' as const,
                        to: '/leads',
                      })),
                    ].slice(0, 8)

                    if (!rows.length) {
                      return (
                        <p className="text-sm text-text-secondary">
                          No open work yet. Assign a lead to an agent (creates a follow-up task), or create an
                          activity under Activities.
                        </p>
                      )
                    }

                    return rows.map((row) => {
                      const owner = users.find((u) => u.id === row.ownerId)
                      return (
                        <Link
                          key={row.key}
                          to={row.to}
                          className="block rounded-[8px] border border-border bg-surface px-3 py-2 text-sm hover:border-accent-blue/40"
                        >
                          <div className="truncate font-medium">{row.title}</div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-secondary">
                            <span>{owner?.name ?? 'Unassigned'}</span>
                            <Badge color={row.badgeColor}>{row.badge}</Badge>
                          </div>
                        </Link>
                      )
                    })
                  })()}
                </div>
              </Card>
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <WidgetTitle title="Recently completed by team" icon={<CheckSquare size={14} />} />
                  <Link to="/help" className="text-xs text-accent-blue hover:underline">
                    How it works
                  </Link>
                </div>
                <div className="space-y-2">
                  {filteredActivities
                    .filter((a) => a.status === 'COMPLETED')
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(String(b.completedAt ?? b.updatedAt ?? 0)).getTime() -
                        new Date(String(a.completedAt ?? a.updatedAt ?? 0)).getTime(),
                    )
                    .slice(0, 6)
                    .map((a) => {
                      const owner = users.find((u) => u.id === a.assignedToId)
                      return (
                        <div
                          key={a.id}
                          className="rounded-[8px] border border-border bg-emerald-50/50 px-3 py-2 text-sm"
                        >
                          <div className="truncate font-medium">{a.title}</div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-secondary">
                            <span>{owner?.name ?? 'Unassigned'}</span>
                            <Badge color="green">COMPLETED</Badge>
                          </div>
                        </div>
                      )
                    })}
                  {!filteredActivities.some((a) => a.status === 'COMPLETED') && (
                    <p className="text-sm text-text-secondary">
                      When agents mark tasks complete on their dashboard, they show up here.
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {(dash === 'sales' || dash === 'pipeline') && (
            <>
              {/* Row: Funnel + Gauge + Target */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1 overflow-hidden">
                  <WidgetTitle title="Sales Pipeline by Stage" />
                  <div className="mt-4 space-y-3">
                    {stageFunnel.map((row) => {
                      const openDeals = Math.max(
                        filteredDeals.filter((d) => d.stage !== 'LOST').length,
                        1,
                      )
                      const pct = Math.round((row.count / openDeals) * 100)
                      const barPct = Math.max(row.count ? 8 : 0, pct)
                      return (
                        <div key={row.stage} className="min-w-0">
                          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate font-medium text-text-primary">{row.stage}</span>
                            <span className="shrink-0 tabular-nums text-text-secondary">
                              {row.count || '—'} · {pct}%
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${barPct}%`, background: row.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                <Card>
                  <WidgetTitle title="Revenue Target" icon={<Target size={14} />} />
                  {revenueTarget <= 0 ? (
                    <div className="mt-6 rounded-[6px] bg-surface p-4 text-center text-sm text-text-secondary">
                      Set a revenue target in{' '}
                      <Link to="/settings" className="font-medium text-accent-blue hover:underline">
                        Settings → Sales Targets
                      </Link>
                    </div>
                  ) : (
                    <>
                      <GaugeChart value={wonRevenue} max={revenueTarget} pct={targetPct} />
                      <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                        <div className="rounded-[6px] bg-surface p-2">
                          <div className="text-text-secondary">Achieved</div>
                          <div className="font-semibold text-accent-green">{formatCurrency(wonRevenue)}</div>
                        </div>
                        <div className="rounded-[6px] bg-surface p-2">
                          <div className="text-text-secondary">Remaining</div>
                          <div className="font-semibold text-accent-amber">
                            {formatCurrency(Math.max(0, revenueTarget - wonRevenue))}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </Card>

                <Card>
                  <WidgetTitle title="Revenue by City" />
                  <div className="mt-2 h-56">
                    {revenueByCity.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
                        No city revenue yet
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={revenueByCity} layout="vertical" margin={{ left: 8, right: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => `₹${v / 100000}L`} tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="city" width={72} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="revenue" name="Won revenue" fill={chartColors[0]} radius={[0, 4, 4, 0]} barSize={12} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </div>

              {/* Conversion funnel + Industry + Top products/cities */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card>
                  <WidgetTitle title="Lead Conversion Analytics" />
                  <div className="mt-4 space-y-3">
                    {conversionFunnel.map((row, i) => (
                      <div key={row.label} className="min-w-0">
                        <div className="mb-1 flex justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-text-primary">{row.label}</span>
                          <span className="shrink-0 tabular-nums text-text-secondary">
                            {row.value}
                            {i > 0 && (
                              <span className="ml-1 text-accent-green">
                                {Math.round((row.value / Math.max(conversionFunnel[0].value, 1)) * 100)}%
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.max(row.value ? 8 : 0, Math.round((row.value / Math.max(conversionFunnel[0].value, 1)) * 100))}%`,
                              background: row.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {conversionFunnel.map((r) => (
                      <div key={r.label} className="flex items-center gap-1.5 text-[10px] text-text-secondary">
                        <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                        {r.label}
                      </div>
                    ))}
                  </div>
                </Card>

                <Card padding={false}>
                  <div className="p-5 pb-3">
                    <WidgetTitle title="Industry-wise Comparator" />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-y border-border bg-surface text-xs text-text-secondary">
                          <th className="px-4 py-2 font-medium">Industry</th>
                          <th className="px-3 py-2 font-medium">Won</th>
                          <th className="px-3 py-2 font-medium">Open</th>
                          <th className="px-3 py-2 font-medium">Lost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {industryComparator.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-sm text-text-secondary">
                              No industry data yet
                            </td>
                          </tr>
                        ) : (
                          industryComparator.map((row) => (
                            <tr key={row.industry} className="border-b border-border last:border-0">
                              <td className="px-4 py-2.5 font-medium">{row.industry}</td>
                              <td className="px-3 py-2.5">
                                <span className="font-semibold text-accent-green">{row.won}</span>
                                <span className="ml-1 text-[10px] text-accent-green">↑</span>
                              </td>
                              <td className="px-3 py-2.5 text-accent-blue">{row.open}</td>
                              <td className="px-3 py-2.5">
                                <span className="text-accent-red">{row.lost}</span>
                                {row.lost > 0 && <span className="ml-1 text-[10px] text-accent-red">↑</span>}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card>
                  <WidgetTitle title="Revenue by Industry" />
                  <div className="mt-2 h-56">
                    {industryBars.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
                        No industry revenue yet
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={industryBars} layout="vertical" margin={{ left: 4, right: 8 }}>
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="industry" width={100} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                            {industryBars.map((_, i) => (
                              <Cell key={i} fill={chartColors[i % chartColors.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>
              </div>
            </>
          )}

          {(dash === 'sales' || dash === 'leads') && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card>
                <WidgetTitle title="Leads by Status" />
                <div className="mt-2 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadsByStatus}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill={chartColors[0]} radius={[4, 4, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <WidgetTitle title="Leads by Source" />
                <div className="mt-2 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={leadsBySource}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                      >
                        {leadsBySource.map((_, i) => (
                          <Cell key={i} fill={chartColors[i % chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="flex flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <WidgetTitle title="Recent Activities" />
                  <Link to="/activities" className="text-xs text-accent-blue hover:underline">
                    View all
                  </Link>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto max-h-56">
                  {recentActivities.map((a) => {
                    const meta = activityIcons[a.type] ?? activityIcons.NOTE
                    const Icon = meta.icon
                    return (
                      <div key={a.id} className="flex items-start gap-2.5">
                        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.color} text-white`}>
                          <Icon size={11} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text-primary">{a.title}</p>
                          <p className="text-[11px] text-text-secondary">{timeAgo(a.scheduledAt ?? a.createdAt)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>
          )}

          {(dash === 'sales' || dash === 'activity') && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="flex flex-col items-center justify-center py-8">
                <div className="text-sm text-text-secondary">Avg Call Duration</div>
                {avgCallMinutes > 0 ? (
                  <div className="mt-2 font-mono text-4xl font-bold text-accent-amber">
                    {avgCallMinutes % 1 === 0 ? avgCallMinutes : avgCallMinutes.toFixed(1)}
                    <span className="ml-1 text-base font-medium text-text-secondary">min</span>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 text-4xl font-bold text-text-secondary">—</div>
                    <div className="mt-1 text-xs text-text-secondary">No call durations logged</div>
                  </>
                )}
              </Card>
              <Card className="flex flex-col items-center justify-center py-8">
                <div className="text-sm text-text-secondary">High Priority Tasks</div>
                <div className="mt-2 text-5xl font-bold text-accent-red">{overdueTasks || pendingTasks}</div>
              </Card>
              <Card>
                <WidgetTitle title="Tasks Progress" />
                <TaskGauge inProgress={pendingTasks} completed={completedTasks} />
              </Card>
              <Card>
                <WidgetTitle title="Activities by Type" />
                <div className="mt-3 max-h-36 space-y-2 overflow-y-auto">
                  {activityByType.length === 0 ? (
                    <div className="py-6 text-center text-sm text-text-secondary">No activities yet</div>
                  ) : (
                    activityByType.map((row) => {
                      const maxVal = Math.max(...activityByType.map((r) => r.value), 1)
                      return (
                        <div key={row.name}>
                          <div className="mb-0.5 flex justify-between text-xs">
                            <span className="font-medium text-text-primary">{row.name}</span>
                            <span className="text-text-secondary">{row.value}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-accent-blue"
                              style={{ width: `${Math.round((row.value / maxVal) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </Card>
            </div>
          )}

          {dash === 'activity' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <WidgetTitle title="Activity volume (last 7 months)" />
                <div className="mt-2 h-64">
                  {activityMonthly.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-text-secondary">
                      No activity volume yet
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={activityMonthly}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="completed" name="Completed" fill={chartColors[0]} radius={[4, 4, 0, 0]} barSize={16} />
                        <Bar dataKey="pending" name="Pending" fill={chartColors[1]} radius={[4, 4, 0, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
              <Card>
                <WidgetTitle title="Leads by Source" />
                <div className="mt-2 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadsBySource.map((s) => ({ name: s.name, leads: s.value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={48} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="leads" fill={chartColors[0]} radius={[4, 4, 0, 0]} barSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}

          {/* Bottom: Deals table + Leaderboard + Latest deals */}
          {(dash === 'sales' || dash === 'pipeline') && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card padding={false} className="lg:col-span-1">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <WidgetTitle title="Top Deals" />
                <Link to="/deals" className="text-xs text-accent-blue hover:underline">
                  View all
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface text-xs text-text-secondary">
                      <th className="px-4 py-2.5 font-medium">Deal</th>
                      <th className="px-3 py-2.5 font-medium">Stage</th>
                      <th className="px-3 py-2.5 font-medium text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDeals.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface">
                        <td className="px-4 py-2.5">
                          <Link to={`/deals/${d.id}`} className="font-medium text-accent-blue hover:underline">
                            {d.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge color={dealStageColor[d.stage]}>{labelize(d.stage)}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">{formatCurrency(d.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <WidgetTitle title="Expected Revenue Leaderboard" />
              <div className="mt-4 space-y-4">
                {leaderboard.slice(0, 3).map((row, i) => (
                  <div key={row.user.id} className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar name={row.user.name} size="lg" />
                      <span
                        className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                          i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-400' : 'bg-orange-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{row.user.name}</div>
                      <div className="text-xs text-text-secondary">{row.closed} deals closed</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-text-primary">{formatCurrency(row.expected)}</div>
                      <div className="text-[10px] text-text-secondary">expected</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card padding={false}>
              <div className="border-b border-border px-5 py-4">
                <WidgetTitle title="Latest Deals" />
              </div>
              <div className="divide-y divide-border">
                {latestDeals.map((d) => {
                  const owner = users.find((user) => user.id === d.ownerId)
                  const contact = contacts.find((item) => item.id === d.contactId)
                  return (
                    <Link
                      key={d.id}
                      to={`/deals/${d.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors duration-150"
                    >
                      {owner && <Avatar name={owner.name} size="sm" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{d.name}</div>
                        <div className="truncate text-[11px] text-text-secondary">
                          {contact?.name ?? '—'} · {formatDate(d.updatedAt)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold">{formatCurrency(d.value)}</div>
                        <div className="text-[10px] text-text-secondary">{d.probability}%</div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </Card>
          </div>
          )}

          {/* Team performance full width */}
          {dash === 'sales' && (
            <Card padding={false}>
              <div className="border-b border-border px-5 py-4">
                <WidgetTitle title="Team Performance" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface text-xs text-text-secondary">
                      <th className="px-5 py-2.5 font-medium">Agent</th>
                      <th className="px-3 py-2.5 font-medium">Leads</th>
                      <th className="px-3 py-2.5 font-medium">Deals Closed</th>
                      <th className="px-3 py-2.5 font-medium">Revenue</th>
                      <th className="px-3 py-2.5 font-medium">Calls</th>
                      <th className="px-3 py-2.5 font-medium">Win Rate</th>
                      <th className="px-3 py-2.5 font-medium">Performance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row) => {
                      const assigned = leads.filter((l) => l.assignedToId === row.user.id).length
                      const owned = deals.filter((d) => d.ownerId === row.user.id)
                      const winRate = owned.length
                        ? Math.round((owned.filter((d) => d.stage === 'WON').length / owned.length) * 100)
                        : 0
                      const callsMade = activities.filter(
                        (a) => a.assignedToId === row.user.id && a.type === 'CALL',
                      ).length
                      const perf = winRate
                      return (
                        <tr key={row.user.id} className="border-b border-border last:border-0 hover:bg-surface">
                          <td className="px-5 py-3">
                            <span className="flex items-center gap-2">
                              <Avatar name={row.user.name} size="sm" />
                              <span className="font-medium">{row.user.name}</span>
                            </span>
                          </td>
                          <td className="px-3 py-3">{assigned}</td>
                          <td className="px-3 py-3">{row.closed}</td>
                          <td className="px-3 py-3 font-semibold">{formatCurrency(row.revenue)}</td>
                          <td className="px-3 py-3">{callsMade}</td>
                          <td className="px-3 py-3">{winRate}%</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${
                                    perf < 50
                                      ? 'bg-accent-red'
                                      : perf < 80
                                        ? 'bg-accent-amber'
                                        : 'bg-accent-green'
                                  }`}
                                  style={{ width: `${perf}%` }}
                                />
                              </div>
                              <span className="text-xs text-text-secondary">{perf}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function WidgetTitle({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-md font-semibold text-text-primary">
      {icon}
      {title}
    </h2>
  )
}

function KpiCard({
  label,
  value,
  change,
  up,
  icon,
  iconBg,
  sub,
  to,
}: {
  label: string
  value: string
  change: string
  up: boolean
  icon: React.ReactNode
  iconBg: string
  sub?: string
  to?: string
}) {
  const inner = (
    <Card hover className={to ? 'h-full cursor-pointer transition hover:border-accent-blue/40' : undefined}>
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconBg}`}>{icon}</div>
        <span
          className={`flex items-center gap-0.5 text-xs font-medium ${up ? 'text-accent-green' : 'text-accent-red'}`}
        >
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {change}
        </span>
      </div>
      <div className="mt-3 text-sm text-text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-bold text-text-primary">{value}</div>
      {sub && <div className="mt-1 text-xs text-text-secondary">{sub}</div>}
      <div className="mt-3 flex h-7 items-end gap-0.5">
        {[40, 55, 45, 70, 60, 80, 75, 90, 85, 95].map((h, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${up ? 'bg-accent-blue/20' : 'bg-accent-red/20'}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </Card>
  )
  if (!to) return inner
  return (
    <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 rounded-[8px]">
      {inner}
    </Link>
  )
}

function GaugeChart({ value, max, pct }: { value: number; max: number; pct: number }) {
  const angle = -90 + (pct / 100) * 180
  return (
    <div className="relative mx-auto mt-2 h-40 w-full max-w-[240px]">
      <svg viewBox="0 0 200 120" className="h-full w-full">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#FEE2E2" strokeWidth="16" strokeLinecap="round" />
        <path d="M20 100 A80 80 0 0 1 80 28" fill="none" stroke="#FCA5A5" strokeWidth="16" strokeLinecap="round" />
        <path d="M80 28 A80 80 0 0 1 120 28" fill="none" stroke="#FCD34D" strokeWidth="16" strokeLinecap="round" />
        <path d="M120 28 A80 80 0 0 1 180 100" fill="none" stroke="#6EE7B7" strokeWidth="16" strokeLinecap="round" />
        <g transform={`rotate(${angle} 100 100)`}>
          <line x1="100" y1="100" x2="100" y2="40" stroke="#0F172A" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="100" r="6" fill="#0F172A" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-2 text-center">
        <div className="text-lg font-bold text-text-primary">{formatCurrency(value)}</div>
        <div className="text-[11px] text-text-secondary">{pct}% of {formatCurrency(max)}</div>
      </div>
    </div>
  )
}

function TaskGauge({ inProgress, completed }: { inProgress: number; completed: number }) {
  const total = Math.max(inProgress + completed, 1)
  const pct = Math.round((completed / total) * 100)
  const data = [
    { name: 'done', value: completed || 1 },
    { name: 'left', value: Math.max(total - completed, 1) },
  ]
  return (
    <div className="relative mx-auto h-36 w-36">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={58}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
          >
            <Cell fill="#F59E0B" />
            <Cell fill="#E2E8F0" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-lg font-bold">{inProgress + completed}</div>
        <div className="text-[10px] text-accent-green">{completed} done · {pct}%</div>
      </div>
    </div>
  )
}
