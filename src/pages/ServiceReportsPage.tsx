import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { DownloadIconButton } from '@/components/ui/BulkSelect'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { api, ApiClientError } from '@/lib/api'
import { downloadXlsx } from '@/lib/reportExport'
import { formatServiceId } from '@/lib/serviceId'
import { formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'
import {
  openPrintableServiceReport,
  serviceReportOptsFromTicket,
} from '@/lib/serviceReportPrint'

type JobKind = 'all' | 'service' | 'stamping'

type ReportRow = {
  ticketId: string
  ticketNo?: string
  subject: string
  status: string
  jobKind: 'service' | 'stamping'
  contactId?: string
  contactName: string
  machineName: string
  engineerName: string
  issues: string
  workDone: string
  sparePartsCount: number
  savedAt: string
  savedBy: string
  closedAt: string
}

function jobKindFromTicket(t: Record<string, unknown>): 'service' | 'stamping' {
  const cf =
    t.customFields && typeof t.customFields === 'object'
      ? (t.customFields as Record<string, unknown>)
      : {}
  const cat = String(cf.category ?? '')
  const wt = String(cf.workType ?? '')
  const purpose = String(cf.visitPurpose ?? '')
  if (cat === 'Stamping' || wt === 'Stamping' || purpose === 'STAMPING') return 'stamping'
  return 'service'
}

function reportFromTicket(t: Record<string, unknown>): ReportRow | null {
  const cf =
    t.customFields && typeof t.customFields === 'object'
      ? (t.customFields as Record<string, unknown>)
      : {}
  const sr = cf.serviceReport
  if (!sr || typeof sr !== 'object') return null
  const report = sr as Record<string, unknown>
  const contact = t.contact as { id?: string; name?: string } | null | undefined
  return {
    ticketId: String(t.id),
    ticketNo: t.ticketNo != null ? String(t.ticketNo) : undefined,
    subject: String(t.subject ?? ''),
    status: String(t.status ?? ''),
    jobKind: jobKindFromTicket(t),
    contactId: t.contactId ? String(t.contactId) : contact?.id ? String(contact.id) : undefined,
    contactName: String(report.customerName || contact?.name || '—'),
    machineName: String(report.machineName || '—'),
    engineerName: String(t.assignedToName || report.engineerName || '—'),
    issues: String(report.issues || ''),
    workDone: String(report.workDone || ''),
    sparePartsCount: Number(report.sparePartsCount || 0),
    savedAt: String(report.savedAt || t.closedAt || t.updatedAt || ''),
    savedBy: String(report.savedBy || '—'),
    closedAt: t.closedAt ? String(t.closedAt) : '',
  }
}

/** Paginate CLOSED + RESOLVED (API max 200/page) and keep rows that have a service report. */
async function loadReportTickets(maxPagesPerStatus = 8) {
  const statuses = ['CLOSED', 'RESOLVED'] as const
  const seen = new Set<string>()
  const next: ReportRow[] = []
  const byId: Record<string, Record<string, unknown>> = {}

  for (const status of statuses) {
    for (let page = 1; page <= maxPagesPerStatus; page += 1) {
      const res = await api.tickets({ limit: 200, page, status, sort: 'newest' })
      const items = res.items ?? []
      if (!items.length) break
      for (const t of items) {
        const id = String(t.id)
        if (seen.has(id)) continue
        seen.add(id)
        const raw = t as Record<string, unknown>
        byId[id] = raw
        const row = reportFromTicket(raw)
        if (row) next.push(row)
      }
      if (items.length < 200) break
    }
  }

  next.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  return { rows: next, byId }
}

/**
 * All service reports saved after Approve & close (stored on ticket customFields).
 * Per-customer view also lives on Contact → Service.
 */
export function ServiceReportsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [ticketById, setTicketById] = useState<Record<string, Record<string, unknown>>>({})
  const [q, setQ] = useState('')
  const [jobKind, setJobKind] = useState<JobKind>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows: next, byId } = await loadReportTickets()
      setTicketById(byId)
      setRows(next)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load service reports',
      })
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toMs = to ? new Date(`${to}T23:59:59`).getTime() : null

    return rows.filter((r) => {
      if (jobKind !== 'all' && r.jobKind !== jobKind) return false
      if (statusFilter && r.status !== statusFilter) return false
      const when = r.savedAt || r.closedAt
      if (when && (fromMs != null || toMs != null)) {
        const t = new Date(when).getTime()
        if (Number.isFinite(t)) {
          if (fromMs != null && t < fromMs) return false
          if (toMs != null && t > toMs) return false
        }
      }
      if (!needle) return true
      return [
        r.contactName,
        r.machineName,
        r.subject,
        r.issues,
        r.workDone,
        r.savedBy,
        r.engineerName,
        r.jobKind,
        formatServiceId(r.ticketNo),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [rows, q, jobKind, from, to, statusFilter])

  function exportExcel() {
    if (!filtered.length) {
      addToast({ type: 'error', message: 'No rows to export for current filters' })
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    downloadXlsx(`service-reports-${stamp}.xlsx`, [
      {
        name: 'Service reports',
        rows: filtered.map((r) => ({
          When: r.savedAt ? formatDate(r.savedAt) : '',
          Ticket: formatServiceId(r.ticketNo),
          Status: r.status,
          Type: r.jobKind === 'stamping' ? 'Stamping' : 'Service',
          Customer: r.contactName,
          Machine: r.machineName,
          Engineer: r.engineerName,
          Spares: r.sparePartsCount,
          Issues: r.issues,
          'Work done': r.workDone,
          By: r.savedBy,
        })),
      },
    ])
    addToast({ type: 'success', message: `Excel downloaded (${filtered.length} reports)` })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service reports"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Service' }, { label: 'Reports' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={loading || filtered.length === 0}
              onClick={() => exportExcel()}
            >
              <Download size={16} /> Excel
            </Button>
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        }
      />

      <Card className="border-sky-200/70 bg-sky-50/40 p-4 text-sm text-text-secondary dark:border-sky-900/40 dark:bg-sky-950/20">
        <div className="flex items-start gap-2">
          <FileText size={18} className="mt-0.5 shrink-0 text-sky-600" />
          <p>
            Reports created after <strong>Approve & close</strong>. Filter by date, service vs
            stamping, then download Excel or print a single report. Spare part changes also appear
            under the customer&apos;s <strong>Spare parts</strong> tab.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="min-w-[200px] max-w-sm"
          label="Search"
          placeholder="Customer, machine, ticket, notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          className="w-36"
          label="Job type"
          value={jobKind}
          onChange={(e) => setJobKind(e.target.value as JobKind)}
          options={[
            { value: 'all', label: 'All types' },
            { value: 'service', label: 'Service' },
            { value: 'stamping', label: 'Stamping' },
          ]}
        />
        <Select
          className="w-36"
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[
            { value: '', label: 'Any status' },
            { value: 'CLOSED', label: 'Closed' },
            { value: 'RESOLVED', label: 'Resolved' },
          ]}
        />
        <Input
          className="w-40"
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          className="w-40"
          label="To"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setQ('')
            setJobKind('all')
            setStatusFilter('')
            setFrom('')
            setTo('')
          }}
        >
          Reset
        </Button>
        <span className="pb-2 text-xs text-text-secondary">
          {filtered.length} of {rows.length} report{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title={rows.length === 0 ? 'No service reports yet' : 'No matches'}
          subtitle={
            rows.length === 0
              ? 'Close a ticket from Pending approval, then fill Create service report.'
              : 'Try different filters or search.'
          }
        />
      ) : (
        <Card padding={false}>
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-text-secondary">
              <tr>
                {['When', 'Ticket', 'Type', 'Customer', 'Machine', 'Spares', 'By', ''].map((h) => (
                  <th key={h || 'a'} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticketId} className="border-t border-border">
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-text-secondary">
                    {r.savedAt ? formatDate(r.savedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      className="font-mono text-accent-blue hover:underline"
                      to={`/tickets/${r.ticketId}`}
                    >
                      {formatServiceId(r.ticketNo)}
                    </Link>
                    <div className="mt-0.5 max-w-[180px] truncate text-xs text-text-secondary">
                      {r.subject}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={r.jobKind === 'stamping' ? 'amber' : 'blue'}>
                      {r.jobKind === 'stamping' ? 'Stamping' : 'Service'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {r.contactId ? (
                      <Link
                        className="font-medium text-accent-blue hover:underline"
                        to={`/contacts/${r.contactId}?tab=service`}
                      >
                        {r.contactName}
                      </Link>
                    ) : (
                      r.contactName
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{r.machineName}</td>
                  <td className="px-4 py-3">
                    <Badge color={r.sparePartsCount > 0 ? 'purple' : 'gray'}>
                      {String(r.sparePartsCount)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{r.savedBy}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <DownloadIconButton
                        label="Download service report"
                        onClick={() => {
                          const ticket = ticketById[r.ticketId]
                          const opts = ticket
                            ? serviceReportOptsFromTicket(ticket, APP_NAME)
                            : null
                          if (!opts) {
                            addToast({
                              type: 'error',
                              message: 'Could not build this service report for download',
                            })
                            return
                          }
                          if (!openPrintableServiceReport(opts)) {
                            addToast({
                              type: 'error',
                              message: 'Allow pop-ups — or check Downloads for the HTML file',
                            })
                          }
                        }}
                      />
                      <Link to={`/tickets/${r.ticketId}`}>
                        <Button size="sm" variant="outline">
                          Open
                        </Button>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

export default ServiceReportsPage
