import { useCallback, useEffect, useMemo, useState } from 'react'
import { Award, Download, RefreshCw, TrendingUp } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Badge, ticketPriorityColor, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const CHART_FALLBACK = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#64748b', '#06b6d4']

const TICKET_STATUS_HEX: Record<string, string> = {
  OPEN: '#2563eb',
  IN_PROGRESS: '#f59e0b',
  PENDING: '#f97316',
  RESOLVED: '#10b981',
  CLOSED: '#64748b',
}

const TICKET_PRIORITY_HEX: Record<string, string> = {
  LOW: '#10b981',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
}

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

type Analytics = Awaited<ReturnType<typeof api.analytics>>

export function ReportsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [range, setRange] = useState('month')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isTenantSession()) {
      setError('Sign in to a client workspace to view live reports.')
      setLoading(false)
      setData(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      setData(await api.analytics(range))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load reports')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  function exportCsv() {
    if (!data) return
    const rows = [
      ['Metric', 'Value'],
      ['Total leads', String(data.kpis.totalLeads)],
      ['Qualified leads', String(data.kpis.qualifiedLeads)],
      ['Conversion rate %', String(data.kpis.conversionRate)],
      ['Won revenue', String(data.kpis.wonRevenue)],
      ['Open pipeline', String(data.kpis.openPipeline)],
      ['Invoice revenue', String(data.kpis.invoiceRevenue)],
      ['Total tickets', String(data.kpis.tickets ?? 0)],
      ['Open tickets', String(data.kpis.openTickets ?? 0)],
      ['Resolved tickets', String(data.kpis.resolvedTickets ?? 0)],
      ['SLA breached', String(data.kpis.slaBreached ?? 0)],
      ['Avg resolution hours', String(data.kpis.avgResolutionHours ?? 0)],
      ...data.ticketsByStatus.map((s) => [`Ticket status:${s.name}`, String(s.value)]),
      ...data.ticketsByPriority.map((s) => [`Ticket priority:${s.name}`, String(s.value)]),
      ...data.ticketsByCategory.map((s) => [`Ticket category:${s.name}`, String(s.value)]),
      ...data.byCity.map((c) => [`City:${c.city} revenue`, String(c.revenue)]),
      ...data.team.map((t) => [`Team:${t.name} revenue`, String(t.revenue)]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `novacrm-report-${range}.csv`
    a.click()
    URL.revokeObjectURL(url)
    addToast({ type: 'success', message: 'Report CSV downloaded' })
  }

  const kpis = data?.kpis
  const statuses = useMemo(
    () =>
      (data?.leadsByStatus ?? []).map((s, i) => ({
        ...s,
        color: CHART_FALLBACK[i % CHART_FALLBACK.length],
      })),
    [data?.leadsByStatus],
  )

  const ticketStatuses = useMemo(
    () =>
      (data?.ticketsByStatus ?? [])
        .filter((s) => s.value > 0)
        .map((s) => ({
          ...s,
          label: labelize(s.name),
          color: TICKET_STATUS_HEX[s.name] ?? CHART_FALLBACK[0],
        })),
    [data?.ticketsByStatus],
  )

  const ticketPriorities = useMemo(
    () =>
      (data?.ticketsByPriority ?? []).map((s) => ({
        ...s,
        label: labelize(s.name),
        color: TICKET_PRIORITY_HEX[s.name] ?? CHART_FALLBACK[0],
      })),
    [data?.ticketsByPriority],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Reports' }]}
        actions={
          <>
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              options={[
                { value: 'week', label: 'Last 7 days' },
                { value: 'month', label: 'Last 30 days' },
                { value: 'quarter', label: 'Last quarter' },
                { value: 'year', label: 'Last year' },
              ]}
            />
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw size={16} /> Refresh
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data}>
              <Download size={16} /> Export CSV
            </Button>
          </>
        }
      />

      <PageTip moduleKey="crm.reports" />

      {loading && <Card className="p-6 text-sm text-text-secondary">Loading live reports from database…</Card>}
      {error && !loading && <Card className="p-6 text-sm text-accent-red">{error}</Card>}

      {data && !loading && (
        <>
          <section>
            <SectionTitle
              title="Service ticket analytics"
              subtitle="Live ticket status, SLA and agent workload from your database"
            />
            <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Total tickets', String(kpis?.tickets ?? 0)],
                ['Open / in progress', String(kpis?.openTickets ?? 0)],
                ['Resolved (all time)', String(kpis?.resolvedTickets ?? 0)],
                ['SLA breached', String(kpis?.slaBreached ?? 0)],
              ].map(([k, v]) => (
                <Card key={k}>
                  <p className="text-sm text-text-secondary">{k}</p>
                  <p className="mt-2 text-2xl font-bold">{v}</p>
                </Card>
              ))}
            </div>
            <div className="mb-4 grid gap-4 sm:grid-cols-3">
              {[
                [
                  'Created in range',
                  `${kpis?.ticketsInRange ?? 0}${
                    typeof kpis?.ticketGrowth === 'number'
                      ? ` (${kpis.ticketGrowth >= 0 ? '+' : ''}${kpis.ticketGrowth}%)`
                      : ''
                  }`,
                ],
                ['Resolved in range', String(kpis?.resolvedInRange ?? 0)],
                ['Avg resolution', `${kpis?.avgResolutionHours ?? 0} hrs`],
              ].map(([k, v]) => (
                <Card key={k}>
                  <p className="text-sm text-text-secondary">{k}</p>
                  <p className="mt-2 text-xl font-bold">{v}</p>
                </Card>
              ))}
            </div>

            <div className="mb-5 grid gap-5 lg:grid-cols-2">
              <Card>
                <h3 className="mb-4 font-semibold">Tickets by status</h3>
                <div className="h-72">
                  {ticketStatuses.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={ticketStatuses}
                          dataKey="value"
                          nameKey="label"
                          innerRadius={58}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          {ticketStatuses.map((s) => (
                            <Cell key={s.name} fill={s.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="p-6 text-sm text-text-secondary">No tickets in the database yet.</p>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(data.ticketsByStatus ?? []).map((s) => (
                    <Badge key={s.name} color={ticketStatusColor[s.name] ?? 'gray'}>
                      {labelize(s.name)} · {s.value}
                    </Badge>
                  ))}
                </div>
              </Card>

              <Card>
                <h3 className="mb-4 font-semibold">Tickets by priority</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ticketPriorities}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" name="Tickets" radius={[4, 4, 0, 0]}>
                        {ticketPriorities.map((s) => (
                          <Cell key={s.name} fill={s.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(data.ticketsByPriority ?? []).map((s) => (
                    <Badge key={s.name} color={ticketPriorityColor[s.name] ?? 'gray'}>
                      {labelize(s.name)} · {s.value}
                    </Badge>
                  ))}
                </div>
              </Card>
            </div>

            <div className="mb-5 grid gap-5 lg:grid-cols-2">
              <Card>
                <h3 className="mb-4 font-semibold">Service category mix</h3>
                <div className="h-72">
                  {(data.ticketsByCategory ?? []).length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.ticketsByCategory} layout="vertical" margin={{ left: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={100} />
                        <Tooltip />
                        <Bar dataKey="value" name="Tickets" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="p-6 text-sm text-text-secondary">No category data yet.</p>
                  )}
                </div>
              </Card>

              <Card>
                <h3 className="mb-4 font-semibold">Created vs resolved (7 months)</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.ticketMonthly ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="created" name="Created" stroke="#2563eb" strokeWidth={3} />
                      <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} />
                      <Line type="monotone" dataKey="breached" name="SLA breached" stroke="#ef4444" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card padding={false}>
              <div className="p-5">
                <SectionTitle title="Agent service workload" subtitle="Open vs resolved tickets per assignee (live)" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-surface text-xs text-text-secondary">
                    <tr>
                      {['Agent', 'Total', 'Open', 'Resolved', 'SLA breached'].map((h) => (
                        <th key={h} className="px-5 py-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ticketsByAssignee ?? []).map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-5 py-3 font-semibold">{row.name}</td>
                        <td className="px-5 py-3">{row.total}</td>
                        <td className="px-5 py-3">
                          <Badge color="amber">{row.open}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          <Badge color="green">{row.resolved}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          <Badge color={row.breached ? 'red' : 'gray'}>{row.breached}</Badge>
                        </td>
                      </tr>
                    ))}
                    {!(data.ticketsByAssignee ?? []).length && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-text-secondary">
                          No assigned tickets yet
                          {num(kpis?.unassignedTickets) > 0
                            ? ` · ${kpis?.unassignedTickets} unassigned`
                            : ''}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          <Card>
            <SectionTitle title="Sales performance" subtitle="Won deal revenue by month (live database)" />
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.monthlyRevenue} margin={{ top: 16, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => `₹${Number(v) / 1000}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="current" name="This period year" stroke="#2563eb" strokeWidth={3} />
                  <Line type="monotone" dataKey="last" name="Prior year" stroke="#94a3b8" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <section>
            <SectionTitle title="Lead analytics" subtitle="Acquisition and qualification from live leads" />
            <div className="mb-4 grid gap-4 sm:grid-cols-3">
              {[
                ['Total leads', String(kpis?.totalLeads ?? 0)],
                ['Qualified', String(kpis?.qualifiedLeads ?? 0)],
                ['Conversion rate', `${kpis?.conversionRate ?? 0}%`],
              ].map(([k, v]) => (
                <Card key={k}>
                  <p className="text-sm text-text-secondary">{k}</p>
                  <p className="mt-2 text-2xl font-bold">{v}</p>
                </Card>
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <h3 className="mb-4 font-semibold">Leads by source</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.leadsBySource}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="leads" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <h3 className="mb-4 font-semibold">Status distribution</h3>
                <div className="h-72">
                  {statuses.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statuses} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={3}>
                          {statuses.map((s) => (
                            <Cell key={s.name} fill={s.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="p-6 text-sm text-text-secondary">No lead status data yet.</p>
                  )}
                </div>
              </Card>
            </div>
          </section>

          <Card>
            <SectionTitle title="Pipeline funnel" subtitle="Live deal stages from your workspace pipeline" />
            <div className="space-y-4">
              {data.funnel.map((row) => (
                <div key={row.stage} className="grid gap-2 sm:grid-cols-[140px_1fr_220px] sm:items-center">
                  <span className="text-sm font-medium">{row.stage}</span>
                  <div className="h-9 rounded-[6px] bg-surface">
                    <div
                      style={{ width: row.width, background: row.color || '#2563eb' }}
                      className="flex h-full items-center rounded-[6px] px-3 text-sm font-semibold text-white"
                    >
                      {row.count}
                    </div>
                  </div>
                  <div className="flex justify-between text-sm text-text-secondary">
                    <span>{formatCurrency(row.value)}</span>
                    <span>{row.conversion}% of top stage</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle title="City mix" subtitle="Accounts, leads and won revenue by city (live)" />
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byCity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="city" />
                  <YAxis tickFormatter={(v) => `₹${Number(v) / 1000}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                  <Bar dataKey="revenue" name="Won revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="leads" name="Leads" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card padding={false}>
            <div className="flex items-center justify-between p-5">
              <SectionTitle title="Team leaderboard" subtitle="Won revenue by owner (live)" />
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download size={15} /> Export
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-surface text-xs text-text-secondary">
                  <tr>
                    {['Rank', 'Team member', 'Won deals', 'Revenue', 'Win rate'].map((h) => (
                      <th key={h} className="px-5 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((member, index) => (
                    <tr key={member.id} className="border-t border-border">
                      <td className="px-5 py-4">
                        {index === 0 ? (
                          <Badge color="amber">
                            <Award size={13} className="mr-1" /> Top performer
                          </Badge>
                        ) : (
                          `#${index + 1}`
                        )}
                      </td>
                      <td className="px-5 py-4 font-semibold">{member.name}</td>
                      <td className="px-5 py-4">{member.wonDeals}</td>
                      <td className="px-5 py-4 font-semibold">{formatCurrency(member.revenue)}</td>
                      <td className="px-5 py-4">{member.win}%</td>
                    </tr>
                  ))}
                  {!data.team.length && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-text-secondary">
                        No team data yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Won revenue', formatCurrency(num(kpis?.wonRevenue))],
              ['Open pipeline', formatCurrency(num(kpis?.openPipeline))],
              ['Invoices', `${kpis?.invoiceCount ?? 0} · ${formatCurrency(num(kpis?.invoiceRevenue))}`],
              ['Activities', String(kpis?.activities ?? 0)],
            ].map(([k, v]) => (
              <Card key={k}>
                <p className="text-sm text-text-secondary">{k}</p>
                <p className="mt-2 text-xl font-bold">{v}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
        <TrendingUp size={18} className="text-accent-blue" />
        {title}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
    </div>
  )
}

export default ReportsPage
