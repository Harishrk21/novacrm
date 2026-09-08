import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Ticket, Users } from 'lucide-react'
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
  const role = useAuthStore((s) => s.user?.role)
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
  const role = useAuthStore((s) => s.user?.role)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState({
    open: 0,
    activeQueue: 0,
    overdue: 0,
    unassigned: 0,
    resolvedToday: 0,
  })
  const [recent, setRecent] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isTenantSession()) {
        setLoading(false)
        return
      }
      try {
        const [tSum, tickets] = await Promise.all([
          api.ticketsSummary(),
          api.tickets({ limit: 8, sort: 'sla' }),
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service desk"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Home' }]}
        actions={
          <Link to="/tickets?open=1">
            <Button>New ticket</Button>
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Open', value: summary.open, to: '/tickets?status=OPEN' },
          { label: 'Active queue', value: summary.activeQueue, to: '/tickets' },
          { label: 'Overdue SLA', value: summary.overdue, to: '/tickets?slaBreached=1' },
          { label: 'Unassigned', value: summary.unassigned, to: '/tickets?unassigned=1' },
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
          <h2 className="text-sm font-semibold text-text-primary">Recent open tickets</h2>
          <Link to="/tickets" className="text-xs font-medium text-accent-blue hover:underline">
            All tickets
          </Link>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">No open tickets — create one when a customer calls.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((t) => {
              const st = String(t.status)
              return (
                <li key={String(t.id)}>
                  <Link
                    to={`/tickets/${String(t.id)}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {formatServiceId(t.ticketNo)} · {String(t.subject)}
                      </div>
                    </div>
                    <Badge color={ticketStatusColor[st] ?? 'gray'}>{st.replaceAll('_', ' ')}</Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/tickets?open=1">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <Ticket className="text-accent-blue" size={20} />
            <div className="mt-2 text-sm font-semibold text-text-primary">Create ticket</div>
            <p className="mt-1 text-xs text-text-secondary">Customer → machine → issue log → OPEN</p>
          </Card>
        </Link>
        <Link to="/contacts">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <Users className="text-accent-blue" size={20} />
            <div className="mt-2 text-sm font-semibold text-text-primary">Find / add customer</div>
            <p className="mt-1 text-xs text-text-secondary">Search by name or phone before creating a job</p>
          </Card>
        </Link>
        <Link to="/tickets">
          <Card className="h-full p-4 transition hover:border-accent-blue/40">
            <Clock className="text-accent-blue" size={20} />
            <div className="mt-2 text-sm font-semibold text-text-primary">Track all tickets</div>
            <p className="mt-1 text-xs text-text-secondary">
              {loading ? '—' : summary.resolvedToday} completed today · follow OPEN → CLOSED
            </p>
          </Card>
        </Link>
      </div>
    </div>
  )
}
