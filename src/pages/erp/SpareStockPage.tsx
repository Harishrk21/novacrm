import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FileSpreadsheet,
  History,
  Package,
  Plus,
  Warehouse,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { filterServiceEngineers } from '@/lib/roles'
import { can } from '@/lib/permissions'
import {
  canSeeSpareFamily,
  resolveInventoryAreas,
  type InventoryAreas,
} from '@/lib/inventoryAreas'
import { StockImportPanel } from '@/components/inventory/StockImportPanel'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

type Family = 'WEIGHING' | 'BILLING'

type SpareItem = {
  id: string
  name: string
  machineFamily: Family
  unit?: string
  partCode?: string | null
  quantityOnHand?: number
}

type HistoryRow = {
  id: string
  txnType: 'IN' | 'OUT'
  quantity: number
  txnDate: string
  spareName?: string
  machineFamily?: Family | null
  supplierName?: string | null
  invoiceDate?: string | null
  invoiceNo?: string | null
  issuedToName?: string | null
  createdByName?: string | null
  notes?: string | null
  createdAt?: string
}

type MonthlyItem = {
  sparePartId: string
  name: string
  machineFamily: Family
  unit?: string
  opening: number
  received: number
  issued: number
  closing: number
}

const FAMILY_LABEL: Record<Family, string> = {
  WEIGHING: 'Weighing machine',
  BILLING: 'Billing machine',
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function SpareStockPage() {
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const role = authUser?.role
  const canWrite = can(role, 'inventory:write')
  const areas: InventoryAreas = resolveInventoryAreas(authUser?.inventoryAreas, role)
  const allowedFamilies = (['BILLING', 'WEIGHING'] as Family[]).filter((f) =>
    canSeeSpareFamily(areas, f),
  )
  const [searchParams, setSearchParams] = useSearchParams()

  const now = new Date()
  const [tab, setTab] = useState<'stock' | 'monthly' | 'history'>(() => {
    const t = searchParams.get('tab')
    if (t === 'monthly' || t === 'history') return t
    return 'stock'
  })
  const [familyFilter, setFamilyFilter] = useState<'' | Family>(() =>
    allowedFamilies.length === 1 ? allowedFamilies[0] : '',
  )
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SpareItem[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [monthly, setMonthly] = useState<{
    year: number
    month: number
    items: MonthlyItem[]
    totals: { opening: number; received: number; issued: number; closing: number }
  } | null>(null)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [engineers, setEngineers] = useState<Array<{ id: string; name: string }>>([])

  const [receiveOpen, setReceiveOpen] = useState(searchParams.get('receive') === '1')
  const [issueOpen, setIssueOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [recv, setRecv] = useState({
    machineFamily: (allowedFamilies[0] ?? 'BILLING') as Family,
    sparePartId: '',
    spareName: '',
    quantity: '',
    supplierName: '',
    invoiceDate: todayIso(),
    invoiceNo: '',
    notes: '',
  })
  const [iss, setIss] = useState({
    machineFamily: '' as '' | Family,
    sparePartId: '',
    quantity: '',
    issuedToUserId: '',
    txnDate: todayIso(),
    notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function loadItems() {
    const data = await api.spareStockItems({
      machineFamily: familyFilter || undefined,
      q: q.trim() || undefined,
    })
    setItems(
      (data ?? []).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        machineFamily: r.machineFamily as Family,
        unit: r.unit ? String(r.unit) : 'NOS',
        partCode: r.partCode != null ? String(r.partCode) : null,
        quantityOnHand: Number(r.quantityOnHand ?? 0),
      })),
    )
  }

  async function loadHistory() {
    const data = await api.spareStockHistory({
      machineFamily: familyFilter || undefined,
      limit: 200,
    })
    setHistory(
      (data ?? []).map((r) => ({
        id: String(r.id),
        txnType: r.txnType as 'IN' | 'OUT',
        quantity: Number(r.quantity),
        txnDate: String(r.txnDate),
        spareName: r.spareName != null ? String(r.spareName) : undefined,
        machineFamily: (r.machineFamily as Family) ?? null,
        supplierName: r.supplierName != null ? String(r.supplierName) : null,
        invoiceDate: r.invoiceDate != null ? String(r.invoiceDate) : null,
        invoiceNo: r.invoiceNo != null ? String(r.invoiceNo) : null,
        issuedToName: r.issuedToName != null ? String(r.issuedToName) : null,
        createdByName: r.createdByName != null ? String(r.createdByName) : null,
        notes: r.notes != null ? String(r.notes) : null,
        createdAt: r.createdAt != null ? String(r.createdAt) : undefined,
      })),
    )
  }

  async function loadMonthly() {
    const data = await api.spareStockMonthly({
      year,
      month,
      machineFamily: familyFilter || undefined,
    })
    setMonthly({
      year: data.year,
      month: data.month,
      items: (data.items ?? []).map((r) => ({
        sparePartId: String(r.sparePartId),
        name: String(r.name),
        machineFamily: r.machineFamily as Family,
        unit: r.unit ? String(r.unit) : 'NOS',
        opening: Number(r.opening),
        received: Number(r.received),
        issued: Number(r.issued),
        closing: Number(r.closing),
      })),
      totals: data.totals,
    })
  }

  async function refresh() {
    setLoading(true)
    try {
      await Promise.all([loadItems(), loadHistory(), loadMonthly()])
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load spare stock',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Keep filters in sync when admin changes this user's spare areas mid-session
    if (!allowedFamilies.length) return
    if (familyFilter && !allowedFamilies.includes(familyFilter)) {
      setFamilyFilter(allowedFamilies.length === 1 ? allowedFamilies[0] : '')
    }
    if (!allowedFamilies.includes(recv.machineFamily)) {
      setRecv((r) => ({ ...r, machineFamily: allowedFamilies[0], sparePartId: '', spareName: '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedFamilies.join('|')])

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyFilter, year, month])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadItems().catch(() => undefined)
    }, 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    void api
      .listUsers()
      .then((res) => {
        const eng = filterServiceEngineers(
          (res.items ?? []).map((u) => ({
            id: u.id,
            name: u.name,
            roleCode: u.role?.code ?? null,
          })),
        )
        setEngineers(eng.map((e) => ({ id: e.id, name: e.name })))
      })
      .catch(() => setEngineers([]))
  }, [])

  useEffect(() => {
    if (searchParams.get('receive') === '1') setReceiveOpen(true)
  }, [searchParams])

  const recvSpareOptions = useMemo(() => {
    const list = items.filter((i) => i.machineFamily === recv.machineFamily)
    const opts = list.map((i) => ({
      value: i.id,
      label: i.name,
      sublabel: `On hand: ${i.quantityOnHand ?? 0} ${i.unit ?? 'NOS'}`,
    }))
    const typed = recv.spareName.trim()
    if (typed && !list.some((i) => i.name.toLowerCase() === typed.toLowerCase())) {
      opts.unshift({
        value: `__new__:${typed}`,
        label: typed,
        sublabel: 'New spare — will be added to catalog',
      })
    }
    return opts
  }, [items, recv.machineFamily, recv.spareName])

  const issueSpareOptions = useMemo(() => {
    const list = items.filter((i) => !iss.machineFamily || i.machineFamily === iss.machineFamily)
    return list.map((i) => ({
      value: i.id,
      label: i.name,
      sublabel: `${FAMILY_LABEL[i.machineFamily]} · On hand: ${i.quantityOnHand ?? 0}`,
    }))
  }, [items, iss.machineFamily])

  const selectedIssue = items.find((i) => i.id === iss.sparePartId)
  const issueOnHand = selectedIssue?.quantityOnHand ?? 0

  function openReceive() {
    setErrors({})
    setRecv((r) => ({
      ...r,
      quantity: '',
      supplierName: '',
      invoiceDate: todayIso(),
      invoiceNo: '',
      notes: '',
    }))
    setReceiveOpen(true)
  }

  function closeReceive() {
    setReceiveOpen(false)
    setErrors({})
    if (searchParams.get('receive')) {
      const next = new URLSearchParams(searchParams)
      next.delete('receive')
      setSearchParams(next, { replace: true })
    }
  }

  function openIssue(prefill?: SpareItem) {
    setErrors({})
    setIss({
      machineFamily: prefill?.machineFamily ?? '',
      sparePartId: prefill?.id ?? '',
      quantity: '',
      issuedToUserId: '',
      txnDate: todayIso(),
      notes: '',
    })
    setIssueOpen(true)
  }

  async function saveReceive() {
    const nextErr: Record<string, string> = {}
    const qty = Number(recv.quantity)
    if (!recv.sparePartId && !recv.spareName.trim()) nextErr.spare = 'Select or enter spare name'
    if (!(qty > 0)) nextErr.quantity = 'Enter quantity arrived'
    if (!recv.supplierName.trim()) nextErr.supplierName = 'Supplier name required'
    if (!recv.invoiceDate) nextErr.invoiceDate = 'Invoice date required'
    setErrors(nextErr)
    if (Object.keys(nextErr).length) return

    const isNew = recv.sparePartId.startsWith('__new__:')
    setSaving(true)
    try {
      await api.receiveSpareStock({
        machineFamily: recv.machineFamily,
        sparePartId: isNew || !recv.sparePartId ? null : recv.sparePartId,
        spareName: isNew
          ? recv.sparePartId.slice('__new__:'.length)
          : recv.spareName.trim() || undefined,
        quantity: qty,
        supplierName: recv.supplierName.trim(),
        invoiceDate: recv.invoiceDate,
        invoiceNo: recv.invoiceNo.trim() || null,
        notes: recv.notes.trim() || null,
      })
      addToast({ type: 'success', message: 'Spare stock received' })
      closeReceive()
      await refresh()
      setTab('stock')
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not receive spare stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveIssue() {
    const nextErr: Record<string, string> = {}
    const qty = Number(iss.quantity)
    if (!iss.sparePartId) nextErr.sparePartId = 'Select spare part'
    if (!(qty > 0)) nextErr.quantity = 'Enter quantity'
    if (qty > issueOnHand) nextErr.quantity = `Only ${issueOnHand} available`
    setErrors(nextErr)
    if (Object.keys(nextErr).length) return

    setSaving(true)
    try {
      await api.issueSpareStock({
        sparePartId: iss.sparePartId,
        quantity: qty,
        issuedToUserId: iss.issuedToUserId || undefined,
        txnDate: iss.txnDate || null,
        notes: iss.notes.trim() || null,
      })
      addToast({
        type: 'success',
        message: iss.issuedToUserId ? 'Spare issued' : 'Spare stock reduced',
      })
      setIssueOpen(false)
      await refresh()
      setTab('history')
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not issue spare',
      })
    } finally {
      setSaving(false)
    }
  }

  const monthLabel = `${String(month).padStart(2, '0')}/${year}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="Spare parts stock"
        breadcrumbs={[
          { label: 'Inventory', to: '/erp/inventory' },
          { label: 'Spare stock' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/erp/inventory">
              <Button variant="outline">
                <Warehouse size={16} /> Machine stock
              </Button>
            </Link>
            <Link to="/spare-parts">
              <Button variant="outline">
                <Package size={16} /> Service log
              </Button>
            </Link>
            {canWrite ? (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <FileSpreadsheet size={16} /> Import Excel
                </Button>
                <Button variant="outline" onClick={() => openIssue()}>
                  <ArrowUpFromLine size={16} /> Issue to engineer
                </Button>
                <Button onClick={openReceive}>
                  <Plus size={16} /> Receive spare stock
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {importOpen ? (
        <Card className="p-4">
          <StockImportPanel
            kinds={[
              ...(areas.sparesBilling ? (['sparesBilling'] as const) : []),
              ...(areas.sparesWeighing ? (['sparesWeighing'] as const) : []),
            ]}
            onImported={() => void refresh()}
            onClose={() => setImportOpen(false)}
          />
        </Card>
      ) : null}

      <Card className="border-sky-200/70 bg-sky-50/40 p-4 text-sm text-text-secondary dark:border-sky-900/40 dark:bg-sky-950/20">
        <p>
          Quantity stock for <strong>billing</strong> and <strong>weighing</strong> machine spares
          (batteries, load cells, printer heads…). Separate from product serial stock. Opening stock
          for a month is the previous month&apos;s closing. Issue reduces stock only when quantity
          is available.
        </p>
      </Card>

      {!allowedFamilies.length ? (
        <Card className="border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-900">
          You are not assigned any spare stock area. Ask your company admin (or platform admin) to
          enable Billing/Touch POS spares and/or Weighing spares on your user.
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs sm:w-56">
          <Select
            label="Machine type"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value as '' | Family)}
            options={[
              ...(allowedFamilies.length > 1
                ? [{ value: '', label: 'All assigned' }]
                : []),
              ...allowedFamilies.map((f) => ({
                value: f,
                label: FAMILY_LABEL[f],
              })),
            ]}
          />
        </div>
        {tab === 'stock' ? (
          <div className="w-full max-w-sm flex-1">
            <Input
              label="Search spare"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Battery, load cell…"
            />
          </div>
        ) : null}
        {tab === 'monthly' ? (
          <>
            <div className="w-28">
              <Select
                label="Month"
                value={String(month)}
                onChange={(e) => setMonth(Number(e.target.value))}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1).padStart(2, '0'),
                }))}
              />
            </div>
            <div className="w-28">
              <Input
                label="Year"
                type="number"
                value={String(year)}
                onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
              />
            </div>
          </>
        ) : null}
      </div>

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          { id: 'stock', label: 'On hand', count: items.length },
          { id: 'monthly', label: `Monthly (${monthLabel})` },
          { id: 'history', label: 'Timeline', count: history.length },
        ]}
      />

      {loading ? (
        <Card className="p-8 text-sm text-text-secondary">Loading spare stock…</Card>
      ) : null}

      {!loading && tab === 'stock' ? (
        items.length === 0 ? (
          <EmptyState
            title="No spare parts yet"
            subtitle="Receive stock for billing or weighing machine spares to start the catalog."
            actionLabel={canWrite ? 'Receive spare stock' : undefined}
            onAction={canWrite ? openReceive : undefined}
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-4 py-3 font-medium">Spare</th>
                    <th className="px-4 py-3 font-medium">Machine</th>
                    <th className="px-4 py-3 font-medium text-right">On hand</th>
                    <th className="px-4 py-3 font-medium">Unit</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-3 font-medium text-text-primary">{row.name}</td>
                      <td className="px-4 py-3">
                        <Badge color="gray">{FAMILY_LABEL[row.machineFamily]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {row.quantityOnHand ?? 0}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{row.unit ?? 'NOS'}</td>
                      <td className="px-4 py-3 text-right">
                        {canWrite ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={(row.quantityOnHand ?? 0) <= 0}
                            onClick={() => openIssue(row)}
                          >
                            Issue
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : null}

      {!loading && tab === 'monthly' && monthly ? (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-3 text-sm">
            <span className="font-medium text-text-primary">Period {monthLabel}</span>
            <span className="text-text-secondary">
              Opening {monthly.totals.opening} · Received {monthly.totals.received} · Issued{' '}
              {monthly.totals.issued} · Closing {monthly.totals.closing}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">Spare</th>
                  <th className="px-4 py-3 font-medium">Machine</th>
                  <th className="px-4 py-3 font-medium text-right">Opening</th>
                  <th className="px-4 py-3 font-medium text-right">Received</th>
                  <th className="px-4 py-3 font-medium text-right">Issued</th>
                  <th className="px-4 py-3 font-medium text-right">Closing</th>
                </tr>
              </thead>
              <tbody>
                {monthly.items.map((row) => (
                  <tr key={row.sparePartId} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {FAMILY_LABEL[row.machineFamily]}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.opening}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {row.received}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                      {row.issued}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {row.closing}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {monthly.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-secondary">No movements for this period.</p>
          ) : null}
        </Card>
      ) : null}

      {!loading && tab === 'history' ? (
        history.length === 0 ? (
          <EmptyState
            title="No spare movements yet"
            subtitle="Receives and issues will show here as a timeline."
            icon={<History className="text-text-secondary" size={28} />}
          />
        ) : (
          <Card className="space-y-0 overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex gap-3 px-4 py-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      h.txnType === 'IN'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {h.txnType === 'IN' ? (
                      <ArrowDownToLine size={16} />
                    ) : (
                      <ArrowUpFromLine size={16} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-text-primary">
                        {h.txnType === 'IN' ? 'Received' : 'Issued'} {h.quantity} ×{' '}
                        {h.spareName ?? 'Spare'}
                      </span>
                      {h.machineFamily ? (
                        <Badge color="gray">{FAMILY_LABEL[h.machineFamily]}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-text-secondary">
                      {h.txnType === 'IN' ? (
                        <>
                          Supplier: {h.supplierName ?? '—'}
                          {h.invoiceDate
                            ? ` · Invoice ${formatDate(h.invoiceDate)}`
                            : null}
                          {h.invoiceNo ? ` (${h.invoiceNo})` : null}
                        </>
                      ) : (
                        <>To engineer: {h.issuedToName ?? '—'}</>
                      )}
                    </p>
                    {h.notes ? (
                      <p className="mt-0.5 text-xs text-text-secondary">{h.notes}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-text-secondary">
                      {formatDate(h.txnDate)}
                      {h.createdByName ? ` · by ${h.createdByName}` : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      <Drawer
        open={receiveOpen}
        width={560}
        storageKey="nova.drawer.spareStock.receive"
        onClose={closeReceive}
        title={
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Spare parts
            </div>
            <div className="text-lg font-semibold text-text-primary">Receive spare stock</div>
            <p className="mt-0.5 text-sm font-normal text-text-secondary">
              Choose machine type → spare → quantity, supplier, invoice date.
            </p>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeReceive}>
              Cancel
            </Button>
            <Button onClick={() => void saveReceive()} disabled={saving}>
              {saving ? 'Saving…' : 'Add stock'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-5">
          <Select
            label="Machine type *"
            value={recv.machineFamily}
            onChange={(e) =>
              setRecv({
                ...recv,
                machineFamily: e.target.value as Family,
                sparePartId: '',
                spareName: '',
              })
            }
            options={allowedFamilies.map((f) => ({
              value: f,
              label: FAMILY_LABEL[f],
            }))}
          />
          <SearchableSelect
            label="Spare name *"
            value={recv.sparePartId}
            onChange={(sparePartId) => {
              if (sparePartId.startsWith('__new__:')) {
                setRecv({
                  ...recv,
                  sparePartId,
                  spareName: sparePartId.slice('__new__:'.length),
                })
                return
              }
              const found = items.find((i) => i.id === sparePartId)
              setRecv({
                ...recv,
                sparePartId,
                spareName: found?.name ?? '',
              })
            }}
            placeholder="Search spare or type to add…"
            error={errors.spare}
            options={recvSpareOptions}
            emptyText="Type a new spare name below"
          />
          <Input
            label="Or type new spare name"
            value={recv.spareName}
            onChange={(e) => {
              const spareName = e.target.value
              const match = items.find(
                (i) =>
                  i.machineFamily === recv.machineFamily &&
                  i.name.toLowerCase() === spareName.trim().toLowerCase(),
              )
              setRecv({
                ...recv,
                spareName,
                sparePartId: match
                  ? match.id
                  : spareName.trim()
                    ? `__new__:${spareName.trim()}`
                    : '',
              })
            }}
            placeholder="e.g. Battery"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Quantity arrived *"
              type="number"
              min={0}
              step="any"
              value={recv.quantity}
              error={errors.quantity}
              onChange={(e) => setRecv({ ...recv, quantity: e.target.value })}
            />
            <Input
              label="Invoice date *"
              type="date"
              value={recv.invoiceDate}
              error={errors.invoiceDate}
              onChange={(e) => setRecv({ ...recv, invoiceDate: e.target.value })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Supplier name *"
                value={recv.supplierName}
                error={errors.supplierName}
                onChange={(e) => setRecv({ ...recv, supplierName: e.target.value })}
                placeholder="Supplier / vendor"
              />
            </div>
            <Input
              label="Invoice no (optional)"
              value={recv.invoiceNo}
              onChange={(e) => setRecv({ ...recv, invoiceNo: e.target.value })}
            />
            <Input
              label="Notes"
              value={recv.notes}
              onChange={(e) => setRecv({ ...recv, notes: e.target.value })}
            />
          </div>
        </div>
      </Drawer>

      <Drawer
        open={issueOpen}
        width={520}
        storageKey="nova.drawer.spareStock.issue"
        onClose={() => setIssueOpen(false)}
        title={
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Spare parts
            </div>
            <div className="text-lg font-semibold text-text-primary">Issue to service team</div>
            <p className="mt-0.5 text-sm font-normal text-text-secondary">
              Stock is checked before issue and reduced from on-hand.
            </p>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveIssue()} disabled={saving}>
              {saving ? 'Saving…' : 'Issue spare'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-5">
          <Select
            label="Machine type"
            value={iss.machineFamily}
            onChange={(e) =>
              setIss({
                ...iss,
                machineFamily: e.target.value as '' | Family,
                sparePartId: '',
              })
            }
            options={[
              ...(allowedFamilies.length > 1 ? [{ value: '', label: 'All assigned' }] : []),
              ...allowedFamilies.map((f) => ({
                value: f,
                label: FAMILY_LABEL[f],
              })),
            ]}
          />
          <SearchableSelect
            label="Spare name *"
            value={iss.sparePartId}
            onChange={(sparePartId) => setIss({ ...iss, sparePartId })}
            placeholder="Search spare…"
            error={errors.sparePartId}
            options={issueSpareOptions}
          />
          {selectedIssue ? (
            <p className="text-sm text-text-secondary">
              Available: <strong className="text-text-primary">{issueOnHand}</strong>{' '}
              {selectedIssue.unit ?? 'NOS'}
            </p>
          ) : null}
          <Input
            label="Quantity *"
            type="number"
            min={0}
            step="any"
            value={iss.quantity}
            error={errors.quantity}
            onChange={(e) => setIss({ ...iss, quantity: e.target.value })}
          />
          <SearchableSelect
            label="Issue to (optional)"
            value={iss.issuedToUserId}
            onChange={(issuedToUserId) => setIss({ ...iss, issuedToUserId })}
            placeholder={
              engineers.length
                ? 'Engineer — or leave blank to reduce as yourself'
                : 'Leave blank to reduce as yourself'
            }
            error={errors.issuedToUserId}
            options={engineers.map((e) => ({ value: e.id, label: e.name }))}
            emptyText="No matching engineer"
          />
          <Input
            label="Date"
            type="date"
            value={iss.txnDate}
            onChange={(e) => setIss({ ...iss, txnDate: e.target.value })}
          />
          <Input
            label="Notes"
            value={iss.notes}
            onChange={(e) => setIss({ ...iss, notes: e.target.value })}
            placeholder="Ticket / job note"
          />
        </div>
      </Drawer>
    </div>
  )
}

export default SpareStockPage
