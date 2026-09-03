import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  History,
  Package,
  Pencil,
  Plus,
  ShoppingCart,
  SlidersHorizontal,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { ProductImage } from '@/components/ProductImage'
import { api, ApiClientError, num } from '@/lib/api'
import { productRequiresStamping } from '@/lib/productCatalog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

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
  stampingDate?: string | null
  notes?: string | null
  status: string
  leadId?: string | null
  contactId?: string | null
  createdAt?: string
  updatedAt?: string
  product?: { id: string; sku: string; name: string; imageUrl?: string | null; attributes?: unknown } | null
  warehouse?: { id: string; name: string; code?: string } | null
  lead?: { id: string; name: string; company?: string | null; phone?: string | null; city?: string | null; status?: string } | null
  contact?: { id: string; name: string; customerCode?: string | null; phone?: string | null; city?: string | null } | null
  customFields?: Record<string, unknown> | null
}

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
  SOLD: 'blue',
  RETURNED: 'gray',
}

const emptyForm = {
  productId: '',
  warehouseId: '',
  serialNo: '',
  stampingDate: '',
  notes: '',
}

function attrLabel(p: CatalogProduct | null | undefined) {
  const a = p?.attributes
  if (!a || typeof a !== 'object') return ''
  const machineType = String((a as Record<string, unknown>).machineType ?? (a as Record<string, unknown>).type ?? '')
  const capacity = String((a as Record<string, unknown>).capacity ?? '')
  return [machineType, capacity].filter(Boolean).join(' · ')
}

