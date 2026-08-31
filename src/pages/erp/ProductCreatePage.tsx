import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ImagePlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { useUIStore } from '@/store/uiStore'
import { CATALOG_PRODUCT_OPTIONS } from './ProductsPage'

type CatalogKind = (typeof CATALOG_PRODUCT_OPTIONS)[number]['value']

type FormState = {
  catalogKind: CatalogKind | ''
  model: string
  brand: string
  warranty: string
  mrp: string
  salePrice: string
  purchasePrice: string
  taxPercent: string
  capacity: string
  accuracy: string
  platform: string
  description: string
  imageUrl: string
  uploading: boolean
}

function kindLabel(kind: string) {
  return CATALOG_PRODUCT_OPTIONS.find((o) => o.value === kind)?.label ?? kind
}

function buildSku(kind: CatalogKind, model: string) {
  const code = kind.replaceAll('_', '').slice(0, 6)
  const slug = model
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  const suffix = Date.now().toString(36).slice(-4).toUpperCase()
  return `${code}-${slug || 'MODEL'}-${suffix}`
}

function buildName(kind: CatalogKind, brand: string, model: string) {
  const label = kindLabel(kind)
  const parts = [brand.trim(), model.trim()].filter(Boolean)
  return parts.length ? `${label} · ${parts.join(' ')}` : label
}

const empty = (): FormState => ({
  catalogKind: '',
  model: '',
  brand: '',
  warranty: '',
  mrp: '',
  salePrice: '',
  purchasePrice: '',
  taxPercent: '18',
  capacity: '',
  accuracy: '',
  platform: '',
  description: '',
  imageUrl: '',
  uploading: false,
})

export function ProductCreatePage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [form, setForm] = useState<FormState>(empty)
  const [saving, setSaving] = useState(false)
  const isWeighing = form.catalogKind === 'WEIGHING'

  async function uploadImage(file?: File | null) {
    if (!file) return
    setForm((f) => ({ ...f, uploading: true }))
    try {
      const uploaded = await api.uploadImage(file)
      setForm((f) => ({ ...f, imageUrl: uploaded.url, uploading: false }))
      addToast({ type: 'success', message: 'Image uploaded' })
    } catch (err) {
      setForm((f) => ({ ...f, uploading: false }))
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Image upload failed',
      })
    }
  }

  async function save() {
    if (!form.catalogKind) {
      addToast({ type: 'error', message: 'Select a product type' })
      return
    }
    if (!form.model.trim()) {
      addToast({ type: 'error', message: 'Enter model number' })
      return
    }
    setSaving(true)
    try {
      const kind = form.catalogKind
      const attributes: Record<string, unknown> = {
        catalogKind: kind,
        brand: form.brand.trim() || null,
        model: form.model.trim(),
        warranty: form.warranty.trim() || null,
      }
      if (kind === 'WEIGHING') {
        attributes.capacity = form.capacity.trim() || null
        attributes.accuracy = form.accuracy.trim() || null
        attributes.platform = form.platform.trim() || null
      }

      await api.createProduct({
        sku: buildSku(kind, form.model),
        name: buildName(kind, form.brand, form.model),
        productType: 'GOODS',
        unit: 'NOS',
        salePrice: Number(form.salePrice) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        mrp: form.mrp ? Number(form.mrp) : null,
        taxPercent: Number(form.taxPercent) || 0,
        trackInventory: true,
        reorderLevel: 5,
        description: form.description.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
        attributes,
      })
      addToast({ type: 'success', message: 'Product added to catalog' })
      navigate('/erp/products')
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save product',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Add product"
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
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save product'}
            </Button>
          </div>
        }
      />

      <Card>
        <div className="mb-4 rounded-[8px] border border-sky-200 bg-sky-50/80 px-3 py-2.5 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">Note:</span> You are adding a{' '}
          <span className="font-medium text-text-primary">catalog product</span> (model / brand / price).
          Later in <span className="font-medium text-text-primary">Inventory</span>, each unit gets its own{' '}
          <span className="font-medium text-text-primary">serial number</span> and{' '}
          <span className="font-medium text-text-primary">stamping date</span> (govt verification stamp).
        </div>

        <div className="space-y-4">
          <Select
            label="Select product *"
            value={form.catalogKind}
            onChange={(e) =>
              setForm({
                ...form,
                catalogKind: e.target.value as CatalogKind | '',
                capacity: '',
                accuracy: '',
                platform: '',
              })
            }
            options={[
              { value: '', label: 'Choose product type…' },
              ...CATALOG_PRODUCT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
          />

          {form.catalogKind ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Model number *"
                  placeholder="e.g. TT-30 / DS-700"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
                <Input
                  label="Brand"
                  placeholder="e.g. Precision / ESSAE"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
                <Input
                  label="Warranty"
                  placeholder="e.g. 12 months / 1 year"
                  value={form.warranty}
                  onChange={(e) => setForm({ ...form, warranty: e.target.value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="MRP ₹"
                  type="number"
                  value={form.mrp}
                  onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                />
                <Input
                  label="Sale price ₹"
                  type="number"
                  value={form.salePrice}
                  onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                />
                <Input
                  label="Purchase price ₹"
                  type="number"
                  value={form.purchasePrice}
                  onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                />
                <Input
                  label="Tax %"
                  type="number"
                  value={form.taxPercent}
                  onChange={(e) => setForm({ ...form, taxPercent: e.target.value })}
                />
              </div>

              {isWeighing ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    label="Capacity"
                    placeholder="e.g. 30 kg / 300 kg"
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  />
                  <Input
                    label="Accuracy"
                    placeholder="e.g. 2 g / 50 g"
                    value={form.accuracy}
                    onChange={(e) => setForm({ ...form, accuracy: e.target.value })}
                  />
                  <Input
                    label="Platform"
                    placeholder="e.g. 600×600 mm"
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  />
                </div>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-text-secondary">Description</span>
                <textarea
                  className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  placeholder="Optional notes about this catalog product…"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <div className="flex flex-wrap items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                  {form.imageUrl ? (
                    <img src={assetUrl(form.imageUrl)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="text-text-secondary" size={22} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-sm font-medium text-text-secondary">Product image</div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-[6px] border border-border bg-card px-3 py-2 text-sm font-medium text-accent-blue hover:bg-surface">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void uploadImage(e.target.files?.[0])}
                    />
                    {form.uploading ? 'Uploading…' : 'Upload image'}
                  </label>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-text-secondary">Select a product type above to continue.</p>
          )}
        </div>
      </Card>
    </div>
  )
}

export default ProductCreatePage
