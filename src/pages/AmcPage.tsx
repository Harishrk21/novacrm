import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, Package, Shield, ShieldOff, UserPlus, Wrench } from 'lucide-react'
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
import {
  canEnrollAmc,
  defaultAmcEndFromStart,
  defaultNextAmcService,
  effectiveServicePlan,
  isWeighingMachine,
} from '@/lib/hmsCoverage'
import { isCompanyAdmin } from '@/lib/roles'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { TableSkeleton } from '@/components/ui/Skeleton'

type PlanTab = 'AMC' | 'ELIGIBLE' | 'NON_AMC' | 'UPCOMING_SERVICE' | 'UPCOMING_AMC_RENEWAL'
type OriginFilter = 'ALL' | 'SOLD_BY_US' | 'THIRD_PARTY'

const SERVICE_WINDOW_DAYS = 30
const AMC_RENEWAL_WINDOW_DAYS = 60

function daysUntil(dateStr?: string | null) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function daysLabel(days: number | null) {
  if (days == null) return null
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Today'
  return `${days}d left`
}

function daysClass(days: number | null) {
  if (days == null) return 'text-text-secondary'
  if (days < 0) return 'text-accent-red'
  if (days <= 7) return 'text-accent-red'
  if (days <= 30) return 'text-accent-amber'
  return 'text-text-secondary'
}

type AssetRow = Record<string, unknown>

function contactCell(a: AssetRow) {
  const contact = a.contact as
    | { id?: string; name?: string; phone?: string | null; customerCode?: string | null }
    | null
    | undefined
  const contactId = contact?.id ? String(contact.id) : a.contactId ? String(a.contactId) : ''
  if (!contactId) return '—'
  return (
    <div>
      <Link to={`/contacts/${contactId}`} className="font-medium text-accent-blue hover:underline">
        {contact?.customerCode ? (
          <span className="mr-1 font-mono text-xs">{contact.customerCode}</span>
        ) : null}
        {contact?.name ?? 'Customer'}
      </Link>
      {contact?.phone ? (
        <div className="text-xs text-text-secondary">{formatPhone(String(contact.phone))}</div>
      ) : null}
    </div>
  )
}

function machineCell(a: AssetRow) {
  return (
    <div>
      <div className="font-medium">{String(a.name)}</div>
      <div className="text-xs text-text-secondary">
        {[a.machineType, a.serialNo, a.model].filter(Boolean).join(' · ').replaceAll('_', ' ') || '—'}
      </div>
    </div>
  )
}

