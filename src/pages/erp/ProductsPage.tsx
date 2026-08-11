import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Package, Plus, Trash2 } from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
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
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type ProductRow = {
  key: string
  sku: string
  name: string
  productType: string
  unit: string
  categoryId: string
  salePrice: string
  purchasePrice: string
  mrp: string
  taxPercent: string
  hsnSac: string
  reorderLevel: string
  trackInventory: boolean
  openingQty: string
  description: string
  brand: string
  model: string
  warrantyMonths: string
  capacityKg: string
  imageUrl: string
  uploading?: boolean
}

function blankRow(): ProductRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sku: '',
    name: '',
    productType: 'GOODS',
    unit: 'NOS',
    categoryId: '',
    salePrice: '',
    purchasePrice: '',
    mrp: '',
    taxPercent: '18',
    hsnSac: '',
    reorderLevel: '5',
    trackInventory: true,
    openingQty: '0',
    description: '',
    brand: '',
    model: '',
    warrantyMonths: '',
    capacityKg: '',
    imageUrl: '',
  }
}

export function ProductsPage() {
  const navigate = useNavigate()
  const t = DEFAULT_TIPS['erp.products'] ?? {
    title: 'Products catalog',
    body: 'Add every sellable item — goods or services. Optional product image helps your team recognize items quickly.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [levels, setLevels] = useState<Record<string, unknown>[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<ProductRow[]>([blankRow(), blankRow()])
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const [products, stock, lookups] = await Promise.all([
        api.products({ limit: 100 }),
        api.inventory(),
        api.lookups(),
      ])
      setItems(products.items ?? [])
      setLevels(stock)
      setCategories(lookups.categories)
      setWarehouseId(lookups.warehouses.find((w) => w.isDefault)?.id ?? lookups.warehouses[0]?.id ?? '')
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Failed to load products' })
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  const stockByProduct = useMemo(() => {
    const map: Record<string, number> = {}
    for (const row of levels) {
      const pid = String(row.productId)
      map[pid] = (map[pid] ?? 0) + num(row.quantityOnHand ?? row.quantityAvailable)
    }
    return map
  }, [levels])

  const filtered = useMemo(
    () =>
      items.filter(
        (p) =>
          !q ||
          String(p.name).toLowerCase().includes(q.toLowerCase()) ||
          String(p.sku).toLowerCase().includes(q.toLowerCase()),
      ),
    [items, q],
  )

  const ids = useMemo(() => filtered.map((p) => String(p.id)), [filtered])
  const selection = useRowSelection(ids)

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteProduct(id)))
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

  function updateRow(key: string, patch: Partial<ProductRow>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function uploadImage(key: string, file?: File | null) {
    if (!file) return
    updateRow(key, { uploading: true })
    try {
      const uploaded = await api.uploadImage(file)
      updateRow(key, { imageUrl: uploaded.url, uploading: false })
      addToast({ type: 'success', message: 'Image uploaded' })
    } catch (err) {
      updateRow(key, { uploading: false })
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Upload failed' })
    }
  }

  async function saveAll() {
    const valid = rows.filter((r) => r.sku.trim() && r.name.trim())
    if (!valid.length) {
      addToast({ type: 'error', message: 'Add at least one product with SKU and name' })
      return
    }
    setSaving(true)
    let created = 0
    try {
      for (const row of valid) {
        const attributes: Record<string, unknown> = {}
        if (row.brand) attributes.brand = row.brand
        if (row.model) attributes.model = row.model
        if (row.warrantyMonths) attributes.warranty_months = Number(row.warrantyMonths)
        if (row.capacityKg) attributes.capacity_kg = row.capacityKg

        const product = await api.createProduct({
          sku: row.sku.trim(),
          name: row.name.trim(),
          productType: row.productType,
          unit: row.unit || 'NOS',
          categoryId: row.categoryId || null,
          salePrice: Number(row.salePrice) || 0,
          purchasePrice: Number(row.purchasePrice) || 0,
          mrp: row.mrp ? Number(row.mrp) : null,
          taxPercent: Number(row.taxPercent) || 0,
          hsnSac: row.hsnSac || null,
          reorderLevel: Number(row.reorderLevel) || 0,
          trackInventory: row.trackInventory,
          description: row.description || null,
          imageUrl: row.imageUrl.trim() || null,
          attributes,
        })
        const qty = Number(row.openingQty) || 0
        if (row.trackInventory && qty > 0 && warehouseId && product.id) {
          await api.adjustStock({
            productId: String(product.id),
            warehouseId,
            quantity: qty,
            movementType: 'IN',
            notes: 'Opening stock',
          })
        }
        created += 1
      }
      setTab('list')
      setRows([blankRow(), blankRow()])
      addToast({ type: 'success', message: `Saved ${created} product${created === 1 ? '' : 's'}` })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : `Failed after saving ${created} product(s)`,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        count={items.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Products' }]}
      />
      <FeatureTip title={t.title} body={t.body} tipType={t.tipType} />

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create')
          if (id === 'create') setRows([blankRow(), blankRow()])
        }}
        tabs={[
          { id: 'list', label: 'All products', count: filtered.length },
          { id: 'create', label: 'Add products' },
        ]}
      />

      {tab === 'list' ? (
        <>
          <Input
            className="mb-4 max-w-md"
            placeholder="Search SKU or name..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Card padding={false}>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Package size={22} />}
                title="No products"
                subtitle="Add your catalog — any industry."
                actionLabel="Add products"
                onAction={() => setTab('create')}
              />
            ) : (
              <div className="p-4 pt-3">
                {selection.someSelected ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="product"
                    busy={busyDelete}
                    onClear={selection.clear}
                    onDelete={() => setConfirm({ ids: selection.selectedIds })}
                  />
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-left text-sm">
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
                        {['', 'SKU', 'Name', 'Type', 'Unit', 'Sale', 'Purchase', 'Tax %', 'Stock', 'HSN', 'Actions'].map(
                          (h) => (
                            <th key={h || 'img'} className="px-4 py-3 font-medium">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => {
                        const id = String(p.id)
                        const stock = stockByProduct[id] ?? 0
                        const img = assetUrl(p.imageUrl as string | null)
                        return (
                          <tr
                            key={id}
                            className="cursor-pointer border-t border-border hover:bg-surface"
                            onClick={() => navigate(`/erp/products/${id}`)}
                          >
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <SelectCheckbox
                                checked={selection.isSelected(id)}
                                onChange={() => selection.toggle(id)}
                                aria-label={`Select ${String(p.name)}`}
                              />
                            </td>
                            <td className="px-4 py-3">
                              {img ? (
                                <img src={img} alt="" className="h-9 w-9 rounded object-cover ring-1 ring-border" />
                              ) : (
                                <div className="flex h-9 w-9 items-center justify-center rounded bg-muted text-text-secondary">
                                  <Package size={14} />
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">{String(p.sku)}</td>
                            <td className="px-4 py-3 font-medium text-accent-blue">{String(p.name)}</td>
                            <td className="px-4 py-3">
                              <Badge color="blue">{String(p.productType)}</Badge>
                            </td>
                            <td className="px-4 py-3">{String(p.unit)}</td>
                            <td className="px-4 py-3 font-semibold">{formatCurrency(num(p.salePrice))}</td>
                            <td className="px-4 py-3">{formatCurrency(num(p.purchasePrice))}</td>
                            <td className="px-4 py-3">{num(p.taxPercent)}%</td>
                            <td className="px-4 py-3">
                              <Badge color={stock < num(p.reorderLevel, 5) ? 'red' : 'green'}>{stock}</Badge>
                            </td>
                            <td className="px-4 py-3 text-text-secondary">{String(p.hsnSac || '—')}</td>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-0.5">
                                <ViewIconButton onClick={() => navigate(`/erp/products/${id}`)} />
                                <DeleteIconButton
                                  disabled={busyDelete}
                                  onClick={() => setConfirm({ ids: [id] })}
                                />
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <FormPanel
          open
          accent="theme"
          eyebrow="Catalog"
          title="Add products"
          subtitle="Add several SKUs at once. Leave a row blank to skip it. Opening qty goes to the default warehouse when tracking is on."
          onClose={() => setTab('list')}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setRows((list) => [...list, blankRow()])}>
                <Plus size={16} /> Add another
              </Button>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button onClick={() => void saveAll()} disabled={saving}>
                {saving ? 'Saving…' : 'Save all products'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {rows.map((row, index) => (
              <div key={row.key} className="rounded-[10px] border border-border bg-card/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold">Product {index + 1}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-accent-red"
                    disabled={rows.length <= 1}
                    onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 size={14} /> Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-start gap-3 sm:col-span-2 lg:col-span-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                      {row.imageUrl ? (
                        <img src={assetUrl(row.imageUrl)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus className="text-text-secondary" size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        label="Image URL (optional)"
                        placeholder="https://… or upload"
                        value={row.imageUrl}
                        onChange={(e) => updateRow(row.key, { imageUrl: e.target.value })}
                      />
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-accent-blue">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => void uploadImage(row.key, e.target.files?.[0])}
                        />
                        {row.uploading ? 'Uploading…' : 'Upload product image'}
                      </label>
                    </div>
                  </div>
                  <Input
                    label="SKU *"
                    placeholder="PSI-TT-30"
                    value={row.sku}
                    onChange={(e) => updateRow(row.key, { sku: e.target.value })}
                  />
                  <Input
                    label="Name *"
                    placeholder="Table Top Scale 30kg"
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                  />
                  <Select
                    label="Type"
                    value={row.productType}
                    onChange={(e) => updateRow(row.key, { productType: e.target.value })}
                    options={[
                      { value: 'GOODS', label: 'Goods' },
                      { value: 'SERVICE', label: 'Service' },
                      { value: 'BUNDLE', label: 'Bundle' },
                    ]}
                  />
                  <Select
                    label="Category"
                    value={row.categoryId}
                    onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                    options={[
                      { value: '', label: 'Uncategorized' },
                      ...categories.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                  <Input
                    label="Sale price ₹"
                    type="number"
                    value={row.salePrice}
                    onChange={(e) => updateRow(row.key, { salePrice: e.target.value })}
                  />
                  <Input
                    label="Purchase price ₹"
                    type="number"
                    value={row.purchasePrice}
                    onChange={(e) => updateRow(row.key, { purchasePrice: e.target.value })}
                  />
                  <Input
                    label="MRP ₹"
                    type="number"
                    value={row.mrp}
                    onChange={(e) => updateRow(row.key, { mrp: e.target.value })}
                  />
                  <Input
                    label="Tax %"
                    type="number"
                    value={row.taxPercent}
                    onChange={(e) => updateRow(row.key, { taxPercent: e.target.value })}
                  />
                  <Input label="Unit" value={row.unit} onChange={(e) => updateRow(row.key, { unit: e.target.value })} />
                  <Input
                    label="HSN / SAC"
                    value={row.hsnSac}
                    onChange={(e) => updateRow(row.key, { hsnSac: e.target.value })}
                  />
                  <Input
                    label="Reorder level"
                    type="number"
                    value={row.reorderLevel}
                    onChange={(e) => updateRow(row.key, { reorderLevel: e.target.value })}
                  />
                  <Input
                    label="Opening qty"
                    type="number"
                    value={row.openingQty}
                    onChange={(e) => updateRow(row.key, { openingQty: e.target.value })}
                    disabled={!row.trackInventory}
                  />
                  <Input label="Brand" value={row.brand} onChange={(e) => updateRow(row.key, { brand: e.target.value })} />
                  <Input label="Model" value={row.model} onChange={(e) => updateRow(row.key, { model: e.target.value })} />
                  <Input
                    label="Warranty (months)"
                    type="number"
                    value={row.warrantyMonths}
                    onChange={(e) => updateRow(row.key, { warrantyMonths: e.target.value })}
                  />
                  <Input
                    label="Capacity / size"
                    value={row.capacityKg}
                    onChange={(e) => updateRow(row.key, { capacityKg: e.target.value })}
                    placeholder="e.g. 500 kg"
                  />
                  <label className="flex items-end gap-2 pb-2 text-sm font-medium text-text-secondary">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={row.trackInventory}
                      onChange={(e) => updateRow(row.key, { trackInventory: e.target.checked })}
                    />
                    Track inventory
                  </label>
                  <Input
                    className="sm:col-span-2 lg:col-span-4"
                    label="Description"
                    value={row.description}
                    onChange={(e) => updateRow(row.key, { description: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </FormPanel>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete product?' : `Delete ${confirm?.ids.length ?? 0} products?`}
        body={
          confirm?.ids.length === 1
            ? 'This product will be permanently removed.'
            : 'Selected products will be permanently removed.'
        }
      />
    </div>
  )
}