export function InventoryPage() {
  const [searchParams] = useSearchParams()
  const preselectProduct = searchParams.get('productId') || ''
  const tip = DEFAULT_TIPS['erp.inventory'] ?? {
    title: 'Serial stock',
    body: 'Each physical piece has a unique serial. Add stock with serial + stamping date. Demo issues reduce available stock until sold.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)

  const [units, setUnits] = useState<StockUnit[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [levels, setLevels] = useState<Array<Record<string, unknown>>>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [tab, setTab] = useState<'list' | 'add' | 'history' | 'demo'>('list')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ ...emptyForm, productId: preselectProduct })
  const [viewUnit, setViewUnit] = useState<StockUnit | null>(null)
  const [editUnit, setEditUnit] = useState<StockUnit | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [drillProductId, setDrillProductId] = useState<string | null>(null)

  // Filters (product group list + serial drill-down)
  const [filterProductId, setFilterProductId] = useState('')
  const [filterWarehouseId, setFilterWarehouseId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterQ, setFilterQ] = useState('')
  const [filterStampFrom, setFilterStampFrom] = useState('')
  const [filterStampTo, setFilterStampTo] = useState('')
  const [moreFilters, setMoreFilters] = useState(false)
  const [returnConfirm, setReturnConfirm] = useState<StockUnit | null>(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [returnBusy, setReturnBusy] = useState(false)

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  )

  const addFormRequiresStamping = useMemo(() => {
    const product = products.find((p) => p.id === form.productId)
    return product ? productRequiresStamping(product) : false
  }, [products, form.productId])

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
    try {
      // Load catalog + warehouses first so Add stock works even if serial API fails
      const [lookups, productPage] = await Promise.all([
        api.lookups(),
        api.products({ limit: 500 }),
      ])
      const catalog = (productPage.items ?? []).map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ''),
        sku: String(p.sku ?? ''),
        unit: p.unit ? String(p.unit) : 'pcs',
        imageUrl: (p.imageUrl as string | null) ?? null,
        productType: p.productType ? String(p.productType) : undefined,
        attributes: (p.attributes as Record<string, unknown> | null) ?? null,
        purchasePrice: num(p.purchasePrice),
        salePrice: num(p.salePrice),
      }))
      // Merge lookups products in case products API misses any active ones
      const byId = new Map(catalog.map((p) => [p.id, p]))
      for (const p of lookups.products) {
        if (!byId.has(p.id)) {
          byId.set(p.id, {
            id: p.id,
            name: p.name,
            sku: p.sku,
            unit: p.unit,
            imageUrl: null,
            productType: undefined,
            attributes: null,
            purchasePrice: num(p.purchasePrice),
            salePrice: num(p.salePrice),
          })
        }
      }
      const merged = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
      setProducts(merged)
      const WAREHOUSE_ORDER = ['MAIN', 'STORE', 'EXECUTIVE', 'STAMPING']
      const sortedWarehouses = [...lookups.warehouses].sort((a, b) => {
        const ai = WAREHOUSE_ORDER.indexOf(String(a.code ?? '').toUpperCase())
        const bi = WAREHOUSE_ORDER.indexOf(String(b.code ?? '').toUpperCase())
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
      setWarehouses(sortedWarehouses)
      setForm((f) => ({
        ...f,
        warehouseId: f.warehouseId || sortedWarehouses[0]?.id || '',
        productId: f.productId || preselectProduct || merged[0]?.id || '',
      }))
      if (preselectProduct) setTab('add')

      const [stockUnits, hist, stockLevels] = await Promise.all([
        api.stockUnits({ limit: 500 }).catch(() => [] as Record<string, unknown>[]),
        api.inventoryHistory({ limit: 200 }).catch(() => [] as Record<string, unknown>[]),
        api.inventory().catch(() => [] as Record<string, unknown>[]),
      ])
      setUnits(stockUnits as StockUnit[])
      setHistory(hist as HistoryRow[])
      setLevels(stockLevels)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load inventory',
      })
    }
  }, [addToast, preselectProduct])

  useEffect(() => {
    void load()
  }, [load])

  async function returnDemoToStock() {
    if (!returnConfirm) return
    setReturnBusy(true)
    try {
      await api.returnDemoUnit(returnConfirm.id, returnNotes.trim() || undefined)
      addToast({
        type: 'success',
        message: `Serial ${returnConfirm.serialNo} returned — back in stock`,
      })
      setReturnConfirm(null)
      setReturnNotes('')
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
      const p = productMap[u.productId] ?? u.product
      if (filterProductId && u.productId !== filterProductId) return false
      if (filterWarehouseId && u.warehouseId !== filterWarehouseId) return false
      if (filterStatus && u.status !== filterStatus) return false
      if (q) {
        const name = (p && 'name' in p ? String(p.name) : '') || ''
        const sku = (p && 'sku' in p ? String(p.sku) : '') || ''
        const hay = `${name} ${sku} ${u.serialNo}`.toLowerCase()
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
    setFilterWarehouseId('')
    setFilterStatus('')
    setFilterQ('')
    setFilterStampFrom('')
    setFilterStampTo('')
  }

  const advancedActive = Boolean(filterWarehouseId || filterStampFrom || filterStampTo)
  const filtersActive = Boolean(filterProductId || filterStatus || filterQ || advancedActive)

  function openAdd(defaults?: Partial<typeof form>) {
    setForm((f) => ({
      ...emptyForm,
      productId: defaults?.productId || f.productId || products[0]?.id || '',
      warehouseId: defaults?.warehouseId || f.warehouseId || warehouses[0]?.id || '',
      ...defaults,
    }))
    setErrors({})
    setViewUnit(null)
    setEditUnit(null)
    setDrillProductId(null)
    setTab('add')
  }

  function openEdit(unit: StockUnit) {
    setEditUnit(unit)
    setEditForm({
      productId: unit.productId,
      warehouseId: unit.warehouseId,
      serialNo: unit.serialNo,
      stampingDate: unit.stampingDate ? String(unit.stampingDate).slice(0, 10) : '',
      notes: unit.notes ?? '',
    })
    setErrors({})
    setViewUnit(null)
  }

  async function saveAdd() {
    const next: Record<string, string> = {}
    if (!form.productId) next.productId = 'Select a product'
    if (!form.warehouseId) next.warehouseId = 'Select a warehouse'
    if (!form.serialNo.trim()) next.serialNo = 'Serial number is required'
    setErrors(next)
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }
    setSaving(true)
    try {
      await api.addStockUnit({
        productId: form.productId,
        warehouseId: form.warehouseId,
        serialNo: form.serialNo.trim(),
        stampingDate: addFormRequiresStamping ? form.stampingDate || null : null,
        notes: form.notes.trim() || null,
      })
      addToast({ type: 'success', message: `Added serial ${form.serialNo.trim().toUpperCase()}` })
      const addedProductId = form.productId
      setForm((f) => ({ ...f, serialNo: '', stampingDate: '', notes: '' }))
      setErrors({})
      setTab('list')
      setDrillProductId(addedProductId)
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Could not add stock' })
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!editUnit) return
    const next: Record<string, string> = {}
    if (!editForm.warehouseId) next.warehouseId = 'Select a warehouse'
    if (!editForm.serialNo.trim()) next.serialNo = 'Serial number is required'
    setErrors(next)
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }
    setSaving(true)
    try {
      await api.updateStockUnit(editUnit.id, {
        warehouseId: editForm.warehouseId,
        serialNo: editForm.serialNo.trim(),
        stampingDate: editFormRequiresStamping ? editForm.stampingDate || null : null,
        notes: editForm.notes.trim() || null,
      })
      addToast({ type: 'success', message: 'Stock unit updated' })
      setEditUnit(null)
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Update failed' })
    } finally {
      setSaving(false)
    }
  }

  const filterBar = (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1 basis-[220px]">
          <Input
            className="h-9"
            placeholder="Search name, SKU, serial…"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
          />
        </div>
        <div className="w-[170px] shrink-0">
          <Select
            className="h-9"
            value={filterProductId}
            onChange={(e) => setFilterProductId(e.target.value)}
            options={[
              { value: '', label: 'All products' },
              ...products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
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

  return (
    <div>
      <PageHeader
        title="Inventory"
        count={units.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Inventory' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/erp/products">
              <Button variant="outline">
                <Package size={16} /> Products
              </Button>
            </Link>
            <Link to="/erp/purchase-orders">
              <Button variant="outline">
                <ShoppingCart size={16} /> Purchase orders
              </Button>
            </Link>
            <Button onClick={() => openAdd()}>
              <Plus size={16} /> Add stock
            </Button>
          </div>
        }
      />
      {tab !== 'list' ? <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} /> : null}

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
        accent="amber"
        active={tab}
        onChange={(id) => {
          if (id === 'add') openAdd()
          else {
            setViewUnit(null)
            setEditUnit(null)
            if (id === 'list' || id === 'demo') setTab(id as 'list' | 'demo')
            else {
              setDrillProductId(null)
              setTab('history')
            }
          }
        }}
        tabs={[
          { id: 'list', label: 'All stock', count: groups.length },
          { id: 'demo', label: 'Demo inventory', count: demoUnits.length },
          { id: 'add', label: 'Add stock' },
          { id: 'history', label: 'History', count: history.length },
        ]}
      />

      {tab === 'list' ? (
        <>
          {filterBar}

          {drillGroup ? (
            <div className="mb-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrillProductId(null)}
              >
                <ArrowLeft size={14} /> Back to products
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
                            'Serial no.',
                            'Warehouse',
                            ...(drillGroup.product && productRequiresStamping(drillGroup.product)
                              ? ['Stamping date']
                              : []),
                            'Status',
                            'Notes',
                            'Added',
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
                            <td className="px-4 py-3 font-mono font-semibold">{row.serialNo}</td>
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
                            <td className="max-w-[200px] truncate px-4 py-3 text-text-secondary">
                              {row.notes || '—'}
                            </td>
                            <td className="px-4 py-3 text-text-secondary">
                              {row.createdAt ? formatDate(String(row.createdAt)) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" title="View" onClick={() => setViewUnit(row)}>
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
                  title={units.length === 0 ? 'No serial stock yet' : 'No products match filters'}
                  subtitle={
                    units.length === 0
                      ? 'Add each physical unit with a unique serial number and stamping date.'
                      : 'Try clearing filters or searching a different product / serial.'
                  }
                  actionLabel="Add stock"
                  onAction={() => openAdd()}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-muted text-xs text-text-secondary">
                      <tr>
                        {[
                          'Product',
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
                                    {attrLabel(g.product) ? ` · ${attrLabel(g.product)}` : ''}
                                  </div>
                                </div>
                              </div>
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
              Units issued for customer demos — serial stock is reduced until sold or returned. Linked to sale enquiries from{' '}
              <Link to="/sale-tracking" className="font-medium text-accent-blue hover:underline">
                Sale tracking
              </Link>
              .
            </p>
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
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {[
                      'Product',
                      'Serial no.',
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
                    return (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <div className="font-medium">{p?.name ?? cf.productName ?? '—'}</div>
                          <div className="font-mono text-xs text-text-secondary">
                            {p?.sku ?? cf.productSku ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">{row.serialNo}</td>
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
                              setReturnConfirm(row)
                            }}
                          >
                            Return to stock
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

      {tab === 'add' ? (
        <FormPanel
          open
          accent="amber"
          eyebrow="Inventory"
          title="Add stock"
          subtitle="Select product → warehouse → unique serial → stamping date. Each physical machine is one serial."
          onClose={() => setTab('list')}
          footer={
            <>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button onClick={() => void saveAdd()} disabled={saving}>
                {saving ? 'Saving…' : 'Add stock'}
              </Button>
            </>
          }
        >
          {products.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm">
              <p className="font-medium text-amber-900">No products in catalog yet</p>
              <p className="mt-1 text-amber-800/80">
                Create a product under Products first, then come back to add serial stock.
              </p>
              <Link to="/erp/products" className="mt-3 inline-block">
                <Button size="sm" variant="outline">
                  Go to Products
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <SearchableSelect
                  label="Product *"
                  value={form.productId}
                  onChange={(productId) => setForm({ ...form, productId })}
                  placeholder="Search product by name or SKU…"
                  error={errors.productId}
                  options={products.map((p) => ({
                    value: p.id,
                    label: p.name,
                    sublabel: p.sku,
                  }))}
                />
              </div>
              <div>
                <Select
                  label="Warehouse *"
                  value={form.warehouseId}
                  onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                  options={[
                    { value: '', label: 'Select warehouse' },
                    ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                  ]}
                />
                {errors.warehouseId && <p className="mt-1 text-xs text-accent-red">{errors.warehouseId}</p>}
              </div>
              <Input
                label="Serial number * (unique)"
                value={form.serialNo}
                error={errors.serialNo}
                onChange={(e) => setForm({ ...form, serialNo: e.target.value })}
                placeholder="e.g. BM-2026-00421"
              />
              <div>
                {addFormRequiresStamping ? (
                  <>
                    <Input
                      label="Stamping date"
                      type="date"
                      value={form.stampingDate}
                      onChange={(e) => setForm({ ...form, stampingDate: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-text-secondary">Usually sold within ~10 days of stamping</p>
                  </>
                ) : form.productId ? (
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-text-secondary">
                    Govt. stamping is not required for this product — serial only.
                  </p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes for this unit"
                />
              </div>
            </div>
          )}
        </FormPanel>
      ) : null}

      {viewUnit ? (
        <FormPanel
          open
          accent="amber"
          eyebrow="Stock unit"
          title={viewUnit.serialNo}
          subtitle={`${viewUnit.product?.name ?? productMap[viewUnit.productId]?.name ?? 'Product'} · ${viewUnit.warehouse?.name ?? 'Warehouse'}`}
          onClose={() => setViewUnit(null)}
          footer={
            <>
              <FormPanelCancel onClick={() => setViewUnit(null)} />
              <Button
                onClick={() => {
                  openEdit(viewUnit)
                }}
              >
                <Pencil size={14} /> Edit
              </Button>
            </>
          }
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ['Serial', viewUnit.serialNo],
              ['Status', viewUnit.status.replace('_', ' ')],
              ['Product', viewUnit.product?.name ?? productMap[viewUnit.productId]?.name],
              ['SKU', viewUnit.product?.sku ?? productMap[viewUnit.productId]?.sku],
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
        </FormPanel>
      ) : null}

      {editUnit ? (
        <FormPanel
          open
          accent="amber"
          eyebrow="Edit stock unit"
          title={editUnit.serialNo}
          subtitle="Update serial, warehouse, stamping date, or notes"
          onClose={() => setEditUnit(null)}
          footer={
            <>
              <FormPanelCancel onClick={() => setEditUnit(null)} />
              <Button onClick={() => void saveEdit()} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm sm:col-span-2">
              <div className="text-xs text-text-secondary">Product (fixed)</div>
              <div className="font-medium">
                {(editUnit.product?.sku ?? productMap[editUnit.productId]?.sku) || '—'} —{' '}
                {editUnit.product?.name ?? productMap[editUnit.productId]?.name}
              </div>
            </div>
            <Select
              label="Warehouse *"
              value={editForm.warehouseId}
              onChange={(e) => setEditForm({ ...editForm, warehouseId: e.target.value })}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
            <Input
              label="Serial number *"
              value={editForm.serialNo}
              error={errors.serialNo}
              onChange={(e) => setEditForm({ ...editForm, serialNo: e.target.value })}
            />
            {editFormRequiresStamping ? (
              <Input
                label="Stamping date"
                type="date"
                value={editForm.stampingDate}
                onChange={(e) => setEditForm({ ...editForm, stampingDate: e.target.value })}
              />
            ) : (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-text-secondary sm:col-span-2">
                Govt. stamping is not required for this product.
              </p>
            )}
            <div className="sm:col-span-2">
              <Input
                label="Notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
          </div>
        </FormPanel>
      ) : null}

      <Modal
        open={Boolean(returnConfirm)}
        onClose={() => {
          if (!returnBusy) {
            setReturnConfirm(null)
            setReturnNotes('')
          }
        }}
        title="Return demo unit to stock?"
        subtitle={returnConfirm ? `Serial ${returnConfirm.serialNo}` : undefined}
        size="sm"
        accent="amber"
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
              {returnBusy ? 'Returning…' : 'Return to stock'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          The unit moves back to <strong>In stock</strong> and available quantity increases by 1. Any linked
          sale enquiry returns to <strong>Pending</strong>.
        </p>
        <div className="mt-4">
          <Input
            label="Return notes (optional)"
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            placeholder="Condition, reason for return…"
          />
        </div>
      </Modal>
    </div>
  )
}
