import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Package, Plus } from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { assetUrl, firstError, validateProductForm, type FieldErrors } from '@/lib/formValidation'
import { formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const emptyForm = {
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
  description: '',
  brand: '',
  model: '',
  warrantyMonths: '',
  capacityKg: '',
  imageUrl: '',
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
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<FieldErrors>({})

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

  async function onImageFile(file?: File | null) {
    if (!file) return
    setUploading(true)
    try {
      const uploaded = await api.uploadImage(file)
      setForm((f) => ({ ...f, imageUrl: uploaded.url }))
      setErrors((e) => ({ ...e, imageUrl: '' }))
      addToast({ type: 'success', message: 'Image uploaded' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  async function saveProduct() {
    const nextErrors = validateProductForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      return
    }
    setSaving(true)
    try {
      const attributes: Record<string, unknown> = {}
      if (form.brand) attributes.brand = form.brand
      if (form.model) attributes.model = form.model
      if (form.warrantyMonths) attributes.warranty_months = Number(form.warrantyMonths)
      if (form.capacityKg) attributes.capacity_kg = form.capacityKg

      await api.createProduct({
        sku: form.sku.trim(),
        name: form.name.trim(),
        productType: form.productType,
        unit: form.unit || 'NOS',
        categoryId: form.categoryId || null,
        salePrice: Number(form.salePrice) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        mrp: form.mrp ? Number(form.mrp) : null,
        taxPercent: Number(form.taxPercent) || 0,
        hsnSac: form.hsnSac || null,
        reorderLevel: Number(form.reorderLevel) || 0,
        trackInventory: form.trackInventory,
        description: form.description || null,
        imageUrl: form.imageUrl.trim() || null,
        attributes,
      })
      setOpen(false)
      setForm(emptyForm)
      setErrors({})
      addToast({ type: 'success', message: 'Product saved' })
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
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
        actions={
          <Button onClick={() => navigate('/erp/products/new')}>
            <Plus size={16} /> Add products
          </Button>
        }
      />
      <FeatureTip title={t.title} body={t.body} tipType={t.tipType} />
      <Input className="mb-4 max-w-md" placeholder="Search SKU or name..." value={q} onChange={(e) => setQ(e.target.value)} />
      <Card padding={false}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Package size={22} />}
            title="No products"
            subtitle="Add your catalog — any industry."
            actionLabel="Add products"
            onAction={() => navigate('/erp/products/new')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['', 'SKU', 'Name', 'Type', 'Unit', 'Sale', 'Purchase', 'Tax %', 'Stock', 'HSN'].map((h) => (
                    <th key={h || 'img'} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const stock = stockByProduct[String(p.id)] ?? 0
                  const img = assetUrl(p.imageUrl as string | null)
                  return (
                    <tr
                      key={String(p.id)}
                      className="cursor-pointer border-t border-border hover:bg-surface"
                      onClick={() => navigate(`/erp/products/${p.id}`)}
                    >
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add product"
        subtitle="SKU, pricing and optional image. Fields marked * are required."
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveProduct()} disabled={saving || uploading}>
              {saving ? 'Saving…' : 'Save product'}
            </Button>
          </>
        }
      >
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <div className="sm:col-span-2 flex flex-wrap items-start gap-4 rounded-lg border border-border bg-surface p-3">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
              {form.imageUrl ? (
                <img src={assetUrl(form.imageUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="text-text-secondary" size={22} />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                label="Image URL (optional)"
                value={form.imageUrl}
                error={errors.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://… or upload below"
              />
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-accent-blue">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onImageFile(e.target.files?.[0])}
                />
                {uploading ? 'Uploading…' : 'Upload image icon'}
              </label>
            </div>
          </div>

          <Input label="SKU *" value={form.sku} error={errors.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <Input label="Product name *" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select
            label="Type"
            value={form.productType}
            onChange={(e) => setForm({ ...form, productType: e.target.value })}
            options={[
              { value: 'GOODS', label: 'Goods' },
              { value: 'SERVICE', label: 'Service' },
              { value: 'BUNDLE', label: 'Bundle' },
            ]}
          />
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            options={[{ value: '', label: 'Uncategorized' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <Input label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="NOS / KG / SET" />
          <Input label="HSN / SAC" value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} />
          <Input label="Sale price ₹" type="number" value={form.salePrice} error={errors.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} />
          <Input label="Purchase price ₹" type="number" value={form.purchasePrice} error={errors.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
          <Input label="MRP ₹" type="number" value={form.mrp} error={errors.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
          <Input label="Tax % *" type="number" value={form.taxPercent} error={errors.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
          <Input label="Reorder level" type="number" value={form.reorderLevel} error={errors.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
          <Input label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <Input label="Warranty (months)" type="number" value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} />
          <Input label="Capacity / size" value={form.capacityKg} onChange={(e) => setForm({ ...form, capacityKg: e.target.value })} placeholder="e.g. 500 kg" />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.trackInventory}
              onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })}
            />
            Track inventory for this product
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-text-secondary">Description</span>
            <textarea
              className="min-h-20 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
