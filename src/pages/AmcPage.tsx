import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, Package, Shield, ShieldOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError } from '@/lib/api'
import { assetOriginShort, isThirdPartyOrigin } from '@/lib/assetOrigin'
import { formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type PlanTab = 'AMC' | 'NON_AMC' | 'DUE'
type OriginFilter = 'ALL' | 'SOLD_BY_US' | 'THIRD_PARTY'

function daysUntil(dateStr?: string | null) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

export function AmcPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<PlanTab>('AMC')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.assets({ limit: 200 })
      setRows(res.items ?? [])
    } catch (err) {
      setRows([])
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load machines',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  const byOrigin = useMemo(() => {
    if (originFilter === 'ALL') return rows
    return rows.filter((r) => String(r.origin ?? 'SOLD_BY_US') === originFilter)
  }, [originFilter, rows])

  const soldCount = useMemo(
    () => rows.filter((r) => !isThirdPartyOrigin(r.origin ? String(r.origin) : null)).length,
    [rows],
  )
  const outsideCount = useMemo(
    () => rows.filter((r) => isThirdPartyOrigin(r.origin ? String(r.origin) : null)).length,
    [rows],
  )

  const amcRows = useMemo(() => byOrigin.filter((r) => String(r.servicePlan) === 'AMC'), [byOrigin])
  const nonAmcRows = useMemo(() => byOrigin.filter((r) => String(r.servicePlan) !== 'AMC'), [byOrigin])
  const dueRows = useMemo(() => {
    return byOrigin
      .map((r) => {
        const due = daysUntil(r.nextDueDate ? String(r.nextDueDate) : null)
        const amc = daysUntil(r.amcEndDate ? String(r.amcEndDate) : null)
        const soon = (due != null && due <= 30) || (amc != null && amc <= 30)
        return { row: r, due, amc, soon }
      })
      .filter((x) => x.soon)
      .sort((a, b) => {
        const av = Math.min(a.due ?? 9999, a.amc ?? 9999)
        const bv = Math.min(b.due ?? 9999, b.amc ?? 9999)
        return av - bv
      })
  }, [byOrigin])

  const list =
    tab === 'AMC' ? amcRows : tab === 'NON_AMC' ? nonAmcRows : dueRows.map((d) => d.row)

  const ids = useMemo(() => list.map((i) => String(i.id)), [list])
  const selection = useRowSelection(ids)

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteAsset(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      selection.clear()
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete',
      })
    } finally {
      setBusyDelete(false)
      setConfirm(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="AMC / Non-AMC"
        count={rows.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'AMC / Non-AMC' }]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-center justify-between py-3">
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <Shield size={16} className="text-accent-green" /> AMC machines
          </span>
          <span className="text-xl font-semibold tabular-nums">{amcRows.length}</span>
        </Card>
        <Card className="flex items-center justify-between py-3">
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <ShieldOff size={16} /> Non-AMC
          </span>
          <span className="text-xl font-semibold tabular-nums">{nonAmcRows.length}</span>
        </Card>
        <Card className="flex items-center justify-between py-3">
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <CalendarClock size={16} className="text-accent-amber" /> Due in 30 days
          </span>
          <span className="text-xl font-semibold tabular-nums">{dueRows.length}</span>
        </Card>
        <Card className="flex items-center justify-between gap-2 py-3">
          <span className="text-sm text-text-secondary">Sold by us / Outside</span>
          <span className="text-lg font-semibold tabular-nums">
            {soldCount} / {outsideCount}
          </span>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            { id: 'ALL', label: 'All origins' },
            { id: 'SOLD_BY_US', label: `Sold by us (${soldCount})` },
            { id: 'THIRD_PARTY', label: `Outside / repair (${outsideCount})` },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOriginFilter(o.id)}
            className={`rounded-[10px] px-3 py-1.5 text-sm font-medium transition ${
              originFilter === o.id
                ? 'bg-accent-blue text-white'
                : 'bg-muted text-text-secondary hover:text-text-primary'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <PageTabs
        tabs={[
          { id: 'AMC', label: 'AMC', count: amcRows.length },
          { id: 'NON_AMC', label: 'Non-AMC', count: nonAmcRows.length },
          { id: 'DUE', label: 'Maintenance due', count: dueRows.length },
        ]}
        active={tab}
        onChange={(id) => setTab(id as PlanTab)}
      />

      {loading ? (
        <Card className="mt-4 p-6 text-sm text-text-secondary">Loading machines…</Card>
      ) : list.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Package size={22} />}
            title={tab === 'DUE' ? 'Nothing due in 30 days' : 'No machines in this plan'}
            subtitle="Add machines on a customer profile and set AMC / Non-AMC + next due dates."
            actionLabel="Customers"
            onAction={() => navigate('/contacts')}
          />
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden" padding={false}>
          <div className="p-4 pt-3">
            {selection.someSelected ? (
              <BulkActionBar
                count={selection.selectedCount}
                noun="machine"
                busy={busyDelete}
                onClear={selection.clear}
                onDelete={() => setConfirm({ ids: selection.selectedIds })}
              />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected && !selection.allSelected}
                        onChange={selection.toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    {['Customer', 'Machine', 'Origin', 'Plan', 'Next due', 'AMC period', 'Reminders', 'Actions'].map(
                      (h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const id = String(a.id)
                    const contact = a.contact as
                      | { id?: string; name?: string; phone?: string | null; customerCode?: string | null }
                      | null
                      | undefined
                    const contactId = contact?.id ? String(contact.id) : a.contactId ? String(a.contactId) : ''
                    const due = daysUntil(a.nextDueDate ? String(a.nextDueDate) : null)
                    const amcEnd = daysUntil(a.amcEndDate ? String(a.amcEndDate) : null)
                    const plan = String(a.servicePlan) === 'AMC' ? 'AMC' : 'Non-AMC'
                    const outside = isThirdPartyOrigin(a.origin ? String(a.origin) : null)
                    return (
                      <tr key={id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <SelectCheckbox
                            checked={selection.isSelected(id)}
                            onChange={() => selection.toggle(id)}
                            aria-label={`Select ${String(a.name)}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {contactId ? (
                            <Link
                              to={`/contacts/${contactId}`}
                              className="font-medium text-accent-blue hover:underline"
                            >
                              {contact?.customerCode ? (
                                <span className="mr-1 font-mono text-xs">{contact.customerCode}</span>
                              ) : null}
                              {contact?.name ?? 'Customer'}
                            </Link>
                          ) : (
                            '—'
                          )}
                          {contact?.phone ? (
                            <div className="text-xs text-text-secondary">{formatPhone(String(contact.phone))}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{String(a.name)}</div>
                          <div className="text-xs text-text-secondary">
                            {[a.machineType, a.serialNo].filter(Boolean).join(' · ').replaceAll('_', ' ') || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={outside ? 'amber' : 'blue'}>
                            {assetOriginShort(a.origin ? String(a.origin) : null)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={plan === 'AMC' ? 'green' : 'gray'}>{plan}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
                          {due != null ? (
                            <div
                              className={`text-xs ${due <= 7 ? 'text-accent-red' : due <= 30 ? 'text-accent-amber' : 'text-text-secondary'}`}
                            >
                              {due < 0 ? `${Math.abs(due)}d overdue` : `${due}d left`}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {plan === 'AMC' ? (
                            <div className="text-xs">
                              <div>
                                {a.amcStartDate ? formatDate(String(a.amcStartDate)) : '—'} →{' '}
                                {a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}
                              </div>
                              {amcEnd != null ? (
                                <div
                                  className={`text-xs ${amcEnd <= 7 ? 'text-accent-red' : amcEnd <= 30 ? 'text-accent-amber' : 'text-text-secondary'}`}
                                >
                                  {amcEnd < 0 ? `${Math.abs(amcEnd)}d overdue` : `${amcEnd}d left`}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">
                          {a.remindersEnabled === false ? 'Off' : 'On'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {contactId ? (
                              <ViewIconButton onClick={() => navigate(`/contacts/${contactId}`)} />
                            ) : null}
                            <DeleteIconButton
                              disabled={busyDelete}
                              onClick={() => setConfirm({ ids: [id] })}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                navigate(
                                  `/tickets?contactId=${encodeURIComponent(String(a.contactId))}&assetId=${encodeURIComponent(id)}&open=1`,
                                )
                              }
                            >
                              New job
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete machine?' : `Delete ${confirm?.ids.length ?? 0} machines?`}
        body={
          confirm?.ids.length === 1
            ? 'This machine will be permanently removed.'
            : 'Selected machines will be permanently removed.'
        }
      />
    </div>
  )
}

export default AmcPage
