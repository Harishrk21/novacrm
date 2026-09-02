import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ImagePlus, Package, SlidersHorizontal, X } from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  EditIconButton,
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

/** Catalog product kinds — generic product info (serial / stamping come later in Inventory). */
export const CATALOG_PRODUCT_OPTIONS = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing Machine' },
  { value: 'CCM', label: 'Currency Counting Machine' },
  { value: 'BIOMETRIC', label: 'Biometric machine' },
  { value: 'PAPER_SHREDDER', label: 'Paper Shredder' },
  { value: 'PAPER_ROLL', label: 'Paper Role for Billing printer' },
  { value: 'CCTV', label: 'CCTV' },
] as const

type CatalogKind = (typeof CATALOG_PRODUCT_OPTIONS)[number]['value']

type ProductForm = {
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

const emptyForm = (): ProductForm => ({
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

function attrsOf(p: Record<string, unknown>) {
  return (p.attributes as Record<string, unknown> | null) ?? {}
}

function productToForm(p: Record<string, unknown>): ProductForm {
  const a = attrsOf(p)
  const kind = String(a.catalogKind ?? '') as CatalogKind | ''
  const valid = CATALOG_PRODUCT_OPTIONS.some((o) => o.value === kind)
  return {
    catalogKind: valid ? kind : '',
    model: String(a.model ?? ''),
    brand: String(a.brand ?? ''),
    warranty: String(a.warranty ?? ''),
    mrp: p.mrp != null ? String(num(p.mrp)) : '',
    salePrice: p.salePrice != null ? String(num(p.salePrice)) : '',
    purchasePrice: p.purchasePrice != null ? String(num(p.purchasePrice)) : '',
    taxPercent: p.taxPercent != null ? String(num(p.taxPercent)) : '18',
    capacity: String(a.capacity ?? ''),
    accuracy: String(a.accuracy ?? ''),
    platform: String(a.platform ?? ''),
    description: String(p.description ?? ''),
    imageUrl: String(p.imageUrl ?? ''),
    uploading: false,
  }
}

function buildAttributes(form: ProductForm) {
  const kind = form.catalogKind as CatalogKind
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
  return attributes
}

export function ProductsPage() {
  const tip = DEFAULT_TIPS['erp.products'] ?? {
    title: 'Products catalog',
    body: 'Add catalog products first. Serial numbers and stamping dates are added later in Inventory for each physical unit.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [viewProduct, setViewProduct] = useState<Record<string, unknown> | null>(null)
  const [editProduct, setEditProduct] = useState<Record<string, unknown> | null>(null)
  const [editForm, setEditForm] = useState<ProductForm>(emptyForm)

  const [filterQ, setFilterQ] = useState('')
  const [filterKind, setFilterKind] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [moreFilters, setMoreFilters] = useState(false)

  const load = useCallback(async () => {
    try {
      const products = await api.products({ limit: 200 })
      setItems(products.items ?? [])
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load products',
      })
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (searchParams.get('tab') === 'create') setTab('create')
  }, [searchParams])

  const brands = useMemo(() => {
    const set = new Set<string>()
    for (const p of items) {
      const brand = String(attrsOf(p).brand ?? '').trim()
      if (brand) set.add(brand)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  const filtered = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    return items.filter((p) => {
      const a = attrsOf(p)
      const kind = String(a.catalogKind ?? '')
      const brand = String(a.brand ?? '')
      if (filterKind && kind !== filterKind) return false
      if (filterBrand && brand.toLowerCase() !== filterBrand.toLowerCase()) return false
      if (!q) return true
      const hay = `${p.name ?? ''} ${p.sku ?? ''} ${a.model ?? ''} ${brand} ${kindLabel(kind)}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, filterQ, filterKind, filterBrand])

  const ids = useMemo(() => filtered.map((p) => String(p.id)), [filtered])
  const selection = useRowSelection(ids)
  const filtersActive = Boolean(filterQ || filterKind || filterBrand)

  function clearFilters() {
    setFilterQ('')
    setFilterKind('')
    setFilterBrand('')
  }

  function openEdit(p: Record<string, unknown>) {
    setViewProduct(null)
    setEditProduct(p)
    setEditForm(productToForm(p))
    setTab('list')
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteProduct(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      if (viewProduct && deleteIds.includes(String(viewProduct.id))) setViewProduct(null)
      if (editProduct && deleteIds.includes(String(editProduct.id))) setEditProduct(null)
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

  async function uploadImage(
    target: 'create' | 'edit',
    file?: File | null,
  ) {
    if (!file) return
    const set = target === 'create' ? setForm : setEditForm
    set((f) => ({ ...f, uploading: true }))
    try {
      const uploaded = await api.uploadImage(file)
      set((f) => ({ ...f, imageUrl: uploaded.url, uploading: false }))
      addToast({ type: 'success', message: 'Image uploaded' })
    } catch (err) {
      set((f) => ({ ...f, uploading: false }))
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Upload failed',
      })
    }
  }

  async function saveProduct() {
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
      await api.createProduct({
        sku: buildSku(kind, form.model),
        name: buildName(kind, form.brand, form.model),
        description: form.description.trim() || null,
        productType: 'GOODS',
        unit: 'pcs',
        salePrice: Number(form.salePrice) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        mrp: form.mrp ? Number(form.mrp) : null,
        taxPercent: Number(form.taxPercent) || 0,
        trackInventory: true,
        imageUrl: form.imageUrl || null,
        attributes: buildAttributes(form),
      })
      addToast({ type: 'success', message: 'Product saved' })
      setForm(emptyForm())
      setTab('list')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save product',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!editProduct) return
    if (!editForm.catalogKind) {
      addToast({ type: 'error', message: 'Select a product type' })
      return
    }
    if (!editForm.model.trim()) {
      addToast({ type: 'error', message: 'Enter model number' })
      return
    }
    setSaving(true)
    try {
      const kind = editForm.catalogKind
      const updated = await api.updateProduct(String(editProduct.id), {
        name: buildName(kind, editForm.brand, editForm.model),
        description: editForm.description.trim() || null,
        salePrice: Number(editForm.salePrice) || 0,
        purchasePrice: Number(editForm.purchasePrice) || 0,
        mrp: editForm.mrp ? Number(editForm.mrp) : null,
        taxPercent: Number(editForm.taxPercent) || 0,
        imageUrl: editForm.imageUrl || null,
        attributes: buildAttributes(editForm),
      })
      addToast({ type: 'success', message: 'Product updated' })
      setEditProduct(null)
      setItems((prev) =>
        prev.map((p) => (String(p.id) === String(editProduct.id) ? { ...p, ...updated } : p)),
      )
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update product',
      })
    } finally {
      setSaving(false)
    }
  }

  function catalogFields(
    state: ProductForm,
    set: (next: ProductForm) => void,
    uploadTarget: 'create' | 'edit',
  ) {
    const weighing = state.catalogKind === 'WEIGHING'
    return (
      <div className="space-y-4">
        <Select
          label="Select product *"
          value={state.catalogKind}
          onChange={(e) =>
            set({
              ...state,
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

        {state.catalogKind ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Model number *"
                placeholder="e.g. TT-30 / DS-700"
                value={state.model}
                onChange={(e) => set({ ...state, model: e.target.value })}
              />
              <Input
                label="Brand"
                placeholder="e.g. Precision / ESSAE"
                value={state.brand}
                onChange={(e) => set({ ...state, brand: e.target.value })}
              />
              <Input
                label="Warranty"
                placeholder="e.g. 12 months / 1 year"
                value={state.warranty}
                onChange={(e) => set({ ...state, warranty: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="MRP ₹"
                type="number"
                value={state.mrp}
                onChange={(e) => set({ ...state, mrp: e.target.value })}
              />
              <Input
                label="Sale price ₹"
                type="number"
                value={state.salePrice}
                onChange={(e) => set({ ...state, salePrice: e.target.value })}
              />
              <Input
                label="Purchase price ₹"
                type="number"
                value={state.purchasePrice}
                onChange={(e) => set({ ...state, purchasePrice: e.target.value })}
              />
              <Input
                label="Tax %"
                type="number"
                value={state.taxPercent}
                onChange={(e) => set({ ...state, taxPercent: e.target.value })}
              />
            </div>

            {weighing ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Capacity"
                  placeholder="e.g. 30 kg / 300 kg"
                  value={state.capacity}
                  onChange={(e) => set({ ...state, capacity: e.target.value })}
                />
                <Input
                  label="Accuracy"
                  placeholder="e.g. 2 g / 50 g"
                  value={state.accuracy}
                  onChange={(e) => set({ ...state, accuracy: e.target.value })}
                />
                <Input
                  label="Platform"
                  placeholder="e.g. 600×600 mm"
                  value={state.platform}
                  onChange={(e) => set({ ...state, platform: e.target.value })}
                />
              </div>
            ) : null}

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-text-secondary">Description</span>
              <textarea
                className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                placeholder="Optional notes about this catalog product…"
                value={state.description}
                onChange={(e) => set({ ...state, description: e.target.value })}
              />
            </label>

            <div className="flex flex-wrap items-start gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                {state.imageUrl ? (
                  <img src={assetUrl(state.imageUrl)} alt="" className="h-full w-full object-cover" />
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
                    onChange={(e) => void uploadImage(uploadTarget, e.target.files?.[0])}
                  />
                  {state.uploading ? 'Uploading…' : 'Upload image'}
                </label>
                {state.imageUrl ? (
                  <button
                    type="button"
                    className="block text-xs text-text-secondary hover:text-accent-red"
                    onClick={() => set({ ...state, imageUrl: '' })}
                  >
                    Remove image
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Select a product type above to continue.</p>
        )}
      </div>
    )
  }

  const filterBar = (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1 basis-[220px]">
          <Input
            className="h-9"
            placeholder="Search name, model, brand, SKU…"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
          />
        </div>
        <div className="w-[180px] shrink-0">
          <Select
            className="h-9"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            options={[
              { value: '', label: 'All types' },
              ...CATALOG_PRODUCT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
          />
        </div>
        <Button
          variant={moreFilters || filterBrand ? 'primary' : 'outline'}
          size="sm"
          className="h-9 shrink-0"
          onClick={() => setMoreFilters((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          More
          {filterBrand ? (
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
          <div className="w-[180px]">
            <Select
              className="h-9"
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              options={[
                { value: '', label: 'All brands' },
                ...brands.map((b) => ({ value: b, label: b })),
              ]}
            />
          </div>
        </div>
      ) : null}
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Products"
        count={items.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Products' }]}
      />
      {tab !== 'list' ? <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} /> : null}

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setViewProduct(null)
          setEditProduct(null)
          setTab(id as 'list' | 'create')
          if (id === 'create') setForm(emptyForm())
        }}
        tabs={[
          { id: 'list', label: 'All products', count: filtered.length },
          { id: 'create', label: 'Add product' },
        ]}
      />

      {tab === 'list' ? (
        <>
          {filterBar}
          <Card padding={false}>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Package size={22} />}
                title={items.length === 0 ? 'No products' : 'No products match filters'}
                subtitle={
                  items.length === 0
                    ? 'Add catalog products first. Serial numbers are added later in Inventory.'
                    : 'Try clearing filters or searching a different name / type.'
                }
                actionLabel="Add product"
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
                  <table className="w-full min-w-[720px] text-left text-sm">
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
                        {['Product name', 'Sale', 'Purchase', 'Tax %', 'Actions'].map((h) => (
                          <th key={h} className="px-4 py-3 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => {
                        const id = String(p.id)
                        const img = assetUrl(p.imageUrl as string | null)
                        const a = attrsOf(p)
                        const kind = a.catalogKind ? kindLabel(String(a.catalogKind)) : ''
                        return (
                          <tr key={id} className="border-t border-border hover:bg-surface">
                            <td className="px-4 py-3">
                              <SelectCheckbox
                                checked={selection.isSelected(id)}
                                onChange={() => selection.toggle(id)}
                                aria-label={`Select ${String(p.name)}`}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {img ? (
                                  <img
                                    src={img}
                                    alt=""
                                    className="h-9 w-9 rounded object-cover ring-1 ring-border"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded bg-muted text-text-secondary">
                                    <Package size={14} />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-text-primary">
                                    {String(p.name)}
                                  </div>
                                  <div className="truncate text-xs text-text-secondary">
                                    {[kind, a.model ? String(a.model) : null, a.brand ? String(a.brand) : null]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-semibold">{formatCurrency(num(p.salePrice))}</td>
                            <td className="px-4 py-3">{formatCurrency(num(p.purchasePrice))}</td>
                            <td className="px-4 py-3">{num(p.taxPercent)}%</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-0.5">
                                <ViewIconButton onClick={() => setViewProduct(p)} />
                                <EditIconButton onClick={() => openEdit(p)} />
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
          title="Add product"
          subtitle="Store generic product information here. Serial numbers and stamping dates are added later in Inventory for each physical unit."
          onClose={() => setTab('list')}
          footer={
            <>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button onClick={() => void saveProduct()} disabled={saving || !form.catalogKind}>
                {saving ? 'Saving…' : 'Save product'}
              </Button>
            </>
          }
        >
          <div className="mb-4 rounded-[8px] border border-sky-200 bg-sky-50/80 px-3 py-2.5 text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">Note:</span> You are adding a{' '}
            <span className="font-medium text-text-primary">catalog product</span> (model / brand / price).
            Later in <span className="font-medium text-text-primary">Inventory</span>, each unit gets its own{' '}
            <span className="font-medium text-text-primary">serial number</span> and{' '}
            <span className="font-medium text-text-primary">stamping date</span>.
          </div>
          {catalogFields(form, setForm, 'create')}
        </FormPanel>
      )}

      {viewProduct ? (
        <FormPanel
          open
          accent="theme"
          eyebrow="Product"
          title={String(viewProduct.name)}
          subtitle={String(viewProduct.sku ?? '')}
          onClose={() => setViewProduct(null)}
          footer={
            <>
              <FormPanelCancel onClick={() => setViewProduct(null)} />
              <Button
                onClick={() => {
                  openEdit(viewProduct)
                }}
              >
                Edit
              </Button>
            </>
          }
        >
          {(() => {
            const a = attrsOf(viewProduct)
            const kind = a.catalogKind ? kindLabel(String(a.catalogKind)) : '—'
            const img = assetUrl(viewProduct.imageUrl as string | null)
            const rows: Array<[string, string]> = [
              ['Type', kind],
              ['Model', String(a.model ?? '—')],
              ['Brand', String(a.brand ?? '—')],
              ['Warranty', String(a.warranty ?? '—')],
              ['MRP', viewProduct.mrp != null ? formatCurrency(num(viewProduct.mrp)) : '—'],
              ['Sale price', formatCurrency(num(viewProduct.salePrice))],
              ['Purchase price', formatCurrency(num(viewProduct.purchasePrice))],
              ['Tax', `${num(viewProduct.taxPercent)}%`],
            ]
            if (String(a.catalogKind) === 'WEIGHING') {
              rows.push(
                ['Capacity', String(a.capacity ?? '—')],
                ['Accuracy', String(a.accuracy ?? '—')],
                ['Platform', String(a.platform ?? '—')],
              )
            }
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  {img ? (
                    <img src={img} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-border" />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted">
                      <Package size={22} />
                    </div>
                  )}
                  <div>
                    <Badge color="blue">{kind}</Badge>
                    <div className="mt-2 font-mono text-xs text-text-secondary">
                      SKU {String(viewProduct.sku ?? '—')}
                    </div>
                  </div>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {rows.map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border px-3 py-2">
                      <dt className="text-xs text-text-secondary">{k}</dt>
                      <dd className="mt-0.5 font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                {viewProduct.description ? (
                  <div className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="text-xs text-text-secondary">Description</div>
                    <p className="mt-1 whitespace-pre-wrap">{String(viewProduct.description)}</p>
                  </div>
                ) : null}
              </div>
            )
          })()}
        </FormPanel>
      ) : null}

      {editProduct ? (
        <FormPanel
          open
          accent="theme"
          eyebrow="Edit product"
          title={String(editProduct.name)}
          subtitle="Update catalog fields. Serial stock stays in Inventory."
          onClose={() => setEditProduct(null)}
          footer={
            <>
              <FormPanelCancel onClick={() => setEditProduct(null)} />
              <Button onClick={() => void saveEdit()} disabled={saving || !editForm.catalogKind}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          }
        >
          {catalogFields(editForm, setEditForm, 'edit')}
        </FormPanel>
      ) : null}

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
