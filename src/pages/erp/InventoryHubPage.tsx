import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import { api, ApiClientError, num } from '@/lib/api'
import {
  buildHmsAttributes,
  familyByCode,
  HMS_FAMILY_OPTIONS,
  industryOptions,
  machineOptions,
  productCatalogMeta,
} from '@/lib/hmsCatalog'
import { GC_MONTH_OPTIONS } from '@/lib/hmsCoverage'
import { downloadXlsx } from '@/lib/reportExport'
import { productAttrs, truncateProductName } from '@/lib/productCatalog'
import { expandSerialRange, bumpSerial } from '@/lib/stockSerial'
import { filterServiceEngineers } from '@/lib/roles'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { ConfirmModal } from '@/components/ui/Modal'

type Category = 'MACHINE' | 'SPARE'
type HubTab = 'catalog' | 'stock' | 'suppliers' | 'report'
export type InventoryHubSection = HubTab
type StockMode = 'add' | 'reduce'
type StockView = 'onhand' | 'demo' | 'history' | 'reduce'
type Family = 'WEIGHING' | 'BILLING'

/** Machine types shown when adding / reducing stock (Cash Counting split out of OA). */
const STOCK_MACHINE_TYPES = [
  { value: 'WEIGHING_SCALES', label: 'Weighing' },
  { value: 'BILLING_MACHINE', label: 'Billing' },
  { value: 'TOUCH_POS', label: 'Touch POS' },
  { value: 'CASH_COUNTING', label: 'Cash Counting' },
  { value: 'OFFICE_AUTOMATION', label: 'Office Automation' },
  { value: 'BILLING_SOFTWARE', label: 'Billing Software' },
] as const

type StockMachineType = (typeof STOCK_MACHINE_TYPES)[number]['value']

function productMatchesStockType(p: Record<string, unknown>, type: StockMachineType) {
  const a = productAttrs(p)
  const fam = String(a.catalogFamily ?? '')
  const kind = String(a.catalogKind ?? '')
  if (type === 'CASH_COUNTING') return kind === 'CCM'
  if (type === 'OFFICE_AUTOMATION') return fam === 'OFFICE_AUTOMATION' && kind !== 'CCM'
  return fam === type
}

function spareFamilyFromStockType(type: StockMachineType): Family {
  return type === 'WEIGHING_SCALES' ? 'WEIGHING' : 'BILLING'
}

const SPARE_FAMILY_OPTS = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing / Touch POS' },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function unitCustomFields(u: Record<string, unknown>) {
  const cf = u.customFields
  return cf && typeof cf === 'object' && !Array.isArray(cf) ? (cf as Record<string, unknown>) : {}
}

function demoDaysOut(iso?: string | null) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

function parseStockView(raw: string | null): StockView {
  if (raw === 'reduce' || raw === 'history' || raw === 'demo') return raw
  return 'onhand'
}

function monthBounds(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const last = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { from, to }
}

function skuFromName(familyCode: string, industryCode: string, name: string) {
  const fam = familyCode.replaceAll('_', '').slice(0, 6)
  const ind = industryCode ? industryCode.replaceAll('_', '').slice(0, 4) : 'GEN'
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28)
  const suffix = Date.now().toString(36).slice(-4).toUpperCase()
  return `HMS-${fam}-${ind}-${slug || 'MODEL'}-${suffix}`
}

/**
 * Unified inventory pages: Products / Stock / Suppliers / monthly report.
 * Prefer dedicated routes (`section` prop) over in-page tabs.
 */
