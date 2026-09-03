import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Building2,
  ChevronRight,
  Package,
  Plus,
  Stamp,
  Warehouse,
} from 'lucide-react'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { api, ApiClientError, num } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS, assetOriginShort } from '@/lib/assetOrigin'
import { assetRequiresStamping, productRequiresStamping } from '@/lib/productCatalog'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type StockRow = {
  id: string
  serialNo: string
  productId: string
  status: string
  stampingDate?: string | null
  notes?: string | null
  customFields?: Record<string, unknown> | null
  product?: {
    name?: string
    sku?: string
    salePrice?: number
    purchasePrice?: number
    productType?: string
    attributes?: Record<string, unknown> | null
  } | null
  warehouse?: { name?: string; code?: string } | null
  lead?: { name?: string; company?: string; phone?: string } | null
  contact?: { name?: string; customerCode?: string; phone?: string } | null
}

type AssetRow = Record<string, unknown> & {
  id: string
  name: string
  serialNo?: string | null
  stampingDate?: string | null
  nextDueDate?: string | null
  origin?: string
  servicePlan?: string
  machineType?: string
  capacity?: string | null
  model?: string | null
  contactId?: string
  contact?: {
    id?: string
    name?: string
    customerCode?: string
    phone?: string
    city?: string
  } | null
}

type FilterTab = 'ALL' | 'PENDING' | 'STAMPED' | 'DUE_RENEWAL'
type WorkflowTab = 'ALL' | 'STAMPING_DUE' | 'IN_PROGRESS'
type OriginFilter = 'ALL' | 'SOLD_BY_US' | 'THIRD_PARTY'

const RENEWAL_WINDOW_DAYS = 30
const STAMP_VALIDITY_DAYS = 365
const IN_PROGRESS_DAYS = 14

type StampRow = {
  stampingDate?: string | null
  nextDueDate?: string | null
  customFields?: Record<string, unknown> | null
}

function renewalFor(row: StampRow) {
  if (row.nextDueDate) return String(row.nextDueDate).slice(0, 10)
  return renewalDueFromStamp(row.stampingDate)
}

/** Never stamped, or renewal / re-stamp window (≤30 days) */
function isStampingDue(row: StampRow) {
  const stamp = row.stampingDate ? String(row.stampingDate).slice(0, 10) : null
  if (!stamp) return true
  const renewal = renewalFor(row)
  const days = daysUntil(renewal)
  return days != null && days <= RENEWAL_WINDOW_DAYS
}

/** Stamped recently (govt visit in progress) or valid stamp not yet due for renewal */
function isStampingInProgress(row: StampRow) {
  const stamp = row.stampingDate ? String(row.stampingDate).slice(0, 10) : null
  if (!stamp) return false
  const stampDays = daysUntil(stamp)
  const recentlyStamped = stampDays != null && stampDays >= -IN_PROGRESS_DAYS
  const renewal = renewalFor(row)
  const renewalDays = daysUntil(renewal)
  const validNotDue = renewalDays != null && renewalDays > RENEWAL_WINDOW_DAYS
  return recentlyStamped || validNotDue
}

function workflowFilter(row: StampRow, tab: WorkflowTab) {
  if (tab === 'STAMPING_DUE') return isStampingDue(row)
  if (tab === 'IN_PROGRESS') return isStampingInProgress(row) && !isStampingDue(row)
  return true
}

function daysUntil(dateStr?: string | null) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function renewalDueFromStamp(stampingDate?: string | null) {
  if (!stampingDate) return null
  const d = new Date(String(stampingDate).slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + STAMP_VALIDITY_DAYS)
  return d.toISOString().slice(0, 10)
}

function stampFilter(row: StampRow, filter: FilterTab) {
  const stamp = row.stampingDate ? String(row.stampingDate).slice(0, 10) : null
  if (filter === 'PENDING') return !stamp
  if (filter === 'STAMPED') return Boolean(stamp)
  if (filter === 'DUE_RENEWAL') {
    const renewal = renewalFor(row)
    const days = daysUntil(renewal)
    return days != null && days <= RENEWAL_WINDOW_DAYS
  }
  return true
}

