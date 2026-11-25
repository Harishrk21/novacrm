import { useCallback, useEffect, useMemo, useState } from 'react'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { usePagedRows } from '@/hooks/usePagedRows'
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
import {
  STAMP_QUARTERS,
  stampQuarterFromDate,
  stampQuarterLabel,
  stampQuarterOf,
  type StampQuarter,
} from '@/lib/hmsCoverage'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { TableSkeleton } from '@/components/ui/Skeleton'

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

/** One status per machine — the only filter that matters on this page. */
type StampStatus = 'NOT_STAMPED' | 'OVERDUE' | 'DUE_SOON' | 'VALID'
type StatusFilter = 'ALL' | StampStatus | 'JOB_OPEN'
type OriginFilter = 'ALL' | 'SOLD_BY_US' | 'THIRD_PARTY'
type OpenJob = { id: string; ticketNo: number; status: string }

const RENEWAL_WINDOW_DAYS = 30
const STAMP_VALIDITY_DAYS = 365

type StampRow = {
  stampingDate?: string | null
  nextDueDate?: string | null
  customFields?: Record<string, unknown> | null
}

function renewalFor(row: StampRow) {
  if (row.nextDueDate) return String(row.nextDueDate).slice(0, 10)
  return renewalDueFromStamp(row.stampingDate)
}

function stampStatusOf(row: StampRow): { key: StampStatus; label: string; color: 'amber' | 'red' | 'orange' | 'green' } {
  // Valid-till decides when known (imported machines often have only that date)
  const renewal = renewalFor(row)
  if (!renewal) return { key: 'NOT_STAMPED', label: 'Not stamped', color: 'amber' }
  const days = daysUntil(renewal)
  if (days != null && days < 0) return { key: 'OVERDUE', label: `Overdue ${-days}d`, color: 'red' }
  if (days != null && days <= RENEWAL_WINDOW_DAYS)
    return { key: 'DUE_SOON', label: days === 0 ? 'Due today' : `Due in ${days}d`, color: 'orange' }
  return { key: 'VALID', label: 'Valid', color: 'green' }
}

/** Needs a stamping visit (never stamped, overdue or due within 30 days) */
function needsStamping(row: StampRow) {
  return stampStatusOf(row).key !== 'VALID'
}

const STATUS_CHIPS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'DUE_SOON', label: 'Due ≤30 days' },
  { id: 'NOT_STAMPED', label: 'Not stamped' },
  { id: 'VALID', label: 'Valid' },
  { id: 'JOB_OPEN', label: 'Job open' },
]

