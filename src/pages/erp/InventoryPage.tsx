import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  Package,
  Pencil,
  Plus,
  Printer,
  ShoppingCart,
  SlidersHorizontal,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { AiAssistCard } from '@/components/ai/AiAssistCard'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { ProductImage } from '@/components/ProductImage'
import { api, ApiClientError, num } from '@/lib/api'
import {
  productRequiresStamping,
  productAttrs,
  isWeighingCatalogProduct,
} from '@/lib/productCatalog'
import {
  HMS_FAMILY_OPTIONS,
  industryOptions,
  productCatalogMeta,
} from '@/lib/hmsCatalog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { can } from '@/lib/permissions'
import { resolveInventoryAreas } from '@/lib/inventoryAreas'
import { StockImportPanel } from '@/components/inventory/StockImportPanel'
import { RequisitionsPanel } from '@/components/sales/RequisitionsPanel'
import { APP_NAME } from '@/lib/branding'
import {
  challanFromCustomFields,
  openPrintableDeliveryChallan,
} from '@/lib/deliveryChallanPrint'
import { expandSerialRange, parseSerialPaste } from '@/lib/stockSerial'
import { downloadXlsx, printReportHtml, tableHtml } from '@/lib/reportExport'

type CatalogProduct = {
  id: string
  name: string
  sku: string
  unit?: string
  imageUrl?: string | null
  productType?: string
  attributes?: Record<string, unknown> | null
  purchasePrice?: number
  salePrice?: number
}

type StockUnit = {
  id: string
  productId: string
  warehouseId: string
  serialNo: string
  hmsUniqId?: string | null
  unitCost?: number | null
  brandId?: string | null
  receiptId?: string | null
  stampingDate?: string | null
  notes?: string | null
  status: string
  leadId?: string | null
  contactId?: string | null
  createdAt?: string
  updatedAt?: string
  product?: { id: string; sku: string; name: string; imageUrl?: string | null; attributes?: unknown } | null
  warehouse?: { id: string; name: string; code?: string } | null
  brand?: { id: string; name: string; code?: string } | null
  receipt?: {
    id: string
    invoiceNo?: string | null
    invoiceDate?: string | null
    receivedDate?: string | null
    spec?: string | null
    unitAmount?: number | string | null
    vendor?: { id: string; name: string } | null
  } | null
  lead?: { id: string; name: string; company?: string | null; phone?: string | null; city?: string | null; status?: string } | null
  contact?: { id: string; name: string; customerCode?: string | null; phone?: string | null; city?: string | null } | null
  customFields?: Record<string, unknown> | null
}

type ReceiveUnitRow = { serialNo: string; hmsUniqId: string }

type BrandRow = { id: string; name: string; code: string }
type VendorRow = { id: string; name: string }

type HistoryRow = {
  id: string
  movementType: string
  quantity: number
  notes?: string | null
  movedAt: string
  product?: { id: string; sku: string; name: string } | null
  warehouse?: { id: string; name: string } | null
  stockUnit?: { id: string; serialNo: string; status: string } | null
  performer?: { id: string; name: string } | null
}

type ProductGroup = {
  productId: string
  product: CatalogProduct | null
  total: number
  inStock: number
  demo: number
  sold: number
  returned: number
  warehouses: string[]
  latestStamp: string | null
  units: StockUnit[]
}

const STATUS_COLOR: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  IN_STOCK: 'green',
  DEMO: 'amber',
  RENTED: 'blue',
  SOLD: 'blue',
  RETURNED: 'gray',
}

type EditPlacement = 'STOCK' | 'DEMO' | 'RENTAL'

type EditFormState = {
  warehouseId: string
  serialNo: string
  hmsUniqId: string
  brandId: string
  unitCost: string
  stampingDate: string
  notes: string
  placement: EditPlacement
  demoCustomerName: string
  demoPhone: string
  demoEmail: string
  demoCompany: string
  demoAddress: string
  demoCity: string
  demoState: string
  demoAssigneeId: string
  rentalCustomerName: string
  rentalPhone: string
  rentalEmail: string
  rentalCompany: string
  rentalAddress: string
  rentalCity: string
  rentalState: string
  rentalStartAt: string
  rentalExpectedReturnAt: string
  rentalDailyRate: string
  rentalDeposit: string
  rentalTotal: string
}

function localDateTimeValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyEditForm(warehouseId = ''): EditFormState {
  return {
    warehouseId,
    serialNo: '',
    hmsUniqId: '',
    brandId: '',
    unitCost: '',
    stampingDate: '',
    notes: '',
    placement: 'STOCK',
    demoCustomerName: '',
    demoPhone: '',
    demoEmail: '',
    demoCompany: '',
    demoAddress: '',
    demoCity: '',
    demoState: '',
    demoAssigneeId: '',
    rentalCustomerName: '',
    rentalPhone: '',
    rentalEmail: '',
    rentalCompany: '',
    rentalAddress: '',
    rentalCity: '',
    rentalState: '',
    rentalStartAt: localDateTimeValue(),
    rentalExpectedReturnAt: '',
    rentalDailyRate: '',
    rentalDeposit: '',
    rentalTotal: '',
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function emptyReceiveForm(warehouseId = ''): {
  productId: string
  warehouseId: string
  vendorId: string
  brandId: string
  spec: string
  quantity: string
  unitAmount: string
  invoiceNo: string
  invoiceDate: string
  receivedDate: string
  startSerial: string
  stampingDate: string
  notes: string
  pasteSerials: string
  units: ReceiveUnitRow[]
} {
  return {
    productId: '',
    warehouseId,
    vendorId: '',
    brandId: '',
    spec: '',
    quantity: '1',
    unitAmount: '',
    invoiceNo: '',
    invoiceDate: todayIso(),
    receivedDate: todayIso(),
    startSerial: '',
    stampingDate: '',
    notes: '',
    pasteSerials: '',
    units: [],
  }
}

function attrLabel(p: CatalogProduct | null | undefined) {
  const a = p?.attributes
  if (!a || typeof a !== 'object') return ''
  const meta = productCatalogMeta(a as Record<string, unknown>)
  const capacity = String((a as Record<string, unknown>).capacity ?? '')
  const parts = [
    meta.familyName || null,
    meta.industryName || null,
    capacity || null,
  ].filter(Boolean)
  return parts.join(' · ')
}

function matchesFamily(
  meta: ReturnType<typeof productCatalogMeta>,
  family: string,
) {
  if (!family) return true
  if (meta.familyCode) return meta.familyCode === family
  if (family === 'WEIGHING_SCALES') return meta.catalogKind === 'WEIGHING'
  return false
}

function ymdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

type ExportPreset = 'today' | '7d' | '30d' | 'custom'

function rangeForPreset(preset: ExportPreset): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (preset === '7d') from.setDate(from.getDate() - 6)
  else if (preset === '30d') from.setDate(from.getDate() - 29)
  return { from: ymdLocal(from), to: ymdLocal(to) }
}

export function InventoryPage() {
  const [searchParams] = useSearchParams()
  const preselectProduct = searchParams.get('productId') || ''
  const tip = DEFAULT_TIPS['erp.inventory'] ?? {
    title: 'Serial stock',
    body: 'Receive a supplier invoice in one go: pick supplier, brand, model, qty + starting serial — HMS Unique IDs and ending serial auto-fill.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const showSalesRelease = can(authUser?.role, 'requisitions:fulfill')
  const invAreas = resolveInventoryAreas(authUser?.inventoryAreas, authUser?.role)
  const navigate = useNavigate()

  const [units, setUnits] = useState<StockUnit[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [levels, setLevels] = useState<Array<Record<string, unknown>>>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [stockAccessDenied, setStockAccessDenied] = useState(false)
  const [stockLoadError, setStockLoadError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [tab, setTab] = useState<'list' | 'add' | 'history' | 'demo'>('list')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState(() => ({
    ...emptyReceiveForm(),
    productId: preselectProduct,
  }))
  const [viewUnit, setViewUnit] = useState<StockUnit | null>(null)
  const [editUnit, setEditUnit] = useState<StockUnit | null>(null)
  const [editForm, setEditForm] = useState<EditFormState>(() => emptyEditForm())
  const [teamUsers, setTeamUsers] = useState<Array<{ id: string; name: string }>>([])
  const [receiveOpen, setReceiveOpen] = useState(false)
  /** null = choose machine vs spare before the receive form */
  const [receiveKind, setReceiveKind] = useState<null | 'machine' | 'spare'>(null)
  const [drillProductId, setDrillProductId] = useState<string | null>(null)

  const [exportOpen, setExportOpen] = useState(false)
  const [exportPreset, setExportPreset] = useState<ExportPreset>('today')
  const [exportFrom, setExportFrom] = useState(() => ymdLocal(new Date()))
  const [exportTo, setExportTo] = useState(() => ymdLocal(new Date()))
  const [exportWarehouseId, setExportWarehouseId] = useState('')
  const [exportProductId, setExportProductId] = useState('')
  const [exportBusy, setExportBusy] = useState(false)

  // Filters (product group list + serial drill-down)
  const [filterProductId, setFilterProductId] = useState('')
  const [filterFamily, setFilterFamily] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [filterWarehouseId, setFilterWarehouseId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterQ, setFilterQ] = useState('')
  const [filterStampFrom, setFilterStampFrom] = useState('')
  const [filterStampTo, setFilterStampTo] = useState('')
  const [moreFilters, setMoreFilters] = useState(false)
  const [returnConfirm, setReturnConfirm] = useState<StockUnit | null>(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [returnBusy, setReturnBusy] = useState(false)
  const [returnOutcome, setReturnOutcome] = useState<'NOT_INTERESTED' | 'READY_TO_BUY'>(
    'NOT_INTERESTED',
  )

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  )

  const receiveProduct = useMemo(
    () => products.find((p) => p.id === form.productId) ?? null,
    [products, form.productId],
  )

  const addFormRequiresStamping = useMemo(
    () => (receiveProduct ? productRequiresStamping(receiveProduct) : false),
    [receiveProduct],
  )

  const receiveIsWeighing = useMemo(
    () => (receiveProduct ? isWeighingCatalogProduct(receiveProduct) : false),
    [receiveProduct],
  )

  const receiveEndSerial = useMemo(() => {
    if (receiveIsWeighing) return ''
    const qty = Math.max(1, Math.floor(Number(form.quantity) || 1))
    if (!form.startSerial.trim() || qty < 1) return ''
    return expandSerialRange(form.startSerial.trim(), qty).at(-1) ?? ''
  }, [form.startSerial, form.quantity, receiveIsWeighing])

  const editFormRequiresStamping = useMemo(() => {
    if (!editUnit) return false
    const product = editUnit.product ?? productMap[editUnit.productId]
    return product ? productRequiresStamping(product) : false
  }, [editUnit, productMap])

  const viewUnitRequiresStamping = useMemo(() => {
    if (!viewUnit) return false
    const product = viewUnit.product ?? productMap[viewUnit.productId]
    return product ? productRequiresStamping(product) : false
  }, [viewUnit, productMap])

  const load = useCallback(async () => {
    setStockAccessDenied(false)
    setStockLoadError(null)
    if (!invAreas.machines) {
      setStockAccessDenied(true)
      setUnits([])
      setHistory([])
      setLevels([])
      return
    }
    try {
      // Load catalog + warehouses first so Add stock works even if serial API fails
      const [lookups, productPage] = await Promise.all([
        api.lookups(),
        api.products({ limit: 200 }),
      ])
      // Prefer lookups (active catalog + attributes); merge products API for any extras
      const byId = new Map<string, CatalogProduct>()
      for (const p of lookups.products) {
        byId.set(p.id, {
          id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          imageUrl: p.imageUrl ?? null,
          productType: p.productType ? String(p.productType) : undefined,
          attributes: p.attributes ?? null,
          purchasePrice: num(p.purchasePrice),
          salePrice: num(p.salePrice),
        })
      }
      for (const p of productPage.items ?? []) {
        const id = String(p.id)
        const prev = byId.get(id)
        byId.set(id, {
          id,
          name: String(p.name ?? prev?.name ?? ''),
          sku: String(p.sku ?? prev?.sku ?? ''),
          unit: p.unit ? String(p.unit) : prev?.unit || 'pcs',
          imageUrl: (p.imageUrl as string | null) ?? prev?.imageUrl ?? null,
          productType: p.productType ? String(p.productType) : prev?.productType,
          attributes:
            (p.attributes as Record<string, unknown> | null) ?? prev?.attributes ?? null,
          purchasePrice: num(p.purchasePrice ?? prev?.purchasePrice),
          salePrice: num(p.salePrice ?? prev?.salePrice),
        })
      }
      const merged = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
      setProducts(merged)
      const WAREHOUSE_ORDER = ['MAIN', 'STORE', 'DEMO', 'EXECUTIVE', 'STAMPING']
      const sortedWarehouses = [...lookups.warehouses].sort((a, b) => {
        const ai = WAREHOUSE_ORDER.indexOf(String(a.code ?? '').toUpperCase())
        const bi = WAREHOUSE_ORDER.indexOf(String(b.code ?? '').toUpperCase())
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
      setWarehouses(sortedWarehouses)
      setTeamUsers(
        (lookups.users ?? []).map((u) => ({ id: u.id, name: u.name })).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      const mainWh =
        sortedWarehouses.find((w) => String(w.code ?? '').toUpperCase() === 'MAIN') ??
        sortedWarehouses[0]
      setForm((f) => ({
        ...f,
        warehouseId: f.warehouseId || mainWh?.id || '',
        productId: f.productId || preselectProduct || '',
      }))
      if (preselectProduct) {
        setTab('list')
        setReceiveOpen(true)
      }

      const settled = await Promise.allSettled([
        api.stockUnits({ limit: 200 }),
        api.inventoryHistory({ limit: 200 }),
        api.inventory(),
        api.inventoryBrands(),
        api.vendors(),
      ])
      const [unitsRes, histRes, levelsRes, brandsRes, vendorsRes] = settled

      const denied = settled.some(
        (r) => r.status === 'rejected' && r.reason instanceof ApiClientError && r.reason.status === 403,
      )
      if (denied) {
        setStockAccessDenied(true)
        setUnits([])
        setHistory([])
        setLevels([])
        addToast({
          type: 'error',
          message: 'You do not have access to machine / product stock',
        })
      } else {
        const stockFail = settled
          .slice(0, 3)
          .find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
        if (stockFail) {
          const msg =
            stockFail.reason instanceof ApiClientError
              ? stockFail.reason.message
              : 'Failed to load stock data'
          setStockLoadError(msg)
          addToast({ type: 'error', message: msg })
        }
        setUnits(unitsRes.status === 'fulfilled' ? (unitsRes.value as StockUnit[]) : [])
        setHistory(histRes.status === 'fulfilled' ? (histRes.value as HistoryRow[]) : [])
        setLevels(levelsRes.status === 'fulfilled' ? levelsRes.value : [])
      }

      const brandRows = brandsRes.status === 'fulfilled' ? brandsRes.value : []
      const vendorRows = vendorsRes.status === 'fulfilled' ? vendorsRes.value : []
      setBrands(
        brandRows.map((b) => ({
          id: String(b.id),
          name: String(b.name ?? ''),
          code: String(b.code ?? ''),
        })),
      )
      setVendors(
        vendorRows.map((v) => ({
          id: String(v.id),
          name: String(v.name ?? ''),
        })),
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load inventory',
      })
    }
  }, [addToast, preselectProduct, invAreas.machines])

  useEffect(() => {
    void load()
  }, [load])

  async function returnDemoToStock() {
    if (!returnConfirm) return
    setReturnBusy(true)
    try {
      const linkedEnquiry = Boolean(
        returnConfirm.leadId || returnConfirm.customFields?.demoLeadId,
      )
      const result = await api.returnDemoUnit(
        returnConfirm.id,
        linkedEnquiry
          ? {
              outcome: returnOutcome,
              notes: returnNotes.trim() || undefined,
            }
          : { notes: returnNotes.trim() || undefined },
      )
      setReturnConfirm(null)
      setReturnNotes('')
      if (result.outcome === 'READY_TO_BUY' || result.next === 'requisition' || result.next === 'invoice') {
        const leadId = String((result as { lead?: { id?: string }; leadId?: string }).lead?.id
          ?? (result as { leadId?: string }).leadId
          ?? '')
        addToast({
          type: 'success',
          message: 'Customer converted — approve sales requisition, then reduce stock (proforma after)',
        })
        if (leadId) {
          navigate(`/sale-tracking/${encodeURIComponent(leadId)}`)
          return
        }
        navigate('/sale-tracking?queue=requisitions')
        return
      } else if (result.enquiryMissing) {
        addToast({
          type: 'success',
          message: `Serial ${returnConfirm.serialNo} returned to stock (linked enquiry was missing or deleted)`,
        })
      } else if (linkedEnquiry) {
        addToast({
          type: 'success',
          message: `Serial ${returnConfirm.serialNo} returned — enquiry closed`,
        })
      } else {
        addToast({
          type: 'success',
          message: `Serial ${returnConfirm.serialNo} returned — back in stock`,
        })
      }
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not return demo unit',
      })
    } finally {
      setReturnBusy(false)
    }
  }

  function demoIssuedAt(row: StockUnit) {
    const cf = row.customFields ?? {}
    const at = cf.demoIssuedAt ? String(cf.demoIssuedAt) : row.updatedAt ?? row.createdAt
    return at ? formatDate(String(at)) : '—'
  }

  function productSpecs(p: CatalogProduct | null | undefined, cf?: Record<string, unknown> | null) {
    const attrs = (cf?.productAttributes as Record<string, unknown> | undefined) ?? p?.attributes
    if (!attrs || typeof attrs !== 'object') return attrLabel(p)
    const machineType = String(attrs.machineType ?? attrs.type ?? '')
    const capacity = String(attrs.capacity ?? '')
    return [machineType, capacity].filter(Boolean).join(' · ') || attrLabel(p) || '—'
  }

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'demo') setTab('demo')
  }, [searchParams])

  const demoUnits = useMemo(() => units.filter((u) => u.status === 'DEMO'), [units])

  const filteredUnits = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    return units.filter((u) => {
      const p = (productMap[u.productId] ?? u.product) as CatalogProduct | null | undefined
      const meta = productCatalogMeta(productAttrs(p ?? {}))
      if (!matchesFamily(meta, filterFamily)) return false
      if (filterIndustry && meta.industryCode !== filterIndustry) return false
      if (filterProductId && u.productId !== filterProductId) return false
      if (filterWarehouseId && u.warehouseId !== filterWarehouseId) return false
      if (filterStatus && u.status !== filterStatus) return false
      if (q) {
        const name = (p && 'name' in p ? String(p.name) : '') || ''
        const sku = (p && 'sku' in p ? String(p.sku) : '') || ''
        const hay =
          `${name} ${sku} ${u.serialNo} ${u.hmsUniqId ?? ''} ${u.brand?.name ?? ''} ${u.receipt?.vendor?.name ?? ''} ${u.receipt?.invoiceNo ?? ''} ${meta.familyName} ${meta.industryName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filterStampFrom && u.stampingDate && String(u.stampingDate).slice(0, 10) < filterStampFrom) {
        return false
      }
      if (filterStampTo && u.stampingDate && String(u.stampingDate).slice(0, 10) > filterStampTo) {
        return false
      }
      if ((filterStampFrom || filterStampTo) && !u.stampingDate) return false
      return true
    })
  }, [
    units,
    productMap,
    filterFamily,
    filterIndustry,
    filterProductId,
    filterWarehouseId,
    filterStatus,
    filterQ,
    filterStampFrom,
    filterStampTo,
  ])

  const groups = useMemo(() => {
    const map = new Map<string, ProductGroup>()
    for (const u of filteredUnits) {
      let g = map.get(u.productId)
      if (!g) {
        g = {
          productId: u.productId,
          product: productMap[u.productId] ?? (u.product
            ? {
                id: u.product.id,
                name: u.product.name,
                sku: u.product.sku,
                imageUrl: u.product.imageUrl,
                attributes: (u.product.attributes as Record<string, unknown> | null) ?? null,
              }
            : null),
          total: 0,
          inStock: 0,
          demo: 0,
          sold: 0,
          returned: 0,
          warehouses: [],
          latestStamp: null,
          units: [],
        }
        map.set(u.productId, g)
      }
      g.total += 1
      if (u.status === 'IN_STOCK') g.inStock += 1
      else if (u.status === 'DEMO') g.demo += 1
      else if (u.status === 'SOLD') g.sold += 1
      else if (u.status === 'RETURNED') g.returned += 1
      const wh = u.warehouse?.name
      if (wh && !g.warehouses.includes(wh)) g.warehouses.push(wh)
      const stamp = u.stampingDate ? String(u.stampingDate).slice(0, 10) : null
      if (stamp && (!g.latestStamp || stamp > g.latestStamp)) g.latestStamp = stamp
      g.units.push(u)
    }
    return [...map.values()].sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? ''))
  }, [filteredUnits, productMap])

  const drillGroup = useMemo(
    () => (drillProductId ? groups.find((g) => g.productId === drillProductId) ?? null : null),
    [groups, drillProductId],
  )

  const anyGroupRequiresStamping = useMemo(
    () => groups.some((g) => g.product && productRequiresStamping(g.product)),
    [groups],
  )

  const summary = useMemo(() => {
    const inStock = units.filter((u) => u.status === 'IN_STOCK').length
    const demo = units.filter((u) => u.status === 'DEMO').length
    const sold = units.filter((u) => u.status === 'SOLD').length
    const value = levels.reduce((s, r) => s + num(r.stockValue), 0)
    return { inStock, demo, sold, value, models: groups.length }
  }, [units, levels, groups.length])

  function clearFilters() {
    setFilterProductId('')
    setFilterFamily('')
    setFilterIndustry('')
    setFilterWarehouseId('')
    setFilterStatus('')
    setFilterQ('')
    setFilterStampFrom('')
    setFilterStampTo('')
  }

  const advancedActive = Boolean(filterWarehouseId || filterStampFrom || filterStampTo || filterIndustry)
  const filtersActive = Boolean(
    filterProductId || filterFamily || filterStatus || filterQ || advancedActive,
  )

  const productsForFilter = useMemo(() => {
    return products.filter((p) => {
      const meta = productCatalogMeta(productAttrs(p))
      if (!matchesFamily(meta, filterFamily)) return false
      if (filterIndustry && meta.industryCode !== filterIndustry) return false
      return true
    })
  }, [products, filterFamily, filterIndustry])

  async function rebuildUnitGrid(next: typeof form, opts?: { clampQty?: boolean }) {
    const parsed = Math.floor(Number(String(next.quantity).trim()))
    const qtyValid = Number.isFinite(parsed) && parsed >= 1
    const qty = qtyValid ? Math.min(200, parsed) : 0
    const product = products.find((p) => p.id === next.productId)
    const weighing = product ? isWeighingCatalogProduct(product) : false
    const startReady = Boolean(next.startSerial.trim()) || Boolean(next.pasteSerials.trim())

    if (!qty) {
      setForm({ ...next, units: [] })
      return
    }

    // Weighing: Unique IDs from qty alone. Others: wait until start serial (or paste) so end + IDs fill together.
    const shouldPreviewIds = Boolean(next.productId) && (weighing || startReady)
    let uniqIds: string[] = []
    if (shouldPreviewIds) {
      try {
        uniqIds = await api.previewHmsUniqIds({ productId: next.productId, quantity: qty })
      } catch {
        uniqIds = []
      }
    }

    let serials: string[] = []
    if (weighing) {
      serials = uniqIds.map((id) => id)
    } else {
      const pasted = parseSerialPaste(next.pasteSerials)
      if (pasted.length > 0) {
        serials = pasted.slice(0, qty)
        while (serials.length < qty) serials.push('')
      } else if (next.startSerial.trim()) {
        serials = expandSerialRange(next.startSerial.trim(), qty)
      } else {
        serials = Array.from({ length: qty }, () => '')
      }
    }

    const units: ReceiveUnitRow[] = Array.from({ length: qty }, (_, i) => ({
      serialNo: weighing ? uniqIds[i] ?? '' : serials[i] ?? '',
      hmsUniqId: uniqIds[i] ?? '',
    }))
    setForm({
      ...next,
      quantity: opts?.clampQty ? String(qty) : next.quantity,
      units,
    })
  }

  function openAdd(defaults?: Partial<typeof form>) {
    const mainWh =
      warehouses.find((w) => String(w.code ?? '').toUpperCase() === 'MAIN') ?? warehouses[0]
    const base = emptyReceiveForm(defaults?.warehouseId || mainWh?.id || '')
    const next = {
      ...base,
      ...defaults,
      productId: defaults?.productId || '',
      units: [],
    }
    setForm(next)
    setErrors({})
    setViewUnit(null)
    setEditUnit(null)
    setReceiveKind(null)
    setReceiveOpen(true)
    if (tab === 'add' || tab === 'history') setTab('list')
    void rebuildUnitGrid(next)
  }

  function closeReceive() {
    setReceiveOpen(false)
    setReceiveKind(null)
    setErrors({})
  }

  function openEdit(unit: StockUnit) {
    const cf = (unit.customFields ?? {}) as Record<string, unknown>
    const placement: EditPlacement =
      unit.status === 'DEMO' ? 'DEMO' : unit.status === 'RENTED' ? 'RENTAL' : 'STOCK'
    const mainWh =
      warehouses.find((w) => String(w.code ?? '').toUpperCase() === 'MAIN') ?? warehouses[0]
    setReceiveOpen(false)
    setViewUnit(null)
    setEditUnit(unit)
    setEditForm({
      ...emptyEditForm(unit.warehouseId || mainWh?.id || ''),
      warehouseId: unit.warehouseId || mainWh?.id || '',
      serialNo: unit.serialNo,
      hmsUniqId: unit.hmsUniqId ?? '',
      brandId: unit.brandId ?? '',
      unitCost: unit.unitCost != null ? String(unit.unitCost) : '',
      stampingDate: unit.stampingDate ? String(unit.stampingDate).slice(0, 10) : '',
      notes: unit.notes ?? '',
      placement,
      demoCustomerName: String(cf.demoCustomerName ?? unit.lead?.name ?? ''),
      demoPhone: String(cf.demoPhone ?? unit.lead?.phone ?? ''),
      demoEmail: '',
      demoCompany: String(cf.demoCompany ?? unit.lead?.company ?? ''),
      demoAddress: String(cf.demoAddress ?? ''),
      demoCity: String(cf.demoCity ?? unit.lead?.city ?? ''),
      demoState: String(cf.demoState ?? ''),
      demoAssigneeId: String(cf.demoExecutiveId ?? ''),
      rentalCustomerName: String(cf.rentalCustomerName ?? ''),
      rentalPhone: String(cf.rentalCustomerPhone ?? ''),
      rentalCompany: String(cf.rentalCustomerCompany ?? ''),
      rentalStartAt: cf.rentedAt
        ? localDateTimeValue(new Date(String(cf.rentedAt)))
        : localDateTimeValue(),
      rentalExpectedReturnAt: cf.expectedReturnAt
        ? localDateTimeValue(new Date(String(cf.expectedReturnAt)))
        : '',
    })
    setErrors({})
  }

  async function saveAdd() {
    const qty = Math.floor(Number(form.quantity) || 0)
    const next: Record<string, string> = {}
    if (!form.productId) next.productId = 'Select a product / model'
    if (!form.warehouseId) next.warehouseId = 'Select a warehouse'
    if (!form.vendorId) next.vendorId = 'Select a supplier'
    if (!form.brandId) next.brandId = 'Select a brand'
    if (qty < 1 || qty > 200) next.quantity = 'Quantity must be 1–200'
    const weighing = receiveProduct ? isWeighingCatalogProduct(receiveProduct) : false
    if (
      !weighing &&
      !form.startSerial.trim() &&
      form.units.every((u) => !u.serialNo.trim())
    ) {
      next.startSerial = 'Enter starting serial (or paste serials)'
    }
    const units =
      form.units.length === qty
        ? form.units
        : weighing
          ? Array.from({ length: qty }, (_, i) => ({
              serialNo: form.units[i]?.hmsUniqId || form.units[i]?.serialNo || '',
              hmsUniqId: form.units[i]?.hmsUniqId || '',
            }))
          : expandSerialRange(form.startSerial.trim() || 'SN0001', qty).map((serialNo, i) => ({
              serialNo: form.units[i]?.serialNo || serialNo,
              hmsUniqId: form.units[i]?.hmsUniqId || '',
            }))
    if (!weighing && units.some((u) => !u.serialNo.trim())) {
      next.serialNo = 'Every unit needs a serial number'
    }
    if (units.some((u) => !u.hmsUniqId.trim())) {
      next.hmsUniqId = 'HMS Unique ID missing — pick product and qty again'
    }
    setErrors(next)
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }
    setSaving(true)
    try {
      let vendorId = form.vendorId
      let brandId = form.brandId
      const knownVendor = vendors.find(
        (v) => v.id === vendorId || v.name.toLowerCase() === vendorId.trim().toLowerCase(),
      )
      if (knownVendor) vendorId = knownVendor.id
      else if (vendorId.trim()) {
        const created = await api.createVendor({ name: vendorId.trim() })
        vendorId = String(created.id)
        setVendors((prev) => [...prev, { id: vendorId, name: String(created.name ?? vendorId) }])
      }
      const knownBrand = brands.find(
        (b) => b.id === brandId || b.name.toLowerCase() === brandId.trim().toLowerCase(),
      )
      if (knownBrand) brandId = knownBrand.id
      else if (brandId.trim()) {
        const created = await api.createInventoryBrand({ name: brandId.trim() })
        brandId = String(created.id)
        setBrands((prev) => [
          ...prev,
          {
            id: brandId,
            name: String(created.name ?? brandId),
            code: String(created.code ?? brandId),
          },
        ])
      }
      const res = await api.receiveStockBatch({
        productId: form.productId,
        warehouseId: form.warehouseId,
        vendorId: vendorId || null,
        brandId: brandId || null,
        spec: form.spec.trim() || null,
        quantity: qty,
        unitAmount: form.unitAmount ? Number(form.unitAmount) : 0,
        invoiceNo: form.invoiceNo.trim() || null,
        invoiceDate: form.invoiceDate || null,
        receivedDate: form.receivedDate || todayIso(),
        notes: form.notes.trim() || null,
        stampingDate: addFormRequiresStamping ? form.stampingDate || null : null,
        startSerial: form.startSerial.trim() || null,
        units: units.map((u) => ({
          serialNo: u.serialNo.trim(),
          hmsUniqId: u.hmsUniqId.trim() || null,
        })),
      })
      addToast({
        type: 'success',
        message: `${res.quantity} unit${res.quantity === 1 ? '' : 's'} were added to stock`,
      })
      const addedProductId = form.productId
      const mainWh =
        warehouses.find((w) => String(w.code ?? '').toUpperCase() === 'MAIN') ?? warehouses[0]
      setForm(emptyReceiveForm(mainWh?.id || ''))
      setErrors({})
      setReceiveOpen(false)
      setTab('list')
      setDrillProductId(addedProductId)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not receive stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!editUnit) return
    const next: Record<string, string> = {}
    if (!editForm.serialNo.trim()) next.serialNo = 'Serial number is required'
    if (editForm.placement === 'STOCK' && !editForm.warehouseId) {
      next.warehouseId = 'Select a warehouse'
    }
    if (editForm.placement === 'DEMO') {
      if (!editForm.demoCustomerName.trim()) next.demoCustomerName = 'Customer name is required'
      if (!editForm.demoAssigneeId) next.demoAssigneeId = 'Select who is responsible for this demo'
    }
    if (editForm.placement === 'RENTAL') {
      if (!editForm.rentalCustomerName.trim()) next.rentalCustomerName = 'Customer name is required'
      if (!editForm.rentalStartAt) next.rentalStartAt = 'Rental start is required'
    }
    setErrors(next)
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }
    setSaving(true)
    try {
      const demoWh = warehouses.find((w) => String(w.code ?? '').toUpperCase() === 'DEMO')
      const body: Record<string, unknown> = {
        serialNo: editForm.serialNo.trim(),
        hmsUniqId: editForm.hmsUniqId.trim() || null,
        brandId: editForm.brandId || null,
        unitCost: editForm.unitCost ? Number(editForm.unitCost) : null,
        stampingDate: editFormRequiresStamping ? editForm.stampingDate || null : null,
        notes: editForm.notes.trim() || null,
        placement: editForm.placement,
      }
      if (editForm.placement === 'STOCK') {
        body.warehouseId = editForm.warehouseId
      }
      if (editForm.placement === 'DEMO') {
        body.warehouseId = demoWh?.id || editForm.warehouseId
        body.demo = {
          customerName: editForm.demoCustomerName.trim(),
          customerPhone: editForm.demoPhone.trim() || null,
          customerEmail: editForm.demoEmail.trim() || null,
          customerCompany: editForm.demoCompany.trim() || null,
          customerAddress: editForm.demoAddress.trim() || null,
          city: editForm.demoCity.trim() || null,
          state: editForm.demoState.trim() || null,
          assigneeUserId: editForm.demoAssigneeId,
          notes: editForm.notes.trim() || null,
        }
      }
      if (editForm.placement === 'RENTAL') {
        body.rental = {
          customerName: editForm.rentalCustomerName.trim(),
          customerPhone: editForm.rentalPhone.trim() || null,
          customerEmail: editForm.rentalEmail.trim() || null,
          customerCompany: editForm.rentalCompany.trim() || null,
          customerAddress: editForm.rentalAddress.trim() || null,
          city: editForm.rentalCity.trim() || null,
          state: editForm.rentalState.trim() || null,
          startAt: new Date(editForm.rentalStartAt).toISOString(),
          expectedReturnAt: editForm.rentalExpectedReturnAt
            ? new Date(editForm.rentalExpectedReturnAt).toISOString()
            : null,
          dailyRate: editForm.rentalDailyRate ? Number(editForm.rentalDailyRate) : null,
          depositAmount: editForm.rentalDeposit ? Number(editForm.rentalDeposit) : null,
          totalAmount: editForm.rentalTotal ? Number(editForm.rentalTotal) : null,
          notes: editForm.notes.trim() || null,
        }
      }
      await api.updateStockUnit(editUnit.id, body)
      addToast({
        type: 'success',
        message:
          editForm.placement === 'DEMO'
            ? 'Demo details saved — unit marked DEMO'
            : editForm.placement === 'RENTAL'
              ? 'Rental saved — unit marked RENTED'
              : 'Stock unit updated',
      })
      setEditUnit(null)
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Update failed' })
    } finally {
      setSaving(false)
    }
  }

  function onEditWarehouseChange(warehouseId: string) {
    const wh = warehouses.find((w) => w.id === warehouseId)
    const code = String(wh?.code ?? '').toUpperCase()
    setEditForm((f) => ({
      ...f,
      warehouseId,
      placement: code === 'DEMO' || code === 'EXECUTIVE' ? 'DEMO' : f.placement === 'DEMO' ? 'STOCK' : f.placement,
    }))
  }

  function applyExportPreset(preset: ExportPreset) {
    setExportPreset(preset)
    if (preset !== 'custom') {
      const r = rangeForPreset(preset)
      setExportFrom(r.from)
      setExportTo(r.to)
    }
  }

  async function downloadStockReport(format: 'xlsx' | 'pdf') {
    if (!exportFrom || !exportTo) {
      addToast({ type: 'error', message: 'Pick a from and to date' })
      return
    }
    if (exportFrom > exportTo) {
      addToast({ type: 'error', message: 'From date must be on or before To date' })
      return
    }
    // Open print tab in the same click gesture (async fetch would otherwise blank/block it)
    let printWin: Window | null = null
    if (format === 'pdf') {
      printWin = window.open('about:blank', '_blank')
      if (!printWin) {
        addToast({
          type: 'error',
          message: 'Popup blocked — allow popups for this site, then try Print again',
        })
        return
      }
      printWin.document.write(
        '<!doctype html><title>Preparing report…</title><body style="font-family:system-ui;padding:24px;color:#64748b">Preparing stock report…</body>',
      )
      printWin.document.close()
    }
    setExportBusy(true)
    try {
      const data = await api.inventoryExport({
        from: exportFrom,
        to: exportTo,
        warehouseId: exportWarehouseId || undefined,
        productId: exportProductId || undefined,
      })
      if (!data.units.length && !data.receipts.length) {
        printWin?.close()
        addToast({ type: 'error', message: 'No stock added in this date range' })
        return
      }
      const base = `HMS-stock-in_${data.from}_to_${data.to}`
      const unitRows = data.units.map((u) => ({
        'Added date': u.addedDate ?? '',
        'HMS Unique ID': u.hmsUniqId ?? '',
        'Serial / ID': u.serialNo ?? '',
        Product: u.productName ?? '',
        SKU: u.sku ?? '',
        Brand: u.brand ?? '',
        Supplier: u.supplier ?? '',
        Warehouse: u.warehouse ?? '',
        Status: u.status ?? '',
        'Unit cost': u.unitCost ?? 0,
        'Invoice no': u.invoiceNo ?? '',
        'Received date': u.receivedDate ?? '',
        Spec: u.spec ?? '',
        'Stamping date': u.stampingDate ?? '',
        Notes: u.notes ?? '',
      }))
      const receiptRows = data.receipts.map((r) => {
        const product = r.product as { name?: string; sku?: string } | null
        const vendor = r.vendor as { name?: string } | null
        const brand = r.brand as { name?: string } | null
        const warehouse = r.warehouse as { name?: string } | null
        return {
          'Received date': r.receivedDate ?? '',
          'Invoice no': r.invoiceNo ?? '',
          'Invoice date': r.invoiceDate ?? '',
          Supplier: vendor?.name ?? '',
          Brand: brand?.name ?? '',
          Product: product?.name ?? '',
          SKU: product?.sku ?? '',
          Warehouse: warehouse?.name ?? '',
          Qty: r.quantity ?? 0,
          'Unit amount': r.unitAmount ?? 0,
          'Line total': r.lineTotal ?? 0,
          Spec: r.spec ?? '',
          Notes: r.notes ?? '',
        }
      })
      const summaryRows = [
        { Metric: 'From', Value: data.from },
        { Metric: 'To', Value: data.to },
        { Metric: 'Units added', Value: data.summary.unitsAdded },
        { Metric: 'Receipt batches', Value: data.summary.receipts },
        { Metric: 'Stock value (unit cost)', Value: data.summary.totalValue },
      ]

      if (format === 'xlsx') {
        downloadXlsx(`${base}.xlsx`, [
          { name: 'Summary', rows: summaryRows },
          { name: 'Units added', rows: unitRows },
          { name: 'Receipts', rows: receiptRows.length ? receiptRows : [{ note: 'No receipt batches' }] },
        ])
        addToast({
          type: 'success',
          message: `Excel downloaded · ${data.summary.unitsAdded} unit${data.summary.unitsAdded === 1 ? '' : 's'}`,
        })
      } else {
        const opened = printReportHtml(
          `Stock in report · ${data.from} to ${data.to}`,
          [
            {
              heading: 'Summary',
              html: tableHtml(
                ['Metric', 'Value'],
                summaryRows.map((r) => [
                  String(r.Metric),
                  r.Metric === 'Stock value (unit cost)'
                    ? formatCurrency(Number(r.Value))
                    : String(r.Value),
                ]),
              ),
            },
            {
              heading: `Units added (${unitRows.length})`,
              html: tableHtml(
                [
                  'Date',
                  'HMS ID',
                  'Serial',
                  'Product',
                  'Brand',
                  'Supplier',
                  'Warehouse',
                  'Cost',
                  'Invoice',
                ],
                unitRows.map((r) => [
                  String(r['Added date']),
                  String(r['HMS Unique ID']),
                  String(r['Serial / ID']),
                  String(r.Product),
                  String(r.Brand),
                  String(r.Supplier),
                  String(r.Warehouse),
                  formatCurrency(Number(r['Unit cost'] || 0)),
                  String(r['Invoice no']),
                ]),
              ),
            },
            {
              heading: `Receipt batches (${receiptRows.length})`,
              html: receiptRows.length
                ? tableHtml(
                    ['Received', 'Invoice', 'Supplier', 'Product', 'Qty', 'Total'],
                    receiptRows.map((r) => [
                      String(r['Received date']),
                      String(r['Invoice no']),
                      String(r.Supplier),
                      String(r.Product),
                      String(r.Qty),
                      formatCurrency(Number(r['Line total'] || 0)),
                    ]),
                  )
                : '<p>No receipt batches in this range.</p>',
            },
          ],
          printWin,
        )
        if (!opened) {
          printWin?.close()
          addToast({
            type: 'error',
            message: 'Could not open print report — try again or use Excel',
          })
          return
        }
        addToast({ type: 'success', message: 'Report opened — use Print / Save PDF in the new tab' })
      }
      if (data.truncated) {
        addToast({
          type: 'info',
          message: 'Export capped at 5,000 units — narrow the date range if needed',
        })
      }
      setExportOpen(false)
    } catch (err) {
      printWin?.close()
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not download stock report',
      })
    } finally {
      setExportBusy(false)
    }
  }

  const filterBar = (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1 basis-[220px]">
          <Input
            className="h-9"
            placeholder="Search name, SKU, HMS ID, serial, brand, invoice…"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
          />
        </div>
        <div className="w-[180px] shrink-0">
          <Select
            className="h-9"
            value={filterFamily}
            onChange={(e) => {
              setFilterFamily(e.target.value)
              setFilterIndustry('')
              setFilterProductId('')
            }}
            options={[{ value: '', label: 'All product families' }, ...HMS_FAMILY_OPTIONS]}
          />
        </div>
        {filterFamily === 'WEIGHING_SCALES' ? (
          <div className="w-[200px] shrink-0">
            <Select
              className="h-9"
              value={filterIndustry}
              onChange={(e) => {
                setFilterIndustry(e.target.value)
                setFilterProductId('')
              }}
              options={[
                { value: '', label: 'All industries' },
                ...industryOptions('WEIGHING_SCALES'),
              ]}
            />
          </div>
        ) : null}
        <div className="w-[200px] shrink-0">
          <Select
            className="h-9"
            value={filterProductId}
            onChange={(e) => setFilterProductId(e.target.value)}
            options={[
              { value: '', label: 'All machines' },
              ...productsForFilter.map((p) => ({ value: p.id, label: `${p.name}` })),
            ]}
          />
        </div>
        <div className="w-[130px] shrink-0">
          <Select
            className="h-9"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'IN_STOCK', label: 'In stock' },
              { value: 'DEMO', label: 'Demo' },
              { value: 'SOLD', label: 'Sold' },
              { value: 'RETURNED', label: 'Returned' },
            ]}
          />
        </div>
        <Button
          variant={moreFilters || advancedActive ? 'primary' : 'outline'}
          size="sm"
          className="h-9 shrink-0"
          onClick={() => setMoreFilters((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          More
          {advancedActive ? (
            <span className="rounded bg-white/20 px-1.5 text-[10px]">on</span>
          ) : (
            <ChevronDown size={14} className={moreFilters ? 'rotate-180' : ''} />
          )}
        </Button>
        {filtersActive ? (
          <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={clearFilters}>
            <X size={14} /> Clear
          </Button>
        ) : null}
      </div>
      {moreFilters ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5">
          <div className="w-[160px]">
            <Select
              className="h-9"
              value={filterWarehouseId}
              onChange={(e) => setFilterWarehouseId(e.target.value)}
              options={[
                { value: '', label: 'All warehouses' },
                ...warehouses.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
          </div>
          <div className="w-[150px]">
            <Input
              className="h-9"
              type="date"
              title="Stamping from"
              value={filterStampFrom}
              onChange={(e) => setFilterStampFrom(e.target.value)}
            />
          </div>
          <div className="w-[150px]">
            <Input
              className="h-9"
              type="date"
              title="Stamping to"
              value={filterStampTo}
              onChange={(e) => setFilterStampTo(e.target.value)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )

  if (stockAccessDenied) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Inventory"
          breadcrumbs={[{ label: 'ERP' }, { label: 'Inventory' }]}
        />
        <Card className="border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
          <p className="font-semibold">No access to machine / product stock</p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">
            Your account is not assigned the Machines inventory area. Ask your company admin (or
            platform admin) to enable it under Users → Inventory visibility.
          </p>
          {(invAreas.sparesBilling || invAreas.sparesWeighing) && (
            <div className="mt-4">
              <Link to="/erp/spare-stock">
                <Button>Go to Spare stock</Button>
              </Link>
            </div>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        count={units.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Inventory' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                applyExportPreset(exportPreset === 'custom' ? 'today' : exportPreset)
                setExportOpen(true)
              }}
            >
              <Download size={16} /> Download stock
            </Button>
            <Link to="/erp/products">
              <Button variant="outline">
                <Package size={16} /> Products
              </Button>
            </Link>
            <Link to="/erp/suppliers">
              <Button variant="outline">Suppliers</Button>
            </Link>
            <Link to="/erp/purchase-orders">
              <Button variant="outline">
                <ShoppingCart size={16} /> Purchase orders
              </Button>
            </Link>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet size={16} /> Import Excel
            </Button>
            <Button onClick={() => openAdd()}>
              <Plus size={16} /> Receive stock
            </Button>
          </div>
        }
      />
      {importOpen ? (
        <Card className="p-4">
          <StockImportPanel
            kinds={['machines']}
            onImported={() => void load()}
            onClose={() => setImportOpen(false)}
          />
        </Card>
      ) : null}
      {showSalesRelease ? (
        <RequisitionsPanel
          defaultQueue="fulfill"
          title="Sales release queue"
          subtitle="After sales notifies inventory: weighing → stamp, then PI (serial + HMS Unique ID) and delivery."
        />
      ) : null}
      {tab === 'history' || receiveOpen ? (
        <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { label: 'Models', value: String(summary.models) },
          { label: 'In stock', value: String(summary.inStock) },
          { label: 'Demo', value: String(summary.demo) },
          { label: 'Value', value: formatCurrency(summary.value) },
        ].map((card) => (
          <div
            key={card.label}
            className="flex min-w-[110px] flex-1 items-baseline gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              {card.label}
            </span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-text-primary">{card.value}</span>
          </div>
        ))}
      </div>

      <PageTabs
        accent="theme"
        active={receiveOpen ? 'add' : tab === 'add' ? 'list' : tab}
        onChange={(id) => {
          if (id === 'add') {
            openAdd()
            return
          }
          setReceiveOpen(false)
          setViewUnit(null)
          setEditUnit(null)
          if (id === 'list' || id === 'demo') setTab(id as 'list' | 'demo')
          else {
            setDrillProductId(null)
            setTab('history')
          }
        }}
        tabs={[
          { id: 'list', label: 'All stock', count: groups.length },
          { id: 'demo', label: 'Demo inventory', count: demoUnits.length },
          { id: 'add', label: 'Receive stock' },
          { id: 'history', label: 'History', count: history.length },
        ]}
      />

      {tab === 'list' ? (
        <>
          {filterBar}

          {drillGroup ? (
            <div className="mb-3">
              <Button variant="ghost" size="sm" onClick={() => setDrillProductId(null)}>
                <ArrowLeft size={14} /> Back to machines
              </Button>
              <Card className="mt-2 mb-4 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <ProductImage
                    src={drillGroup.product?.imageUrl}
                    className="h-14 w-14 rounded object-cover ring-1 ring-border"
                    fallbackClassName="h-14 w-14 rounded ring-1 ring-border"
                    iconSize={20}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold">{drillGroup.product?.name ?? 'Product'}</div>
                    <div className="font-mono text-xs text-text-secondary">{drillGroup.product?.sku}</div>
                    {attrLabel(drillGroup.product) ? (
                      <div className="mt-1 text-sm text-text-secondary">{attrLabel(drillGroup.product)}</div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-sm">
                      <Badge color="green">{drillGroup.inStock} in stock</Badge>
                      <Badge color="amber">{drillGroup.demo} demo</Badge>
                      <Badge color="blue">{drillGroup.sold} sold</Badge>
                      <Badge color="gray">{drillGroup.total} total serials</Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      openAdd({
                        productId: drillGroup.productId,
                      })
                    }
                  >
                    <Plus size={14} /> Add serial
                  </Button>
                </div>
              </Card>

              <Card padding={false}>
                {drillGroup.units.length === 0 ? (
                  <EmptyState
                    icon={<WarehouseIcon size={22} />}
                    title="No serials match filters"
                    subtitle="Clear filters or add a new serial for this product."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-muted text-xs text-text-secondary">
                        <tr>
                          {[
                            'HMS Unique ID',
                            'Serial no.',
                            'Brand',
                            'Supplier',
                            'Invoice',
                            'Unit cost',
                            'Warehouse',
                            ...(drillGroup.product && productRequiresStamping(drillGroup.product)
                              ? ['Stamping date']
                              : []),
                            'Status',
                            'Actions',
                          ].map((h) => (
                              <th key={h} className="px-4 py-3 font-medium">
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {drillGroup.units.map((row) => (
                          <tr key={row.id} className="border-t border-border">
                            <td className="px-4 py-3 font-mono text-xs font-semibold">
                              {row.hmsUniqId || '—'}
                            </td>
                            <td className="px-4 py-3 font-mono font-semibold">{row.serialNo}</td>
                            <td className="px-4 py-3">{row.brand?.name ?? '—'}</td>
                            <td className="px-4 py-3">{row.receipt?.vendor?.name ?? '—'}</td>
                            <td className="px-4 py-3 text-xs">
                              {row.receipt?.invoiceNo || '—'}
                              {row.receipt?.invoiceDate
                                ? ` · ${formatDate(String(row.receipt.invoiceDate))}`
                                : ''}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {row.unitCost != null ? formatCurrency(Number(row.unitCost)) : '—'}
                            </td>
                            <td className="px-4 py-3">{row.warehouse?.name ?? '—'}</td>
                            {drillGroup.product && productRequiresStamping(drillGroup.product) ? (
                              <td className="px-4 py-3">
                                {row.stampingDate ? formatDate(String(row.stampingDate)) : '—'}
                              </td>
                            ) : null}
                            <td className="px-4 py-3">
                              <Badge color={STATUS_COLOR[row.status] ?? 'gray'}>
                                {row.status.replace('_', ' ')}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="View"
                                  onClick={() => {
                                    setEditUnit(null)
                                    setReceiveOpen(false)
                                    setViewUnit(row)
                                  }}
                                >
                                  <Eye size={14} />
                                </Button>
                                <Button variant="ghost" size="sm" title="Edit" onClick={() => openEdit(row)}>
                                  <Pencil size={14} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <Card padding={false}>
              {groups.length === 0 ? (
                <EmptyState
                  icon={<WarehouseIcon size={22} />}
                  title={
                    stockLoadError
                      ? 'Could not load stock'
                      : units.length === 0
                        ? 'No serial stock yet'
                        : 'No products match filters'
                  }
                  subtitle={
                    stockLoadError
                      ? stockLoadError
                      : units.length === 0
                        ? 'Receive a supplier invoice: model, brand, qty, starting serial — Unique IDs fill automatically.'
                        : 'Try clearing filters or searching a different product / serial / HMS ID.'
                  }
                  actionLabel={stockLoadError ? 'Retry' : 'Receive stock'}
                  onAction={() => (stockLoadError ? void load() : openAdd())}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-muted text-xs text-text-secondary">
                      <tr>
                        {[
                          'Machine',
                          'Family / industry',
                          'Qty (serials)',
                          'In stock',
                          'Demo',
                          'Sold',
                          'Warehouses',
                          'Latest stamp',
                          '',
                        ]
                          .filter((h) => h !== 'Latest stamp' || anyGroupRequiresStamping)
                          .map((h) => (
                          <th key={h || 'go'} className="px-4 py-3 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => {
                        const showStamping = g.product ? productRequiresStamping(g.product) : false
                        const meta = productCatalogMeta(productAttrs(g.product ?? {}))
                        return (
                          <tr
                            key={g.productId}
                            className="cursor-pointer border-t border-border hover:bg-muted/40"
                            onClick={() => setDrillProductId(g.productId)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <ProductImage
                                  src={g.product?.imageUrl}
                                  className="h-9 w-9 rounded object-cover ring-1 ring-border"
                                  fallbackClassName="h-9 w-9 rounded ring-1 ring-border"
                                />
                                <div>
                                  <div className="font-medium">{g.product?.name ?? '—'}</div>
                                  <div className="font-mono text-xs text-text-secondary">
                                    {g.product?.sku ?? '—'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary">
                              <div>{meta.familyName || '—'}</div>
                              {meta.industryName ? (
                                <div className="mt-0.5 text-text-secondary/80">{meta.industryName}</div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-lg font-semibold tabular-nums">{g.total}</span>
                              <span className="ml-1 text-xs text-text-secondary">pcs</span>
                            </td>
                            <td className="px-4 py-3">
                              <Badge color="green">{g.inStock}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <Badge color="amber">{g.demo}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <Badge color="blue">{g.sold}</Badge>
                            </td>
                            <td className="px-4 py-3 text-text-secondary">
                              {g.warehouses.join(', ') || '—'}
                            </td>
                            {showStamping ? (
                              <td className="px-4 py-3 text-text-secondary">
                                {g.latestStamp ? formatDate(g.latestStamp) : '—'}
                              </td>
                            ) : anyGroupRequiresStamping ? (
                              <td className="px-4 py-3 text-text-secondary">—</td>
                            ) : null}
                            <td className="px-4 py-3 text-text-secondary">
                              <ChevronRight size={16} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      ) : null}

      {tab === 'demo' ? (
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm text-text-secondary">
              Units issued for customer demos with an automatic delivery challan (DC). Stock is reduced until sold or
              returned. Linked from{' '}
              <Link to="/sale-tracking" className="font-medium text-accent-blue hover:underline">
                Sale tracking
              </Link>
              .
            </p>
            {demoUnits[0] ? (
              <div className="mt-3">
                <AiAssistCard
                  title="Stock AI"
                  subtitle="Plain-language demo status. Final GST bill stays in Tally."
                  actions={[
                    {
                      id: 'stock_explain',
                      label: 'Explain first demo unit',
                      run: () =>
                        api.aiWarehouseAssist({
                          action: 'stock_explain',
                          stockUnitId: String(demoUnits[0].id),
                          serialNo: String(demoUnits[0].serialNo ?? ''),
                        }),
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
          {demoUnits.length === 0 ? (
            <EmptyState
              icon={<WarehouseIcon size={22} />}
              title="No demo units out"
              subtitle="When a sale enquiry moves to Demo and a serial is issued, it appears here."
              actionLabel="Sale tracking"
              onAction={() => window.location.assign('/sale-tracking')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {[
                      'Product',
                      'Family / industry',
                      'Serial no.',
                      'DC no.',
                      'Specs',
                      'Sale price',
                      'Customer / lead',
                      'Executive',
                      'Phone',
                      'Demo issued',
                      'Stamping',
                      'Warehouse',
                      'Actions',
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {demoUnits.map((row) => {
                    const p = productMap[row.productId] ?? row.product
                    const cf = row.customFields ?? {}
                    const challan = challanFromCustomFields(cf)
                    const party = row.contact ?? row.lead
                    const partyName = row.contact
                      ? `${row.contact.customerCode ? `${row.contact.customerCode} · ` : ''}${row.contact.name}`
                      : row.lead
                        ? `${row.lead.name}${row.lead.company ? ` · ${row.lead.company}` : ''}`
                        : cf.demoCustomerName
                          ? String(cf.demoCustomerName)
                          : '—'
                    const sale =
                      cf.productSalePrice != null
                        ? num(cf.productSalePrice)
                        : p && 'salePrice' in p
                          ? num((p as CatalogProduct).salePrice)
                          : 0
                    const family =
                      cf.catalogFamily
                        ? String(cf.catalogFamily)
                        : p && 'attributes' in p
                          ? String(
                              ((p as CatalogProduct).attributes as Record<string, unknown> | null)
                                ?.catalogFamilyName ?? '',
                            )
                          : ''
                    const industry =
                      cf.catalogIndustry
                        ? String(cf.catalogIndustry)
                        : p && 'attributes' in p
                          ? String(
                              ((p as CatalogProduct).attributes as Record<string, unknown> | null)
                                ?.catalogIndustryName ?? '',
                            )
                          : ''
                    return (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <div className="font-medium">{p?.name ?? cf.productName ?? '—'}</div>
                          <div className="font-mono text-xs text-text-secondary">
                            {p?.sku ?? cf.productSku ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-text-secondary">
                          {[family, industry].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">{row.serialNo}</td>
                        <td className="px-4 py-3">
                          {challan?.number || cf.demoDcNo ? (
                            <div>
                              <div className="font-mono font-semibold text-amber-800 dark:text-amber-200">
                                {challan?.number ?? String(cf.demoDcNo)}
                              </div>
                              {challan ? (
                                <button
                                  type="button"
                                  className="mt-0.5 text-xs font-semibold text-accent-blue hover:underline"
                                  onClick={() => {
                                    const ok = openPrintableDeliveryChallan(
                                      challan,
                                      authUser?.tenantName || APP_NAME,
                                    )
                                    if (!ok) {
                                      addToast({
                                        type: 'error',
                                        message: 'Could not open print dialog — try again',
                                      })
                                    }
                                  }}
                                >
                                  View / print
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="max-w-[140px] px-4 py-3 text-text-secondary">
                          {productSpecs(p as CatalogProduct, cf)}
                        </td>
                        <td className="px-4 py-3">{sale ? formatCurrency(sale) : '—'}</td>
                        <td className="px-4 py-3">
                          {party || row.lead ? (
                            row.lead ? (
                              <Link to="/sale-tracking" className="text-accent-blue hover:underline">
                                {partyName}
                              </Link>
                            ) : (
                              partyName
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">
                          {cf.demoExecutiveName ? String(cf.demoExecutiveName) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {party && 'phone' in party && party.phone
                            ? String(party.phone)
                            : cf.demoPhone
                              ? String(cf.demoPhone)
                              : '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{demoIssuedAt(row)}</td>
                        <td className="px-4 py-3">
                          {row.stampingDate ? formatDate(String(row.stampingDate)) : '—'}
                        </td>
                        <td className="px-4 py-3">{row.warehouse?.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReturnNotes('')
                              setReturnOutcome('NOT_INTERESTED')
                              setReturnConfirm(row)
                            }}
                          >
                            Return / close demo
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'history' ? (
        <Card padding={false}>
          {history.length === 0 ? (
            <EmptyState
              icon={<History size={22} />}
              title="No movements yet"
              subtitle="Stock in, demo issues, and sales will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['When', 'Type', 'Product', 'Serial', 'Warehouse', 'Qty', 'By', 'Notes'].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-4 py-3 text-text-secondary">{formatDate(row.movedAt)}</td>
                      <td className="px-4 py-3">
                        <Badge
                          color={
                            row.movementType === 'IN' ? 'green' : row.movementType === 'OUT' ? 'amber' : 'blue'
                          }
                        >
                          {row.movementType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.product?.name ?? '—'}</div>
                        <div className="font-mono text-xs text-text-secondary">{row.product?.sku ?? ''}</div>
                      </td>
                      <td className="px-4 py-3 font-mono">{row.stockUnit?.serialNo ?? '—'}</td>
                      <td className="px-4 py-3">{row.warehouse?.name ?? '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{num(row.quantity)}</td>
                      <td className="px-4 py-3">{row.performer?.name ?? '—'}</td>
                      <td className="max-w-[280px] truncate px-4 py-3 text-text-secondary">
                        {row.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <Drawer
        open={receiveOpen}
        width={640}
        storageKey="nova.drawer.inventory.receive"
        onClose={closeReceive}
        title={
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Inventory
            </div>
            <div className="text-lg font-semibold text-text-primary">
              {receiveKind === null
                ? 'What are you receiving?'
                : receiveKind === 'spare'
                  ? 'Spare parts stock'
                  : 'Receive machine stock'}
            </div>
            <p className="mt-0.5 text-sm font-normal text-text-secondary">
              {receiveKind === null
                ? 'Choose machine (serial) stock or spare parts quantity stock.'
                : receiveKind === 'spare'
                  ? 'Billing / weighing spares are managed on the Spare stock page.'
                  : 'One supplier invoice → N units. Weighing uses HMS Unique ID.'}
            </p>
          </div>
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={closeReceive}>
              Cancel
            </Button>
            {receiveKind === 'machine' ? (
              <Button onClick={() => void saveAdd()} disabled={saving || products.length === 0}>
                {saving
                  ? 'Saving…'
                  : `Receive ${Math.max(1, Math.floor(Number(form.quantity) || 1))} unit${
                      Math.floor(Number(form.quantity) || 1) === 1 ? '' : 's'
                    }`}
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="p-5">
          {receiveKind === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-accent-blue hover:bg-muted/40"
                onClick={() => setReceiveKind('machine')}
              >
                <div className="flex items-center gap-2 font-semibold text-text-primary">
                  <Package size={18} /> Machine / product stock
                </div>
                <p className="mt-1.5 text-sm text-text-secondary">
                  Serial units for weighing &amp; billing machines (HMS Unique ID, brands, suppliers).
                </p>
              </button>
              <button
                type="button"
                className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-accent-blue hover:bg-muted/40"
                onClick={() => {
                  closeReceive()
                  navigate('/erp/spare-stock?receive=1')
                }}
              >
                <div className="flex items-center gap-2 font-semibold text-text-primary">
                  <WarehouseIcon size={18} /> Spare parts stock
                </div>
                <p className="mt-1.5 text-sm text-text-secondary">
                  Quantity stock by machine type → spare name → supplier &amp; invoice date. Issue to
                  engineers separately.
                </p>
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm">
              <p className="font-medium text-amber-900">No products in catalog yet</p>
              <p className="mt-1 text-amber-800/80">
                Create a product under Products first, then come back to receive stock.
              </p>
              <Link to="/erp/products" className="mt-3 inline-block">
                <Button size="sm" variant="outline">
                  Go to Products
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                className="text-sm font-medium text-accent-blue hover:underline"
                onClick={() => setReceiveKind(null)}
              >
                ← Change stock type
              </button>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SearchableSelect
                    label="Product / model *"
                    value={form.productId}
                    onChange={(productId) => {
                      void rebuildUnitGrid({ ...form, productId })
                    }}
                    placeholder="Search by name or SKU…"
                    error={errors.productId}
                    options={products.map((p) => ({
                      value: p.id,
                      label: p.name,
                      sublabel: [p.sku, p.productType].filter(Boolean).join(' · '),
                    }))}
                  />
                </div>

                <div>
                  <SearchableSelect
                    label="Supplier *"
                    value={form.vendorId}
                    error={errors.vendorId}
                    allowCreate
                    placeholder="Search or type supplier…"
                    options={vendors.map((v) => ({ value: v.id, label: v.name }))}
                    onChange={(vendorId) => setForm({ ...form, vendorId })}
                  />
                  <p className="mt-1.5 text-xs text-text-secondary">
                    Shared list — also in{' '}
                    <Link to="/erp/suppliers" className="font-medium text-accent-blue underline">
                      Inventory hub
                    </Link>
                  </p>
                </div>

                <div>
                  <SearchableSelect
                    label="Brand *"
                    value={form.brandId}
                    error={errors.brandId}
                    allowCreate
                    placeholder="Search or type brand…"
                    options={brands.map((b) => ({ value: b.id, label: b.name }))}
                    onChange={(brandId) => setForm({ ...form, brandId })}
                  />
                  <p className="mt-1.5 text-xs text-text-secondary">
                    Manage in{' '}
                    <Link
                      to="/erp/suppliers?tab=brands"
                      className="font-medium text-accent-blue underline"
                    >
                      Suppliers → Brands
                    </Link>
                  </p>
                </div>

                <Input
                  label="Spec"
                  value={form.spec}
                  onChange={(e) => setForm({ ...form, spec: e.target.value })}
                  placeholder="e.g. 2T Superstar / 30kg"
                />
                <Select
                  label="Warehouse *"
                  value={form.warehouseId}
                  onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                  options={[
                    { value: '', label: 'Select warehouse' },
                    ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                  ]}
                />
                {errors.warehouseId ? (
                  <p className="text-xs text-accent-red sm:col-span-2">{errors.warehouseId}</p>
                ) : null}

                <Input
                  label="Qty arrived *"
                  type="text"
                  inputMode="numeric"
                  value={form.quantity}
                  error={errors.quantity}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const quantity = e.target.value.replace(/[^\d]/g, '').slice(0, 3)
                    void rebuildUnitGrid({ ...form, quantity })
                  }}
                  onBlur={() => {
                    void rebuildUnitGrid(form, { clampQty: true })
                  }}
                  placeholder="e.g. 28"
                />
                <Input
                  label="Per unit amount"
                  type="number"
                  min={0}
                  value={form.unitAmount}
                  onChange={(e) => setForm({ ...form, unitAmount: e.target.value })}
                  placeholder="0"
                />
                <Input
                  label="Supplier invoice no."
                  value={form.invoiceNo}
                  onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
                />
                <Input
                  label="Invoice date"
                  type="date"
                  value={form.invoiceDate}
                  onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
                />
                <Input
                  label="Received date"
                  type="date"
                  value={form.receivedDate}
                  onChange={(e) => setForm({ ...form, receivedDate: e.target.value })}
                />
                {addFormRequiresStamping ? (
                  <Input
                    label="Stamping date"
                    type="date"
                    value={form.stampingDate}
                    onChange={(e) => setForm({ ...form, stampingDate: e.target.value })}
                  />
                ) : (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-text-secondary">
                    Govt. stamping not required for this product.
                  </p>
                )}

                {receiveIsWeighing ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-950 sm:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <strong>Weighing machines:</strong> no supplier serial by default. Enter qty —
                    HMS Unique IDs auto-fill below.
                  </div>
                ) : (
                  <>
                    <Input
                      label="Starting serial *"
                      value={form.startSerial}
                      error={errors.startSerial || errors.serialNo}
                      onChange={(e) => {
                        void rebuildUnitGrid({
                          ...form,
                          startSerial: e.target.value,
                          pasteSerials: '',
                        })
                      }}
                      placeholder="e.g. SS2T2601001"
                    />
                    <Input
                      label="Ending serial (auto)"
                      value={receiveEndSerial}
                      readOnly
                      placeholder="Fills when start serial + qty are set"
                    />
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-text-secondary">
                        Or paste serials (one per line) — overrides auto-range
                      </label>
                      <textarea
                        className="min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={form.pasteSerials}
                        onChange={(e) => {
                          void rebuildUnitGrid({ ...form, pasteSerials: e.target.value })
                        }}
                        placeholder={'SS2T2601001\nSS2T2601005\n…'}
                      />
                    </div>
                  </>
                )}

                {form.units.length > 0 &&
                (receiveIsWeighing || form.startSerial.trim() || form.pasteSerials.trim()) ? (
                  <div className="rounded-lg border border-emerald-300/70 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 sm:col-span-2 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <strong>
                      {form.units.length} unit{form.units.length === 1 ? '' : 's'} will be added
                    </strong>
                    {!receiveIsWeighing && form.startSerial.trim() && receiveEndSerial ? (
                      <span className="mt-0.5 block font-mono text-xs opacity-90">
                        Serials {form.startSerial.trim().toUpperCase()} → {receiveEndSerial}
                        {form.units[0]?.hmsUniqId
                          ? ` · HMS IDs ${form.units[0].hmsUniqId} → ${form.units.at(-1)?.hmsUniqId ?? ''}`
                          : ''}
                      </span>
                    ) : null}
                    {receiveIsWeighing && form.units[0]?.hmsUniqId ? (
                      <span className="mt-0.5 block font-mono text-xs opacity-90">
                        HMS Unique IDs {form.units[0].hmsUniqId} →{' '}
                        {form.units.at(-1)?.hmsUniqId ?? ''}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="sm:col-span-2">
                  <Input
                    label="Notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Optional notes for this receipt"
                  />
                </div>
              </div>

              {form.units.length > 0 &&
              (receiveIsWeighing || form.startSerial.trim() || form.pasteSerials.trim()) ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="bg-muted text-xs text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">HMS Unique ID</th>
                        {!receiveIsWeighing ? (
                          <th className="px-3 py-2 font-medium">Serial no.</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {form.units.map((row, idx) => (
                        <tr key={idx} className="border-t border-border">
                          <td className="px-3 py-1.5 text-text-secondary">{idx + 1}</td>
                          <td className="px-3 py-1.5">
                            <input
                              className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                              value={row.hmsUniqId}
                              onChange={(e) => {
                                const id = e.target.value.toUpperCase()
                                const units = [...form.units]
                                units[idx] = {
                                  ...row,
                                  hmsUniqId: id,
                                  serialNo: receiveIsWeighing ? id : row.serialNo,
                                }
                                setForm({ ...form, units })
                              }}
                            />
                          </td>
                          {!receiveIsWeighing ? (
                            <td className="px-3 py-1.5">
                              <input
                                className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                                value={row.serialNo}
                                onChange={(e) => {
                                  const units = [...form.units]
                                  units[idx] = { ...row, serialNo: e.target.value.toUpperCase() }
                                  setForm({ ...form, units })
                                }}
                              />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Drawer>

      <Drawer
        open={Boolean(viewUnit)}
        width={520}
        storageKey="nova.drawer.inventory.view"
        onClose={() => setViewUnit(null)}
        title={
          viewUnit ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Stock unit
              </div>
              <div className="text-lg font-semibold text-text-primary">
                {viewUnit.hmsUniqId || viewUnit.serialNo}
              </div>
              <p className="mt-0.5 text-sm font-normal text-text-secondary">
                {viewUnit.product?.name ?? productMap[viewUnit.productId]?.name ?? 'Product'} ·{' '}
                {viewUnit.warehouse?.name ?? 'Warehouse'}
              </p>
            </div>
          ) : (
            'Stock unit'
          )
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setViewUnit(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (viewUnit) openEdit(viewUnit)
              }}
            >
              <Pencil size={14} /> Edit
            </Button>
          </div>
        }
      >
        {viewUnit ? (
          <dl className="grid gap-2 p-5 text-sm sm:grid-cols-2">
            {[
              ['HMS Unique ID', viewUnit.hmsUniqId || '—'],
              ['Serial', viewUnit.serialNo],
              ['Status', viewUnit.status.replace('_', ' ')],
              ['Product', viewUnit.product?.name ?? productMap[viewUnit.productId]?.name],
              ['SKU', viewUnit.product?.sku ?? productMap[viewUnit.productId]?.sku],
              ['Brand', viewUnit.brand?.name || '—'],
              ['Supplier', viewUnit.receipt?.vendor?.name || '—'],
              ['Spec', viewUnit.receipt?.spec || '—'],
              ['Invoice no.', viewUnit.receipt?.invoiceNo || '—'],
              [
                'Invoice date',
                viewUnit.receipt?.invoiceDate
                  ? formatDate(String(viewUnit.receipt.invoiceDate))
                  : '—',
              ],
              [
                'Received date',
                viewUnit.receipt?.receivedDate
                  ? formatDate(String(viewUnit.receipt.receivedDate))
                  : '—',
              ],
              [
                'Unit cost',
                viewUnit.unitCost != null ? formatCurrency(Number(viewUnit.unitCost)) : '—',
              ],
              ['Warehouse', viewUnit.warehouse?.name],
              ...(viewUnitRequiresStamping
                ? [['Stamping date', viewUnit.stampingDate ? formatDate(String(viewUnit.stampingDate)) : '—']]
                : []),
              ['Added', viewUnit.createdAt ? formatDate(String(viewUnit.createdAt)) : '—'],
              ['Updated', viewUnit.updatedAt ? formatDate(String(viewUnit.updatedAt)) : '—'],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-border px-3 py-2">
                <dt className="text-xs text-text-secondary">{String(k)}</dt>
                <dd className="mt-0.5 font-medium">{String(v ?? '—')}</dd>
              </div>
            ))}
            <div className="rounded-lg border border-border px-3 py-2 sm:col-span-2">
              <dt className="text-xs text-text-secondary">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-medium">{viewUnit.notes || '—'}</dd>
            </div>
          </dl>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(editUnit)}
        width={560}
        storageKey="nova.drawer.inventory.edit"
        onClose={() => setEditUnit(null)}
        title={
          editUnit ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Edit stock unit
              </div>
              <div className="text-lg font-semibold text-text-primary">
                {editUnit.hmsUniqId || editUnit.serialNo}
              </div>
              <p className="mt-0.5 text-sm font-normal text-text-secondary">
                Main stock, Demo, or Rental — edit anytime
              </p>
            </div>
          ) : (
            'Edit stock'
          )
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setEditUnit(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>
              {saving
                ? 'Saving…'
                : editForm.placement === 'DEMO'
                  ? 'Save demo placement'
                  : editForm.placement === 'RENTAL'
                    ? 'Save rental'
                    : 'Save changes'}
            </Button>
          </div>
        }
      >
        {editUnit ? (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2.5 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
              You can edit any stock unit anytime (demos and rentals included). New stock defaults to{' '}
              <strong>Main warehouse</strong>. Choose <strong>Demo</strong> or <strong>Rental</strong>{' '}
              below to capture customer details and responsibility.
            </div>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div className="text-xs text-text-secondary">Product</div>
              <div className="font-medium">
                {(editUnit.product?.sku ?? productMap[editUnit.productId]?.sku) || '—'} —{' '}
                {editUnit.product?.name ?? productMap[editUnit.productId]?.name}
              </div>
              <div className="mt-1 text-xs text-text-secondary">
                Current status:{' '}
                <Badge color={STATUS_COLOR[editUnit.status] ?? 'gray'} className="align-middle">
                  {editUnit.status}
                </Badge>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-text-secondary">Place as</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'STOCK' as const, label: 'In stock' },
                    { id: 'DEMO' as const, label: 'Demo' },
                    { id: 'RENTAL' as const, label: 'Rental' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      editForm.placement === p.id
                        ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                        : 'border-border bg-card text-text-primary hover:bg-muted'
                    }`}
                    onClick={() => {
                      const demoWh = warehouses.find(
                        (w) => String(w.code ?? '').toUpperCase() === 'DEMO',
                      )
                      const mainWh = warehouses.find(
                        (w) => String(w.code ?? '').toUpperCase() === 'MAIN',
                      )
                      setEditForm((f) => ({
                        ...f,
                        placement: p.id,
                        warehouseId:
                          p.id === 'DEMO'
                            ? demoWh?.id || f.warehouseId
                            : p.id === 'STOCK'
                              ? mainWh?.id || f.warehouseId
                              : f.warehouseId,
                      }))
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {editForm.placement === 'STOCK' ? (
                <Select
                  label="Warehouse *"
                  value={editForm.warehouseId}
                  error={errors.warehouseId}
                  onChange={(e) => onEditWarehouseChange(e.target.value)}
                  options={warehouses.map((w) => ({
                    value: w.id,
                    label:
                      String(w.code ?? '').toUpperCase() === 'MAIN'
                        ? `${w.name} (default)`
                        : w.name,
                  }))}
                />
              ) : null}
              <Input
                label="HMS Unique ID"
                value={editForm.hmsUniqId}
                onChange={(e) => setEditForm({ ...editForm, hmsUniqId: e.target.value })}
              />
              <Input
                label="Serial / ID *"
                value={editForm.serialNo}
                error={errors.serialNo}
                onChange={(e) => setEditForm({ ...editForm, serialNo: e.target.value })}
              />
              <Select
                label="Brand"
                value={editForm.brandId}
                onChange={(e) => setEditForm({ ...editForm, brandId: e.target.value })}
                options={[
                  { value: '', label: 'No brand' },
                  ...brands.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
              <Input
                label="Unit cost ₹"
                type="number"
                value={editForm.unitCost}
                onChange={(e) => setEditForm({ ...editForm, unitCost: e.target.value })}
              />
              {editFormRequiresStamping ? (
                <Input
                  label="Stamping date"
                  type="date"
                  value={editForm.stampingDate}
                  onChange={(e) => setEditForm({ ...editForm, stampingDate: e.target.value })}
                />
              ) : null}
              <div className="sm:col-span-2">
                <Input
                  label="Notes"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>
            </div>

            {editForm.placement === 'DEMO' ? (
              <section className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                <h3 className="text-sm font-semibold text-text-primary">Demo customer & assignee</h3>
                <p className="text-xs text-text-secondary">
                  Creates / updates a Sale tracking enquiry and marks this serial as DEMO.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Customer name *"
                    value={editForm.demoCustomerName}
                    error={errors.demoCustomerName}
                    onChange={(e) =>
                      setEditForm({ ...editForm, demoCustomerName: e.target.value })
                    }
                  />
                  <Input
                    label="Phone"
                    value={editForm.demoPhone}
                    onChange={(e) => setEditForm({ ...editForm, demoPhone: e.target.value })}
                  />
                  <Input
                    label="Company / shop"
                    value={editForm.demoCompany}
                    onChange={(e) => setEditForm({ ...editForm, demoCompany: e.target.value })}
                  />
                  <Input
                    label="Email"
                    value={editForm.demoEmail}
                    onChange={(e) => setEditForm({ ...editForm, demoEmail: e.target.value })}
                  />
                  <Input
                    label="City"
                    value={editForm.demoCity}
                    onChange={(e) => setEditForm({ ...editForm, demoCity: e.target.value })}
                  />
                  <Input
                    label="State"
                    value={editForm.demoState}
                    onChange={(e) => setEditForm({ ...editForm, demoState: e.target.value })}
                  />
                  <Input
                    className="sm:col-span-2"
                    label="Address"
                    value={editForm.demoAddress}
                    onChange={(e) => setEditForm({ ...editForm, demoAddress: e.target.value })}
                  />
                  <div className="sm:col-span-2">
                    <Select
                      label="Responsible (assignee) *"
                      value={editForm.demoAssigneeId}
                      error={errors.demoAssigneeId}
                      onChange={(e) =>
                        setEditForm({ ...editForm, demoAssigneeId: e.target.value })
                      }
                      options={[
                        { value: '', label: 'Select executive / salesperson…' },
                        ...teamUsers.map((u) => ({ value: u.id, label: u.name })),
                      ]}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {editForm.placement === 'RENTAL' ? (
              <section className="space-y-3 rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                <h3 className="text-sm font-semibold text-text-primary">
                  Rental · sales category + customer
                </h3>
                <p className="text-xs text-text-secondary">
                  Logs a RENTAL enquiry under Sales, creates/updates the rental agreement, and marks
                  the serial RENTED.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Customer name *"
                    value={editForm.rentalCustomerName}
                    error={errors.rentalCustomerName}
                    onChange={(e) =>
                      setEditForm({ ...editForm, rentalCustomerName: e.target.value })
                    }
                  />
                  <Input
                    label="Phone"
                    value={editForm.rentalPhone}
                    onChange={(e) => setEditForm({ ...editForm, rentalPhone: e.target.value })}
                  />
                  <Input
                    label="Company / shop"
                    value={editForm.rentalCompany}
                    onChange={(e) => setEditForm({ ...editForm, rentalCompany: e.target.value })}
                  />
                  <Input
                    label="Email"
                    value={editForm.rentalEmail}
                    onChange={(e) => setEditForm({ ...editForm, rentalEmail: e.target.value })}
                  />
                  <Input
                    label="City"
                    value={editForm.rentalCity}
                    onChange={(e) => setEditForm({ ...editForm, rentalCity: e.target.value })}
                  />
                  <Input
                    label="State"
                    value={editForm.rentalState}
                    onChange={(e) => setEditForm({ ...editForm, rentalState: e.target.value })}
                  />
                  <Input
                    className="sm:col-span-2"
                    label="Address"
                    value={editForm.rentalAddress}
                    onChange={(e) => setEditForm({ ...editForm, rentalAddress: e.target.value })}
                  />
                  <Input
                    label="Rental start *"
                    type="datetime-local"
                    value={editForm.rentalStartAt}
                    error={errors.rentalStartAt}
                    onChange={(e) => setEditForm({ ...editForm, rentalStartAt: e.target.value })}
                  />
                  <Input
                    label="Expected return"
                    type="datetime-local"
                    value={editForm.rentalExpectedReturnAt}
                    onChange={(e) =>
                      setEditForm({ ...editForm, rentalExpectedReturnAt: e.target.value })
                    }
                  />
                  <Input
                    label="Daily rate ₹"
                    type="number"
                    value={editForm.rentalDailyRate}
                    onChange={(e) => setEditForm({ ...editForm, rentalDailyRate: e.target.value })}
                  />
                  <Input
                    label="Deposit ₹"
                    type="number"
                    value={editForm.rentalDeposit}
                    onChange={(e) => setEditForm({ ...editForm, rentalDeposit: e.target.value })}
                  />
                  <Input
                    label="Agreed total ₹"
                    type="number"
                    value={editForm.rentalTotal}
                    onChange={(e) => setEditForm({ ...editForm, rentalTotal: e.target.value })}
                  />
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={Boolean(returnConfirm)}
        onClose={() => {
          if (!returnBusy) {
            setReturnConfirm(null)
            setReturnNotes('')
          }
        }}
        title="Close demo unit"
        subtitle={returnConfirm ? `Serial ${returnConfirm.serialNo}` : undefined}
        size="lg"
        accent="theme"
        footer={
          <>
            <Button
              variant="outline"
              disabled={returnBusy}
              onClick={() => {
                setReturnConfirm(null)
                setReturnNotes('')
              }}
            >
              Cancel
            </Button>
            <Button disabled={returnBusy} onClick={() => void returnDemoToStock()}>
              {returnBusy
                ? 'Processing…'
                : returnConfirm?.leadId || returnConfirm?.customFields?.demoLeadId
                  ? returnOutcome === 'READY_TO_BUY'
                    ? 'Convert & invoice'
                    : 'Return & close enquiry'
                  : 'Return to stock'}
            </Button>
          </>
        }
      >
        {returnConfirm?.leadId || returnConfirm?.customFields?.demoLeadId ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              This serial is linked to a sale enquiry. Choose why the demo is ending:
            </p>
            <label
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                returnOutcome === 'READY_TO_BUY' ? 'border-accent-blue bg-accent-blue/5' : 'border-border'
              }`}
            >
              <input
                type="radio"
                className="mt-1"
                checked={returnOutcome === 'READY_TO_BUY'}
                onChange={() => setReturnOutcome('READY_TO_BUY')}
              />
              <div>
                <div className="text-sm font-semibold">Customer ready to buy / stamp</div>
                <div className="text-xs text-text-secondary">
                  Convert to permanent customer, add machine to their products, open invoice.
                </div>
              </div>
            </label>
            <label
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                returnOutcome === 'NOT_INTERESTED'
                  ? 'border-accent-red bg-accent-red/5'
                  : 'border-border'
              }`}
            >
              <input
                type="radio"
                className="mt-1"
                checked={returnOutcome === 'NOT_INTERESTED'}
                onChange={() => setReturnOutcome('NOT_INTERESTED')}
              />
              <div>
                <div className="text-sm font-semibold">Not interested</div>
                <div className="text-xs text-text-secondary">
                  Return serial to stock and close the enquiry. Admin is notified.
                </div>
              </div>
            </label>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            The unit moves back to <strong>In stock</strong> and available quantity increases by 1.
          </p>
        )}
        <div className="mt-4">
          <Input
            label="Notes (optional)"
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            placeholder="Condition, reason…"
          />
        </div>
      </Modal>

      <Modal
        open={exportOpen}
        onClose={() => !exportBusy && setExportOpen(false)}
        title="Download stock details"
        subtitle="Units added in the period — Excel or Print/PDF"
        size="md"
        accent="theme"
        footer={
          <>
            <Button variant="outline" disabled={exportBusy} onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={exportBusy}
              onClick={() => void downloadStockReport('pdf')}
            >
              <Printer size={16} />
              {exportBusy ? 'Preparing…' : 'Print / PDF'}
            </Button>
            <Button disabled={exportBusy} onClick={() => void downloadStockReport('xlsx')}>
              <FileSpreadsheet size={16} />
              {exportBusy ? 'Preparing…' : 'Excel'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-text-secondary">Period</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'today' as const, label: 'Today' },
                  { id: '7d' as const, label: '7 days' },
                  { id: '30d' as const, label: '1 month' },
                  { id: 'custom' as const, label: 'Calendar' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    exportPreset === p.id
                      ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                      : 'border-border bg-card text-text-primary hover:bg-muted'
                  }`}
                  onClick={() => applyExportPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="From"
              type="date"
              value={exportFrom}
              onChange={(e) => {
                setExportPreset('custom')
                setExportFrom(e.target.value)
              }}
            />
            <Input
              label="To"
              type="date"
              value={exportTo}
              onChange={(e) => {
                setExportPreset('custom')
                setExportTo(e.target.value)
              }}
            />
          </div>

          <Select
            label="Warehouse (optional)"
            value={exportWarehouseId}
            onChange={(e) => setExportWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'All warehouses' },
              ...warehouses.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />

          <Select
            label="Machine (optional)"
            value={exportProductId}
            onChange={(e) => setExportProductId(e.target.value)}
            options={[
              { value: '', label: 'All machines' },
              ...products.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />

          <p className="text-xs text-text-secondary">
            Includes every unit entered into stock in this range (HMS Unique ID, serial, product,
            brand, supplier, cost) plus receipt batch summary. Dates use India business day.
            For spare monthly + machine filters together, use Inventory → Monthly report.
          </p>
        </div>
      </Modal>
    </div>
  )
}