export function AmcPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const isAdmin = isCompanyAdmin(useAuthStore((s) => s.user?.role))
  const [tab, setTab] = useState<PlanTab>('AMC')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL')
  const [rows, setRows] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [convertId, setConvertId] = useState<string | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [busyConvert, setBusyConvert] = useState(false)

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

  const amcRows = useMemo(
    () =>
      byOrigin.filter(
        (r) => String(r.servicePlan) === 'AMC' && isWeighingMachine(r.machineType ? String(r.machineType) : null),
      ),
    [byOrigin],
  )
  const eligibleRows = useMemo(
    () =>
      byOrigin.filter(
        (r) =>
          canEnrollAmc({
            machineType: r.machineType ? String(r.machineType) : null,
            servicePlan: r.servicePlan ? String(r.servicePlan) : null,
            warrantyEndDate: r.warrantyEndDate ? String(r.warrantyEndDate) : null,
            amcEndDate: r.amcEndDate ? String(r.amcEndDate) : null,
          }).ok,
      ),
    [byOrigin],
  )
  const nonAmcRows = useMemo(() => byOrigin.filter((r) => String(r.servicePlan) !== 'AMC'), [byOrigin])

  const upcomingServiceRows = useMemo(() => {
    return byOrigin
      .map((r) => ({ row: r, due: daysUntil(r.nextDueDate ? String(r.nextDueDate) : null) }))
      .filter((x) => x.due != null && x.due <= SERVICE_WINDOW_DAYS)
      .sort((a, b) => (a.due ?? 9999) - (b.due ?? 9999))
  }, [byOrigin])

  const upcomingAmcRenewalRows = useMemo(() => {
    return byOrigin
      .filter((r) => String(r.servicePlan) === 'AMC')
      .map((r) => ({ row: r, amcEnd: daysUntil(r.amcEndDate ? String(r.amcEndDate) : null) }))
      .filter((x) => x.amcEnd != null && x.amcEnd <= AMC_RENEWAL_WINDOW_DAYS)
      .sort((a, b) => (a.amcEnd ?? 9999) - (b.amcEnd ?? 9999))
  }, [byOrigin])

  const list: AssetRow[] =
    tab === 'AMC'
      ? amcRows
      : tab === 'ELIGIBLE'
        ? eligibleRows
        : tab === 'NON_AMC'
          ? nonAmcRows
          : tab === 'UPCOMING_SERVICE'
            ? upcomingServiceRows.map((x) => x.row)
            : upcomingAmcRenewalRows.map((x) => x.row)

  const ids = useMemo(() => list.map((i) => String(i.id)), [list])
  const selection = useRowSelection(ids)

  const tableHeaders =
    tab === 'AMC'
      ? ['Customer', 'Machine', 'Origin', 'AMC start', 'AMC end', 'Next service', 'Actions']
      : tab === 'ELIGIBLE'
        ? ['Customer', 'Machine', 'Origin', 'Coverage', 'GC / stamp till', 'Why eligible', 'Actions']
        : tab === 'NON_AMC'
          ? ['Customer', 'Machine', 'Origin', 'Stamping', 'Next due', 'Plan', 'Actions']
          : tab === 'UPCOMING_SERVICE'
            ? ['Customer', 'Machine', 'Service due', 'Days left', 'Plan', 'Stamping', 'Phone', 'Actions']
            : ['Customer', 'Machine', 'AMC ends', 'Days left', 'AMC period', 'Next service', 'Actions']

  async function convertToAmc(assetId: string) {
    const start = new Date().toISOString().slice(0, 10)
    setBusyConvert(true)
    try {
      await api.updateAsset(assetId, {
        servicePlan: 'AMC',
        amcStartDate: start,
        amcEndDate: defaultAmcEndFromStart(start),
        nextServiceDueDate: defaultNextAmcService(start),
      })
      addToast({ type: 'success', message: 'Converted to AMC (1 year)' })
      setConvertId(null)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not convert to AMC',
      })
    } finally {
      setBusyConvert(false)
    }
  }

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

  function renderRowCells(a: AssetRow) {
    const contact = a.contact as { id?: string; phone?: string | null } | null | undefined
    const due = daysUntil(a.nextDueDate ? String(a.nextDueDate) : null)
    const amcEnd = daysUntil(a.amcEndDate ? String(a.amcEndDate) : null)
    const outside = isThirdPartyOrigin(a.origin ? String(a.origin) : null)
    const plan = effectiveServicePlan({
      servicePlan: a.servicePlan ? String(a.servicePlan) : null,
      warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
    })
    const enroll = canEnrollAmc({
      machineType: a.machineType ? String(a.machineType) : null,
      servicePlan: a.servicePlan ? String(a.servicePlan) : null,
      warrantyEndDate: a.warrantyEndDate ? String(a.warrantyEndDate) : null,
      amcEndDate: a.amcEndDate ? String(a.amcEndDate) : null,
    })

    if (tab === 'AMC') {
      return (
        <>
          <td className="px-4 py-3">{contactCell(a)}</td>
          <td className="px-4 py-3">{machineCell(a)}</td>
          <td className="px-4 py-3">
            <Badge color={outside ? 'amber' : 'blue'}>{assetOriginShort(a.origin ? String(a.origin) : null)}</Badge>
          </td>
          <td className="px-4 py-3">{a.amcStartDate ? formatDate(String(a.amcStartDate)) : '—'}</td>
          <td className="px-4 py-3">
            {a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}
            {amcEnd != null ? (
              <div className={`text-xs ${daysClass(amcEnd)}`}>{daysLabel(amcEnd)}</div>
            ) : null}
          </td>
          <td className="px-4 py-3">
            {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
            {due != null ? <div className={`text-xs ${daysClass(due)}`}>{daysLabel(due)}</div> : null}
          </td>
        </>
      )
    }

    if (tab === 'ELIGIBLE') {
      return (
        <>
          <td className="px-4 py-3">{contactCell(a)}</td>
          <td className="px-4 py-3">{machineCell(a)}</td>
          <td className="px-4 py-3">
            <Badge color={outside ? 'amber' : 'blue'}>{assetOriginShort(a.origin ? String(a.origin) : null)}</Badge>
          </td>
          <td className="px-4 py-3">
            <Badge color={plan === 'NGC' ? 'gray' : 'green'}>{plan}</Badge>
          </td>
          <td className="px-4 py-3 text-xs">
            <div>GC {a.warrantyEndDate ? formatDate(String(a.warrantyEndDate)) : '—'}</div>
            <div className="text-text-secondary">
              Stamp {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
            </div>
          </td>
          <td className="max-w-[220px] px-4 py-3 text-xs text-text-secondary">{enroll.reason}</td>
        </>
      )
    }

    if (tab === 'NON_AMC') {
      return (
        <>
          <td className="px-4 py-3">{contactCell(a)}</td>
          <td className="px-4 py-3">{machineCell(a)}</td>
          <td className="px-4 py-3">
            <Badge color={outside ? 'amber' : 'blue'}>{assetOriginShort(a.origin ? String(a.origin) : null)}</Badge>
          </td>
          <td className="px-4 py-3">{a.stampingDate ? formatDate(String(a.stampingDate)) : '—'}</td>
          <td className="px-4 py-3">
            {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
            {due != null ? <div className={`text-xs ${daysClass(due)}`}>{daysLabel(due)}</div> : null}
          </td>
          <td className="px-4 py-3">
            <Badge color={plan === 'GC' ? 'green' : 'gray'}>{plan === 'AMC' ? 'Non-AMC' : plan}</Badge>
          </td>
        </>
      )
    }

    if (tab === 'UPCOMING_SERVICE') {
      return (
        <>
          <td className="px-4 py-3">{contactCell(a)}</td>
          <td className="px-4 py-3">{machineCell(a)}</td>
          <td className="px-4 py-3 font-medium">
            {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
          </td>
          <td className="px-4 py-3">
            <Badge color={due != null && due <= 7 ? 'red' : due != null && due <= 30 ? 'amber' : 'gray'}>
              {daysLabel(due) ?? '—'}
            </Badge>
          </td>
          <td className="px-4 py-3">
            <Badge color={plan === 'AMC' ? 'green' : plan === 'GC' ? 'green' : 'gray'}>
              {plan}
            </Badge>
          </td>
          <td className="px-4 py-3">{a.stampingDate ? formatDate(String(a.stampingDate)) : '—'}</td>
          <td className="px-4 py-3">{contact?.phone ? formatPhone(String(contact.phone)) : '—'}</td>
        </>
      )
    }

    // UPCOMING_AMC_RENEWAL
    return (
      <>
        <td className="px-4 py-3">{contactCell(a)}</td>
        <td className="px-4 py-3">{machineCell(a)}</td>
        <td className="px-4 py-3 font-medium">{a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}</td>
        <td className="px-4 py-3">
          <Badge color={amcEnd != null && amcEnd <= 7 ? 'red' : amcEnd != null && amcEnd <= 30 ? 'amber' : 'gray'}>
            {daysLabel(amcEnd) ?? '—'}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs">
          {a.amcStartDate ? formatDate(String(a.amcStartDate)) : '—'} →{' '}
          {a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}
        </td>
        <td className="px-4 py-3">
          {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
          {due != null ? <div className={`text-xs ${daysClass(due)}`}>{daysLabel(due)}</div> : null}
        </td>
      </>
    )
  }

  const emptyTitle =
    tab === 'UPCOMING_SERVICE'
      ? `No services due in ${SERVICE_WINDOW_DAYS} days`
      : tab === 'UPCOMING_AMC_RENEWAL'
        ? `No AMC renewals in ${AMC_RENEWAL_WINDOW_DAYS} days`
        : tab === 'ELIGIBLE'
          ? 'No weighing machines ready for AMC'
          : tab === 'NON_AMC'
            ? 'No Non-AMC machines'
            : 'No AMC machines'

  return (
    <div>
      <PageHeader
        title="AMC & Service"
        count={rows.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'AMC / Service' }]}
      />

      <Card className="mb-3 border-emerald-200/60 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="text-sm font-medium text-text-primary">AMC flow</p>
        <p className="mt-1 text-xs text-text-secondary">
          AMC is <strong>weighing only</strong>. After the 1-year GC (or any existing weighing
          customer) contact them from <strong>Convert to AMC</strong>. Other machines stay GC → NGC
          with no AMC. Stamping is separate (1 year on weighing, quarters A–D).
        </p>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { label: 'AMC', value: amcRows.length, icon: Shield },
          { label: 'Convert to AMC', value: eligibleRows.length, icon: UserPlus },
          { label: 'Non-AMC / NGC', value: nonAmcRows.length, icon: ShieldOff },
          { label: 'Upcoming service', value: upcomingServiceRows.length, icon: Wrench },
          { label: 'AMC renewal', value: upcomingAmcRenewalRows.length, icon: CalendarClock },
        ].map((card) => (
          <div
            key={card.label}
            className="flex min-w-[130px] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <card.icon size={16} className="text-text-secondary" />
            <span className="text-xs text-text-secondary">{card.label}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums">{card.value}</span>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            { id: 'ALL', label: 'All origins' },
            { id: 'SOLD_BY_US', label: `Sold by us (${soldCount})` },
            { id: 'THIRD_PARTY', label: `Outside (${outsideCount})` },
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
          { id: 'ELIGIBLE', label: 'Convert to AMC', count: eligibleRows.length },
          { id: 'NON_AMC', label: 'NGC / other', count: nonAmcRows.length },
          { id: 'UPCOMING_SERVICE', label: 'Upcoming services', count: upcomingServiceRows.length },
          { id: 'UPCOMING_AMC_RENEWAL', label: 'Upcoming AMC renewal', count: upcomingAmcRenewalRows.length },
        ]}
        active={tab}
        onChange={(id) => setTab(id as PlanTab)}
      />

      {loading ? (
        <div className="mt-4"><TableSkeleton rows={7} /></div>
      ) : list.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Package size={22} />}
            title={emptyTitle}
            subtitle="Add machines on a customer profile with AMC dates and next service due."
            actionLabel="Customers"
            onAction={() => navigate('/contacts')}
          />
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden" padding={false}>
          <div className="p-4 pt-3">
            {isAdmin && selection.someSelected ? (
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
                    {tableHeaders.map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const id = String(a.id)
                    const contact = a.contact as { id?: string } | null | undefined
                    const contactId = contact?.id ? String(contact.id) : a.contactId ? String(a.contactId) : ''
                    return (
                      <tr key={id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <SelectCheckbox
                            checked={selection.isSelected(id)}
                            onChange={() => selection.toggle(id)}
                            aria-label={`Select ${String(a.name)}`}
                          />
                        </td>
                        {renderRowCells(a)}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {contactId ? (
                              <ViewIconButton onClick={() => navigate(`/contacts/${contactId}`)} />
                            ) : null}
                            <DeleteIconButton
                              disabled={busyDelete}
                              onClick={() => setConfirm({ ids: [id] })}
                            />
                            {tab === 'ELIGIBLE' ? (
                              <Button
                                size="sm"
                                disabled={busyConvert}
                                onClick={() => setConvertId(id)}
                              >
                                Convert to AMC
                              </Button>
                            ) : null}
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
      <ConfirmModal
        open={Boolean(convertId)}
        onClose={() => !busyConvert && setConvertId(null)}
        onConfirm={() => {
          if (convertId) void convertToAmc(convertId)
        }}
        title="Convert to AMC?"
        body="Starts a 1-year AMC on this weighing machine (service every 6 months; parts charged). Existing customers can be converted after GC or if they already have a weighing unit."
        confirmLabel={busyConvert ? 'Saving…' : 'Convert to AMC'}
      />
    </div>
  )
}

export default AmcPage
