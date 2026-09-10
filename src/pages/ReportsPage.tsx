import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Award,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Printer,
  RefreshCw,
} from 'lucide-react'
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
import { AskDashboardPanel } from '@/components/ai/AskDashboardPanel'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Badge, ticketPriorityColor, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import {
  downloadCsv,
  downloadJson,
  downloadXlsx,
  printReportHtml,
  tableHtml,
} from '@/lib/reportExport'
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
type Tab = 'overview' | 'leads' | 'service' | 'team' | 'stock'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'leads', label: 'Leads' },
  { id: 'service', label: 'Service' },
  { id: 'team', label: 'Team & performers' },
  { id: 'stock', label: 'Stock & billing' },
]

function Kpi({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div> : null}
    </div>
  )
}

function EmptyChart({ label = 'No data for current filters' }: { label?: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-text-secondary">{label}</div>
  )
}

export function ReportsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [leadStatus, setLeadStatus] = useState('')
  const [city, setCity] = useState('')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportOpen, setExportOpen] = useState(false)

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
      setData(
        await api.analytics({
          range: from || to ? 'custom' : range,
          from: from || undefined,
          to: to || undefined,
          assigneeId: assigneeId || undefined,
          sourceId: sourceId || undefined,
          ticketStatus: ticketStatus || undefined,
          leadStatus: leadStatus || undefined,
          city: city || undefined,
        }),
      )
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load reports')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [range, from, to, assigneeId, sourceId, ticketStatus, leadStatus, city])

  useEffect(() => {
    void load()
  }, [load])

  const k = data?.kpis
  const stamp = data?.generatedAt ? new Date(data.generatedAt).toLocaleString('en-IN') : ''

  const exportPack = useMemo(() => {
    if (!data || !k) return null
    const overview = [
      { metric: 'Open tickets', value: k.openTickets },
      { metric: 'Awaiting assignment', value: k.awaitingAssignment },
      { metric: 'Balance outstanding', value: k.balanceOutstanding },
      { metric: 'Service collected', value: k.serviceCollected },
      { metric: 'Sale enquiries', value: k.totalLeads },
      { metric: 'Converted enquiries', value: k.enquiriesConverted },
      { metric: 'Proforma revenue', value: k.invoiceRevenue },
      { metric: 'In stock serials', value: k.inStock },
      { metric: 'Demo out', value: k.demoOut },
    ]
    return {
      overview,
      leadsByStatus: data.leadsByStatus,
      leadsBySource: data.leadsBySource,
      leadsByOwner: data.leadsByOwner ?? [],
      ticketsByStatus: data.ticketsByStatus,
      ticketsByAssignee: data.ticketsByAssignee,
      performers: data.performers ?? [],
      byCity: data.byCity,
      monthlyRevenue: data.monthlyRevenue,
      stockByStatus: data.stockByStatus ?? [],
    }
  }, [data, k])

  function doExport(kind: 'csv' | 'xlsx' | 'json' | 'print') {
    if (!exportPack || !data || !k) {
      addToast({ type: 'error', message: 'Nothing to export yet' })
      return
    }
    const base = `hms-reports-${range}-${tab}-${new Date().toISOString().slice(0, 10)}`
    setExportOpen(false)
    if (kind === 'json') {
      downloadJson(`${base}.json`, data)
      addToast({ type: 'success', message: 'JSON downloaded' })
      return
    }
    if (kind === 'csv') {
      downloadCsv(`${base}.csv`, exportPack.overview)
      addToast({ type: 'success', message: 'CSV downloaded' })
      return
    }
    if (kind === 'xlsx') {
      downloadXlsx(`${base}.xlsx`, [
        { name: 'Overview', rows: exportPack.overview },
        { name: 'Leads status', rows: exportPack.leadsByStatus },
        { name: 'Leads source', rows: exportPack.leadsBySource },
        { name: 'Lead owners', rows: exportPack.leadsByOwner },
        { name: 'Ticket status', rows: exportPack.ticketsByStatus },
        { name: 'Assignees', rows: exportPack.ticketsByAssignee },
        { name: 'Performers', rows: exportPack.performers },
        { name: 'Cities', rows: exportPack.byCity },
        { name: 'Billing monthly', rows: exportPack.monthlyRevenue },
        { name: 'Stock', rows: exportPack.stockByStatus },
      ])
      addToast({ type: 'success', message: 'Excel downloaded' })
      return
    }
    printReportHtml('HMS Enterprises — Reports', [
      {
        heading: 'Key metrics',
        html: tableHtml(
          ['Metric', 'Value'],
          exportPack.overview.map((r) => [String(r.metric), String(r.value)]),
        ),
      },
      {
        heading: 'Top performers',
        html: tableHtml(
          ['Name', 'Tickets resolved', 'Leads converted', 'Service collected', 'Score'],
          exportPack.performers.map((p) => [
            p.name,
            p.ticketsResolved,
            p.leadsConverted,
            formatCurrency(p.serviceCollected),
            p.score,
          ]),
        ),
      },
      {
        heading: 'Tickets by status',
        html: tableHtml(
          ['Status', 'Count'],
          exportPack.ticketsByStatus.map((r) => [labelize(r.name), r.value]),
        ),
      },
      {
        heading: 'Billing by month',
        html: tableHtml(
          ['Month', 'Proforma', 'Service paid'],
          exportPack.monthlyRevenue.map((r) => [
            r.month,
            formatCurrency(num(r.proforma)),
            formatCurrency(num(r.servicePaid)),
          ]),
        ),
      },
    ])
  }

  function clearFilters() {
    setRange('month')
    setFrom('')
    setTo('')
    setAssigneeId('')
    setSourceId('')
    setTicketStatus('')
    setLeadStatus('')
    setCity('')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
            <div className="relative">
              <Button type="button" size="sm" onClick={() => setExportOpen((v) => !v)}>
                <Download size={14} /> Download
              </Button>
              {exportOpen ? (
                <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-border bg-card p-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => doExport('csv')}
                  >
                    <FileText size={14} /> CSV
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => doExport('xlsx')}
                  >
                    <FileSpreadsheet size={14} /> Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => doExport('json')}
                  >
                    <FileJson size={14} /> JSON
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => doExport('print')}
                  >
                    <Printer size={14} /> Print / PDF
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        }
      />
      <p className="-mt-3 mb-4 text-sm text-text-secondary">
        Live analytics from your database — leads, service, team performers, stock & billing. Download CSV, Excel, JSON, or Print/PDF.
      </p>
      <PageTip moduleKey="reports" />

      <AskDashboardPanel range={from || to ? 'custom' : range} />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            options={[
              { value: 'week', label: 'Last 7 days' },
              { value: 'month', label: 'Last month' },
              { value: 'quarter', label: 'Last quarter' },
              { value: 'year', label: 'Last year' },
            ]}
          />
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select
            label="Assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            options={[
              { value: '', label: 'All people' },
              ...(data?.users ?? []).map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <Select
            label="Lead source"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            options={[
              { value: '', label: 'All sources' },
              ...(data?.sources ?? []).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <Select
            label="Ticket status"
            value={ticketStatus}
            onChange={(e) => setTicketStatus(e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'OPEN', label: 'Open' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'PENDING', label: 'Pending' },
              { value: 'RESOLVED', label: 'Resolved' },
              { value: 'CLOSED', label: 'Closed' },
            ]}
          />
          <Select
            label="Lead status"
            value={leadStatus}
            onChange={(e) => setLeadStatus(e.target.value)}
            options={[
              { value: '', label: 'All leads' },
              { value: 'NEW', label: 'New' },
              { value: 'CONTACTED', label: 'Contacted' },
              { value: 'QUALIFIED', label: 'Qualified' },
              { value: 'DEMO', label: 'Demo' },
              { value: 'CONVERTED', label: 'Converted' },
              { value: 'LOST', label: 'Lost' },
            ]}
          />
          <Select
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            options={[
              { value: '', label: 'All cities' },
              ...(data?.cities ?? []).map((c) => ({ value: c, label: c })),
            ]}
          />
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Reset filters
          </Button>
        </div>
        {stamp ? <p className="text-xs text-text-muted">Live from DB · generated {stamp}</p> : null}
      </Card>

      <PageTabs tabs={TABS} active={tab} onChange={(id) => setTab(id as Tab)} />

      {error ? (
        <Card className="p-6 text-sm text-accent-red">{error}</Card>
      ) : loading && !data ? (
        <Card className="p-6 text-sm text-text-secondary">Loading live reports…</Card>
      ) : !data || !k ? (
        <Card className="p-6 text-sm text-text-secondary">No analytics yet.</Card>
      ) : (
        <>
          {tab === 'overview' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Open tickets" value={k.openTickets} hint={`${k.awaitingAssignment} unassigned`} />
                <Kpi label="Balance outstanding" value={formatCurrency(k.balanceOutstanding)} />
                <Kpi label="Service collected" value={formatCurrency(k.serviceCollected)} hint="Paid jobs" />
                <Kpi
                  label="Proforma total"
                  value={formatCurrency(k.invoiceRevenue)}
                  hint={`${k.invoiceCount} invoices`}
                />
                <Kpi label="Sale enquiries" value={k.totalLeads} hint={`${k.enquiriesConverted} converted`} />
                <Kpi label="Conversion" value={`${k.conversionRate}%`} />
                <Kpi label="In stock" value={k.inStock} hint={`${k.demoOut} on demo`} />
                <Kpi label="Customers" value={k.contacts} hint={`${k.accounts} accounts`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Billing mix</h3>
                  {(data.monthlyRevenue?.length ?? 0) === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={data.monthlyRevenue}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                        <Legend />
                        <Bar dataKey="proforma" name="Proforma" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="servicePaid" name="Service paid" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Ticket trend</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data.ticketMonthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="created" name="Created" stroke="#3b82f6" strokeWidth={2} />
                      <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} />
                      <Line type="monotone" dataKey="breached" name="SLA breach" stroke="#ef4444" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </div>
              {(data.attentionTickets?.length ?? 0) > 0 ? (
                <Card className="overflow-hidden">
                  <div className="border-b border-border px-4 py-3 text-sm font-semibold">Needs attention</div>
                  <div className="divide-y divide-border">
                    {data.attentionTickets!.map((t) => (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <div>
                          <span className="font-medium">SVC-{String(t.ticketNo).padStart(5, '0')}</span>
                          <span className="text-text-secondary"> — {t.subject}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge color={ticketStatusColor[t.status] ?? 'gray'}>{labelize(t.status)}</Badge>
                          <Badge color={ticketPriorityColor[t.priority] ?? 'gray'}>{labelize(t.priority)}</Badge>
                          {t.slaBreached ? <Badge color="red">SLA</Badge> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
          ) : null}

          {tab === 'leads' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Total enquiries" value={k.totalLeads} />
                <Kpi label="Pending" value={k.enquiriesPending} />
                <Kpi label="Demo" value={k.enquiriesDemo} />
                <Kpi label="Converted" value={k.enquiriesConverted} hint={`${k.conversionRate}%`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">By status</h3>
                  {data.leadsByStatus.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={data.leadsByStatus}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tickFormatter={labelize} tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">By source</h3>
                  {data.leadsBySource.every((s) => s.leads === 0) ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={data.leadsBySource}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="leads" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
                <Card className="p-4 lg:col-span-2">
                  <h3 className="mb-2 text-sm font-semibold">Enquiry trend</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data.leadMonthly ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="created" name="Created" stroke="#3b82f6" strokeWidth={2} />
                      <Line type="monotone" dataKey="converted" name="Converted" stroke="#10b981" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </div>
              <Card className="overflow-hidden">
                <div className="border-b border-border px-4 py-3 text-sm font-semibold">Leads by owner</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-text-secondary">
                      <tr>
                        <th className="px-4 py-2">Owner</th>
                        <th className="px-4 py-2">Total</th>
                        <th className="px-4 py-2">Pending</th>
                        <th className="px-4 py-2">Demo</th>
                        <th className="px-4 py-2">Converted</th>
                        <th className="px-4 py-2">Conv %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.leadsByOwner ?? []).map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <td className="px-4 py-2 font-medium">{row.name}</td>
                          <td className="px-4 py-2 tabular-nums">{row.total}</td>
                          <td className="px-4 py-2 tabular-nums">{row.pending}</td>
                          <td className="px-4 py-2 tabular-nums">{row.demo}</td>
                          <td className="px-4 py-2 tabular-nums">{row.converted}</td>
                          <td className="px-4 py-2 tabular-nums">{row.conversionRate}%</td>
                        </tr>
                      ))}
                      {(data.leadsByOwner ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-text-secondary">
                            No lead owners in this filter
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
    </Card>
            </div>
          ) : null}

          {tab === 'service' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Open" value={k.openTickets} hint={`${k.slaBreached} SLA breached`} />
                <Kpi label="Resolved (range)" value={k.resolvedInRange} />
                <Kpi label="Avg resolution" value={`${k.avgResolutionHours}h`} />
                <Kpi label="Outstanding" value={formatCurrency(k.balanceOutstanding)} />
      </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Status mix</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={data.ticketsByStatus.filter((x) => x.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {data.ticketsByStatus.map((row) => (
                          <Cell key={row.name} fill={TICKET_STATUS_HEX[row.name] ?? CHART_FALLBACK[0]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend formatter={labelize} />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Priority</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.ticketsByPriority}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tickFormatter={labelize} tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.ticketsByPriority.map((row) => (
                          <Cell key={row.name} fill={TICKET_PRIORITY_HEX[row.name] ?? CHART_FALLBACK[1]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
    </Card>
              </div>
              <Card className="overflow-hidden">
                <div className="border-b border-border px-4 py-3 text-sm font-semibold">Workload by assignee</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-text-secondary">
                      <tr>
                        <th className="px-4 py-2">Engineer</th>
                        <th className="px-4 py-2">Total</th>
                        <th className="px-4 py-2">Open</th>
                        <th className="px-4 py-2">Resolved</th>
                        <th className="px-4 py-2">SLA breach</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ticketsByAssignee.map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <td className="px-4 py-2 font-medium">{row.name}</td>
                          <td className="px-4 py-2 tabular-nums">{row.total}</td>
                          <td className="px-4 py-2 tabular-nums">{row.open}</td>
                          <td className="px-4 py-2 tabular-nums">{row.resolved}</td>
                          <td className="px-4 py-2 tabular-nums">{row.breached}</td>
                        </tr>
                      ))}
                      {data.ticketsByAssignee.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-text-secondary">
                            No assigned tickets in this filter
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
    </Card>
            </div>
          ) : null}

          {tab === 'team' ? (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                  <Award size={16} className="text-amber-500" /> Top performers
                  <span className="font-normal text-text-secondary">
                    (resolved tickets + converted leads + service collected)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-text-secondary">
                      <tr>
                        <th className="px-4 py-2">#</th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Open jobs</th>
                        <th className="px-4 py-2">Resolved</th>
                        <th className="px-4 py-2">Leads converted</th>
                        <th className="px-4 py-2">Service collected</th>
                        <th className="px-4 py-2">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.performers ?? []).map((p, i) => (
                        <tr key={p.id} className="border-t border-border">
                          <td className="px-4 py-2 tabular-nums text-text-secondary">{i + 1}</td>
                          <td className="px-4 py-2 font-medium">{p.name}</td>
                          <td className="px-4 py-2 tabular-nums">{p.ticketsOpen}</td>
                          <td className="px-4 py-2 tabular-nums">{p.ticketsResolved}</td>
                          <td className="px-4 py-2 tabular-nums">
                            {p.leadsConverted}
                            <span className="text-text-muted"> / {p.leadsTotal}</span>
                          </td>
                          <td className="px-4 py-2 tabular-nums">{formatCurrency(p.serviceCollected)}</td>
                          <td className="px-4 py-2 font-semibold tabular-nums">{p.score}</td>
                        </tr>
                      ))}
                      {(data.performers ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-text-secondary">
                            No performer activity for current filters
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
      </div>
              </Card>
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold">City mix (live ops revenue)</h3>
                {data.byCity.length === 0 ? (
                  <EmptyChart />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.byCity.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="city" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                      <Legend />
                      <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="leads" name="Leads" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="tickets" name="Tickets" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
    </Card>
  </div>
          ) : null}

          {tab === 'stock' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="In stock" value={k.inStock} />
                <Kpi label="Demo out" value={k.demoOut} />
                <Kpi label="Proforma revenue" value={formatCurrency(k.invoiceRevenue)} />
                <Kpi label="Service collected" value={formatCurrency(k.serviceCollected)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Serial stock by status</h3>
                  {(data.stockByStatus?.length ?? 0) === 0 ? (
                    <EmptyChart />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={data.stockByStatus}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                        >
                          {(data.stockByStatus ?? []).map((row, i) => (
                            <Cell key={row.name} fill={CHART_FALLBACK[i % CHART_FALLBACK.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Billing by month</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.monthlyRevenue}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                      <Legend />
                      <Bar dataKey="proforma" name="Proforma" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="servicePaid" name="Service paid" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