function addOneYear(dateStr: string) {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function attrLine(attrs?: Record<string, unknown> | null) {
  if (!attrs || typeof attrs !== 'object') return ''
  const machineType = String(attrs.machineType ?? attrs.type ?? '')
  const capacity = String(attrs.capacity ?? '')
  return [machineType, capacity].filter(Boolean).join(' · ')
}

export function StampingPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [searchParams, setSearchParams] = useSearchParams()
  const [mainTab, setMainTab] = useState<'warehouse' | 'customer'>('warehouse')
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('ALL')
  const [filter, setFilter] = useState<FilterTab>('ALL')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL')
  const [search, setSearch] = useState('')
  const [units, setUnits] = useState<StockRow[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; sku: string; attributes?: Record<string, unknown> | null }>>([])
  const [loading, setLoading] = useState(true)

  const [detailUnit, setDetailUnit] = useState<StockRow | null>(null)
  const [detailAsset, setDetailAsset] = useState<AssetRow | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createKind, setCreateKind] = useState<'warehouse' | 'customer'>('warehouse')
  const [createProductId, setCreateProductId] = useState('')
  const [createUnitId, setCreateUnitId] = useState('')
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [createAssetId, setCreateAssetId] = useState('')
  const [newMachine, setNewMachine] = useState(false)
  const [machineForm, setMachineForm] = useState({
    name: '',
    serialNo: '',
    origin: 'THIRD_PARTY',
    machineType: 'WEIGHING',
    conditionOk: true,
    conditionNotes: '',
  })
  const [customerAssets, setCustomerAssets] = useState<AssetRow[]>([])
  const [stampDate, setStampDate] = useState(new Date().toISOString().slice(0, 10))
  const [stampNotes, setStampNotes] = useState('')
  const [nextDue, setNextDue] = useState(addOneYear(new Date().toISOString().slice(0, 10)))
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [unitRes, assetRes, productPage] = await Promise.all([
        api.stockUnits({ limit: 500 }),
        api.assets({ limit: 500 }),
        api.products({ limit: 500 }),
      ])
      setUnits((unitRes as StockRow[]) ?? [])
      setAssets((assetRes.items ?? []) as AssetRow[])
      setProducts(
        (productPage.items ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name ?? ''),
          sku: String(p.sku ?? ''),
          attributes: (p.attributes as Record<string, unknown> | null) ?? null,
        })),
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load stamping register',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unitId = searchParams.get('unitId')
    if (!unitId || loading) return
    const u = units.find((x) => x.id === unitId)
    if (u) {
      setMainTab('warehouse')
      setDetailUnit(u)
      setDetailAsset(null)
      setStampDate(new Date().toISOString().slice(0, 10))
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, units, loading, setSearchParams])

  const stampingUnits = useMemo(
    () => units.filter((u) => (u.product ? productRequiresStamping(u.product) : true)),
    [units],
  )

  const stampingAssets = useMemo(
    () => assets.filter((a) => assetRequiresStamping({ machineType: a.machineType })),
    [assets],
  )

  const stampingProducts = useMemo(
    () => products.filter((p) => productRequiresStamping(p)),
    [products],
  )

  const productOptions = useMemo(
    () => stampingProducts.map((p) => ({ value: p.id, label: p.name, sublabel: p.sku })),
    [stampingProducts],
  )

  const serialOptions = useMemo(() => {
    return stampingUnits
      .filter((u) => !createProductId || u.productId === createProductId)
      .map((u) => ({
        value: u.id,
        label: `${u.serialNo} · ${u.product?.name ?? 'Product'}${u.stampingDate ? ` · stamped ${formatDate(String(u.stampingDate))}` : ' · pending'}`,
        sublabel: u.warehouse?.name ?? '',
      }))
  }, [stampingUnits, createProductId])

  const workflowCounts = useMemo(() => {
    const rows = [...stampingUnits, ...stampingAssets]
    return {
      due: rows.filter((r) => isStampingDue(r)).length,
      inProgress: rows.filter((r) => isStampingInProgress(r) && !isStampingDue(r)).length,
    }
  }, [stampingAssets, stampingUnits])

  const counts = useMemo(() => {
    const rows = mainTab === 'warehouse' ? stampingUnits : stampingAssets
    return {
      pending: rows.filter((r) => stampFilter(r, 'PENDING')).length,
      stamped: rows.filter((r) => stampFilter(r, 'STAMPED')).length,
      due: rows.filter((r) => stampFilter(r, 'DUE_RENEWAL')).length,
    }
  }, [stampingAssets, mainTab, stampingUnits])

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stampingUnits.filter((u) => {
      if (!workflowFilter(u, workflowTab)) return false
      if (!stampFilter(u, filter)) return false
      if (!q) return true
      const hay = `${u.serialNo} ${u.product?.name ?? ''} ${u.product?.sku ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [stampingUnits, filter, search, workflowTab])

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stampingAssets.filter((a) => {
      if (!workflowFilter(a, workflowTab)) return false
      if (!stampFilter(a, filter)) return false
      if (originFilter === 'SOLD_BY_US' && a.origin !== 'SOLD_BY_US') return false
      if (originFilter === 'THIRD_PARTY' && a.origin !== 'THIRD_PARTY') return false
      if (!q) return true
      const c = a.contact as { name?: string } | undefined
      const hay = `${a.name} ${a.serialNo ?? ''} ${c?.name ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [stampingAssets, filter, originFilter, search, workflowTab])

  function openCreate(kind: 'warehouse' | 'customer') {
    setCreateKind(kind)
    setCreateProductId(stampingProducts[0]?.id ?? '')
    setCreateUnitId('')
    setPickedContact(null)
    setCreateAssetId('')
    setNewMachine(kind === 'customer')
    setMachineForm({
      name: '',
      serialNo: '',
      origin: 'THIRD_PARTY',
      machineType: 'WEIGHING',
      conditionOk: true,
      conditionNotes: '',
    })
    setStampDate(new Date().toISOString().slice(0, 10))
    setStampNotes('')
    setNextDue(addOneYear(new Date().toISOString().slice(0, 10)))
    setCreateOpen(true)
  }

  async function loadCustomerAssets(contactId: string) {
    if (!contactId) {
      setCustomerAssets([])
      return
    }
    try {
      const res = await api.assets({ contactId, limit: 100 })
      setCustomerAssets((res.items ?? []) as AssetRow[])
    } catch {
      setCustomerAssets([])
    }
  }

  async function saveNewStamping() {
    if (!stampDate) {
      addToast({ type: 'error', message: 'Stamping date is required' })
      return
    }
    setSaving(true)
    try {
      if (createKind === 'warehouse') {
        if (!createUnitId) {
          addToast({ type: 'error', message: 'Select product and serial number' })
          setSaving(false)
          return
        }
        await api.stampStockUnit(createUnitId, stampDate, stampNotes.trim() || undefined)
      } else {
        if (!pickedContact?.id) {
          addToast({ type: 'error', message: 'Select the outside / customer shop' })
          setSaving(false)
          return
        }
        if (!machineForm.conditionOk) {
          addToast({ type: 'error', message: 'Confirm machine condition before stamping outside units' })
          setSaving(false)
          return
        }
        let assetId = createAssetId
        if (newMachine || !assetId) {
          if (!machineForm.name.trim()) {
            addToast({ type: 'error', message: 'Enter machine name for outside customer' })
            setSaving(false)
            return
          }
          const created = await api.createAsset({
            contactId: pickedContact.id,
            name: machineForm.name.trim(),
            serialNo: machineForm.serialNo.trim() || null,
            origin: machineForm.origin,
            machineType: machineForm.machineType,
            stampingDate: stampDate,
            nextDueDate: nextDue || addOneYear(stampDate),
            notes: machineForm.conditionNotes.trim() || null,
            customFields: {
              stampingConditionOk: machineForm.conditionOk,
              stampingConditionNotes: machineForm.conditionNotes.trim() || null,
            },
          })
          assetId = String(created.id)
        } else {
          await api.updateAsset(assetId, {
            stampingDate: stampDate,
            nextDueDate: nextDue || addOneYear(stampDate),
            customFields: {
              stampingConditionOk: machineForm.conditionOk,
              stampingConditionNotes: machineForm.conditionNotes.trim() || null,
            },
          })
        }
      }
      addToast({ type: 'success', message: 'Stamping recorded' })
      setCreateOpen(false)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save stamping',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveDetailStamp() {
    if (!stampDate) return
    setSaving(true)
    try {
      if (detailUnit) {
        await api.stampStockUnit(detailUnit.id, stampDate, stampNotes.trim() || undefined)
        setDetailUnit(null)
      } else if (detailAsset) {
        await api.updateAsset(String(detailAsset.id), {
          stampingDate: stampDate,
          nextDueDate: nextDue || addOneYear(stampDate),
        })
        setDetailAsset(null)
      }
      addToast({ type: 'success', message: 'Stamping updated' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save',
      })
    } finally {
      setSaving(false)
    }
  }

  function openDetailUnit(u: StockRow) {
    setDetailAsset(null)
    setDetailUnit(u)
    setStampDate(u.stampingDate ? String(u.stampingDate).slice(0, 10) : new Date().toISOString().slice(0, 10))
    setStampNotes('')
    setNextDue('')
  }

  function openDetailAsset(a: AssetRow) {
    setDetailUnit(null)
    setDetailAsset(a)
    const stamp = a.stampingDate ? String(a.stampingDate).slice(0, 10) : ''
    setStampDate(stamp || new Date().toISOString().slice(0, 10))
    setStampNotes('')
    setNextDue(
      a.nextDueDate
        ? String(a.nextDueDate).slice(0, 10)
        : stamp
          ? addOneYear(stamp)
          : addOneYear(new Date().toISOString().slice(0, 10)),
    )
  }

  const detailOpen = Boolean(detailUnit || detailAsset)

  return (
    <div>
      <PageHeader
        title="Stamping"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Stamping' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openCreate(mainTab === 'warehouse' ? 'warehouse' : 'customer')}>
              <Plus size={16} /> New stamping
            </Button>
            <Link to="/erp/inventory">
              <Button variant="outline">
                <Package size={16} /> Inventory
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <p className="text-sm text-text-secondary">
          Record govt verification as <strong>product → serial → stamping date</strong>.{' '}
          <strong>Warehouse serials</strong> are units you sell from stock.{' '}
          <strong>Customer machines</strong> include outside / repair machines brought only for stamping
          service — confirm condition before stamping.
        </p>
      </Card>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { label: 'Stamping due', value: workflowCounts.due, hint: 'Needs stamp or renewal' },
          { label: 'In progress', value: workflowCounts.inProgress, hint: 'Recently stamped / valid' },
          { label: 'Pending (segment)', value: counts.pending },
        ].map((c) => (
          <div
            key={c.label}
            className="flex min-w-[110px] flex-1 items-baseline gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <span className="text-[11px] font-medium uppercase text-text-secondary">{c.label}</span>
            <span className="ml-auto text-sm font-semibold tabular-nums">{c.value}</span>
          </div>
        ))}
      </div>

      <PageTabs
        accent="amber"
        active={workflowTab}
        onChange={(id) => setWorkflowTab(id as WorkflowTab)}
        tabs={[
          { id: 'ALL', label: 'All register', count: units.length + assets.length },
          { id: 'STAMPING_DUE', label: 'Stamping due', count: workflowCounts.due },
          { id: 'IN_PROGRESS', label: 'Stamping in progress', count: workflowCounts.inProgress },
        ]}
      />

      <PageTabs
        accent="violet"
        active={mainTab}
        onChange={(id) => setMainTab(id as 'warehouse' | 'customer')}
        className="mt-3"
        tabs={[
          { id: 'warehouse', label: 'Warehouse serials', count: units.length },
          { id: 'customer', label: 'Customer machines', count: assets.length },
        ]}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          className="min-w-[200px] flex-1"
          placeholder="Search product, serial, customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="w-44"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterTab)}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'PENDING', label: 'Pending stamp' },
            { value: 'STAMPED', label: 'Stamped' },
            { value: 'DUE_RENEWAL', label: 'Renewal due' },
          ]}
        />
        {mainTab === 'customer' ? (
          <Select
            className="w-44"
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
            options={[
              { value: 'ALL', label: 'All origins' },
              { value: 'SOLD_BY_US', label: 'Sold by us' },
              { value: 'THIRD_PARTY', label: 'Outside / repair' },
            ]}
          />
        ) : null}
      </div>

      <Card padding={false}>
        {loading ? (
          <p className="p-6 text-sm text-text-secondary">Loading…</p>
        ) : mainTab === 'warehouse' ? (
          filteredUnits.length === 0 ? (
            <EmptyState
              icon={<Stamp size={22} />}
              title="No warehouse serials"
              subtitle="Add stock in Inventory, then use New stamping to record verification."
              actionLabel="New stamping"
              onAction={() => openCreate('warehouse')}
            />
          ) : (
            <div className="divide-y divide-border">
              {filteredUnits.map((u) => {
                const renewal = renewalDueFromStamp(u.stampingDate)
                const renewalDays = daysUntil(renewal)
                return (
                  <button
                    key={u.id}
                    type="button"
                    className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-muted/40"
                    onClick={() => openDetailUnit(u)}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                      <Warehouse size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-text-primary">{u.product?.name ?? 'Product'}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                        <span className="font-mono font-medium text-text-primary">{u.serialNo}</span>
                        <span>{u.product?.sku}</span>
                        <span>{u.warehouse?.name}</span>
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      {u.stampingDate ? (
                        <div className="text-sm font-medium">{formatDate(String(u.stampingDate))}</div>
                      ) : (
                        <Badge color="amber">Pending stamp</Badge>
                      )}
                      {renewal ? (
                        <div className="mt-0.5 text-xs text-text-secondary">
                          Renewal {formatDate(renewal)}
                          {renewalDays != null && renewalDays <= 30 ? ` · ${renewalDays}d` : ''}
                        </div>
                      ) : null}
                    </div>
                    <Badge color={u.status === 'IN_STOCK' ? 'green' : u.status === 'DEMO' ? 'amber' : 'blue'}>
                      {u.status.replace('_', ' ')}
                    </Badge>
                    {isStampingDue(u) ? (
                      <Badge color="red">Due</Badge>
                    ) : isStampingInProgress(u) ? (
                      <Badge color="blue">In progress</Badge>
                    ) : null}
                    <ChevronRight size={16} className="shrink-0 text-text-secondary" />
                  </button>
                )
              })}
            </div>
          )
        ) : filteredAssets.length === 0 ? (
          <EmptyState
            icon={<Building2 size={22} />}
            title="No customer machines"
            subtitle="Use New stamping for outside customers or add machines on customer profiles."
            actionLabel="New stamping"
            onAction={() => openCreate('customer')}
          />
        ) : (
          <div className="divide-y divide-border">
            {filteredAssets.map((a) => {
              const c = a.contact as AssetRow['contact']
              const renewal = a.nextDueDate
                ? String(a.nextDueDate).slice(0, 10)
                : renewalDueFromStamp(a.stampingDate ? String(a.stampingDate) : null)
              return (
                <button
                  key={String(a.id)}
                  type="button"
                  className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-muted/40"
                  onClick={() => openDetailAsset(a)}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-text-primary">{String(a.name)}</div>
                    <div className="mt-0.5 text-xs text-text-secondary">
                      {c?.customerCode ? `${c.customerCode} · ` : ''}{c?.name ?? '—'}
                      {a.serialNo ? ` · ${String(a.serialNo)}` : ''}
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    {a.stampingDate ? (
                      <div className="text-sm font-medium">{formatDate(String(a.stampingDate))}</div>
                    ) : (
                      <Badge color="amber">Pending</Badge>
                    )}
                    {renewal ? (
                      <div className="mt-0.5 text-xs text-text-secondary">Due {formatDate(renewal)}</div>
                    ) : null}
                  </div>
                  <Badge color={a.origin === 'THIRD_PARTY' ? 'amber' : 'blue'}>
                    {assetOriginShort(a.origin ? String(a.origin) : null)}
                  </Badge>
                  {isStampingDue(a) ? (
                    <Badge color="red">Due</Badge>
                  ) : isStampingInProgress(a) ? (
                    <Badge color="blue">In progress</Badge>
                  ) : null}
                  <ChevronRight size={16} className="shrink-0 text-text-secondary" />
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Create stamping */}
      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New government stamping"
        subtitle={
          createKind === 'warehouse'
            ? 'Our stock — pick product and serial from warehouse'
            : 'Customer machine — sold by us or outside repair'
        }
        accent="violet"
        size="lg"
        footer={
          <>
            <Button variant="outline" disabled={saving} onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={saving} onClick={() => void saveNewStamping()}>
              {saving ? 'Saving…' : 'Save stamping'}
            </Button>
          </>
        }
      >
        <div className="mb-4 flex gap-2">
          <Button
            size="sm"
            variant={createKind === 'warehouse' ? 'primary' : 'outline'}
            onClick={() => setCreateKind('warehouse')}
          >
            Warehouse serial
          </Button>
          <Button
            size="sm"
            variant={createKind === 'customer' ? 'primary' : 'outline'}
            onClick={() => setCreateKind('customer')}
          >
            Customer machine
          </Button>
        </div>

        {createKind === 'warehouse' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SearchableSelect
              className="sm:col-span-2"
              label="Product *"
              value={createProductId}
              options={productOptions}
              onChange={(v) => {
                setCreateProductId(v)
                setCreateUnitId('')
              }}
              placeholder="Search product…"
            />
            <SearchableSelect
              className="sm:col-span-2"
              label="Serial number *"
              value={createUnitId}
              options={serialOptions}
              onChange={setCreateUnitId}
              placeholder="Pick serial from stock…"
              emptyText="No serials for this product — add stock first"
            />
          </div>
        ) : (
          <div className="space-y-4">
            <ContactPicker
              label="Customer / shop *"
              valueId={pickedContact?.id ?? ''}
              selected={pickedContact}
              returnTo="/stamping"
              onSelect={(c) => {
                setPickedContact(c)
                setCreateAssetId('')
                if (c?.id) void loadCustomerAssets(c.id)
              }}
            />
            <Select
              label="Machine origin"
              value={machineForm.origin}
              onChange={(e) => setMachineForm({ ...machineForm, origin: e.target.value })}
              options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            {pickedContact?.id && customerAssets.length > 0 && !newMachine ? (
              <Select
                label="Existing machine"
                value={createAssetId}
                onChange={(e) => setCreateAssetId(e.target.value)}
                options={[
                  { value: '', label: 'Select machine' },
                  ...customerAssets.map((a) => ({
                    value: String(a.id),
                    label: `${String(a.name)}${a.serialNo ? ` · ${String(a.serialNo)}` : ''}`,
                  })),
                ]}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newMachine} onChange={(e) => setNewMachine(e.target.checked)} />
              New machine entry (typical for outside customers)
            </label>
            {newMachine || !createAssetId ? (
              <>
                <Input
                  label="Machine name *"
                  value={machineForm.name}
                  onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
                  placeholder="Platform scale 20kg"
                />
                <Input
                  label="Serial number"
                  value={machineForm.serialNo}
                  onChange={(e) => setMachineForm({ ...machineForm, serialNo: e.target.value })}
                />
              </>
            ) : null}
            {machineForm.origin === 'THIRD_PARTY' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={machineForm.conditionOk}
                    onChange={(e) => setMachineForm({ ...machineForm, conditionOk: e.target.checked })}
                  />
                  Machine condition OK for stamping service
                </label>
                <Input
                  label="Condition notes"
                  value={machineForm.conditionNotes}
                  onChange={(e) => setMachineForm({ ...machineForm, conditionNotes: e.target.value })}
                  placeholder="Visible damage, missing parts…"
                />
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 border-t border-border pt-4">
          <Input
            label="Stamping date *"
            type="date"
            value={stampDate}
            onChange={(e) => {
              setStampDate(e.target.value)
              setNextDue(addOneYear(e.target.value))
            }}
          />
          {createKind === 'customer' ? (
            <Input label="Next due date" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          ) : null}
          <Input
            className="sm:col-span-2"
            label="Govt / certificate notes"
            value={stampNotes}
            onChange={(e) => setStampNotes(e.target.value)}
            placeholder="Office, certificate number, inspector…"
          />
        </div>
      </Modal>

      {/* Detail drawer */}
      <Drawer
        open={detailOpen}
        onClose={() => {
          setDetailUnit(null)
          setDetailAsset(null)
        }}
        width={560}
        title={
          detailUnit
            ? (
              <div>
                <div className="text-lg font-semibold">{detailUnit.product?.name ?? 'Warehouse serial'}</div>
                <div className="font-mono text-sm text-text-secondary">{detailUnit.serialNo}</div>
              </div>
            )
            : detailAsset
              ? (
                <div>
                  <div className="text-lg font-semibold">{String(detailAsset.name)}</div>
                  <div className="text-sm text-text-secondary">
                    {(detailAsset.contact as { name?: string })?.name ?? 'Customer machine'}
                  </div>
                </div>
              )
              : null
        }
        footer={
          <div className="flex gap-2">
            <Button className="flex-1" disabled={saving} onClick={() => void saveDetailStamp()}>
              {saving ? 'Saving…' : 'Save stamping'}
            </Button>
          </div>
        }
      >
        {detailUnit ? (
          <div className="space-y-4 px-5 pb-6">
            <section className="rounded-xl border border-border bg-muted/30 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Product</h3>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-text-secondary">Name</dt><dd className="font-medium">{detailUnit.product?.name ?? '—'}</dd></div>
                <div><dt className="text-text-secondary">SKU</dt><dd className="font-mono">{detailUnit.product?.sku ?? '—'}</dd></div>
                <div><dt className="text-text-secondary">Sale price</dt><dd>{detailUnit.product?.salePrice != null ? formatCurrency(num(detailUnit.product.salePrice)) : '—'}</dd></div>
                <div><dt className="text-text-secondary">Specs</dt><dd>{attrLine(detailUnit.product?.attributes as Record<string, unknown>) || '—'}</dd></div>
              </dl>
            </section>
            <section className="rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Serial & warehouse</h3>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-text-secondary">Serial</dt><dd className="font-mono font-semibold">{detailUnit.serialNo}</dd></div>
                <div><dt className="text-text-secondary">Status</dt><dd><Badge>{detailUnit.status.replace('_', ' ')}</Badge></dd></div>
                <div><dt className="text-text-secondary">Warehouse</dt><dd>{detailUnit.warehouse?.name ?? '—'}</dd></div>
                {detailUnit.lead || detailUnit.contact ? (
                  <div className="sm:col-span-2">
                    <dt className="text-text-secondary">With customer / lead</dt>
                    <dd>{detailUnit.contact?.name ?? detailUnit.lead?.name ?? '—'}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-800">Stamping</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input label="Stamping date *" type="date" value={stampDate} onChange={(e) => setStampDate(e.target.value)} />
                <Input label="Notes" value={stampNotes} onChange={(e) => setStampNotes(e.target.value)} />
              </div>
              {detailUnit.customFields?.previousStampingDate ? (
                <p className="mt-2 text-xs text-text-secondary">
                  Previous stamp: {formatDate(String(detailUnit.customFields.previousStampingDate))}
                </p>
              ) : null}
            </section>
            <Link to="/erp/inventory" className="text-sm font-medium text-accent-blue hover:underline">
              Open in inventory →
            </Link>
          </div>
        ) : null}
        {detailAsset ? (
          <div className="space-y-4 px-5 pb-6">
            <section className="rounded-xl border border-border bg-muted/30 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Customer</h3>
              <dl className="mt-2 grid gap-2 text-sm">
                <div><dt className="text-text-secondary">Shop</dt><dd className="font-medium">{(detailAsset.contact as { name?: string })?.name ?? '—'}</dd></div>
                <div><dt className="text-text-secondary">Phone</dt><dd>{(detailAsset.contact as { phone?: string })?.phone ? formatPhone(String((detailAsset.contact as { phone: string }).phone)) : '—'}</dd></div>
                <div><dt className="text-text-secondary">Origin</dt><dd>{assetOriginShort(detailAsset.origin ? String(detailAsset.origin) : null)}</dd></div>
              </dl>
              {(detailAsset.contact as { id?: string })?.id ? (
                <Link
                  to={`/contacts/${(detailAsset.contact as { id: string }).id}`}
                  className="mt-2 text-sm font-medium text-accent-blue hover:underline"
                >
                  Open customer profile →
                </Link>
              ) : null}
            </section>
            <section className="rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Machine</h3>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-text-secondary">Name</dt><dd className="font-medium">{String(detailAsset.name)}</dd></div>
                <div><dt className="text-text-secondary">Serial</dt><dd className="font-mono">{detailAsset.serialNo ? String(detailAsset.serialNo) : '—'}</dd></div>
                <div><dt className="text-text-secondary">Type</dt><dd>{detailAsset.machineType ? String(detailAsset.machineType) : '—'}</dd></div>
                <div><dt className="text-text-secondary">AMC</dt><dd>{detailAsset.servicePlan === 'AMC' ? 'AMC' : 'Non-AMC'}</dd></div>
              </dl>
            </section>
            <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-800">Stamping schedule</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input label="Stamping date *" type="date" value={stampDate} onChange={(e) => {
                  setStampDate(e.target.value)
                  setNextDue(addOneYear(e.target.value))
                }} />
                <Input label="Next due *" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}

export default StampingPage
