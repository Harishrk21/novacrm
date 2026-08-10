import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  Package,
  Pencil,
  ShoppingCart,
  Ticket,
  Warehouse,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [product, setProduct] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    warehouseId: '',
    movementType: 'IN',
    quantity: '',
    notes: '',
  })

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups] = await Promise.all([api.getProduct(id), api.lookups()])
      setProduct(row)
      setWarehouses(lookups.warehouses)
      setForm((f) => ({
        ...f,
        warehouseId: f.warehouseId || lookups.warehouses[0]?.id || '',
      }))
    } catch {
      setProduct(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function adjust() {
    if (!id || !form.warehouseId || !Number(form.quantity)) {
      addToast({ type: 'error', message: 'Warehouse and quantity are required' })
      return
    }
    setSaving(true)
    try {
      await api.adjustStock({
        productId: id,
        warehouseId: form.warehouseId,
        movementType: form.movementType,
        quantity: Math.abs(Number(form.quantity)),
        notes: form.notes.trim() || 'Stock adjustment from product page',
      })
      addToast({ type: 'success', message: 'Stock updated' })
      setAdjustOpen(false)
      setForm((f) => ({ ...f, quantity: '', notes: '' }))
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Adjust failed' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Card className="p-6 text-sm text-text-secondary">Loading product…</Card>
  if (!product) {
    return (
      <EmptyState
        icon={<Package size={26} />}
        title="Product not found"
        actionLabel="Back to products"
        onAction={() => navigate('/erp/products')}
      />
    )
  }

  const attrs = (product.attributes as Record<string, unknown> | null) ?? {}
  const stockSummary = (product.stockSummary as Record<string, number> | null) ?? {
    onHand: 0,
    reserved: 0,
    available: 0,
    isLow: 0,
  }
  const stockLevels = (product.stockLevels as Array<Record<string, unknown>>) ?? []
  const movements = (product.movements as Array<Record<string, unknown>>) ?? []
  const invoiceLines = (product.invoiceLines as Array<Record<string, unknown>>) ?? []
  const tickets = (product.tickets as Array<Record<string, unknown>>) ?? []
  const category = product.category as { name?: string } | null
  const img = assetUrl(product.imageUrl as string | null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => navigate('/erp/products')}>
          <ArrowLeft size={16} /> Products
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAdjustOpen(true)}>
            <Warehouse size={16} /> Adjust stock
          </Button>
          <Link to="/erp/purchase-orders">
            <Button variant="outline">
              <ShoppingCart size={16} /> Purchase
            </Button>
          </Link>
          <Link to="/erp/invoices">
            <Button variant="outline">
              <FileText size={16} /> Invoice
            </Button>
          </Link>
          <Link to={`/erp/inventory?productId=${product.id}`}>
            <Button>
              <Pencil size={16} /> Inventory view
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-5">
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-[10px] bg-muted ring-1 ring-border">
            {img ? (
              <img src={img} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="text-text-secondary" size={32} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-text-primary">{String(product.name)}</h1>
              <Badge color={product.isActive ? 'green' : 'slate'}>
                {product.isActive ? 'Active' : 'Inactive'}
              </Badge>
              <Badge color="blue">{String(product.productType)}</Badge>
              {stockSummary.isLow ? <Badge color="red">Low stock</Badge> : null}
            </div>
            <p className="mt-1 font-mono text-sm text-text-secondary">{String(product.sku)}</p>
            {product.description ? (
              <p className="mt-3 max-w-3xl text-sm text-text-secondary">{String(product.description)}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <div>
                <div className="text-xs text-text-secondary">Sale price</div>
                <div className="text-lg font-semibold">{formatCurrency(num(product.salePrice))}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Purchase</div>
                <div className="text-lg font-semibold">{formatCurrency(num(product.purchasePrice))}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">On hand</div>
                <div className="text-lg font-semibold">{num(stockSummary.onHand)}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Available</div>
                <div className="text-lg font-semibold">{num(stockSummary.available)}</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">Catalog details</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[
              ['Category', category?.name],
              ['Unit', product.unit],
              ['HSN / SAC', product.hsnSac],
              ['Tax %', `${num(product.taxPercent)}%`],
              ['MRP', product.mrp != null ? formatCurrency(num(product.mrp)) : null],
              ['Reorder level', product.reorderLevel],
              ['Track inventory', product.trackInventory ? 'Yes' : 'No'],
              ['Brand', attrs.brand],
              ['Model', attrs.model],
              ['Capacity', attrs.capacity_kg ?? attrs.capacity],
              ['Warranty (months)', attrs.warranty_months],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs text-text-secondary">{String(k)}</dt>
                <dd className="font-medium">{v != null && v !== '' ? String(v) : '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="lg:col-span-2" padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Stock by warehouse</div>
          {stockLevels.length === 0 ? (
            <p className="p-6 text-sm text-text-secondary">No stock rows yet — adjust stock to create one.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['Warehouse', 'On hand', 'Reserved', 'Available', 'Updated'].map((h) => (
                    <th key={h} className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stockLevels.map((row) => {
                  const wh = row.warehouse as { name?: string } | null
                  return (
                    <tr key={String(row.id)} className="border-t border-border">
                      <td className="px-4 py-2">{wh?.name ?? '—'}</td>
                      <td className="px-4 py-2 font-medium">{num(row.quantityOnHand)}</td>
                      <td className="px-4 py-2">{num(row.quantityReserved)}</td>
                      <td className="px-4 py-2">
                        <Badge color={num(row.quantityAvailable) <= num(product.reorderLevel) ? 'red' : 'green'}>
                          {num(row.quantityAvailable)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        {row.updatedAt ? formatDate(String(row.updatedAt)) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Recent stock movements</div>
          <ul className="divide-y divide-border">
            {movements.map((m) => {
              const wh = m.warehouse as { name?: string } | null
              return (
                <li key={String(m.id)} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {labelize(String(m.movementType))} · {num(m.quantity)} {String(product.unit)}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {wh?.name ?? '—'}
                      {m.notes ? ` · ${String(m.notes)}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary">
                    {m.movedAt ? formatDateTime(String(m.movedAt)) : '—'}
                  </div>
                </li>
              )
            })}
            {!movements.length && (
              <li className="p-6 text-center text-sm text-text-secondary">No movements logged</li>
            )}
          </ul>
        </Card>

        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Invoices using this product</div>
          <ul className="divide-y divide-border">
            {invoiceLines.map((line) => {
              const inv = line.invoice as Record<string, unknown> | null
              return (
                <li key={String(line.id)} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{inv ? String(inv.invoiceNumber) : 'Invoice'}</div>
                    <div className="text-xs text-text-secondary">
                      Qty {num(line.quantity)} · {inv?.status ? String(inv.status) : ''}
                    </div>
                  </div>
                  <div className="font-semibold">{formatCurrency(num(line.lineTotal))}</div>
                </li>
              )
            })}
            {!invoiceLines.length && (
              <li className="p-6 text-center text-sm text-text-secondary">Not billed on any invoice yet</li>
            )}
          </ul>
        </Card>

        <Card padding={false} className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-semibold">Support tickets linked</span>
            <Link to="/tickets" className="text-sm text-accent-blue hover:underline">
              All tickets
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {tickets.map((t) => (
              <li key={String(t.id)}>
                <Link
                  to={`/tickets/${t.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Ticket size={14} className="text-text-secondary" />
                    #{num(t.ticketNo)} · {String(t.subject)}
                  </span>
                  <Badge color="blue">{labelize(String(t.status))}</Badge>
                </Link>
              </li>
            ))}
            {!tickets.length && (
              <li className="p-6 text-center text-sm text-text-secondary">No tickets for this product</li>
            )}
          </ul>
        </Card>
      </div>

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Adjust stock"
        subtitle={String(product.name)}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void adjust()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Select
            label="Warehouse"
            value={form.warehouseId}
            onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
          <Select
            label="Movement"
            value={form.movementType}
            onChange={(e) => setForm({ ...form, movementType: e.target.value })}
            options={[
              { value: 'IN', label: 'Stock in (+)' },
              { value: 'OUT', label: 'Stock out (−)' },
              { value: 'ADJUST', label: 'Adjustment (+)' },
              { value: 'RETURN', label: 'Return (−)' },
            ]}
          />
          <Input
            label="Quantity"
            type="number"
            min={1}
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <Input
            label="Reason"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Opening stock / Damaged / Cycle count"
          />
        </div>
      </Modal>
    </div>
  )
}

export default ProductDetailPage
