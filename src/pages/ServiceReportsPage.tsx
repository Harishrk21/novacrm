import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { api, ApiClientError } from '@/lib/api'
import { formatServiceId } from '@/lib/serviceId'
import { formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'

type ReportRow = {
  ticketId: string
  ticketNo?: string
  subject: string
  status: string
  contactId?: string
  contactName: string
  machineName: string
  issues: string
  workDone: string
  sparePartsCount: number
  savedAt: string
  savedBy: string
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
    contactId: t.contactId ? String(t.contactId) : contact?.id ? String(contact.id) : undefined,
    contactName: String(report.customerName || contact?.name || '—'),
    machineName: String(report.machineName || '—'),
    issues: String(report.issues || ''),
    workDone: String(report.workDone || ''),
    sparePartsCount: Number(report.sparePartsCount || 0),
    savedAt: String(report.savedAt || t.closedAt || t.updatedAt || ''),
    savedBy: String(report.savedBy || '—'),
  }
}

/**
 * All service reports saved after Approve & close (stored on ticket customFields).
 * Per-customer view also lives on Contact → Service.
 */
export function ServiceReportsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [closed, resolved] = await Promise.all([
        api.tickets({ limit: 200, status: 'CLOSED', sort: 'newest' }),
        api.tickets({ limit: 100, status: 'RESOLVED', sort: 'newest' }),
      ])
      const seen = new Set<string>()
      const next: ReportRow[] = []
      for (const t of [...(closed.items ?? []), ...(resolved.items ?? [])]) {
        const id = String(t.id)
        if (seen.has(id)) continue
        seen.add(id)
        const row = reportFromTicket(t as Record<string, unknown>)
        if (row) next.push(row)
      }
      next.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
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
    if (!needle) return rows
    return rows.filter((r) =>
      [
        r.contactName,
        r.machineName,
        r.subject,
        r.issues,
        r.workDone,
        r.savedBy,
        formatServiceId(r.ticketNo),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [rows, q])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service reports"
        breadcrumbs={[{ label: APP_NAME }, { label: 'Service' }, { label: 'Reports' }]}
        actions={
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      <Card className="border-sky-200/70 bg-sky-50/40 p-4 text-sm text-text-secondary dark:border-sky-900/40 dark:bg-sky-950/20">
        <div className="flex items-start gap-2">
          <FileText size={18} className="mt-0.5 shrink-0 text-sky-600" />
          <p>
            Reports created after <strong>Approve & close</strong>. Each report is saved on the
            ticket; spare part changes also appear under the customer&apos;s{' '}
            <strong>Spare parts</strong> tab. Open a customer → <strong>Service</strong> for that
            shop&apos;s reports only.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="Search customer, machine, ticket, notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-text-secondary">
          {filtered.length} report{filtered.length === 1 ? '' : 's'}
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
              : 'Try a different search.'
          }
        />
      ) : (
        <Card padding={false}>
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-text-secondary">
              <tr>
                {['When', 'Ticket', 'Customer', 'Machine', 'Spares', 'By', ''].map((h) => (
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
                  <td className="px-4 py-3 text-right">
                    <Link to={`/tickets/${r.ticketId}`}>
                      <Button size="sm" variant="outline">
                        Open ticket
                      </Button>
                    </Link>
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