export function InventoryHubPage({ section }: { section?: InventoryHubSection }) {
  const addToast = useUIStore((s) => s.addToast)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: HubTab = section ?? ((params.get('tab') as HubTab) || 'catalog')

  const [category, setCategory] = useState<Category>(
    () => (params.get('category') === 'SPARE' ? 'SPARE' : 'MACHINE'),
  )
  /** List filter on Products page (All / Machine / Spare) — separate from add-form category */
  const [listFilter, setListFilter] = useState<'ALL' | Category>('ALL')
  const [brandFilter, setBrandFilter] = useState('')
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editingSpareId, setEditingSpareId] = useState<string | null>(null)
  const [productDrawerOpen, setProductDrawerOpen] = useState(
    () => params.get('open') === '1' && (params.get('tab') || 'catalog') === 'catalog',
  )
  const [supplierSubTab, setSupplierSubTab] = useState<'suppliers' | 'brands'>(
    () => (params.get('sub') === 'brands' ? 'brands' : 'suppliers'),
  )
  const [brandFormName, setBrandFormName] = useState('')
  const [brandFormCode, setBrandFormCode] = useState('')
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null)
  const [stockMode, setStockMode] = useState<StockMode>(() =>
    params.get('mode') === 'reduce' ? 'reduce' : 'add',
  )
  const [stockListFilter, setStockListFilter] = useState<'ALL' | Category>('ALL')
  /** On-hand list vs demo monitor vs add/reduce movement history (stock page tabs) */
  const [stockView, setStockView] = useState<StockView>(() => parseStockView(params.get('view')))
  const [returnConfirm, setReturnConfirm] = useState<{
    id: string
    label: string
    customer: string
  } | null>(null)
  const [returnBusy, setReturnBusy] = useState(false)
  const [histAction, setHistAction] = useState<'ALL' | 'ADD' | 'REDUCE'>('ALL')
  const [histCategory, setHistCategory] = useState<'ALL' | Category>('ALL')
  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [histTo, setHistTo] = useState(todayIso())
  const [histLoading, setHistLoading] = useState(false)
  const [stockHistory, setStockHistory] = useState<
    Array<{
      id: string
      when: string
      action: 'ADD' | 'REDUCE'
      category: Category
      item: string
      qty: number
      hmsOrCode: string
      serial: string
      engineer: string
      reason: string
      customer: string
      purpose: string
      by: string
      notes: string
    }>
  >([])
  const [stockMoveOpen, setStockMoveOpen] = useState(false)
  const [stockDetailOpen, setStockDetailOpen] = useState(false)
  const [editingMachineProductId, setEditingMachineProductId] = useState<string | null>(null)
  const [editingSpareStockId, setEditingSpareStockId] = useState<string | null>(null)
  const [editUnitSerial, setEditUnitSerial] = useState('')
  const [editUnitNotes, setEditUnitNotes] = useState('')
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [products, setProducts] = useState<Array<Record<string, unknown>>>([])
  const [spares, setSpares] = useState<Array<Record<string, unknown>>>([])
  const [vendors, setVendors] = useState<Array<Record<string, unknown>>>([])
  const [brands, setBrands] = useState<Array<Record<string, unknown>>>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [units, setUnits] = useState<Array<Record<string, unknown>>>([])
  const [filterQ, setFilterQ] = useState('')

  // Machine catalog form
  const [mFamily, setMFamily] = useState('')
  const [mIndustry, setMIndustry] = useState('')
  const [mCustom, setMCustom] = useState('')
  const [mBrand, setMBrand] = useState('')
  const [mGc, setMGc] = useState(false)
  const [mWarranty, setMWarranty] = useState('')
  const [mAmc, setMAmc] = useState(false)
  const [mStamp, setMStamp] = useState(false)
  const [mHsn, setMHsn] = useState('')
  const [mDesc, setMDesc] = useState('')

  // Spare catalog form
  const [sFamily, setSFamily] = useState<Family>('WEIGHING')
  const [sName, setSName] = useState('')
  const [sCode, setSCode] = useState('')
  const [sUnit, setSUnit] = useState('pcs')

  // Stock move: shared
  const [stockMachineType, setStockMachineType] = useState<StockMachineType | ''>('')
  const [productId, setProductId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [qty, setQty] = useState('1')
  const [serialStart, setSerialStart] = useState('')
  const [hmsStart, setHmsStart] = useState('')
  const [previewHmsIds, setPreviewHmsIds] = useState<string[]>([])
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [unitCost, setUnitCost] = useState('')

  // Spare stock add / reduce
  const [spareId, setSpareId] = useState('')
  const [spareQty, setSpareQty] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [spareNotes, setSpareNotes] = useState('')
  const [spareUniqStart, setSpareUniqStart] = useState('')

  // Reduce
  const [reduceReason, setReduceReason] = useState('')
  const [engineerId, setEngineerId] = useState('')
  const [engineers, setEngineers] = useState<Array<{ id: string; name: string }>>([])
  const [reduceHistory, setReduceHistory] = useState<
    Array<{ when: string; what: string; qty: string; engineer: string; reason: string }>
  >([])

  // Supplier create
  const [supName, setSupName] = useState('')
  const [supPhone, setSupPhone] = useState('')
  const [supGstin, setSupGstin] = useState('')

  // Monthly report — machine / spare / month filters drive preview + Excel
  const now = new Date()
  const [repYear, setRepYear] = useState(now.getFullYear())
  const [repMonth, setRepMonth] = useState(now.getMonth() + 1)
  const [repCategory, setRepCategory] = useState<Category | 'ALL'>('ALL')
  const [repMachineType, setRepMachineType] = useState<StockMachineType | ''>('')
  const [repProductId, setRepProductId] = useState('')
  const [repWarehouseId, setRepWarehouseId] = useState('')
  const [repSpareFamily, setRepSpareFamily] = useState<Family | ''>('')
  const [repSpareId, setRepSpareId] = useState('')
  const [repBusy, setRepBusy] = useState(false)
  const [spareMonthly, setSpareMonthly] = useState<{
    items: Array<Record<string, unknown>>
    totals: { opening: number; received: number; issued: number; closing: number }
  } | null>(null)
  const [machineMonthly, setMachineMonthly] = useState<{
    unitsAdded: number
    receipts: number
    totalValue: number
    units: Array<Record<string, unknown>>
  } | null>(null)

  const reportMachineProducts = useMemo(() => {
    let list = products
    if (repMachineType) {
      list = list.filter((p) => productMatchesStockType(p, repMachineType))
    }
    return list
      .map((p) => ({
        value: String(p.id),
        label: String(p.name ?? ''),
        sublabel: p.sku ? String(p.sku) : undefined,
      }))
      .filter((o) => o.label)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [products, repMachineType])

  const reportSpareOptions = useMemo(() => {
    let list = spares
    if (repSpareFamily) {
      list = list.filter((s) => String(s.machineFamily ?? '') === repSpareFamily)
    }
    return list
      .map((s) => ({
        value: String(s.id),
        label: String(s.name ?? ''),
        sublabel: s.partCode ? String(s.partCode) : String(s.machineFamily ?? ''),
      }))
      .filter((o) => o.label)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [spares, repSpareFamily])

  const famNeedsIndustry = Boolean(familyByCode(mFamily)?.hasIndustry)
  const machineOpts = useMemo(
    () => machineOptions(mFamily, mIndustry).map((o) => ({ value: o.value, label: o.label })),
    [mFamily, mIndustry],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // One workspace call instead of 7 remote round-trips to US-East RDS
      const workspace = await api.inventoryWorkspace()
      setProducts(workspace.products ?? [])
      setSpares(workspace.spares ?? [])
      setVendors(workspace.vendors ?? [])
      setBrands(workspace.brands ?? [])
      setWarehouses(
        (workspace.warehouses ?? []).map((w) => ({ id: String(w.id), name: String(w.name) })),
      )
      const inStock = (workspace.units ?? []).filter((u) => {
        const st = String(u.status)
        return st === 'IN_STOCK' || st === 'DEMO'
      })
      setUnits(inStock)
      setWarehouseId((prev) => prev || (workspace.warehouses?.[0] ? String(workspace.warehouses[0].id) : ''))
      const allUsers = (workspace.users ?? []).map((u) => ({
        id: String(u.id),
        name: String(u.name ?? ''),
        roleCode: String((u.role as { code?: string } | null)?.code ?? u.roleCode ?? ''),
      }))
      const eng = filterServiceEngineers(allUsers)
      setEngineers((eng.length ? eng : allUsers).map((e) => ({ id: e.id, name: e.name })))
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load inventory',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  const demoUnits = useMemo(
    () =>
      units
        .filter((u) => String(u.status) === 'DEMO')
        .slice()
        .sort((a, b) => {
          const aAt = String(unitCustomFields(a).demoIssuedAt ?? a.updatedAt ?? '')
          const bAt = String(unitCustomFields(b).demoIssuedAt ?? b.updatedAt ?? '')
          return bAt.localeCompare(aAt)
        }),
    [units],
  )

  async function returnDemoToHms() {
    if (!returnConfirm) return
    setReturnBusy(true)
    try {
      await api.returnDemoUnit(returnConfirm.id, {
        notes: 'Returned to HMS stock from Demo tab',
      })
      addToast({
        type: 'success',
        message: `${returnConfirm.label} is back in HMS stock`,
      })
      setReturnConfirm(null)
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not return demo unit',
      })
    } finally {
      setReturnBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (category === 'SPARE') next.set('category', 'SPARE')
    else next.delete('category')
    // Dedicated pages do not use ?tab=
    if (section) next.delete('tab')
    const before = params.toString()
    const after = next.toString()
    if (before === after) return
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync category into URL only
  }, [category, tab, section])

  useEffect(() => {
    // Legacy ?open=move / ?mode=reduce on stock list → dedicated page
    if (
      (section === 'stock' || tab === 'stock') &&
      (params.get('open') === 'move' || params.get('mode') === 'reduce' || params.get('mode') === 'add')
    ) {
      const next = new URLSearchParams()
      if (params.get('mode') === 'reduce') next.set('mode', 'reduce')
      if (params.get('category') === 'SPARE') next.set('category', 'SPARE')
      for (const key of ['productId', 'spareId', 'unitId'] as const) {
        const v = params.get(key)
        if (v) next.set(key, v)
      }
      const q = next.toString() ? `?${next.toString()}` : ''
      navigate(`/erp/stock/move${q}`, { replace: true })
      return
    }
    if (params.get('category') === 'SPARE') setCategory('SPARE')
    if (params.get('category') === 'MACHINE') setCategory('MACHINE')
    if (params.get('view') === 'history') setStockView('history')
    else if (params.get('view') === 'reduce') setStockView('reduce')
    else if (params.get('view') === 'demo') setStockView('demo')
    else if ((section === 'stock' || tab === 'stock') && params.get('view') !== 'history') {
      // keep current unless explicitly cleared via URL without view=
      if (!params.has('view') && params.get('open') !== 'move') {
        /* stockView controlled by setStockPageView */
      }
    }
    if (params.get('open') === '1' && tab === 'catalog') {
      setProductDrawerOpen(true)
    }
    if (tab === 'suppliers') {
      setSupplierSubTab(params.get('sub') === 'brands' ? 'brands' : 'suppliers')
    }
  }, [params, tab, section, navigate])

  function openStockMove(
    mode: StockMode,
    opts?: { category?: Category; productId?: string; spareId?: string; unitId?: string },
  ) {
    const next = new URLSearchParams()
    if (mode === 'reduce') next.set('mode', 'reduce')
    const cat = opts?.category ?? category
    if (cat === 'SPARE') next.set('category', 'SPARE')
    if (opts?.productId) next.set('productId', opts.productId)
    if (opts?.spareId) next.set('spareId', opts.spareId)
    if (opts?.unitId) next.set('unitId', opts.unitId)
    const q = next.toString() ? `?${next.toString()}` : ''
    navigate(`/erp/stock/move${q}`)
  }

  async function loadReduceHistory() {
    try {
      const [moves, spareTxns] = await Promise.all([
        api.inventoryHistory({ limit: 40, action: 'reduce' }).catch(() => []),
        api.spareStockHistory({ limit: 40 }).catch(() => []),
      ])
      const machineRows = (Array.isArray(moves) ? moves : [])
        .filter(
          (m) =>
            String(m.referenceType) === 'STOCK_REDUCE' ||
            String(m.referenceType) === 'DEMO_ISSUE' ||
            String(m.action) === 'REDUCE',
        )
        .slice(0, 20)
        .map((m) => ({
          when: String(m.createdAt ?? m.movedAt ?? m.performedAt ?? ''),
          what: String(
            (m.product as { name?: string } | null)?.name ?? m.productName ?? 'Machine unit',
          ),
          qty: String(m.quantity ?? 1),
          engineer:
            String(m.issuedToName ?? '') ||
            String(m.notes ?? '')
              .match(/Issued to:\s*([^·]+)/)?.[1]
              ?.trim() ||
            '—',
          reason: String(m.reduceReason ?? m.notes ?? '—'),
        }))
      const spareRows = (Array.isArray(spareTxns) ? spareTxns : [])
        .filter((t) => String(t.txnType) === 'OUT')
        .slice(0, 20)
        .map((t) => ({
          when: String(t.createdAt ?? t.txnDate ?? ''),
          what: String(
            (t.sparePart as { name?: string } | null)?.name ?? t.spareName ?? 'Spare',
          ),
          qty: String(t.quantity ?? ''),
          engineer: String(
            (t.customFields as { issuedToName?: string } | null)?.issuedToName ??
              t.issuedToName ??
              '—',
          ),
          reason: String(
            (t.customFields as { reduceReason?: string } | null)?.reduceReason ??
              t.notes ??
              '—',
          ),
        }))
      setReduceHistory(
        [...machineRows, ...spareRows]
          .sort((a, b) => (a.when < b.when ? 1 : -1))
          .slice(0, 30),
      )
    } catch {
      setReduceHistory([])
    }
  }

  const loadStockHistory = useCallback(async () => {
    setHistLoading(true)
    try {
      const actionParam =
        histAction === 'ADD' ? 'add' : histAction === 'REDUCE' ? 'reduce' : undefined
      const [moves, spareTxns] = await Promise.all([
        histCategory === 'SPARE'
          ? Promise.resolve([])
          : api
              .inventoryHistory({
                limit: 400,
                from: histFrom,
                to: histTo,
                action: actionParam,
              })
              .catch(() => []),
        histCategory === 'MACHINE'
          ? Promise.resolve([])
          : api
              .spareStockHistory({
                limit: 400,
                from: histFrom,
                to: histTo,
              })
              .catch(() => []),
      ])

      type HistRow = (typeof stockHistory)[number]

      const machineRows = (Array.isArray(moves) ? moves : [])
        .map((m): HistRow | null => {
          const isReduce =
            String(m.referenceType) === 'STOCK_REDUCE' ||
            String(m.referenceType) === 'DEMO_ISSUE' ||
            String(m.action) === 'REDUCE'
          const isAdd =
            String(m.movementType) === 'IN' ||
            String(m.referenceType) === 'STOCK_RECEIPT' ||
            String(m.action) === 'ADD'
          if (histAction === 'ADD' && !isAdd) return null
          if (histAction === 'REDUCE' && !isReduce) return null
          if (!isAdd && !isReduce) return null
          const unit = m.stockUnit as { hmsUniqId?: string; serialNo?: string } | null
          const product = m.product as { name?: string } | null
          const notes = String(m.notes ?? '')
          // Receive notes: "Stock in · HMS · SERIAL · …"
          const stockInParts = notes.match(/^Stock in\s*·\s*([^·]+)\s*·\s*([^·]+)/i)
          const hmsFromNotes = stockInParts?.[1]?.trim() ?? ''
          const serialFromNotes = stockInParts?.[2]?.trim() ?? ''
          return {
            id: `m-${String(m.id)}`,
            when: String(m.movedAt ?? m.createdAt ?? ''),
            action: isReduce ? 'REDUCE' : 'ADD',
            category: 'MACHINE',
            item: String(product?.name ?? m.productName ?? 'Machine'),
            qty: Number(m.quantity ?? 1),
            hmsOrCode: String(unit?.hmsUniqId ?? hmsFromNotes ?? ''),
            serial: String(unit?.serialNo ?? serialFromNotes ?? ''),
            engineer: String(
              m.issuedToName ??
                notes.match(/Issued to:\s*([^·]+)/)?.[1]?.trim() ??
                '',
            ),
            reason: String(m.reduceReason ?? ''),
            customer: String(m.customerName ?? ''),
            purpose: String(m.reducePurpose ?? (isReduce ? 'SALE' : '')),
            by: String((m.performer as { name?: string } | null)?.name ?? ''),
            notes,
          }
        })
        .filter((r): r is HistRow => r != null)

      const spareRows = (Array.isArray(spareTxns) ? spareTxns : [])
        .map((t): HistRow | null => {
          const txn = String(t.txnType)
          const isAdd = txn === 'IN'
          const isReduce = txn === 'OUT'
          if (histAction === 'ADD' && !isAdd) return null
          if (histAction === 'REDUCE' && !isReduce) return null
          if (!isAdd && !isReduce) return null
          return {
            id: `s-${String(t.id)}`,
            when: String(t.txnDate ?? t.createdAt ?? ''),
            action: isReduce ? 'REDUCE' : 'ADD',
            category: 'SPARE',
            item: String(
              (t.sparePart as { name?: string } | null)?.name ?? t.spareName ?? 'Spare',
            ),
            qty: Number(t.quantity ?? 0),
            hmsOrCode: '',
            serial: '',
            engineer: String(
              (t.customFields as { issuedToName?: string } | null)?.issuedToName ??
                t.issuedToName ??
                '',
            ),
            reason: String(
              (t.customFields as { reduceReason?: string } | null)?.reduceReason ?? '',
            ),
            customer: '',
            purpose: isReduce ? 'SPARE' : '',
            by: String(t.createdByName ?? ''),
            notes: String(t.notes ?? ''),
          }
        })
        .filter((r): r is HistRow => r != null)

      setStockHistory(
        [...machineRows, ...spareRows].sort((a, b) => (a.when < b.when ? 1 : -1)),
      )
    } catch (e) {
      setStockHistory([])
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load stock history',
      })
    } finally {
      setHistLoading(false)
    }
  }, [histAction, histCategory, histFrom, histTo, addToast])

  useEffect(() => {
    if (tab === 'stock' && (stockView === 'history' || stockView === 'reduce')) {
      void loadStockHistory()
    }
  }, [tab, stockView, loadStockHistory])

  function setStockPageView(view: StockView) {
    setStockView(view)
    const next = new URLSearchParams(params)
    if (view === 'history' || view === 'reduce' || view === 'demo') next.set('view', view)
    else next.delete('view')
    setParams(next, { replace: true })
    if (view === 'reduce') {
      setHistAction('REDUCE')
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      setHistFrom(start)
      setHistTo(end)
    }
  }

  function downloadStockHistory() {
    if (!stockHistory.length) {
      addToast({ type: 'error', message: 'No history rows to download' })
      return
    }
    const rows = stockHistory.map((h) => ({
      When: h.when ? new Date(h.when).toLocaleString() : '',
      Action: h.action,
      Category: h.category === 'MACHINE' ? 'Machine' : 'Spare',
      Item: h.item,
      Qty: h.qty,
      'HMS / code': h.hmsOrCode || '',
      Serial: h.serial || '',
      Customer: h.customer || '',
      Purpose: h.purpose || '',
      'Issued to': h.engineer || '',
      Reason: h.reason || '',
      By: h.by || '',
      Notes: h.notes || '',
    }))
    downloadXlsx(`stock-history-${histFrom}_to_${histTo}.xlsx`, [
      { name: 'Stock history', rows },
      {
        name: 'Summary',
        rows: [
          {
            From: histFrom,
            To: histTo,
            Action: histAction,
            Category: histCategory,
            Total: stockHistory.length,
            Added: stockHistory.filter((h) => h.action === 'ADD').length,
            Reduced: stockHistory.filter((h) => h.action === 'REDUCE').length,
            'Qty added': stockHistory
              .filter((h) => h.action === 'ADD')
              .reduce((n, h) => n + h.qty, 0),
            'Qty reduced': stockHistory
              .filter((h) => h.action === 'REDUCE')
              .reduce((n, h) => n + h.qty, 0),
          },
        ],
      },
    ])
    addToast({ type: 'success', message: 'History report downloaded' })
  }

  // Preview HMS unique IDs when product + qty ready (server sequence)
  useEffect(() => {
    if (!stockMoveOpen || stockMode !== 'add' || category !== 'MACHINE' || !productId) {
      setPreviewHmsIds([])
      return
    }
    const n = Math.max(1, Math.min(200, Math.floor(Number(qty) || 1)))
    let cancelled = false
    void api
      .previewHmsUniqIds({ productId, quantity: n })
      .then((ids) => {
        if (!cancelled) setPreviewHmsIds(Array.isArray(ids) ? ids.map(String) : [])
      })
      .catch(() => {
        if (!cancelled) setPreviewHmsIds([])
      })
    return () => {
      cancelled = true
    }
  }, [stockMoveOpen, stockMode, category, productId, qty])

  function closeStockMove() {
    setStockMoveOpen(false)
    const next = new URLSearchParams(params)
    next.delete('open')
    next.delete('mode')
    setParams(next, { replace: true })
  }

  function openMachineStockDetail(productIdValue: string) {
    setEditingMachineProductId(productIdValue)
    setEditingSpareStockId(null)
    setEditingUnitId(null)
    setEditUnitSerial('')
    setEditUnitNotes('')
    setStockDetailOpen(true)
  }

  function openSpareStockDetail(s: Record<string, unknown>) {
    setEditingSpareStockId(String(s.id))
    setEditingMachineProductId(null)
    setEditingUnitId(null)
    setSFamily((String(s.machineFamily) === 'BILLING' ? 'BILLING' : 'WEIGHING') as Family)
    setSName(String(s.name ?? ''))
    setSCode(s.partCode != null ? String(s.partCode) : '')
    setSUnit(s.unit != null ? String(s.unit) : 'pcs')
    setSpareId(String(s.id))
    setStockDetailOpen(true)
  }

  function closeStockDetail() {
    setStockDetailOpen(false)
    setEditingMachineProductId(null)
    setEditingSpareStockId(null)
    setEditingUnitId(null)
  }

  async function saveSpareStockDetail() {
    if (!editingSpareStockId) return
    if (!sName.trim()) {
      addToast({ type: 'error', message: 'Enter spare name' })
      return
    }
    setSaving(true)
    try {
      await api.updateSpareStockItem(editingSpareStockId, {
        machineFamily: sFamily,
        name: sName.trim(),
        partCode: sCode.trim() || null,
        unit: sUnit.trim() || 'pcs',
      })
      addToast({ type: 'success', message: 'Spare updated' })
      closeStockDetail()
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not update spare',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveUnitEdit() {
    if (!editingUnitId) return
    setSaving(true)
    try {
      await api.updateStockUnit(editingUnitId, {
        serialNo: editUnitSerial.trim() || undefined,
        notes: editUnitNotes.trim() || null,
      })
      addToast({ type: 'success', message: 'Unit updated' })
      setEditingUnitId(null)
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not update unit',
      })
    } finally {
      setSaving(false)
    }
  }

  function resetProductForm() {
    setEditingProductId(null)
    setEditingSpareId(null)
    setMFamily('')
    setMIndustry('')

    setMCustom('')
    setMBrand('')
    setMGc(false)
    setMWarranty('')
    setMAmc(false)
    setMStamp(false)
    setMHsn('')
    setMDesc('')
    setSFamily('WEIGHING')
    setSName('')
    setSCode('')
    setSUnit('pcs')
  }

  function openProductDrawer(cat?: Category) {
    resetProductForm()
    if (cat) setCategory(cat)
    setProductDrawerOpen(true)
    const next = new URLSearchParams(params)
    if (!section) next.set('tab', 'catalog')
    next.set('open', '1')
    if (cat) next.set('category', cat)
    setParams(next, { replace: true })
  }

  function closeProductDrawer() {
    setProductDrawerOpen(false)
    resetProductForm()
    const next = new URLSearchParams(params)
    next.delete('open')
    setParams(next, { replace: true })
  }

  function openEditMachine(p: Record<string, unknown>) {
    const a = productAttrs(p)
    const meta = productCatalogMeta(a)
    setCategory('MACHINE')
    setEditingProductId(String(p.id))
    setEditingSpareId(null)
    setMFamily(meta.familyCode || '')
    setMIndustry(meta.industryCode || '')

    setMCustom(String(p.name ?? a.model ?? ''))
    setMBrand(a.brand ? String(a.brand) : '')
    setMGc(Boolean(a.gcApplicable) || Boolean(a.warrantyMonths))
    setMWarranty(a.warrantyMonths != null ? String(a.warrantyMonths) : '')
    setMAmc(Boolean(a.amcApplicable))
    setMStamp(
      typeof a.requiresStamping === 'boolean'
        ? Boolean(a.requiresStamping)
        : meta.catalogKind === 'WEIGHING',
    )
    setMHsn(p.hsnSac != null ? String(p.hsnSac) : '')
    setMDesc(p.description != null ? String(p.description) : '')
    setProductDrawerOpen(true)
  }

  function openEditSpare(s: Record<string, unknown>) {
    setCategory('SPARE')
    setEditingSpareId(String(s.id))
    setEditingProductId(null)
    setSFamily((String(s.machineFamily) === 'BILLING' ? 'BILLING' : 'WEIGHING') as Family)
    setSName(String(s.name ?? ''))
    setSCode(s.partCode != null ? String(s.partCode) : '')
    setSUnit(s.unit != null ? String(s.unit) : 'pcs')
    setProductDrawerOpen(true)
  }

  const brandFilterOptions = useMemo(() => {
    const set = new Set<string>()
    for (const b of brands) {
      if (b.name) set.add(String(b.name))
    }
    for (const p of products) {
      const brand = productAttrs(p).brand
      if (brand) set.add(String(brand))
    }
    if (![...set].some((b) => b.toLowerCase() === 'hms')) set.add('HMS')
    return [
      { value: '', label: 'All brands' },
      ...[...set].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b })),
    ]
  }, [brands, products])

  const stockRows = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    const machineGroups = new Map<
      string,
      {
        key: string
        id: string
        kind: 'MACHINE'
        name: string
        brand: string
        sku: string
        inStock: number
        demo: number
        total: number
        warehouses: Set<string>
        rawUnits: Array<Record<string, unknown>>
      }
    >()
    for (const u of units) {
      const pid = String(u.productId ?? '')
      if (!pid) continue
      const name = String(
        (u.product as { name?: string } | null)?.name ?? u.productName ?? '—',
      )
      const brand = String(
        (u.brand as { name?: string } | null)?.name ??
          (u.product as { attributes?: { brand?: string } } | null)?.attributes?.brand ??
          '—',
      )
      const sku = String((u.product as { sku?: string } | null)?.sku ?? u.productSku ?? '—')
      const wh = String(
        (u.warehouse as { name?: string } | null)?.name ?? u.warehouseName ?? '—',
      )
      let g = machineGroups.get(pid)
      if (!g) {
        g = {
          key: `m-${pid}`,
          id: pid,
          kind: 'MACHINE',
          name,
          brand,
          sku,
          inStock: 0,
          demo: 0,
          total: 0,
          warehouses: new Set(),
          rawUnits: [],
        }
        machineGroups.set(pid, g)
      }
      g.rawUnits.push(u)
      g.total += 1
      if (String(u.status) === 'DEMO') g.demo += 1
      else g.inStock += 1
      if (wh && wh !== '—') g.warehouses.add(wh)
    }

    const machineRows =
      stockListFilter === 'SPARE'
        ? []
        : [...machineGroups.values()]
            .filter((g) => {
              if (!q) return true
              const hay = `${g.name} ${g.brand} ${g.sku}`.toLowerCase()
              return hay.includes(q)
            })
            .map((g) => ({
              key: g.key,
              id: g.id,
              kind: 'MACHINE' as const,
              name: g.name,
              brand: g.brand,
              sku: g.sku,
              qtyLabel: `${g.inStock} in stock${g.demo ? ` · ${g.demo} demo` : ''}`,
              qty: g.total,
              inStock: g.inStock,
              demo: g.demo,
              detail: [...g.warehouses].join(', ') || '—',
              raw: g,
            }))
            .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))

    const spareRows =
      stockListFilter === 'MACHINE'
        ? []
        : spares
            .filter((s) => {
              if (!q) return true
              const hay = `${s.name} ${s.partCode ?? ''} ${s.machineFamily ?? ''}`.toLowerCase()
              return hay.includes(q)
            })
            .map((s) => {
              const onHand = Number(s.quantityOnHand ?? 0)
              return {
                key: `s-${s.id}`,
                id: String(s.id),
                kind: 'SPARE' as const,
                name: String(s.name ?? ''),
                brand: '—',
                sku: s.partCode != null ? String(s.partCode) : '—',
                qtyLabel: `${onHand} on hand`,
                qty: onHand,
                inStock: onHand,
                demo: 0,
                detail: s.machineFamily === 'BILLING' ? 'Billing / Touch POS' : 'Weighing',
                raw: s,
              }
            })
            .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))

    return [...machineRows, ...spareRows]
  }, [units, spares, filterQ, stockListFilter])

  const editingMachineUnits = useMemo(() => {
    if (!editingMachineProductId) return []
    return units.filter((u) => String(u.productId) === editingMachineProductId)
  }, [units, editingMachineProductId])

  const editingMachineMeta = useMemo(() => {
    if (!editingMachineProductId) return null
    const row = stockRows.find(
      (r) => r.kind === 'MACHINE' && r.id === editingMachineProductId,
    )
    return row ?? null
  }, [stockRows, editingMachineProductId])

  const catalogRows = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    const brandQ = brandFilter.trim().toLowerCase()
    const machineRows =
      listFilter === 'SPARE'
        ? []
        : products
            .filter((p) => {
              const a = productAttrs(p)
              const brand = String(a.brand ?? '')
              if (brandQ && brand.toLowerCase() !== brandQ) return false
              if (!q) return true
              const hay =
                `${p.name} ${p.sku} ${brand} ${a.catalogFamilyName ?? ''} ${a.catalogIndustryName ?? ''} ${p.hsnSac ?? ''}`.toLowerCase()
              return hay.includes(q)
            })
            .map((p) => {
              const a = productAttrs(p)
              const meta = productCatalogMeta(a)
              return {
                key: `m-${p.id}`,
                id: String(p.id),
                kind: 'MACHINE' as const,
                name: String(p.name ?? ''),
                brand: String(a.brand ?? '—'),
                typeLabel: meta.familyName || meta.catalogKind || '—',
                industry: meta.industryName || '—',
                sku: String(p.sku ?? '—'),
                hsn: p.hsnSac != null ? String(p.hsnSac) : '—',
                stamp:
                  typeof a.requiresStamping === 'boolean'
                    ? a.requiresStamping
                      ? 'Yes'
                      : 'No'
                    : meta.catalogKind === 'WEIGHING'
                      ? 'Yes'
                      : '—',
                onHand: '—',
                raw: p,
              }
            })
    const spareRows =
      listFilter === 'MACHINE'
        ? []
        : spares
            .filter((s) => {
              // Spares aren't brand-tagged; hide when a brand filter is active
              if (brandQ) return false
              if (!q) return true
              const hay = `${s.name} ${s.partCode ?? ''} ${s.machineFamily ?? ''}`.toLowerCase()
              return hay.includes(q)
            })
            .map((s) => ({
              key: `s-${s.id}`,
              id: String(s.id),
              kind: 'SPARE' as const,
              name: String(s.name ?? ''),
              brand: '—',
              typeLabel: s.machineFamily === 'BILLING' ? 'Billing / Touch POS' : 'Weighing',
              industry: '—',
              sku: s.partCode != null ? String(s.partCode) : '—',
              hsn: '—',
              stamp: '—',
              onHand: String(s.quantityOnHand ?? 0),
              raw: s,
            }))
    return [...machineRows, ...spareRows].sort((a, b) => a.name.localeCompare(b.name))
  }, [products, spares, filterQ, listFilter, brandFilter])

  const productOptions = useMemo(() => {
    return products
      .filter((p) => !stockMachineType || productMatchesStockType(p, stockMachineType))
      .map((p) => {
        const onHand = units.filter(
          (u) => String(u.productId) === String(p.id) && String(u.status) === 'IN_STOCK',
        ).length
        return {
          value: String(p.id),
          label: String(p.name),
          sublabel: `${p.sku ?? ''}${onHand ? ` · ${onHand} in stock` : ''}`,
        }
      })
  }, [products, stockMachineType, units])

  const spareOptions = useMemo(() => {
    const fam = stockMachineType ? spareFamilyFromStockType(stockMachineType) : sFamily
    return spares
      .filter((s) => !fam || String(s.machineFamily) === fam)
      .map((s) => ({
        value: String(s.id),
        label: String(s.name),
        sublabel: `${s.machineFamily} · On hand: ${s.quantityOnHand ?? 0}`,
      }))
  }, [spares, sFamily, stockMachineType])

  const isWeighingStock = stockMachineType === 'WEIGHING_SCALES'

  const serialPreviewEnd = useMemo(() => {
    const n = Math.max(1, Math.floor(Number(qty) || 1))
    if (!serialStart.trim() || n < 1) return ''
    return bumpSerial(serialStart.trim(), n - 1)
  }, [serialStart, qty])

  const spareUniqPreview = useMemo(() => {
    const n = Math.max(1, Math.floor(Number(spareQty || qty) || 1))
    if (!spareUniqStart.trim()) return [] as string[]
    return expandSerialRange(spareUniqStart.trim(), n)
  }, [spareUniqStart, spareQty, qty])

  const hmsPreviewDisplay = useMemo(() => {
    if (previewHmsIds.length) return previewHmsIds
    const n = Math.max(1, Math.floor(Number(qty) || 1))
    if (!hmsStart.trim()) return [] as string[]
    return expandSerialRange(hmsStart.trim(), n)
  }, [previewHmsIds, hmsStart, qty])

  const engineerOptions = useMemo(
    () => engineers.map((e) => ({ value: e.id, label: e.name })),
    [engineers],
  )

  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ value: String(v.id), label: String(v.name) })),
    [vendors],
  )
  const brandOptions = useMemo(
    () => brands.map((b) => ({ value: String(b.id), label: String(b.name) })),
    [brands],
  )

  async function ensureVendorId(raw: string): Promise<string | null> {
    const v = raw.trim()
    if (!v) return null
    const existing = vendors.find(
      (x) => String(x.id) === v || String(x.name).toLowerCase() === v.toLowerCase(),
    )
    if (existing) return String(existing.id)
    const created = await api.createVendor({ name: v })
    const id = String(created.id)
    setVendors((prev) => [...prev, created])
    return id
  }

  async function ensureBrandId(raw: string): Promise<string | null> {
    const v = raw.trim()
    if (!v) return null
    const existing = brands.find(
      (x) => String(x.id) === v || String(x.name).toLowerCase() === v.toLowerCase(),
    )
    if (existing) return String(existing.id)
    const created = await api.createInventoryBrand({ name: v })
    const id = String(created.id)
    setBrands((prev) => [...prev, created])
    return id
  }

  async function saveMachineProduct() {
    if (!mFamily) {
      addToast({ type: 'error', message: 'Select machine type (Weighing / Billing / Touch POS…)' })
      return
    }
    if (famNeedsIndustry && !mIndustry) {
      addToast({ type: 'error', message: 'Select industry' })
      return
    }
    const fam = familyByCode(mFamily)
    if (!fam) return
    const name = mCustom.trim()
    if (!name) {
      addToast({ type: 'error', message: 'Type the model name' })
      return
    }
    // Match typed name to catalog SKU when possible; otherwise custom model under this type
    const fromCatalog = machineOptions(mFamily, mIndustry).find(
      (o) => o.label.toLowerCase() === name.toLowerCase(),
    )?.machine
    const catalogKind =
      fromCatalog?.catalogKind ??
      (fam.code === 'WEIGHING_SCALES'
        ? 'WEIGHING'
        : fam.code === 'BILLING_MACHINE'
          ? 'BILLING'
          : fam.code === 'TOUCH_POS'
            ? 'TOUCH_POS'
            : 'CCM')
    setSaving(true)
    try {
      const industry = fam.industries?.find((i) => i.code === mIndustry)
      const attributes = {
        ...buildHmsAttributes({
          familyCode: mFamily,
          familyName: fam.name,
          industryCode: mIndustry || null,
          industryName: industry?.name ?? null,
          machineName: name,
          catalogKind,
          requiresStamping: mStamp || catalogKind === 'WEIGHING',
        }),
        brand: mBrand.trim() || null,
        model: name,
        gcApplicable: mGc,
        warrantyMonths: mGc && mWarranty ? Number(mWarranty) : null,
        amcApplicable: mAmc,
      }
      if (editingProductId) {
        const existing = products.find((p) => String(p.id) === editingProductId)
        await api.updateProduct(editingProductId, {
          name: truncateProductName(name),
          hsnSac: mHsn.trim() || null,
          description: mDesc.trim() || null,
          attributes: {
            ...((existing?.attributes as Record<string, unknown> | undefined) ?? {}),
            ...attributes,
          },
        })
        addToast({ type: 'success', message: 'Machine product updated' })
      } else {
        await api.createProduct({
          name: truncateProductName(name),
          sku: fromCatalog?.sku ?? skuFromName(mFamily, mIndustry, name),
          productType: fromCatalog?.productType ?? 'GOODS',
          trackInventory: fromCatalog?.trackInventory ?? true,
          hsnSac: mHsn.trim() || null,
          description: mDesc.trim() || null,
          attributes,
        })
        addToast({ type: 'success', message: 'Machine product added' })
      }
      setMCustom('')

      closeProductDrawer()
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not save product',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveSpareProduct() {
    if (!sName.trim()) {
      addToast({ type: 'error', message: 'Enter spare name' })
      return
    }
    setSaving(true)
    try {
      if (editingSpareId) {
        await api.updateSpareStockItem(editingSpareId, {
          machineFamily: sFamily,
          name: sName.trim(),
          partCode: sCode.trim() || null,
          unit: sUnit.trim() || 'pcs',
        })
        addToast({ type: 'success', message: 'Spare updated' })
      } else {
        await api.createSpareStockItem({
          machineFamily: sFamily,
          name: sName.trim(),
          partCode: sCode.trim() || null,
          unit: sUnit.trim() || 'pcs',
        })
        addToast({ type: 'success', message: 'Spare catalog item added' })
      }
      setSName('')
      setSCode('')
      closeProductDrawer()
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not save spare',
      })
    } finally {
      setSaving(false)
    }
  }

  function setSupplierSub(sub: 'suppliers' | 'brands') {
    setSupplierSubTab(sub)
    const next = new URLSearchParams(params)
    next.set('tab', 'suppliers')
    if (sub === 'brands') next.set('sub', 'brands')
    else next.delete('sub')
    setParams(next, { replace: true })
  }

  async function saveBrand() {
    if (!brandFormName.trim()) {
      addToast({ type: 'error', message: 'Brand name required' })
      return
    }
    setSaving(true)
    try {
      if (editingBrandId) {
        await api.updateInventoryBrand(editingBrandId, {
          name: brandFormName.trim(),
          code: brandFormCode.trim() || null,
        })
        addToast({ type: 'success', message: 'Brand updated' })
      } else {
        await api.createInventoryBrand({
          name: brandFormName.trim(),
          code: brandFormCode.trim() || null,
        })
        addToast({ type: 'success', message: 'Brand added' })
      }
      setBrandFormName('')
      setBrandFormCode('')
      setEditingBrandId(null)
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not save brand',
      })
    } finally {
      setSaving(false)
    }
  }

  function openEditBrand(b: Record<string, unknown>) {
    setEditingBrandId(String(b.id))
    setBrandFormName(String(b.name ?? ''))
    setBrandFormCode(b.code != null ? String(b.code) : '')
  }

  function resetBrandForm() {
    setEditingBrandId(null)
    setBrandFormName('')
    setBrandFormCode('')
  }

  async function saveProductFromDrawer() {
    if (category === 'MACHINE') await saveMachineProduct()
    else await saveSpareProduct()
  }

  async function addMachineStock() {
    if (!stockMachineType) {
      addToast({ type: 'error', message: 'Select machine type (Weighing / Billing / …)' })
      return
    }
    if (!productId || !warehouseId) {
      addToast({ type: 'error', message: 'Model and warehouse required' })
      return
    }
    const n = Math.max(1, Math.floor(Number(qty) || 1))
    setSaving(true)
    try {
      const vId = await ensureVendorId(vendorId)
      const bId = await ensureBrandId(brandId)
      if (!vId) {
        addToast({ type: 'error', message: 'Select or type a supplier' })
        setSaving(false)
        return
      }
      if (!bId) {
        addToast({ type: 'error', message: 'Select or type a brand' })
        setSaving(false)
        return
      }
      const hmsIds = hmsPreviewDisplay.slice(0, n)
      // Weighing: no manufacturer serial — HMS Unique ID identifies the unit
      const serials = isWeighingStock
        ? hmsIds
        : serialStart.trim()
          ? expandSerialRange(serialStart.trim(), n)
          : Array.from({ length: n }, () => '')
      await api.receiveStockBatch({
        productId,
        warehouseId,
        vendorId: vId,
        brandId: bId,
        quantity: n,
        invoiceNo: invoiceNo.trim() || null,
        invoiceDate: invoiceDate || null,
        receivedDate: invoiceDate || todayIso(),
        unitAmount: unitCost ? Number(unitCost) : 0,
        startSerial: isWeighingStock ? null : serialStart.trim() || null,
        units: Array.from({ length: n }, (_, i) => ({
          serialNo: serials[i] || '',
          hmsUniqId: hmsIds[i] || undefined,
          status: 'IN_STOCK',
        })),
      })
      addToast({ type: 'success', message: `Received ${n} machine unit(s)` })
      setSerialStart('')
      setHmsStart('')
      setPreviewHmsIds([])
      setQty('1')
      closeStockMove()
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not add stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function addSpareStock() {
    if (!stockMachineType) {
      addToast({ type: 'error', message: 'Select machine type first' })
      return
    }
    const n = Number(spareQty || qty)
    if (!(n > 0)) {
      addToast({ type: 'error', message: 'Enter quantity received' })
      return
    }
    const isNew = spareId.startsWith('__new__:') || (!spareId && sName.trim())
    const name = isNew
      ? spareId.startsWith('__new__:')
        ? spareId.slice('__new__:'.length)
        : sName.trim() || spareId
      : undefined
    if (!spareId && !name) {
      addToast({ type: 'error', message: 'Select or type spare name' })
      return
    }
    if (!supplierName.trim() && !vendorId.trim()) {
      addToast({ type: 'error', message: 'Supplier name required' })
      return
    }
    const fam = spareFamilyFromStockType(stockMachineType)
    setSaving(true)
    try {
      const supplier =
        supplierName.trim() ||
        vendors.find((v) => String(v.id) === vendorId)?.name?.toString() ||
        vendorId
      await api.receiveSpareStock({
        machineFamily: fam,
        sparePartId: isNew || !spareId ? null : spareId,
        spareName: name || undefined,
        quantity: n,
        supplierName: String(supplier),
        invoiceDate: invoiceDate || todayIso(),
        invoiceNo: invoiceNo.trim() || null,
        notes: spareNotes.trim() || null,
        unitAmount: unitCost ? Number(unitCost) : null,
        spareUniqIds: spareUniqPreview.length ? spareUniqPreview : undefined,
      })
      addToast({ type: 'success', message: 'Spare stock received' })
      setSpareQty('')
      setSpareId('')
      setSpareUniqStart('')
      closeStockMove()
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not receive spare stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function reduceSpareStock() {
    const n = Number(spareQty || qty)
    if (!spareId || spareId.startsWith('__new__:')) {
      addToast({ type: 'error', message: 'Select an existing spare to reduce' })
      return
    }
    if (!(n > 0)) {
      addToast({ type: 'error', message: 'Enter quantity to reduce' })
      return
    }
    if (!engineerId) {
      addToast({ type: 'error', message: 'Select service engineer (issued to)' })
      return
    }
    if (!reduceReason.trim()) {
      addToast({ type: 'error', message: 'Enter reduce reason' })
      return
    }
    setSaving(true)
    try {
      await api.issueSpareStock({
        sparePartId: spareId,
        quantity: n,
        issuedToUserId: engineerId,
        reason: reduceReason.trim(),
        notes: reduceReason.trim(),
        txnDate: todayIso(),
      })
      addToast({ type: 'success', message: `Reduced ${n} from spare stock` })
      setSpareQty('')
      setReduceReason('')
      closeStockMove()
      closeStockDetail()
      await load()
      await loadReduceHistory()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not reduce spare stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function reduceMachineStock() {
    // Canonical multi-unit Sale/Demo flow lives on the full-page stock move form
    openStockMove('reduce', {
      category: 'MACHINE',
      productId: productId || undefined,
      unitId: undefined,
    })
  }

  async function saveSupplier() {
    if (!supName.trim()) {
      addToast({ type: 'error', message: 'Supplier name required' })
      return
    }
    setSaving(true)
    try {
      await api.createVendor({
        name: supName.trim(),
        phone: supPhone.trim() || null,
        gstin: supGstin.trim() || null,
      })
      addToast({ type: 'success', message: 'Supplier added' })
      setSupName('')
      setSupPhone('')
      setSupGstin('')
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not add supplier',
      })
    } finally {
      setSaving(false)
    }
  }

  function reportMachineProductIds(): string[] | null {
    if (repProductId) return [repProductId]
    if (!repMachineType) return null
    return reportMachineProducts.map((p) => p.value)
  }

  function filterMachineUnits(units: Array<Record<string, unknown>>) {
    const ids = reportMachineProductIds()
    if (!ids) return units
    if (!ids.length) return []
    const set = new Set(ids)
    return units.filter((u) => set.has(String(u.productId ?? '')))
  }

  async function loadReport() {
    setRepBusy(true)
    try {
      const { from, to } = monthBounds(repYear, repMonth)
      const tasks: Promise<void>[] = []
      if (repCategory === 'ALL' || repCategory === 'SPARE') {
        tasks.push(
          api
            .spareStockMonthly({
              year: repYear,
              month: repMonth,
              machineFamily: repSpareFamily || undefined,
              sparePartId: repSpareId || undefined,
            })
            .then((r) => {
              setSpareMonthly({ items: r.items ?? [], totals: r.totals })
            })
            .catch(() => setSpareMonthly(null)),
        )
      } else setSpareMonthly(null)
      if (repCategory === 'ALL' || repCategory === 'MACHINE') {
        const typeIds = reportMachineProductIds()
        // When type filter has zero products, skip API and show empty
        if (typeIds && typeIds.length === 0) {
          setMachineMonthly({
            unitsAdded: 0,
            receipts: 0,
            totalValue: 0,
            units: [],
          })
        } else {
          tasks.push(
            api
              .inventoryExport({
                from,
                to,
                warehouseId: repWarehouseId || undefined,
                productId: repProductId || undefined,
              })
              .then((r) => {
                let units = (r.units ?? []) as Array<Record<string, unknown>>
                if (!repProductId && repMachineType) {
                  units = filterMachineUnits(units)
                }
                const totalValue = units.reduce((s, u) => s + num(u.unitCost), 0)
                setMachineMonthly({
                  unitsAdded: units.length,
                  receipts: r.summary.receipts,
                  totalValue,
                  units,
                })
              })
              .catch(() => setMachineMonthly(null)),
          )
        }
      } else setMachineMonthly(null)
      await Promise.all(tasks)
    } finally {
      setRepBusy(false)
    }
  }

  async function exportReport() {
    setRepBusy(true)
    try {
      const { from, to } = monthBounds(repYear, repMonth)
      const sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }> = []
      const filterRows: Array<Record<string, unknown>> = [
        { Filter: 'Period', Value: `${repMonth}/${repYear} (${from} → ${to})` },
        {
          Filter: 'Category',
          Value:
            repCategory === 'ALL'
              ? 'Machines + Spares'
              : repCategory === 'MACHINE'
                ? 'Machines'
                : 'Spares',
        },
      ]
      if (repCategory === 'ALL' || repCategory === 'MACHINE') {
        if (repMachineType) {
          filterRows.push({
            Filter: 'Machine type',
            Value: STOCK_MACHINE_TYPES.find((t) => t.value === repMachineType)?.label ?? repMachineType,
          })
        }
        if (repProductId) {
          const p = products.find((x) => String(x.id) === repProductId)
          filterRows.push({ Filter: 'Machine', Value: String(p?.name ?? repProductId) })
        }
        if (repWarehouseId) {
          const w = warehouses.find((x) => x.id === repWarehouseId)
          filterRows.push({ Filter: 'Warehouse', Value: w?.name ?? repWarehouseId })
        }
      }
      if (repCategory === 'ALL' || repCategory === 'SPARE') {
        if (repSpareFamily) {
          filterRows.push({
            Filter: 'Spare family',
            Value: SPARE_FAMILY_OPTS.find((o) => o.value === repSpareFamily)?.label ?? repSpareFamily,
          })
        }
        if (repSpareId) {
          const s = spares.find((x) => String(x.id) === repSpareId)
          filterRows.push({ Filter: 'Spare', Value: String(s?.name ?? repSpareId) })
        }
      }
      sheets.push({ name: 'Filters', rows: filterRows })

      if (repCategory === 'ALL' || repCategory === 'MACHINE') {
        const typeIds = reportMachineProductIds()
        let units: Array<Record<string, unknown>> = []
        let summary = { unitsAdded: 0, receipts: 0, totalValue: 0 }
        if (!(typeIds && typeIds.length === 0)) {
          const data = await api.inventoryExport({
            from,
            to,
            warehouseId: repWarehouseId || undefined,
            productId: repProductId || undefined,
          })
          units = (data.units ?? []) as Array<Record<string, unknown>>
          if (!repProductId && repMachineType) units = filterMachineUnits(units)
          summary = {
            unitsAdded: units.length,
            receipts: data.summary.receipts,
            totalValue: units.reduce((s, u) => s + num(u.unitCost), 0),
          }
        }
        sheets.push({
          name: 'Machines summary',
          rows: [
            { Metric: 'From', Value: from },
            { Metric: 'To', Value: to },
            { Metric: 'Units added', Value: summary.unitsAdded },
            { Metric: 'Receipts', Value: summary.receipts },
            { Metric: 'Stock value', Value: summary.totalValue },
          ],
        })
        sheets.push({
          name: 'Machine units',
          rows: units.length
            ? units.map((u) => ({
                Date: u.addedDate ?? u.receivedDate ?? '',
                'HMS ID': u.hmsUniqId ?? '',
                Serial: u.serialNo ?? '',
                Product: u.productName ?? (u.product as { name?: string } | null)?.name ?? '',
                Brand: u.brand ?? '',
                Supplier: u.supplier ?? '',
                Warehouse: u.warehouse ?? '',
                Status: u.status ?? '',
                'Unit cost': u.unitCost ?? 0,
                'Invoice no': u.invoiceNo ?? '',
              }))
            : [{ Note: 'No machine units in this filter' }],
        })
      }
      if (repCategory === 'ALL' || repCategory === 'SPARE') {
        const m = await api.spareStockMonthly({
          year: repYear,
          month: repMonth,
          machineFamily: repSpareFamily || undefined,
          sparePartId: repSpareId || undefined,
        })
        sheets.push({
          name: 'Spare monthly',
          rows: (m.items ?? []).length
            ? (m.items ?? []).map((r) => ({
                Spare: r.name ?? '',
                Family: r.machineFamily ?? '',
                Opening: r.opening ?? 0,
                Received: r.received ?? 0,
                Issued: r.issued ?? 0,
                Closing: r.closing ?? 0,
              }))
            : [{ Note: 'No spare rows in this filter' }],
        })
        sheets.push({
          name: 'Spare totals',
          rows: [
            { Metric: 'Opening', Value: m.totals.opening },
            { Metric: 'Received', Value: m.totals.received },
            { Metric: 'Issued', Value: m.totals.issued },
            { Metric: 'Closing', Value: m.totals.closing },
          ],
        })
      }
      const catTag =
        repCategory === 'ALL' ? 'all' : repCategory === 'MACHINE' ? 'machines' : 'spares'
      downloadXlsx(
        `stock-report-${catTag}-${repYear}-${String(repMonth).padStart(2, '0')}.xlsx`,
        sheets,
      )
      addToast({ type: 'success', message: 'Stock report downloaded with your filters' })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Export failed',
      })
    } finally {
      setRepBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          tab === 'catalog'
            ? 'Products'
            : tab === 'stock'
              ? 'Stock'
              : tab === 'suppliers'
                ? 'Suppliers'
                : 'Monthly stock report'
        }
        breadcrumbs={[
          { label: APP_NAME },
          { label: 'Inventory' },
          {
            label:
              tab === 'catalog'
                ? 'Products'
                : tab === 'stock'
                  ? 'Stock'
                  : tab === 'suppliers'
                    ? 'Suppliers'
                    : 'Report',
          },
        ]}
        actions={
          tab === 'catalog' ? (
            <Button onClick={() => openProductDrawer()}>Add product</Button>
          ) : tab === 'stock' ? (
            <div className="flex flex-wrap gap-2">
              <Link to="/erp/stock/report">
                <Button variant="outline">Monthly report</Button>
              </Link>
              {stockView === 'history' || stockView === 'reduce' ? (
                <Button variant="outline" onClick={downloadStockHistory} disabled={histLoading}>
                  Download report
                </Button>
              ) : null}
              <Link to="/erp/stock/move?mode=reduce">
                <Button variant="outline">
                  <ArrowUpFromLine size={16} /> Reduce stock
                </Button>
              </Link>
              <Link to="/erp/stock/move">
                <Button>
                  <ArrowDownToLine size={16} /> Add stock
                </Button>
              </Link>
            </div>
          ) : undefined
        }
      />
      <p className="text-sm text-text-secondary">
        {tab === 'catalog'
          ? 'Click a row to edit. Filter by category or brand (HMS and others).'
          : tab === 'stock'
            ? stockView === 'reduce'
              ? 'Monthly reduce history — sale and demo (mapped customer), with HMS ID and serial. Download Excel.'
              : stockView === 'history'
                ? 'Add and reduce movements for machines and spares. Filter by date, then download Excel.'
                : stockView === 'demo'
                  ? 'Demo units currently out — monitor customer and days out. When the machine is back, return it to HMS stock.'
                  : 'Click a row for details / edit. Use Demo to monitor units out, Reduce history for sale/demo reports.'
            : tab === 'suppliers'
              ? 'Suppliers and brands in one place — brands are used on products and stock receive.'
              : 'Filter by machines, spares, and month — preview rows, then download Excel.'}
      </p>

      {tab === 'stock' ? (
        <PageTabs
          tabs={[
            { id: 'onhand', label: 'On hand' },
            { id: 'demo', label: 'Demo', count: demoUnits.length },
            { id: 'reduce', label: 'Reduce history' },
            { id: 'history', label: 'All history' },
          ]}
          active={stockView}
          onChange={(id) => setStockPageView(parseStockView(id))}
        />
      ) : null}

      {!section ? (
        <PageTabs
          tabs={[
            { id: 'catalog', label: 'Products' },
            { id: 'stock', label: 'Stock' },
            { id: 'suppliers', label: 'Suppliers' },
            { id: 'report', label: 'Monthly report' },
          ]}
          active={tab}
          onChange={(id) => {
            const next = new URLSearchParams(params)
            next.set('tab', id)
            setParams(next, { replace: true })
          }}
        />
      ) : null}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : tab === 'catalog' ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder="Search name, SKU, brand…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
            />
            <div className="w-[160px]">
              <Select
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value as 'ALL' | Category)}
                options={[
                  { value: 'ALL', label: 'All categories' },
                  { value: 'MACHINE', label: 'Machines' },
                  { value: 'SPARE', label: 'Spares' },
                ]}
              />
            </div>
            <div className="w-[170px]">
              <Select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                options={brandFilterOptions}
              />
            </div>
            <span className="text-xs text-text-secondary">{catalogRows.length} items</span>
          </div>
          {catalogRows.length === 0 ? (
            <EmptyState
              title="No products match"
              subtitle="Try another filter, or add a machine / spare."
              actionLabel="Add product"
              onAction={() => openProductDrawer()}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-text-secondary">
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Category</th>
                    <th className="px-3 py-2.5 font-semibold">Brand</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">SKU / code</th>
                    <th className="px-3 py-2.5 font-semibold">Industry</th>
                    <th className="px-3 py-2.5 font-semibold">Stamp</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogRows.map((row) => (
                    <tr
                      key={row.key}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        row.kind === 'MACHINE'
                          ? openEditMachine(row.raw)
                          : openEditSpare(row.raw)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          if (row.kind === 'MACHINE') openEditMachine(row.raw)
                          else openEditSpare(row.raw)
                        }
                      }}
                      className="cursor-pointer border-t border-border/70 hover:bg-accent-blue/5 focus-visible:bg-accent-blue/5 focus-visible:outline-none"
                    >
                      <td className="px-3 py-2.5 font-medium text-text-primary">{row.name}</td>
                      <td className="px-3 py-2.5">
                        <Badge color={row.kind === 'MACHINE' ? 'blue' : 'purple'}>
                          {row.kind === 'MACHINE' ? 'Machine' : 'Spare'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.brand}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.typeLabel}</td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 font-mono text-xs text-text-secondary">
                        {row.sku}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.industry}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{row.stamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <FormPanel
            open={productDrawerOpen}
            onClose={closeProductDrawer}
            title={editingProductId || editingSpareId ? 'Edit product' : 'Add product'}
            subtitle={
              editingProductId || editingSpareId
                ? 'Update fields and save — SKU stays the same on edit.'
                : 'One form — choose category, then the matching fields appear.'
            }
            footer={
              <>
                <FormPanelCancel onClick={closeProductDrawer} disabled={saving} />
                <Button onClick={() => void saveProductFromDrawer()} disabled={saving}>
                  {saving
                    ? 'Saving…'
                    : editingProductId || editingSpareId
                      ? 'Save changes'
                      : 'Save product'}
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <Select
                label="Category *"
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                disabled={Boolean(editingProductId || editingSpareId)}
                options={[
                  { value: 'MACHINE', label: 'Machine' },
                  { value: 'SPARE', label: 'Spare' },
                ]}
              />

              {category === 'MACHINE' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Machine type *"
                    value={mFamily}
                    onChange={(e) => {
                      setMFamily(e.target.value)
                      setMIndustry('')

                      setMCustom('')
                      setMStamp(e.target.value === 'WEIGHING_SCALES')
                    }}
                    options={[
                      { value: '', label: 'Weighing / Billing / Touch POS / …' },
                      ...HMS_FAMILY_OPTIONS,
                    ]}
                  />
                  {famNeedsIndustry ? (
                    <Select
                      label="Industry *"
                      value={mIndustry}
                      onChange={(e) => {
                        setMIndustry(e.target.value)
                        setMCustom('')
                      }}
                      options={[
                        { value: '', label: 'Select industry…' },
                        ...industryOptions(mFamily),
                      ]}
                    />
                  ) : null}
                  <SearchableSelect
                    label="Brand *"
                    value={mBrand}
                    allowCreate
                    placeholder="Search or type brand…"
                    options={brandOptions.map((b) => ({ value: b.label, label: b.label }))}
                    onChange={setMBrand}
                  />
                  <div>
                    <Input
                      label="Model name *"
                      value={mCustom}
                      onChange={(e) => {

                        setMCustom(e.target.value)
                      }}
                      list="hub-machine-model-suggestions"
                      placeholder="Type model name"
                    />
                    <datalist id="hub-machine-model-suggestions">
                      {machineOpts.map((o) => (
                        <option key={o.value} value={o.label} />
                      ))}
                    </datalist>
                    <p className="mt-1 text-xs text-text-secondary">
                      Typeable — suggestions from catalog when available
                    </p>
                  </div>
                  <Input label="HSN" value={mHsn} onChange={(e) => setMHsn(e.target.value)} />
                  <Input
                    label="Description"
                    value={mDesc}
                    onChange={(e) => setMDesc(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={mGc} onChange={setMGc} /> GC / warranty
                    </label>
                    {mGc ? (
                      <Select
                        label="GC months"
                        value={mWarranty}
                        onChange={(e) => setMWarranty(e.target.value)}
                        options={[{ value: '', label: 'Months…' }, ...GC_MONTH_OPTIONS]}
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={mAmc} onChange={setMAmc} /> AMC
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={mStamp} onChange={setMStamp} /> Requires stamping
                    </label>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="For which machine *"
                    value={sFamily}
                    onChange={(e) => setSFamily(e.target.value as Family)}
                    options={SPARE_FAMILY_OPTS}
                  />
                  <SearchableSelect
                    label="Spare name *"
                    value={sName}
                    allowCreate
                    placeholder="Search or type spare…"
                    options={spareOptions.map((o) => ({
                      value: o.label,
                      label: o.label,
                      sublabel: o.sublabel,
                    }))}
                    onChange={setSName}
                  />
                  <Input
                    label="Part code"
                    value={sCode}
                    onChange={(e) => setSCode(e.target.value)}
                    placeholder="Optional"
                  />
                  <Input label="Unit" value={sUnit} onChange={(e) => setSUnit(e.target.value)} />
                </div>
              )}
            </div>
          </FormPanel>
        </Card>
      ) : tab === 'stock' ? (
        <Card className="space-y-3 p-4">
          {stockView === 'history' || stockView === 'reduce' ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                {stockView === 'history' ? (
                <div className="w-[140px]">
                  <Select
                    label="Action"
                    value={histAction}
                    onChange={(e) => setHistAction(e.target.value as 'ALL' | 'ADD' | 'REDUCE')}
                    options={[
                      { value: 'ALL', label: 'Add + Reduce' },
                      { value: 'ADD', label: 'Add only' },
                      { value: 'REDUCE', label: 'Reduce only' },
                    ]}
                  />
                </div>
                ) : (
                  <p className="pb-2 text-sm font-medium text-text-primary">
                    Reduce history · this month by default
                  </p>
                )}
                <div className="w-[140px]">
                  <Select
                    label="Category"
                    value={histCategory}
                    onChange={(e) => setHistCategory(e.target.value as 'ALL' | Category)}
                    options={[
                      { value: 'ALL', label: 'All' },
                      { value: 'MACHINE', label: 'Machines' },
                      { value: 'SPARE', label: 'Spares' },
                    ]}
                  />
                </div>
                <Input
                  label="From"
                  type="date"
                  className="w-[150px]"
                  value={histFrom}
                  onChange={(e) => setHistFrom(e.target.value)}
                />
                <Input
                  label="To"
                  type="date"
                  className="w-[150px]"
                  value={histTo}
                  onChange={(e) => setHistTo(e.target.value)}
                />
                <Button variant="outline" onClick={() => void loadStockHistory()} disabled={histLoading}>
                  {histLoading ? 'Loading…' : 'Refresh'}
                </Button>
                <Button onClick={downloadStockHistory} disabled={histLoading || !stockHistory.length}>
                  Download Excel
                </Button>
                <span className="pb-2 text-xs text-text-secondary">
                  {stockHistory.length} rows · +
                  {stockHistory.filter((h) => h.action === 'ADD').reduce((n, h) => n + h.qty, 0)} / −
                  {stockHistory.filter((h) => h.action === 'REDUCE').reduce((n, h) => n + h.qty, 0)}
                </span>
              </div>
              {histLoading ? (
                <TableSkeleton rows={8} />
              ) : stockHistory.length === 0 ? (
                <EmptyState
                  title="No stock history in this range"
                  subtitle="Add or reduce stock, then refresh. Widen the date range if needed."
                  actionLabel="Add stock"
                  onAction={() => openStockMove('add')}
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-text-secondary">
                        <th className="px-3 py-2.5 font-semibold">When</th>
                        <th className="px-3 py-2.5 font-semibold">Action</th>
                        <th className="px-3 py-2.5 font-semibold">Category</th>
                        <th className="px-3 py-2.5 font-semibold">Item</th>
                        <th className="px-3 py-2.5 font-semibold">Qty</th>
                        <th className="px-3 py-2.5 font-semibold">HMS / ID</th>
                        <th className="px-3 py-2.5 font-semibold">Serial</th>
                        <th className="px-3 py-2.5 font-semibold">Customer</th>
                        <th className="px-3 py-2.5 font-semibold">Issued to</th>
                        <th className="px-3 py-2.5 font-semibold">Reason / notes</th>
                        <th className="px-3 py-2.5 font-semibold">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockHistory.map((h) => (
                        <tr key={h.id} className="border-t border-border/70">
                          <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                            {h.when ? new Date(h.when).toLocaleString() : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Badge color={h.action === 'ADD' ? 'green' : 'red'}>{h.action}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge color={h.category === 'MACHINE' ? 'blue' : 'purple'}>
                              {h.category === 'MACHINE' ? 'Machine' : 'Spare'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-medium text-text-primary">{h.item}</td>
                          <td className="px-3 py-2 tabular-nums font-semibold">{h.qty}</td>
                          <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                            {h.hmsOrCode || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                            {h.serial || '—'}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">
                            {h.customer || (h.purpose === 'DEMO' ? '—' : h.purpose || '—')}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{h.engineer || '—'}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-text-secondary">
                            {h.reason || h.notes || '—'}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{h.by || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : stockView === 'demo' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">
                  {demoUnits.length} demo unit{demoUnits.length === 1 ? '' : 's'} out — admin is
                  notified when a unit leaves HMS
                </span>
              </div>
              {demoUnits.length === 0 ? (
                <EmptyState
                  title="No demo units out"
                  subtitle="When a machine is issued for demo (reduce stock or sale tracking), it appears here until it returns to HMS."
                  actionLabel="Issue demo"
                  onAction={() => openStockMove('reduce')}
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[960px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-text-secondary">
                        <th className="px-3 py-2.5 font-semibold">Product</th>
                        <th className="px-3 py-2.5 font-semibold">HMS ID</th>
                        <th className="px-3 py-2.5 font-semibold">Serial</th>
                        <th className="px-3 py-2.5 font-semibold">Customer</th>
                        <th className="px-3 py-2.5 font-semibold">Phone</th>
                        <th className="px-3 py-2.5 font-semibold">Issued</th>
                        <th className="px-3 py-2.5 font-semibold">Days out</th>
                        <th className="px-3 py-2.5 font-semibold">DC</th>
                        <th className="px-3 py-2.5 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demoUnits.map((u) => {
                        const cf = unitCustomFields(u)
                        const productName = String(
                          (u.product as { name?: string } | null)?.name ??
                            cf.productName ??
                            '—',
                        )
                        const hms = String(u.hmsUniqId ?? '')
                        const serial = String(u.serialNo ?? '')
                        const customer = String(
                          cf.demoCustomerName ??
                            (u.contact as { name?: string } | null)?.name ??
                            '',
                        )
                        const code = String(
                          cf.demoCustomerCode ??
                            (u.contact as { customerCode?: string } | null)?.customerCode ??
                            '',
                        )
                        const phone = String(
                          cf.demoPhone ?? (u.contact as { phone?: string } | null)?.phone ?? '',
                        )
                        const issuedAt = cf.demoIssuedAt ? String(cf.demoIssuedAt) : ''
                        const days = demoDaysOut(issuedAt)
                        const dc = String(cf.demoDcNo ?? '')
                        const label = hms || serial || String(u.id)
                        return (
                          <tr key={String(u.id)} className="border-t border-border/70">
                            <td className="px-3 py-2 font-medium text-text-primary">{productName}</td>
                            <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                              {hms || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                              {serial || '—'}
                            </td>
                            <td className="px-3 py-2 text-text-secondary">
                              {customer
                                ? `${code ? `${code} · ` : ''}${customer}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-text-secondary">{phone || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                              {issuedAt ? new Date(issuedAt).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {days == null ? (
                                '—'
                              ) : (
                                <Badge color={days >= 7 ? 'amber' : 'blue'}>
                                  {days}d
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                              {dc || '—'}
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={returnBusy}
                                onClick={() =>
                                  setReturnConfirm({
                                    id: String(u.id),
                                    label,
                                    customer: customer || 'the customer',
                                  })
                                }
                              >
                                <RotateCcw size={14} /> Return to HMS stock
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder="Search product, spare, SKU…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
            />
            <div className="w-[160px]">
              <Select
                value={stockListFilter}
                onChange={(e) => setStockListFilter(e.target.value as 'ALL' | Category)}
                options={[
                  { value: 'ALL', label: 'All categories' },
                  { value: 'MACHINE', label: 'Machines' },
                  { value: 'SPARE', label: 'Spares' },
                ]}
              />
            </div>
            <span className="text-xs text-text-secondary">
              {stockRows.length} items ·{' '}
              {stockRows.reduce((n, r) => n + r.qty, 0)} total qty
            </span>
          </div>
          {stockRows.length === 0 ? (
            <EmptyState
              title="No stock yet"
              subtitle="Add stock from the top right — machines by serial, spares by quantity."
              actionLabel="Add stock"
              onAction={() => openStockMove('add')}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-text-secondary">
                    <th className="px-3 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Category</th>
                    <th className="px-3 py-2.5 font-semibold">Qty on hand</th>
                    <th className="px-3 py-2.5 font-semibold">In stock</th>
                    <th className="px-3 py-2.5 font-semibold">Demo</th>
                    <th className="px-3 py-2.5 font-semibold">Brand / type</th>
                    <th className="px-3 py-2.5 font-semibold">SKU / code</th>
                    <th className="px-3 py-2.5 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map((row) => (
                    <tr
                      key={row.key}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        row.kind === 'MACHINE'
                          ? openMachineStockDetail(row.id)
                          : openSpareStockDetail(row.raw as Record<string, unknown>)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          if (row.kind === 'MACHINE') openMachineStockDetail(row.id)
                          else openSpareStockDetail(row.raw as Record<string, unknown>)
                        }
                      }}
                      className="cursor-pointer border-t border-border/70 hover:bg-accent-blue/5 focus-visible:bg-accent-blue/5 focus-visible:outline-none"
                    >
                      <td className="px-3 py-2.5 font-medium text-text-primary">{row.name}</td>
                      <td className="px-3 py-2.5">
                        <Badge color={row.kind === 'MACHINE' ? 'blue' : 'purple'}>
                          {row.kind === 'MACHINE' ? 'Machine' : 'Spare'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-text-primary">
                        {row.qty}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-text-secondary">
                        {row.kind === 'MACHINE' ? row.inStock : row.qty}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-text-secondary">
                        {row.kind === 'MACHINE' ? row.demo : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {row.kind === 'MACHINE' ? row.brand : row.detail}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-xs text-text-secondary">
                        {row.sku}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {row.kind === 'MACHINE' ? row.detail : row.qtyLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
            </>
          )}

          <ConfirmModal
            open={Boolean(returnConfirm)}
            onClose={() => {
              if (!returnBusy) setReturnConfirm(null)
            }}
            onConfirm={() => void returnDemoToHms()}
            title="Return demo to HMS stock"
            body={
              returnConfirm
                ? `${returnConfirm.label} is back from ${returnConfirm.customer}. This puts the unit on hand in the main warehouse again.`
                : ''
            }
            confirmLabel={returnBusy ? 'Returning…' : 'Return to HMS stock'}
          />

          <FormPanel
            open={stockMoveOpen}
            onClose={closeStockMove}
            title={stockMode === 'add' ? 'Add stock' : 'Reduce stock'}
            subtitle="Category → machine type → product → details."
            footer={
              <>
                <FormPanelCancel onClick={closeStockMove} disabled={saving} />
                {stockMode === 'add' ? (
                  <Button
                    onClick={() =>
                      void (category === 'MACHINE' ? addMachineStock() : addSpareStock())
                    }
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Receive stock'}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() =>
                      void (category === 'MACHINE' ? reduceMachineStock() : reduceSpareStock())
                    }
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Reduce stock'}
                  </Button>
                )}
              </>
            }
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setStockMode('add')}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                    stockMode === 'add'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  <ArrowDownToLine size={16} /> Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStockMode('reduce')
                    void loadReduceHistory()
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                    stockMode === 'reduce'
                      ? 'border-red-500 bg-red-500/10 text-red-700'
                      : 'border-border text-text-secondary'
                  }`}
                >
                  <ArrowUpFromLine size={16} /> Reduce
                </button>
              </div>

              <Select
                label="Category *"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as Category)
                  setProductId('')
                  setSpareId('')
                  setStockMachineType('')
                }}
                options={[
                  { value: 'MACHINE', label: 'Machine' },
                  { value: 'SPARE', label: 'Spare' },
                ]}
              />

              <Select
                label="Machine type *"
                value={stockMachineType}
                onChange={(e) => {
                  setStockMachineType(e.target.value as StockMachineType | '')
                  setProductId('')
                  setSpareId('')
                  if (e.target.value) {
                    setSFamily(spareFamilyFromStockType(e.target.value as StockMachineType))
                  }
                }}
                options={[
                  { value: '', label: 'Weighing / Billing / Touch POS / …' },
                  ...STOCK_MACHINE_TYPES.map((t) => ({ value: t.value, label: t.label })),
                ]}
              />

              {stockMode === 'add' && category === 'MACHINE' ? (
                <div className="grid gap-3">
                  <SearchableSelect
                    label="Brand *"
                    value={brandId}
                    allowCreate
                    placeholder="Search or type brand…"
                    options={brandOptions}
                    onChange={setBrandId}
                  />
                  <SearchableSelect
                    label="Model *"
                    value={productId}
                    onChange={setProductId}
                    placeholder={stockMachineType ? 'Search model…' : 'Pick machine type first'}
                    options={productOptions}
                  />
                  <SearchableSelect
                    label="Supplier *"
                    value={vendorId}
                    allowCreate
                    placeholder="Search or type supplier…"
                    options={vendorOptions}
                    onChange={setVendorId}
                  />
                  <Select
                    label="Warehouse *"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    options={[
                      { value: '', label: 'Select…' },
                      ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                    ]}
                  />
                  <Input
                    label="Invoice date *"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                  <Input
                    label="Qty received *"
                    inputMode="numeric"
                    value={qty}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    onBlur={() => {
                      const n = Math.floor(Number(qty) || 0)
                      if (n < 1) setQty('1')
                      else if (n > 200) setQty('200')
                      else setQty(String(n))
                    }}
                  />
                  <Input
                    label="Invoice number"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                  />
                  <Input
                    label="Per unit amount"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                  />
                  <div>
                    <Input
                      label="HMS Unique ID (start)"
                      value={hmsStart || (hmsPreviewDisplay[0] ?? '')}
                      onChange={(e) => {
                        setHmsStart(e.target.value)
                        setPreviewHmsIds([])
                      }}
                      placeholder="Enter one ID — rest auto-fill by qty"
                    />
                    {hmsPreviewDisplay.length > 1 ? (
                      <p className="mt-1 text-xs text-text-secondary">
                        Auto: {hmsPreviewDisplay[0]} → {hmsPreviewDisplay[hmsPreviewDisplay.length - 1]}{' '}
                        ({hmsPreviewDisplay.length} IDs)
                      </p>
                    ) : hmsPreviewDisplay.length === 1 ? (
                      <p className="mt-1 text-xs text-text-secondary">
                        Preview: {hmsPreviewDisplay[0]}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-text-secondary">
                        Select model + qty to preview server IDs, or type a start ID
                      </p>
                    )}
                  </div>
                  {!isWeighingStock ? (
                    <div>
                      <Input
                        label="Serial number (start)"
                        value={serialStart}
                        onChange={(e) => setSerialStart(e.target.value)}
                        placeholder="Start serial — ending fills by qty"
                      />
                      {serialPreviewEnd ? (
                        <p className="mt-1 text-xs text-text-secondary">
                          Range: {serialStart.trim().toUpperCase()} → {serialPreviewEnd}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-text-secondary">
                      Weighing machines have no manufacturer serial — HMS Unique ID is used for
                      identification.
                    </p>
                  )}
                </div>
              ) : null}

              {stockMode === 'add' && category === 'SPARE' ? (
                <div className="grid gap-3">
                  <SearchableSelect
                    label="Spare *"
                    value={spareId}
                    allowCreate
                    createLabel={(q) => `New spare “${q}”`}
                    placeholder={stockMachineType ? 'Search or type spare…' : 'Pick machine type first'}
                    options={spareOptions}
                    onChange={(v) => {
                      const known = spareOptions.find((o) => o.value === v)
                      if (known) setSpareId(v)
                      else setSpareId(`__new__:${v}`)
                    }}
                  />
                  <SearchableSelect
                    label="Supplier *"
                    value={supplierName || vendorId}
                    allowCreate
                    placeholder="Search or type supplier…"
                    options={vendorOptions.map((v) => ({ value: v.label, label: v.label }))}
                    onChange={(v) => {
                      setSupplierName(v)
                      setVendorId('')
                    }}
                  />
                  <Input
                    label="Invoice date *"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                  <Input
                    label="Qty received *"
                    inputMode="numeric"
                    value={spareQty || qty}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                      setSpareQty(v)
                      setQty(v)
                    }}
                  />
                  <Input
                    label="Invoice number"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                  />
                  <Input
                    label="Per unit amount"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                  />
                  <div>
                    <Input
                      label="Spare unique ID (start)"
                      value={spareUniqStart}
                      onChange={(e) => setSpareUniqStart(e.target.value)}
                      placeholder="e.g. SP-2026-0001 — rest auto-fill by qty"
                    />
                    {spareUniqPreview.length > 1 ? (
                      <p className="mt-1 text-xs text-text-secondary">
                        Auto: {spareUniqPreview[0]} → {spareUniqPreview[spareUniqPreview.length - 1]}{' '}
                        ({spareUniqPreview.length} IDs)
                      </p>
                    ) : null}
                  </div>
                  <Input
                    label="Notes"
                    value={spareNotes}
                    onChange={(e) => setSpareNotes(e.target.value)}
                  />
                </div>
              ) : null}

              {stockMode === 'reduce' && category === 'MACHINE' ? (
                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <ol className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                    {['Category', 'Machine type', 'Model', 'Pick unit(s)', 'Reason'].map((label, i) => (
                      <li
                        key={label}
                        className="rounded-full border border-border bg-card px-2.5 py-1"
                      >
                        {i + 1}. {label}
                      </li>
                    ))}
                  </ol>
                  <p className="text-sm text-text-secondary">
                    Machine reduce uses the full-page form — same path everywhere: type → model →
                    select one or more units → <span className="font-medium">Sale</span> or{' '}
                    <span className="font-medium">Demo</span> (taken to customer site).
                  </p>
                  <Button
                    variant="danger"
                    onClick={() =>
                      openStockMove('reduce', {
                        category: 'MACHINE',
                        productId: productId || undefined,
                      })
                    }
                  >
                    Open reduce stock…
                  </Button>
                </div>
              ) : null}

              {stockMode === 'reduce' && category === 'SPARE' ? (
                <div className="grid gap-3">
                  <SearchableSelect
                    label="Spare *"
                    value={spareId}
                    onChange={setSpareId}
                    placeholder={stockMachineType ? 'Select spare…' : 'Pick machine type first'}
                    options={spareOptions}
                  />
                  {spareId && !spareId.startsWith('__new__:') ? (
                    <p className="text-sm text-text-secondary">
                      On hand:{' '}
                      <span className="font-semibold text-text-primary">
                        {String(
                          spares.find((s) => String(s.id) === spareId)?.quantityOnHand ?? 0,
                        )}
                      </span>
                    </p>
                  ) : null}
                  <Input
                    label="Qty to reduce *"
                    inputMode="numeric"
                    value={spareQty || qty}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                      setSpareQty(v)
                      setQty(v)
                    }}
                  />
                  <Input
                    label="Reduce reason *"
                    value={reduceReason}
                    onChange={(e) => setReduceReason(e.target.value)}
                    placeholder="Why reducing?"
                  />
                  <SearchableSelect
                    label="Issued to (service engineer) *"
                    value={engineerId}
                    onChange={setEngineerId}
                    placeholder="Select engineer…"
                    options={engineerOptions}
                  />
                </div>
              ) : null}

              {stockMode === 'reduce' ? (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      Reduce history
                    </h3>
                    <button
                      type="button"
                      className="text-xs text-accent-blue hover:underline"
                      onClick={() => void loadReduceHistory()}
                    >
                      Refresh
                    </button>
                  </div>
                  {reduceHistory.length === 0 ? (
                    <p className="text-xs text-text-secondary">No reduce history yet.</p>
                  ) : (
                    <ul className="max-h-48 space-y-2 overflow-auto text-xs">
                      {reduceHistory.map((h, i) => (
                        <li
                          key={`${h.when}-${i}`}
                          className="rounded-lg border border-border px-2 py-1.5"
                        >
                          <div className="font-medium text-text-primary">{h.what}</div>
                          <div className="text-text-secondary">
                            {h.when ? new Date(h.when).toLocaleString() : '—'} · Qty {h.qty} ·{' '}
                            {h.engineer}
                          </div>
                          <div className="truncate text-text-secondary">{h.reason}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          </FormPanel>

          <FormPanel
            open={stockDetailOpen}
            onClose={closeStockDetail}
            title={
              editingSpareStockId
                ? 'Edit spare stock'
                : editingMachineMeta?.name
                  ? editingMachineMeta.name
                  : 'Stock detail'
            }
            subtitle={
              editingSpareStockId
                ? 'Update spare details, or add / reduce quantity.'
                : editingMachineMeta
                  ? `${editingMachineMeta.inStock} in stock · ${editingMachineMeta.demo} demo — click a serial to edit or reduce`
                  : undefined
            }
            footer={
              <>
                <FormPanelCancel onClick={closeStockDetail} disabled={saving} />
                {editingSpareStockId ? (
                  <Button onClick={() => void saveSpareStockDetail()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save spare'}
                  </Button>
                ) : editingUnitId ? (
                  <Button onClick={() => void saveUnitEdit()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save unit'}
                  </Button>
                ) : null}
              </>
            }
          >
            {editingSpareStockId ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-text-secondary">On hand: </span>
                  <span className="font-semibold tabular-nums">
                    {Number(
                      spares.find((s) => String(s.id) === editingSpareStockId)?.quantityOnHand ?? 0,
                    )}
                  </span>
                </div>
                <Select
                  label="For which machine *"
                  value={sFamily}
                  onChange={(e) => setSFamily(e.target.value as Family)}
                  options={SPARE_FAMILY_OPTS}
                />
                <Input label="Spare name *" value={sName} onChange={(e) => setSName(e.target.value)} />
                <Input label="Part code" value={sCode} onChange={(e) => setSCode(e.target.value)} />
                <Input label="Unit" value={sUnit} onChange={(e) => setSUnit(e.target.value)} />
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      closeStockDetail()
                      openStockMove('add', { category: 'SPARE', spareId: editingSpareStockId })
                    }}
                  >
                    <ArrowDownToLine size={16} /> Add qty
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      closeStockDetail()
                      openStockMove('reduce', { category: 'SPARE', spareId: editingSpareStockId })
                    }}
                  >
                    <ArrowUpFromLine size={16} /> Reduce qty
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {editingMachineMeta ? (
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-lg border border-border px-2 py-2">
                      <div className="text-[11px] uppercase text-text-secondary">Total</div>
                      <div className="text-lg font-semibold tabular-nums">{editingMachineMeta.qty}</div>
                    </div>
                    <div className="rounded-lg border border-border px-2 py-2">
                      <div className="text-[11px] uppercase text-text-secondary">In stock</div>
                      <div className="text-lg font-semibold tabular-nums text-emerald-700">
                        {editingMachineMeta.inStock}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border px-2 py-2">
                      <div className="text-[11px] uppercase text-text-secondary">Demo</div>
                      <div className="text-lg font-semibold tabular-nums text-amber-700">
                        {editingMachineMeta.demo}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const pid = editingMachineProductId
                      closeStockDetail()
                      if (pid) openStockMove('add', { category: 'MACHINE', productId: pid })
                    }}
                  >
                    <ArrowDownToLine size={16} /> Add more
                  </Button>
                </div>
                {editingUnitId ? (
                  <div className="grid gap-3 rounded-lg border border-border p-3">
                    <Input
                      label="Serial / HMS ID"
                      value={editUnitSerial}
                      onChange={(e) => setEditUnitSerial(e.target.value)}
                    />
                    <Input
                      label="Notes"
                      value={editUnitNotes}
                      onChange={(e) => setEditUnitNotes(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        onClick={() => {
                          const pid = editingMachineProductId
                          const uid = editingUnitId
                          closeStockDetail()
                          openStockMove('reduce', {
                            category: 'MACHINE',
                            productId: pid ?? undefined,
                            unitId: uid ?? undefined,
                          })
                        }}
                        disabled={saving}
                      >
                        Reduce this unit…
                      </Button>
                      <Button variant="outline" onClick={() => setEditingUnitId(null)}>
                        Cancel edit
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="max-h-80 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="sticky top-0 border-b border-border bg-muted/40 text-[11px] uppercase text-text-secondary">
                        <th className="px-3 py-2 font-semibold">Serial</th>
                        <th className="px-3 py-2 font-semibold">Warehouse</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingMachineUnits.map((u) => (
                        <tr
                          key={String(u.id)}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setEditingUnitId(String(u.id))
                            setEditUnitSerial(String(u.serialNo || u.hmsUniqId || ''))
                            setEditUnitNotes(u.notes != null ? String(u.notes) : '')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setEditingUnitId(String(u.id))
                              setEditUnitSerial(String(u.serialNo || u.hmsUniqId || ''))
                              setEditUnitNotes(u.notes != null ? String(u.notes) : '')
                            }
                          }}
                          className="cursor-pointer border-t border-border/70 hover:bg-accent-blue/5"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {String(u.serialNo || u.hmsUniqId || '—')}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">
                            {String(
                              (u.warehouse as { name?: string } | null)?.name ??
                                u.warehouseName ??
                                '—',
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge color={String(u.status) === 'DEMO' ? 'amber' : 'green'}>
                              {String(u.status) === 'IN_STOCK' ? 'In stock' : String(u.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {editingMachineUnits.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-text-secondary">
                            No units for this product
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </FormPanel>
        </Card>
      ) : tab === 'suppliers' ? (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Truck size={18} className="text-accent-blue" />
              <div>
                <h2 className="text-sm font-semibold">
                  {supplierSubTab === 'brands' ? 'Brands' : 'Common suppliers'}
                </h2>
                <p className="text-xs text-text-secondary">
                  {supplierSubTab === 'brands'
                    ? 'HMS and other brands — used on products and when receiving stock'
                    : 'Shared for machine and spare stock — searchable everywhere'}
                </p>
              </div>
            </div>
            <div className="flex gap-1 rounded-lg border border-border p-0.5">
              <button
                type="button"
                onClick={() => setSupplierSub('suppliers')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  supplierSubTab === 'suppliers'
                    ? 'bg-accent-blue/10 text-accent-blue'
                    : 'text-text-secondary hover:bg-muted'
                }`}
              >
                Suppliers
              </button>
              <button
                type="button"
                onClick={() => setSupplierSub('brands')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  supplierSubTab === 'brands'
                    ? 'bg-accent-blue/10 text-accent-blue'
                    : 'text-text-secondary hover:bg-muted'
                }`}
              >
                Brands
              </button>
            </div>
          </div>

          {supplierSubTab === 'suppliers' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <SearchableSelect
                  label="Supplier name *"
                  value={supName}
                  allowCreate
                  placeholder="Type or pick…"
                  options={vendorOptions.map((v) => ({ value: v.label, label: v.label }))}
                  onChange={setSupName}
                />
                <Input label="Phone" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} />
                <Input label="GSTIN" value={supGstin} onChange={(e) => setSupGstin(e.target.value)} />
              </div>
              <Button onClick={() => void saveSupplier()} disabled={saving}>
                {saving ? 'Saving…' : 'Add supplier'}
              </Button>
              <ul className="max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border">
                {vendors.map((v) => (
                  <li key={String(v.id)} className="flex justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{String(v.name)}</span>
                    <span className="text-xs text-text-secondary">
                      {[v.phone, v.gstin].filter(Boolean).map(String).join(' · ') || '—'}
                    </span>
                  </li>
                ))}
                {vendors.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-text-secondary">
                    No suppliers yet
                  </li>
                ) : null}
              </ul>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Brand name *"
                  value={brandFormName}
                  onChange={(e) => setBrandFormName(e.target.value)}
                  placeholder="e.g. HMS, ISTHA, iMin…"
                />
                <Input
                  label="Code"
                  value={brandFormCode}
                  onChange={(e) => setBrandFormCode(e.target.value.toUpperCase())}
                  placeholder="Optional short code"
                />
                <div className="flex items-end gap-2">
                  <Button onClick={() => void saveBrand()} disabled={saving}>
                    {saving ? 'Saving…' : editingBrandId ? 'Update brand' : 'Add brand'}
                  </Button>
                  {editingBrandId ? (
                    <Button variant="outline" onClick={resetBrandForm} disabled={saving}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border">
                {brands.map((b) => (
                  <li
                    key={String(b.id)}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditBrand(b)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openEditBrand(b)
                      }
                    }}
                    className="flex cursor-pointer justify-between gap-2 px-3 py-2 text-sm hover:bg-accent-blue/5"
                  >
                    <span className="font-medium">{String(b.name)}</span>
                    <span className="text-xs text-text-secondary">
                      {b.code ? String(b.code) : '—'}
                      {b.isActive === false ? ' · Inactive' : ''}
                    </span>
                  </li>
                ))}
                {brands.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-text-secondary">
                    No brands yet — add HMS or any other brand
                  </li>
                ) : null}
              </ul>
            </>
          )}
          <Link to="/erp/suppliers" className="text-sm text-accent-blue hover:underline">
            Open full suppliers & brands →
          </Link>
        </Card>
      ) : (
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold">Stock report</h2>
            <p className="text-xs text-text-secondary">
              Filter machine-wise, spare-wise, and month-wise — preview on screen, then download Excel
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[200px]">
              <Select
                label="Report type"
                value={repCategory}
                onChange={(e) => {
                  const v = e.target.value as Category | 'ALL'
                  setRepCategory(v)
                  setMachineMonthly(null)
                  setSpareMonthly(null)
                }}
                options={[
                  { value: 'ALL', label: 'All (machines + spares)' },
                  { value: 'MACHINE', label: 'Machines only' },
                  { value: 'SPARE', label: 'Spares only' },
                ]}
              />
            </div>
            <div className="w-[160px]">
              <Select
                label="Month"
                value={String(repMonth)}
                onChange={(e) => {
                  setRepMonth(Number(e.target.value))
                  setMachineMonthly(null)
                  setSpareMonthly(null)
                }}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1),
                  label: new Date(2000, i, 1).toLocaleString('en', { month: 'long' }),
                }))}
              />
            </div>
            <div className="w-[120px]">
              <Select
                label="Year"
                value={String(repYear)}
                onChange={(e) => {
                  setRepYear(Number(e.target.value))
                  setMachineMonthly(null)
                  setSpareMonthly(null)
                }}
                options={[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(
                  (y) => ({
                    value: String(y),
                    label: String(y),
                  }),
                )}
              />
            </div>
          </div>

          {(repCategory === 'ALL' || repCategory === 'MACHINE') && (
            <div className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Machine filters
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[180px]">
                  <Select
                    label="Machine type"
                    value={repMachineType}
                    onChange={(e) => {
                      setRepMachineType(e.target.value as StockMachineType | '')
                      setRepProductId('')
                      setMachineMonthly(null)
                    }}
                    options={[
                      { value: '', label: 'All machine types' },
                      ...STOCK_MACHINE_TYPES.map((t) => ({ value: t.value, label: t.label })),
                    ]}
                  />
                </div>
                <div className="min-w-[220px] flex-1">
                  <SearchableSelect
                    label="Machine (product)"
                    value={repProductId}
                    onChange={(v) => {
                      setRepProductId(v)
                      setMachineMonthly(null)
                    }}
                    options={[{ value: '', label: 'All machines' }, ...reportMachineProducts]}
                    placeholder="All machines"
                    emptyText="No machines match"
                  />
                </div>
                <div className="w-[180px]">
                  <Select
                    label="Warehouse"
                    value={repWarehouseId}
                    onChange={(e) => {
                      setRepWarehouseId(e.target.value)
                      setMachineMonthly(null)
                    }}
                    options={[
                      { value: '', label: 'All warehouses' },
                      ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                    ]}
                  />
                </div>
              </div>
            </div>
          )}

          {(repCategory === 'ALL' || repCategory === 'SPARE') && (
            <div className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Spare filters
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[200px]">
                  <Select
                    label="Spare family"
                    value={repSpareFamily}
                    onChange={(e) => {
                      setRepSpareFamily(e.target.value as Family | '')
                      setRepSpareId('')
                      setSpareMonthly(null)
                    }}
                    options={[
                      { value: '', label: 'All families' },
                      ...SPARE_FAMILY_OPTS,
                    ]}
                  />
                </div>
                <div className="min-w-[220px] flex-1">
                  <SearchableSelect
                    label="Spare part"
                    value={repSpareId}
                    onChange={(v) => {
                      setRepSpareId(v)
                      setSpareMonthly(null)
                    }}
                    options={[{ value: '', label: 'All spares' }, ...reportSpareOptions]}
                    placeholder="All spares"
                    emptyText="No spares match"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void loadReport()} disabled={repBusy}>
              {repBusy ? 'Loading…' : 'Preview'}
            </Button>
            <Button onClick={() => void exportReport()} disabled={repBusy}>
              Download Excel
            </Button>
            <span className="text-xs text-text-secondary">
              Excel includes a Filters sheet plus machine units and/or spare monthly rows
            </span>
          </div>

          {(machineMonthly || spareMonthly) && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {machineMonthly ? (
                  <div className="rounded-lg border border-border p-3 text-sm">
                    <div className="font-semibold">Machines</div>
                    <div className="mt-1 text-text-secondary">
                      Units added: {machineMonthly.unitsAdded} · Receipts:{' '}
                      {machineMonthly.receipts} · Value:{' '}
                      {machineMonthly.totalValue.toLocaleString('en-IN')}
                    </div>
                  </div>
                ) : null}
                {spareMonthly ? (
                  <div className="rounded-lg border border-border p-3 text-sm">
                    <div className="font-semibold">Spares</div>
                    <div className="mt-1 text-text-secondary">
                      Opening {spareMonthly.totals.opening} · In {spareMonthly.totals.received} · Out{' '}
                      {spareMonthly.totals.issued} · Closing {spareMonthly.totals.closing}
                    </div>
                  </div>
                ) : null}
              </div>

              {machineMonthly && machineMonthly.units.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">HMS ID</th>
                        <th className="px-3 py-2 font-medium">Serial</th>
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 font-medium">Warehouse</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {machineMonthly.units.slice(0, 50).map((u, i) => (
                        <tr key={String(u.hmsUniqId ?? i)} className="border-t border-border">
                          <td className="px-3 py-1.5">{String(u.addedDate ?? u.receivedDate ?? '—')}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {String(u.hmsUniqId ?? '—')}
                          </td>
                          <td className="px-3 py-1.5">{String(u.serialNo ?? '—')}</td>
                          <td className="px-3 py-1.5">
                            {String(u.productName ?? '—')}
                          </td>
                          <td className="px-3 py-1.5">{String(u.warehouse ?? '—')}</td>
                          <td className="px-3 py-1.5">{String(u.status ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {machineMonthly.units.length > 50 ? (
                    <p className="border-t border-border px-3 py-2 text-xs text-text-secondary">
                      Showing 50 of {machineMonthly.units.length} — download Excel for the full list
                    </p>
                  ) : null}
                </div>
              ) : null}

              {spareMonthly && spareMonthly.items.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">Spare</th>
                        <th className="px-3 py-2 font-medium">Family</th>
                        <th className="px-3 py-2 font-medium">Opening</th>
                        <th className="px-3 py-2 font-medium">Received</th>
                        <th className="px-3 py-2 font-medium">Issued</th>
                        <th className="px-3 py-2 font-medium">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spareMonthly.items.slice(0, 50).map((r) => (
                        <tr
                          key={String(r.sparePartId ?? r.name)}
                          className="border-t border-border"
                        >
                          <td className="px-3 py-1.5">{String(r.name ?? '—')}</td>
                          <td className="px-3 py-1.5">{String(r.machineFamily ?? '—')}</td>
                          <td className="px-3 py-1.5">{Number(r.opening ?? 0)}</td>
                          <td className="px-3 py-1.5">{Number(r.received ?? 0)}</td>
                          <td className="px-3 py-1.5">{Number(r.issued ?? 0)}</td>
                          <td className="px-3 py-1.5 font-medium">{Number(r.closing ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {spareMonthly.items.length > 50 ? (
                    <p className="border-t border-border px-3 py-2 text-xs text-text-secondary">
                      Showing 50 of {spareMonthly.items.length} — download Excel for the full list
                    </p>
                  ) : null}
                </div>
              ) : null}

              {machineMonthly &&
              machineMonthly.units.length === 0 &&
              (!spareMonthly || spareMonthly.items.length === 0) ? (
                <EmptyState
                  title="No rows for these filters"
                  subtitle="Widen the month, clear machine/spare filters, or add stock for this period."
                />
              ) : null}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

/** Redirect legacy `/erp/hub?tab=…` URLs to dedicated pages. */
export function InventoryHubRedirect() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const next = new URLSearchParams()
  for (const key of ['mode', 'open', 'category', 'sub', 'view'] as const) {
    const v = params.get(key)
    if (v) next.set(key, v)
  }
  const q = next.toString() ? `?${next.toString()}` : ''
  if (tab === 'stock') return <Navigate to={`/erp/stock${q}`} replace />
  if (tab === 'report') return <Navigate to="/erp/stock/report" replace />
  if (tab === 'suppliers') {
    const brands = params.get('sub') === 'brands' ? '?tab=brands' : ''
    return <Navigate to={`/erp/suppliers${brands}`} replace />
  }
  return <Navigate to={`/erp/products${q}`} replace />
}

export default InventoryHubPage
