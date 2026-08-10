import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { useUIStore } from '@/store/uiStore'

type Row = {
  key: string
  sku: string
  name: string
  productType: string
  unit: string
  categoryId: string
  salePrice: string
  purchasePrice: string
  taxPercent: string
  hsnSac: string
  trackInventory: boolean
  openingQty: string
  description: string
  imageUrl: string
  uploading?: boolean
}

function blankRow(): Row {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sku: '',
    name: '',
    productType: 'GOODS',
    unit: 'NOS',
    categoryId: '',
    salePrice: '',
    purchasePrice: '',
    taxPercent: '18',
    hsnSac: '',
    trackInventory: true,
    openingQty: '0',
    description: '',
    imageUrl: '',
  }
}

export function ProductCreatePage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow()])
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const lookups = await api.lookups()
      setCategories(lookups.categories)
      setWarehouseId(lookups.warehouses.find((w) => w.isDefault)?.id ?? lookups.warehouses[0]?.id ?? '')
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load lookups',
      })
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  function updateRow(key: string, patch: Partial<Row>) {
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
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Image upload failed',
      })
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
        const product = await api.createProduct({
          sku: row.sku.trim(),
          name: row.name.trim(),
          productType: row.productType,
          unit: row.unit || 'NOS',
          categoryId: row.categoryId || null,
          salePrice: Number(row.salePrice) || 0,
          purchasePrice: Number(row.purchasePrice) || 0,
          taxPercent: Number(row.taxPercent) || 0,
          hsnSac: row.hsnSac || null,
          trackInventory: row.trackInventory,
          description: row.description || null,
          imageUrl: row.imageUrl.trim() || null,
          reorderLevel: 5,
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
      addToast({ type: 'success', message: `Saved ${created} product${created === 1 ? '' : 's'}` })
      navigate('/erp/products')
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
    <div className="space-y-4">
      <PageHeader
        title="Add products"
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Products', to: '/erp/products' },
          { label: 'New' },
        ]}
        actions={
          <div className="flex gap-2">
            <Link to="/erp/products">
              <Button variant="outline">
                <ArrowLeft size={16} /> Back
              </Button>
            </Link>
            <Button onClick={() => void saveAll()} disabled={saving}>
              {saving ? 'Saving…' : 'Save all'}
            </Button>
          </div>
        }
      />

      <Card>
        <p className="mb-4 text-sm text-text-secondary">
          Add multiple SKUs on one page. Leave a row blank to skip it. Opening qty is applied to the default warehouse when inventory tracking is on.
        </p>
        <div className="space-y-4">
          {rows.map((row, index) => (
            <div key={row.key} className="rounded-[10px] border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Product {index + 1}</div>
                <Button
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
                    { value: '', label: 'Select category' },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
                <Input
                  label="Sale price ₹"
                  type="number"
                  placeholder="18500"
                  value={row.salePrice}
                  onChange={(e) => updateRow(row.key, { salePrice: e.target.value })}
                />
                <Input
                  label="Purchase price ₹"
                  type="number"
                  placeholder="12000"
                  value={row.purchasePrice}
                  onChange={(e) => updateRow(row.key, { purchasePrice: e.target.value })}
                />
                <Input
                  label="Tax %"
                  type="number"
                  placeholder="18"
                  value={row.taxPercent}
                  onChange={(e) => updateRow(row.key, { taxPercent: e.target.value })}
                />
                <Input
                  label="HSN / SAC"
                  placeholder="8423"
                  value={row.hsnSac}
                  onChange={(e) => updateRow(row.key, { hsnSac: e.target.value })}
                />
                <Input
                  label="Unit"
                  placeholder="NOS"
                  value={row.unit}
                  onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                />
                <Input
                  label="Opening qty"
                  type="number"
                  placeholder="10"
                  value={row.openingQty}
                  onChange={(e) => updateRow(row.key, { openingQty: e.target.value })}
                  disabled={!row.trackInventory}
                />
                <label className="flex items-end gap-2 pb-2 text-sm font-medium text-text-secondary">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent-blue"
                    checked={row.trackInventory}
                    onChange={(e) => updateRow(row.key, { trackInventory: e.target.checked })}
                  />
                  Track inventory
                </label>
                <Input
                  className="sm:col-span-2 lg:col-span-4"
                  label="Description"
                  placeholder="Capacity, warranty, notes…"
                  value={row.description}
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRows((list) => [...list, blankRow()])}>
            <Plus size={16} /> Add another product
          </Button>
          <Button onClick={() => void saveAll()} disabled={saving}>
            {saving ? 'Saving…' : 'Save all products'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

export default ProductCreatePage
