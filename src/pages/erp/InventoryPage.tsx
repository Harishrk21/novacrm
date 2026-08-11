import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Eye, Package, Plus, ShoppingCart, Warehouse as WarehouseIcon } from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type StockRow = {
  id: string
  productId: string
  warehouseId: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  stockValue: number
  isLowStock: boolean
  updatedAt?: string
  product?: {
    id: string
    sku: string
    name: string
    unit: string
    salePrice: number
    purchasePrice: number
    reorderLevel: number
    imageUrl?: string | null
    hsnSac?: string | null
    productType?: string
  } | null
  warehouse?: { id: string; name: string; code?: string } | null
}

export function InventoryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preselectProduct = searchParams.get('productId') || ''
  const t = DEFAULT_TIPS['erp.inventory'] ?? {
    title: 'Stock discipline',
    body: 'Use Stock in / Stock out with a short reason. Low-stock rows are highlighted against each product’s reorder level.',
    tipType: 'WARNING' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const [levels, setLevels] = useState<StockRow[]>([])
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; unit?: string; purchasePrice?: number }>
  >([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'low'>('all')
  const [tab, setTab] = useState<'list' | 'adjust'>('list')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    productId: preselectProduct,
    warehouseId: '',
    movementType: 'IN',
    quantity: '',
    notes: '',
  })

  const load = useCallback(async () => {
    try {
      const [stock, lookups] = await Promise.all([api.inventory(), api.lookups()])
      setLevels(stock as StockRow[])
      setProducts(
        lookups.products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          purchasePrice: num(p.purchasePrice),
        })),
      )
      setWarehouses(lookups.warehouses)
      setForm((f) => ({
        ...f,
        warehouseId: f.warehouseId || lookups.warehouses[0]?.id || '',
        productId: f.productId || preselectProduct || lookups.products[0]?.id || '',
      }))
      if (preselectProduct) setTab('adjust')
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Failed to load inventory' })
    }
  }, [addToast, preselectProduct])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => {
    const skus = new Set(levels.map((r) => r.productId)).size
    const onHand = levels.reduce((s, r) => s + num(r.quantityOnHand), 0)
    const value = levels.reduce((s, r) => s + num(r.stockValue), 0)
    const low = levels.filter((r) => r.isLowStock).length
    return { skus, onHand, value, low }
  }, [levels])

  const filtered = useMemo(() => {
    return levels.filter((row) => {
      if (filter === 'low' && !row.isLowStock) return false
      if (!q) return true
      const hay = `${row.product?.sku ?? ''} ${row.product?.name ?? ''} ${row.warehouse?.name ?? ''}`.toLowerCase()
      return hay.includes(q.toLowerCase())
    })
  }, [levels, filter, q])

  const currentStock = useMemo(() => {
    if (!form.productId || !form.warehouseId) return null
    const row = levels.find((r) => r.productId === form.productId && r.warehouseId === form.warehouseId)
    if (!row) {
      return { onHand: 0, reserved: 0, available: 0, unit: products.find((p) => p.id === form.productId)?.unit ?? 'pcs' }
    }
    const onHand = num(row.quantityOnHand)
    const reserved = num(row.quantityReserved)
    const available = num(row.quantityAvailable ?? onHand - reserved)
    return {
      onHand,
      reserved,
      available,
      unit: row.product?.unit ?? products.find((p) => p.id === form.productId)?.unit ?? 'pcs',
    }
  }, [form.productId, form.warehouseId, levels, products])

  function openAdjust(defaults?: Partial<typeof form>) {
    setForm((f) => ({
      ...f,
      movementType: 'IN',
      quantity: '',
      notes: '',
      ...defaults,
    }))
    setErrors({})
    setTab('adjust')
  }

  async function adjust() {
    const next: Record<string, string> = {}
    if (!form.productId) next.productId = 'Select a product'
    if (!form.warehouseId) next.warehouseId = 'Select a warehouse'
    const qty = Number(form.quantity)
    if (!form.quantity || Number.isNaN(qty) || qty === 0) next.quantity = 'Enter a non-zero quantity'
    if (form.quantity && qty < 0) next.quantity = 'Use positive quantity; choose Stock out to reduce'
    if (form.notes.trim() && form.notes.trim().length < 2) next.notes = 'Reason must be at least 2 characters'
    setErrors(next)
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }

    setSaving(true)
    try {
      await api.adjustStock({
        productId: form.productId,
        warehouseId: form.warehouseId,
        movementType: form.movementType,
        quantity: Math.abs(qty),
        notes: form.notes.trim() || 'Stock adjustment',
      })
      setTab('list')
      setForm((f) => ({ ...f, quantity: '', notes: '', movementType: 'IN' }))
      setErrors({})
      addToast({ type: 'success', message: 'Stock updated' })
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Adjust failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        count={levels.length}
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
            <Button onClick={() => openAdjust()}>
              <Plus size={16} /> Adjust stock
            </Button>
          </div>
        }
      />
      <FeatureTip title={t.title} body={t.body} tipType={t.tipType} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'SKUs in stock', value: String(summary.skus) },
          { label: 'Units on hand', value: String(summary.onHand) },
          { label: 'Stock value', value: formatCurrency(summary.value) },
          { label: 'Low stock alerts', value: String(summary.low), warn: summary.low > 0 },
        ].map((card) => (
          <Card key={card.label} className="py-4">
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">{card.label}</div>
            <div className={`mt-1 text-xl font-semibold ${card.warn ? 'text-accent-red' : 'text-text-primary'}`}>
              {card.value}
            </div>
          </Card>
        ))}
      </div>

      <PageTabs
        accent="amber"
        active={tab}
        onChange={(id) => {
          if (id === 'adjust') openAdjust()
          else setTab('list')
        }}
        tabs={[
          { id: 'list', label: 'All stock', count: filtered.length },
          { id: 'adjust', label: 'Adjust stock' },
        ]}
      />

      {tab === 'list' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input className="max-w-sm" placeholder="Search product or warehouse…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex gap-2">
              <Button variant={filter === 'all' ? 'primary' : 'outline'} size="sm" onClick={() => setFilter('all')}>
                All
              </Button>
              <Button variant={filter === 'low' ? 'primary' : 'outline'} size="sm" onClick={() => setFilter('low')}>
                <AlertTriangle size={14} /> Low stock
              </Button>
            </div>
          </div>

          <Card padding={false}>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<WarehouseIcon size={22} />}
                title="No stock rows yet"
                subtitle="Create products, then adjust stock or receive a purchase order."
                actionLabel="Adjust stock"
                onAction={() => openAdjust()}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="bg-muted text-xs text-text-secondary">
                    <tr>
                      {[
                        'Product',
                        'Warehouse',
                        'Type',
                        'Unit',
                        'On hand',
                        'Reserved',
                        'Available',
                        'Reorder',
                        'Unit cost',
                        'Stock value',
                        'Updated',
                        'Actions',
                      ].map((h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const p = row.product
                      const img = assetUrl(p?.imageUrl)
                      const available = num(row.quantityAvailable ?? num(row.quantityOnHand) - num(row.quantityReserved))
                      return (
                        <tr key={String(row.id)} className={`border-t border-border ${row.isLowStock ? 'bg-red-50/40' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {img ? (
                                <img src={img} alt="" className="h-9 w-9 rounded object-cover ring-1 ring-border" />
                              ) : (
                                <div className="flex h-9 w-9 items-center justify-center rounded bg-muted">
                                  <Package size={14} />
                                </div>
                              )}
                              <div>
                                <div className="font-medium">{p?.name ?? '—'}</div>
                                <div className="font-mono text-xs text-text-secondary">{p?.sku ?? '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">{row.warehouse?.name ?? '—'}</td>
                          <td className="px-4 py-3">
                            {p?.productType ? <Badge color="blue">{p.productType}</Badge> : '—'}
                          </td>
                          <td className="px-4 py-3">{p?.unit ?? '—'}</td>
                          <td className="px-4 py-3 font-medium">{num(row.quantityOnHand)}</td>
                          <td className="px-4 py-3">{num(row.quantityReserved)}</td>
                          <td className="px-4 py-3">
                            <Badge color={row.isLowStock ? 'red' : 'green'}>{available}</Badge>
                          </td>
                          <td className="px-4 py-3">{p?.reorderLevel ?? '—'}</td>
                          <td className="px-4 py-3">{formatCurrency(num(p?.purchasePrice))}</td>
                          <td className="px-4 py-3 font-semibold">{formatCurrency(num(row.stockValue))}</td>
                          <td className="px-4 py-3 text-text-secondary">
                            {row.updatedAt ? formatDate(String(row.updatedAt)) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/erp/products/${row.productId}`)}
                              >
                                <Eye size={14} />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  openAdjust({
                                    productId: row.productId,
                                    warehouseId: row.warehouseId,
                                  })
                                }
                              >
                                Adjust
                              </Button>
                              {row.isLowStock ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => navigate('/erp/purchase-orders')}
                                >
                                  Reorder
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <FormPanel
          open
          accent="amber"
          eyebrow="Inventory"
          title="Adjust stock"
          subtitle={
            currentStock
              ? `Current: ${currentStock.available} ${currentStock.unit} available (${currentStock.onHand} on hand · ${currentStock.reserved} reserved)`
              : 'Stock in adds quantity. Stock out removes it. Always leave a short reason.'
          }
          onClose={() => setTab('list')}
          footer={
            <>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button onClick={() => void adjust()} disabled={saving}>
                {saving ? 'Saving…' : 'Save adjustment'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {currentStock && (
              <div className="grid grid-cols-3 gap-2 rounded-[8px] border border-amber-100 bg-amber-50/40 p-3 text-center text-sm sm:col-span-2">
                <div>
                  <div className="text-xs text-text-secondary">On hand</div>
                  <div className="text-lg font-semibold tabular-nums">{currentStock.onHand}</div>
                </div>
                <div>
                  <div className="text-xs text-text-secondary">Reserved</div>
                  <div className="text-lg font-semibold tabular-nums">{currentStock.reserved}</div>
                </div>
                <div>
                  <div className="text-xs text-text-secondary">Available</div>
                  <div className="text-lg font-semibold tabular-nums text-accent-green">
                    {currentStock.available}
                  </div>
                </div>
              </div>
            )}
            <div>
              <Select
                label="Product *"
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
                options={[
                  { value: '', label: 'Select product' },
                  ...products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
                ]}
              />
              {errors.productId && <p className="mt-1 text-xs text-accent-red">{errors.productId}</p>}
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
            <Select
              label="Movement *"
              value={form.movementType}
              onChange={(e) => setForm({ ...form, movementType: e.target.value })}
              options={[
                { value: 'IN', label: 'Stock in (+)' },
                { value: 'OUT', label: 'Stock out (−)' },
                { value: 'ADJUST', label: 'Adjustment (+ qty)' },
                { value: 'RETURN', label: 'Return to vendor (−)' },
              ]}
            />
            <Input
              label={
                currentStock
                  ? `Quantity to ${form.movementType === 'OUT' || form.movementType === 'RETURN' ? 'remove' : 'add'} * (available ${currentStock.available} ${currentStock.unit})`
                  : 'Quantity *'
              }
              type="number"
              min={1}
              value={form.quantity}
              error={errors.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <div className="sm:col-span-2">
              <Input
                label="Reason / notes"
                value={form.notes}
                error={errors.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Opening stock / Damaged / Cycle count"
              />
            </div>
          </div>
        </FormPanel>
      )}
    </div>
  )
}