/** Pages through a list endpoint (the API caps a page at 200 rows). */
async function fetchAllAssets(): Promise<AssetRow[]> {
  const out: AssetRow[] = []
  for (let page = 1; page <= 50; page++) {
    const res = await api.assets({ limit: 200, page })
    out.push(...((res.items ?? []) as AssetRow[]))
    const pages = Number(res.meta && 'pages' in res.meta ? (res.meta as { pages?: number }).pages : 1) || 1
    if (page >= pages || (res.items ?? []).length < 200) break
  }
  return out
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
  const [mainTab, setMainTab] = useState<'warehouse' | 'customer'>('customer')
  const [filter, setFilter] = useState<StatusFilter>('ALL')
  /** Open stamping jobs by machine id — avoids a second job for the same machine */
  const [openJobs, setOpenJobs] = useState<Record<string, OpenJob>>({})
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL')
  const [quarterFilter, setQuarterFilter] = useState<StampQuarter | ''>('')
  const [search, setSearch] = useState('')
  const currentQuarter = stampQuarterFromDate(new Date())
  const currentQuarterYear = new Date().getFullYear()
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

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    // Open stamping jobs load on their own (slowest call) — the register shows without waiting
    void api
      .tickets({ status: 'OPEN,IN_PROGRESS,PENDING,RESOLVED', limit: 200 })
      .then((ticketPage) => {
        const jobs: Record<string, OpenJob> = {}
        for (const t of ticketPage.items ?? []) {
          const cf = (t.customFields ?? {}) as Record<string, unknown>
          const stamping =
            cf.category === 'Stamping' || cf.workType === 'Stamping' || cf.visitPurpose === 'STAMPING'
          if (stamping && t.assetId) {
            jobs[String(t.assetId)] = { id: String(t.id), ticketNo: Number(t.ticketNo), status: String(t.status) }
          }
        }
        setOpenJobs(jobs)
      })
      .catch(() => undefined)
    try {
      const [unitRes, assetRows, productPage] = await Promise.all([
        api.stockUnitsAll({ lite: 1 }),
        fetchAllAssets(),
        api.products({ limit: 500, includeInactive: 1 }),
      ])
      // Sold units live on as customer machines — only our own stock here
      setUnits(((unitRes as StockRow[]) ?? []).filter((u) => u.status !== 'SOLD'))
      // Machines whose customer was removed are not on the register
      setAssets(assetRows.filter((a) => a.contact))
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
      if (!silent) setLoading(false)
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

  const segmentRows = mainTab === 'warehouse' ? stampingUnits : stampingAssets
  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: 0, NOT_STAMPED: 0, OVERDUE: 0, DUE_SOON: 0, VALID: 0, JOB_OPEN: 0 }
    for (const r of segmentRows) {
      c.ALL++
      c[stampStatusOf(r).key]++
      if (mainTab === 'customer' && openJobs[String((r as AssetRow).id)]) c.JOB_OPEN++
    }
    return c
  }, [segmentRows, mainTab, openJobs])

  function statusMatch(r: StampRow & { id?: string }) {
    if (filter === 'ALL') return true
    if (filter === 'JOB_OPEN') return Boolean(r.id && openJobs[String(r.id)])
    return stampStatusOf(r).key === filter
  }

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stampingUnits.filter((u) => {
      if (!statusMatch(u)) return false
      if (quarterFilter && stampQuarterOf(u).code !== quarterFilter) return false
      if (!q) return true
      const hay = `${u.serialNo} ${u.product?.name ?? ''} ${u.product?.sku ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusMatch reads filter + openJobs
  }, [stampingUnits, filter, search, quarterFilter, openJobs])

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stampingAssets.filter((a) => {
      if (!statusMatch(a)) return false
      if (originFilter === 'SOLD_BY_US' && a.origin !== 'SOLD_BY_US') return false
      if (originFilter === 'THIRD_PARTY' && a.origin !== 'THIRD_PARTY') return false
      if (quarterFilter && stampQuarterOf(a).code !== quarterFilter) return false
      if (!q) return true
      const c = a.contact as { name?: string } | undefined
      const hay = `${a.name} ${a.serialNo ?? ''} ${c?.name ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusMatch reads filter + openJobs
  }, [stampingAssets, filter, originFilter, search, quarterFilter, openJobs])

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

  /** Same rules as the server: not in the future, valid till after the stamp date */
  function stampDatesError(stamp: string, due: string) {
    if (stamp > new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10)) return "Stamping date can't be in the future"
    if (due && due <= stamp) return 'Next due must be after the stamping date'
    return null
  }

  async function saveNewStamping() {
    if (!stampDate) {
      addToast({ type: 'error', message: 'Stamping date is required' })
      return
    }
    const dateErr = stampDatesError(stampDate, nextDue)
    if (dateErr) {
      addToast({ type: 'error', message: dateErr })
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
          // Merge — never wipe the machine's other details (catalog, tags, VC no.…)
          const prevCf =
            (customerAssets.find((x) => String(x.id) === assetId)?.customFields as Record<string, unknown> | undefined) ?? {}
          await api.updateAsset(assetId, {
            stampingDate: stampDate,
            nextDueDate: nextDue || addOneYear(stampDate),
            customFields: {
              ...prevCf,
              stampingConditionOk: machineForm.conditionOk,
              stampingConditionNotes: machineForm.conditionNotes.trim() || null,
            },
          })
        }
      }
      addToast({ type: 'success', message: 'Stamping recorded' })
      setCreateOpen(false)
      await load({ silent: true })
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
    const dateErr = stampDatesError(stampDate, detailAsset ? nextDue : '')
    if (dateErr) {
      addToast({ type: 'error', message: dateErr })
      return
    }
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
      await load({ silent: true })
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

  // filteredAssets can grow large — 25 rows a page
  const pagedAssets = usePagedRows(filteredAssets, filteredAssets.length)
  // filteredUnits can grow large — 25 rows a page
  const pagedUnits = usePagedRows(filteredUnits, filteredUnits.length)
  return (
    <div>
      <PageHeader
        title="Stamping"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Stamping' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/tickets?open=1&job=stamping&category=Stamping">
              <Button>
                <Plus size={16} /> New stamping job
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => openCreate(mainTab === 'warehouse' ? 'warehouse' : 'customer')}
            >
              Record dates only
            </Button>
            {/* Finished stamping jobs live in the service list — opened pre-filtered */}
            <Link to="/tickets?queue=closed&type=Stamping">
              <Button variant="outline">Completed jobs</Button>
            </Link>
            <Link to="/erp/inventory">
              <Button variant="outline">
                <Package size={16} /> Inventory
              </Button>
            </Link>
          </div>
        }
      />

      <details className="group mb-4 rounded-xl border border-violet-200/80 bg-violet-50/50 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-950/20">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold text-text-primary">
            Now: {stampQuarterLabel(currentQuarter, currentQuarterYear)}
          </span>
          <span className="text-text-secondary">· How stamping works</span>
          <ChevronRight size={14} className="text-text-secondary transition group-open:rotate-90" />
        </summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-text-secondary">
          <li>
            Machine due? Click <strong>Start stamping job</strong> on its row (or <strong>New stamping job</strong>{' '}
            for a walk-in). Customer + machine are picked; no dates yet.
          </li>
          <li>
            Desk <strong>Takes &amp; starts</strong> the job, or an engineer Accepts it.
          </li>
          <li>
            After verification: on the job, enter <strong>stamp date</strong> + <strong>valid till</strong> (+1 year by
            default), VC number, plate → <strong>Save stamp result</strong>. The machine register updates here.
          </li>
          <li>Collect payment → Mark complete → Approve &amp; close.</li>
        </ol>
        <p className="mt-2 text-xs text-text-secondary">
          Quarters: A Jan–Mar · B Apr–Jun · C Jul–Sep · D Oct–Dec. Reminders go out at the start of the quarter and
          ~1 week before each due date. Use <strong>Record dates only</strong> just to correct the register (no visit).
        </p>
      </details>

      <PageTabs
        accent="violet"
        active={mainTab}
        onChange={(id) => {
          setMainTab(id as 'warehouse' | 'customer')
          setFilter('ALL')
        }}
        tabs={[
          { id: 'customer', label: 'Customer machines', count: stampingAssets.length },
          { id: 'warehouse', label: 'Our stock (warehouse)', count: stampingUnits.length },
        ]}
      />

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Stamping status">
        {STATUS_CHIPS.filter((c) => c.id !== 'JOB_OPEN' || mainTab === 'customer').map((c) => {
          const active = filter === c.id
          const n = statusCounts[c.id]
          const tone =
            c.id === 'OVERDUE' && n > 0
              ? 'text-red-700 dark:text-red-300'
              : c.id === 'DUE_SOON' && n > 0
                ? 'text-orange-700 dark:text-orange-300'
                : 'text-text-secondary'
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(c.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? 'border-violet-500 bg-violet-600 text-white'
                  : 'border-border bg-card text-text-primary hover:bg-muted/60'
              }`}
            >
              {c.label}
              <span className={`tabular-nums text-xs font-semibold ${active ? 'text-white/90' : tone}`}>{n}</span>
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          className="min-w-[200px] flex-1"
          placeholder={mainTab === 'customer' ? 'Search machine, serial, customer…' : 'Search product, serial…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {mainTab === 'customer' ? (
          <Select
            className="w-full sm:w-44"
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
            options={[
              { value: 'ALL', label: 'All origins' },
              { value: 'SOLD_BY_US', label: 'Sold by us' },
              { value: 'THIRD_PARTY', label: 'Outside / repair' },
            ]}
          />
        ) : null}
        <Select
          className="w-full sm:w-48"
          value={quarterFilter}
          onChange={(e) => setQuarterFilter(e.target.value as StampQuarter | '')}
          options={[
            { value: '', label: 'All quarters' },
            ...STAMP_QUARTERS.map((q) => ({
              value: q.code,
              label: `Quarter ${q.code} · ${q.months}${q.code === currentQuarter ? ' (now)' : ''}`,
            })),
          ]}
        />
      </div>

      <Card padding={false}>
        {loading && units.length === 0 && assets.length === 0 ? (
          <TableSkeleton rows={8} />
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
              {pagedUnits.rows.map((u) => {
                const renewal = renewalDueFromStamp(u.stampingDate)
                const renewalDays = daysUntil(renewal)
                return (
                  <button
                    key={u.id}
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/40 sm:items-center sm:gap-4 sm:py-4"
                    onClick={() => openDetailUnit(u)}
                  >
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 sm:flex">
                      <Warehouse size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-text-primary">{u.product?.name ?? 'Product'}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                        <span className="font-mono font-medium text-text-primary">{u.serialNo}</span>
                        <span>{u.product?.sku}</span>
                        <span>{u.warehouse?.name}</span>
                        <Badge color={stampQuarterOf(u).code === currentQuarter ? 'purple' : 'gray'}>
                          {stampQuarterOf(u).label}
                        </Badge>
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      {u.stampingDate ? (
                        <div className="text-sm font-medium">Stamped {formatDate(String(u.stampingDate))}</div>
                      ) : null}
                      {renewal ? (
                        <div className="mt-0.5 text-xs text-text-secondary">
                          Renewal {formatDate(renewal)}
                          {renewalDays != null && renewalDays <= 30 ? ` · ${renewalDays}d` : ''}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <Badge color={stampStatusOf(u).color}>{stampStatusOf(u).label}</Badge>
                      <Badge color={u.status === 'IN_STOCK' ? 'green' : u.status === 'DEMO' ? 'amber' : 'blue'}>
                        {u.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <ChevronRight size={16} className="hidden shrink-0 text-text-secondary sm:block" />
                  </button>
                )
              })}
          <PaginationBar page={pagedUnits.page} total={pagedUnits.total} onPageChange={pagedUnits.setPage} hideWhenSinglePage />
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
            {pagedAssets.rows.map((a) => {
              const c = a.contact as AssetRow['contact']
              const contactId = c?.id || a.contactId
              const renewal = a.nextDueDate
                ? String(a.nextDueDate).slice(0, 10)
                : renewalDueFromStamp(a.stampingDate ? String(a.stampingDate) : null)
              const followUpTo =
                contactId
                  ? `/tickets?open=1&job=stamping&category=Stamping&machine=existing&contactId=${encodeURIComponent(String(contactId))}&assetId=${encodeURIComponent(String(a.id))}`
                  : '/tickets?open=1&job=stamping&category=Stamping'
              return (
                <div
                  key={String(a.id)}
                  className="flex w-full flex-col gap-2 px-4 py-3 transition hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3 sm:py-4"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left sm:items-center sm:gap-4"
                    onClick={() => openDetailAsset(a)}
                  >
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 sm:flex">
                      <Building2 size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-text-primary">{String(a.name)}</div>
                      <div className="mt-0.5 text-xs text-text-secondary">
                        {c?.customerCode ? `${c.customerCode} · ` : ''}{c?.name ?? '—'}
                        {a.serialNo ? ` · ${String(a.serialNo)}` : ''}
                        {' · '}
                        {stampQuarterOf(a).label}
                      </div>
                      {renewal ? (
                        <div className="mt-0.5 text-xs text-text-secondary sm:hidden">Valid till {formatDate(renewal)}</div>
                      ) : null}
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      {a.stampingDate ? (
                        <div className="text-sm font-medium">Stamped {formatDate(String(a.stampingDate))}</div>
                      ) : null}
                      {renewal ? (
                        <div className="mt-0.5 text-xs text-text-secondary">Valid till {formatDate(renewal)}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <Badge color={stampStatusOf(a).color}>{stampStatusOf(a).label}</Badge>
                      <Badge color={a.origin === 'THIRD_PARTY' ? 'amber' : 'blue'}>
                        {assetOriginShort(a.origin ? String(a.origin) : null)}
                      </Badge>
                    </div>
                  </button>
                  {openJobs[String(a.id)] ? (
                    <Link to={`/tickets/${openJobs[String(a.id)]!.id}`} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" className="w-full sm:w-auto">
                        Job open · SVC-{String(openJobs[String(a.id)]!.ticketNo).padStart(5, '0')}
                      </Button>
                    </Link>
                  ) : needsStamping(a) && contactId ? (
                    <Link to={followUpTo} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" className="w-full sm:w-auto">
                        Start stamping job
                      </Button>
                    </Link>
                  ) : (
                    <ChevronRight size={16} className="hidden shrink-0 text-text-secondary sm:block" />
                  )}
                </div>
              )
            })}
            <PaginationBar page={pagedAssets.page} total={pagedAssets.total} onPageChange={pagedAssets.setPage} hideWhenSinglePage />
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
        storageKey="nova.drawer.stamping.detail"
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
          <div className="flex flex-wrap gap-2">
            {detailAsset &&
            ((detailAsset.contact as { id?: string })?.id || detailAsset.contactId) ? (
              <Link
                className="flex-1"
                to={`/tickets?open=1&job=stamping&category=Stamping&machine=existing&contactId=${encodeURIComponent(
                  String((detailAsset.contact as { id?: string })?.id || detailAsset.contactId),
                )}&assetId=${encodeURIComponent(String(detailAsset.id))}`}
                onClick={() => {
                  setDetailAsset(null)
                }}
              >
                <Button className="w-full">
                  Start stamping follow-up
                </Button>
              </Link>
            ) : null}
            <Button className="flex-1" disabled={saving} onClick={() => void saveDetailStamp()}>
              {saving ? 'Saving…' : 'Save dates only'}
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
