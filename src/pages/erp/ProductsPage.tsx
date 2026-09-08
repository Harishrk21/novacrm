import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, SlidersHorizontal, X } from 'lucide-react'
import { ProductImage } from '@/components/ProductImage'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
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
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import {
  buildHmsAttributes,
  familyByCode,
  HMS_FAMILY_OPTIONS,
  industryOptions,
  machineOptions,
  productCatalogMeta,
} from '@/lib/hmsCatalog'
import { productAttrs, truncateProductName, WARRANTY_MONTH_OPTIONS } from '@/lib/productCatalog'
import { formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type ProductForm = {
  familyCode: string
  industryCode: string
  machineSku: string
  customMachineName: string
  warrantyMonths: string
  requiresStamping: boolean
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
  familyCode: '',
  industryCode: '',
  machineSku: '',
  customMachineName: '',
  warrantyMonths: '',
  requiresStamping: false,
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

function productToForm(p: Record<string, unknown>): ProductForm {
  const a = productAttrs(p)
  const meta = productCatalogMeta(a)
  const family = familyByCode(meta.familyCode) ? meta.familyCode : ''
  return {
    familyCode: family,
    industryCode: meta.industryCode || '',
    machineSku: 'CUSTOM',
    customMachineName: String(p.name ?? a.model ?? ''),
    warrantyMonths: a.warrantyMonths != null ? String(a.warrantyMonths) : '',
    requiresStamping:
      typeof a.requiresStamping === 'boolean'
        ? Boolean(a.requiresStamping)
        : meta.catalogKind === 'WEIGHING',
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

export function ProductsPage() {
  const tip = DEFAULT_TIPS['erp.products'] ?? {
    title: 'HMS product catalog',
    body: 'Pick product family → industry (weighing only) → machine. Serial numbers are added later in Inventory.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; code?: string | null; parentId?: string | null }>
  >([])
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [viewProduct, setViewProduct] = useState<Record<string, unknown> | null>(null)
  const [editProduct, setEditProduct] = useState<Record<string, unknown> | null>(null)
  const [editForm, setEditForm] = useState<ProductForm>(emptyForm)

  const [filterQ, setFilterQ] = useState('')
  const [filterFamily, setFilterFamily] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')

  const load = useCallback(async () => {
    try {
      const [products, lookups] = await Promise.all([api.products({ limit: 500 }), api.lookups()])
      setItems(products.items ?? [])
      setCategories(
        (lookups.categories ?? []).map((c) => ({
          id: String(c.id),
          name: String(c.name),
          code: c.code != null ? String(c.code) : null,
          parentId: (c as { parentId?: string | null }).parentId ?? null,
        })),
      )
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

  const filtered = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    return items.filter((p) => {
      const a = productAttrs(p)
      const meta = productCatalogMeta(a)
      if (filterFamily) {
        if (meta.familyCode) {
          if (meta.familyCode !== filterFamily) return false
        } else if (filterFamily === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        } else if (filterFamily !== 'WEIGHING_SCALES' && meta.catalogKind !== filterFamily) {
          // fall through for unmatched legacy
        }
      }
      if (filterIndustry && meta.industryCode !== filterIndustry) return false
      if (!q) return true
      const hay =
        `${p.name ?? ''} ${p.sku ?? ''} ${meta.familyName} ${meta.industryName} ${meta.model}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, filterQ, filterFamily, filterIndustry])

  const ids = useMemo(() => filtered.map((p) => String(p.id)), [filtered])
  const selection = useRowSelection(ids)
  const filtersActive = Boolean(filterQ || filterFamily || filterIndustry)

  const createFamily = familyByCode(form.familyCode)
  const createNeedsIndustry = Boolean(createFamily?.hasIndustry)
  const editFamily = familyByCode(editForm.familyCode)
  const editNeedsIndustry = Boolean(editFamily?.hasIndustry)

  function clearFilters() {
    setFilterQ('')
    setFilterFamily('')
    setFilterIndustry('')
  }

  function categoryIdFor(familyCode: string, industryCode?: string) {
    const code = industryCode ? `${familyCode}__${industryCode}` : familyCode
    return (
      categories.find((c) => c.code === code)?.id ??
      categories.find((c) => c.code === familyCode)?.id ??
      null
    )
  }

  function resolveMachine(formState: ProductForm) {
    const fam = familyByCode(formState.familyCode)
    if (!fam) return null
    const industry = fam.industries?.find((i) => i.code === formState.industryCode)
    const fromCatalog =
      formState.machineSku && formState.machineSku !== 'CUSTOM'
        ? machineOptions(formState.familyCode, formState.industryCode).find(
            (o) => o.value === formState.machineSku,
          )?.machine
        : null
    const name = fromCatalog?.name ?? formState.customMachineName.trim()
    if (!name) return null
    const catalogKind =
      fromCatalog?.catalogKind ??
      (fam.code === 'WEIGHING_SCALES'
        ? 'WEIGHING'
        : fam.code === 'BILLING_MACHINE'
          ? 'BILLING'
          : fam.code === 'TOUCH_POS'
            ? 'TOUCH_POS'
            : fam.code === 'BILLING_SOFTWARE'
              ? 'BILLING_SOFTWARE'
              : 'CCM')
    return {
      name,
      sku: fromCatalog?.sku ?? skuFromName(formState.familyCode, formState.industryCode, name),
      catalogKind,
      requiresStamping: formState.requiresStamping,
      trackInventory: fromCatalog?.trackInventory ?? fam.code !== 'BILLING_SOFTWARE',
      productType: fromCatalog?.productType ?? (fam.code === 'BILLING_SOFTWARE' ? 'SERVICE' : 'GOODS'),
      familyName: fam.name,
      industryName: industry?.name ?? null,
    }
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

  async function uploadImage(target: 'create' | 'edit', file?: File | null) {
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
    if (!form.familyCode) {
      addToast({ type: 'error', message: 'Select a product family' })
      return
    }
    if (createNeedsIndustry && !form.industryCode) {
      addToast({ type: 'error', message: 'Select an industry' })
      return
    }
    const machine = resolveMachine(form)
    if (!machine) {
      addToast({ type: 'error', message: 'Select a machine or enter a custom machine name' })
      return
    }
    setSaving(true)
    try {
      const attrs = {
        ...buildHmsAttributes({
          familyCode: form.familyCode,
          familyName: machine.familyName,
          industryCode: form.industryCode || null,
          industryName: machine.industryName,
          machineName: machine.name,
          catalogKind: machine.catalogKind,
          requiresStamping: form.requiresStamping,
        }),
        warrantyMonths: form.warrantyMonths ? Number(form.warrantyMonths) : null,
        warranty: form.warrantyMonths ? `${form.warrantyMonths} months` : null,
        capacity: form.capacity.trim() || null,
        accuracy: form.accuracy.trim() || null,
        platform: form.platform.trim() || null,
      }
      await api.createProduct({
        sku: machine.sku,
        name: truncateProductName(machine.name),
        description: form.description.trim() || null,
        productType: machine.productType,
        unit: 'NOS',
        categoryId: categoryIdFor(form.familyCode, form.industryCode),
        salePrice: Number(form.salePrice) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        mrp: form.mrp ? Number(form.mrp) : null,
        taxPercent: Number(form.taxPercent) || 18,
        trackInventory: machine.trackInventory,
        imageUrl: form.imageUrl || null,
        attributes: attrs,
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
    if (!editForm.familyCode) {
      addToast({ type: 'error', message: 'Select a product family' })
      return
    }
    if (editNeedsIndustry && !editForm.industryCode) {
      addToast({ type: 'error', message: 'Select an industry' })
      return
    }
    const machine = resolveMachine(editForm)
    if (!machine) {
      addToast({ type: 'error', message: 'Enter machine name' })
      return
    }
    setSaving(true)
    try {
      const attrs = {
        ...buildHmsAttributes({
          familyCode: editForm.familyCode,
          familyName: machine.familyName,
          industryCode: editForm.industryCode || null,
          industryName: machine.industryName,
          machineName: machine.name,
          catalogKind: machine.catalogKind,
          requiresStamping: editForm.requiresStamping,
        }),
        warrantyMonths: editForm.warrantyMonths ? Number(editForm.warrantyMonths) : null,
        warranty: editForm.warrantyMonths ? `${editForm.warrantyMonths} months` : null,
        capacity: editForm.capacity.trim() || null,
        accuracy: editForm.accuracy.trim() || null,
        platform: editForm.platform.trim() || null,
      }
      await api.updateProduct(String(editProduct.id), {
        name: truncateProductName(machine.name),
        description: editForm.description.trim() || null,
        categoryId: categoryIdFor(editForm.familyCode, editForm.industryCode),
        salePrice: Number(editForm.salePrice) || 0,
        purchasePrice: Number(editForm.purchasePrice) || 0,
        mrp: editForm.mrp ? Number(editForm.mrp) : null,
        taxPercent: Number(editForm.taxPercent) || 18,
        imageUrl: editForm.imageUrl || null,
        attributes: attrs,
      })
      addToast({ type: 'success', message: 'Product updated' })
      setEditProduct(null)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update',
      })
    } finally {
      setSaving(false)
    }
  }

  function renderCascadeFields(
    state: ProductForm,
    setState: React.Dispatch<React.SetStateAction<ProductForm>>,
    uploadTarget: 'create' | 'edit',
  ) {
    const fam = familyByCode(state.familyCode)
    const needsIndustry = Boolean(fam?.hasIndustry)
    const machines = machineOptions(state.familyCode, state.industryCode)
    const isWeighing = fam?.code === 'WEIGHING_SCALES'

    return (
      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">
            1. Select product
          </h3>
          <Select
            label="Product family *"
            className="sm:col-span-2 lg:col-span-3"
            value={state.familyCode}
            onChange={(e) => {
              const code = e.target.value
              const nextFam = familyByCode(code)
              setState((f) => ({
                ...f,
                familyCode: code,
                industryCode: '',
                machineSku: '',
                customMachineName: '',
                requiresStamping: nextFam?.code === 'WEIGHING_SCALES',
              }))
            }}
            options={[{ value: '', label: 'Select product…' }, ...HMS_FAMILY_OPTIONS]}
          />
          {needsIndustry ? (
            <Select
              label="Industry *"
              className="sm:col-span-2 lg:col-span-3"
              value={state.industryCode}
              onChange={(e) =>
                setState((f) => ({
                  ...f,
                  industryCode: e.target.value,
                  machineSku: '',
                  customMachineName: '',
                }))
              }
              options={[{ value: '', label: 'Select industry…' }, ...industryOptions(state.familyCode)]}
            />
          ) : null}
          {state.familyCode && (!needsIndustry || state.industryCode) ? (
            <>
              <Select
                label="Machine *"
                className="sm:col-span-2 lg:col-span-3"
                value={state.machineSku}
                onChange={(e) => {
                  const sku = e.target.value
                  const hit = machines.find((m) => m.value === sku)
                  setState((f) => ({
                    ...f,
                    machineSku: sku,
                    customMachineName: sku === 'CUSTOM' ? f.customMachineName : hit?.label ?? '',
                    requiresStamping: hit?.machine.requiresStamping ?? f.requiresStamping,
                  }))
                }}
                options={[
                  { value: '', label: 'Select machine…' },
                  ...machines.map((m) => ({ value: m.value, label: m.label })),
                  { value: 'CUSTOM', label: '+ Add custom machine…' },
                ]}
              />
              {state.machineSku === 'CUSTOM' ? (
                <Input
                  label="Custom machine name *"
                  className="sm:col-span-2 lg:col-span-3"
                  value={state.customMachineName}
                  onChange={(e) =>
                    setState((f) => ({ ...f, customMachineName: e.target.value, machineSku: 'CUSTOM' }))
                  }
                  placeholder="Enter machine name"
                />
              ) : null}
            </>
          ) : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <h3 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold text-text-primary">
            2. Pricing & details
          </h3>
          <Select
            label="Warranty"
            value={state.warrantyMonths}
            onChange={(e) => setState((f) => ({ ...f, warrantyMonths: e.target.value }))}
            options={[
              { value: '', label: '—' },
              ...WARRANTY_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
          />
          <Input
            label="Sale price ₹"
            type="number"
            value={state.salePrice}
            onChange={(e) => setState((f) => ({ ...f, salePrice: e.target.value }))}
          />
          <Input
            label="Purchase price ₹"
            type="number"
            value={state.purchasePrice}
            onChange={(e) => setState((f) => ({ ...f, purchasePrice: e.target.value }))}
          />
          <Input
            label="MRP ₹"
            type="number"
            value={state.mrp}
            onChange={(e) => setState((f) => ({ ...f, mrp: e.target.value }))}
          />
          <Input
            label="GST %"
            type="number"
            value={state.taxPercent}
            onChange={(e) => setState((f) => ({ ...f, taxPercent: e.target.value }))}
          />
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={state.requiresStamping}
                onChange={(v) => setState((f) => ({ ...f, requiresStamping: v }))}
              />
              Requires stamping
            </label>
          </div>
          {isWeighing ? (
            <>
              <Input
                label="Capacity"
                value={state.capacity}
                onChange={(e) => setState((f) => ({ ...f, capacity: e.target.value }))}
                placeholder="e.g. 30 kg"
              />
              <Input
                label="Accuracy"
                value={state.accuracy}
                onChange={(e) => setState((f) => ({ ...f, accuracy: e.target.value }))}
                placeholder="e.g. 2 g"
              />
              <Input
                label="Platform size"
                value={state.platform}
                onChange={(e) => setState((f) => ({ ...f, platform: e.target.value }))}
              />
            </>
          ) : null}
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-20 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
              value={state.description}
              onChange={(e) => setState((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <div className="mb-1 text-sm font-medium text-text-secondary">Product image</div>
            <div className="flex flex-wrap items-center gap-3">
              <ProductImage
                src={state.imageUrl || null}
                alt="Preview"
                className="h-16 w-16 rounded-lg object-cover ring-1 ring-border"
                fallbackClassName="h-16 w-16 rounded-lg ring-1 ring-border"
                iconSize={18}
              />
              <label className="inline-flex cursor-pointer">
                <span className="rounded-[8px] border border-border bg-card px-3 py-2 text-sm hover:bg-surface">
                  {state.uploading ? 'Uploading…' : 'Upload image'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void uploadImage(uploadTarget, e.target.files?.[0])}
                />
              </label>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const groupedCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of items) {
      const meta = productCatalogMeta(productAttrs(p))
      const key = meta.familyName || meta.catalogKind || 'Other'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        breadcrumbs={[{ label: 'ERP' }, { label: 'Products' }]}
        actions={
          <Button onClick={() => setTab('create')}>
            <Package size={16} /> Add product
          </Button>
        }
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {groupedCount.map(([name, count]) => (
          <Card key={name} className="p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{name}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
          </Card>
        ))}
      </div>

      <PageTabs
        tabs={[
          { id: 'list', label: `Catalog ${filtered.length}` },
          { id: 'create', label: 'Add product' },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create')
          setViewProduct(null)
          setEditProduct(null)
        }}
      />

      {tab === 'list' ? (
        <Card padding={false}>
          <div className="flex flex-wrap gap-3 border-b border-border p-4">
            <Input
              placeholder="Search name, SKU, industry…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
              className="min-w-[200px] flex-1"
            />
            <Select
              value={filterFamily}
              onChange={(e) => {
                setFilterFamily(e.target.value)
                setFilterIndustry('')
              }}
              className="w-48"
              options={[{ value: '', label: 'All products' }, ...HMS_FAMILY_OPTIONS]}
            />
            {filterFamily === 'WEIGHING_SCALES' ? (
              <Select
                value={filterIndustry}
                onChange={(e) => setFilterIndustry(e.target.value)}
                className="w-56"
                options={[
                  { value: '', label: 'All industries' },
                  ...industryOptions('WEIGHING_SCALES'),
                ]}
              />
            ) : null}
            {filtersActive ? (
              <Button variant="ghost" onClick={clearFilters}>
                <X size={14} /> Clear
              </Button>
            ) : (
              <Button variant="outline" className="pointer-events-none opacity-60">
                <SlidersHorizontal size={14} /> Filters
              </Button>
            )}
          </div>

          {selection.someSelected ? (
            <div className="px-4 pt-3">
              <BulkActionBar
                count={selection.selectedCount}
                noun="product"
                busy={busyDelete}
                onClear={selection.clear}
                onDelete={() => setConfirm({ ids: selection.selectedIds })}
              />
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              title="No products"
              subtitle="Add HMS catalog products, or clear filters."
              actionLabel="Add product"
              onAction={() => setTab('create')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-surface text-xs text-text-secondary">
                  <tr className="border-b border-border">
                    <th className="w-10 px-3 py-2">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected && !selection.allSelected}
                        onChange={selection.toggleAll}
                      />
                    </th>
                    <th className="px-3 py-2">Machine</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Industry</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Sale ₹</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const id = String(p.id)
                    const meta = productCatalogMeta(productAttrs(p))
                    const a = productAttrs(p)
                    return (
                      <tr
                        key={id}
                        className="cursor-pointer border-b border-border hover:bg-surface/60"
                        onClick={() => {
                          setEditProduct(null)
                          setViewProduct(p)
                        }}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <SelectCheckbox
                            checked={selection.isSelected(id)}
                            onChange={() => selection.toggle(id)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <ProductImage
                              src={p.imageUrl ? String(p.imageUrl) : null}
                              alt={String(p.name)}
                            />
                            <div>
                              <div className="font-medium text-text-primary">{String(p.name)}</div>
                              {a.capacity ? (
                                <div className="text-xs text-text-secondary">{String(a.capacity)}</div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {meta.familyName || meta.catalogKind || '—'}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{meta.industryName || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{String(p.sku)}</td>
                        <td className="px-3 py-2">{formatCurrency(num(p.salePrice))}</td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            <ViewIconButton
                              onClick={() => {
                                setEditProduct(null)
                                setViewProduct(p)
                              }}
                            />
                            <EditIconButton
                              onClick={() => {
                                setViewProduct(null)
                                setEditProduct(p)
                                setEditForm(productToForm(p))
                              }}
                            />
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
          )}
        </Card>
      ) : (
        <FormPanel
          open
          accent="theme"
          eyebrow="CATALOG"
          title="Add product"
          subtitle="Weighing: Product → Industry → Machine. Others: Product → Machine."
          onClose={() => setTab('list')}
          footer={
            <>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button disabled={saving} onClick={() => void saveProduct()}>
                {saving ? 'Saving…' : 'Save product'}
              </Button>
            </>
          }
        >
          {renderCascadeFields(form, setForm, 'create')}
        </FormPanel>
      )}

      {viewProduct ? (
        <Modal
          open
          accent="theme"
          size="lg"
          title={String(viewProduct.name)}
          subtitle={String(viewProduct.sku)}
          onClose={() => setViewProduct(null)}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirm({ ids: [String(viewProduct.id)] })
                }}
              >
                Delete
              </Button>
              <Button variant="outline" onClick={() => setViewProduct(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setEditForm(productToForm(viewProduct))
                  setEditProduct(viewProduct)
                  setViewProduct(null)
                }}
              >
                Edit
              </Button>
            </>
          }
        >
          {(() => {
            const meta = productCatalogMeta(productAttrs(viewProduct))
            const a = productAttrs(viewProduct)
            const rows: Array<[string, string]> = [
              ['Product family', meta.familyName || '—'],
              ['Industry', meta.industryName || '—'],
              ['Machine', String(viewProduct.name)],
              ['SKU', String(viewProduct.sku)],
              ['Sale price', formatCurrency(num(viewProduct.salePrice))],
              ['Purchase price', formatCurrency(num(viewProduct.purchasePrice))],
              ['MRP', viewProduct.mrp != null ? formatCurrency(num(viewProduct.mrp)) : '—'],
              ['Tax %', String(viewProduct.taxPercent ?? '—')],
              ['Unit', String(viewProduct.unit ?? 'NOS')],
              ['Type', String(viewProduct.productType ?? 'GOODS')],
              ['Stamping', a.requiresStamping ? 'Required' : 'Not required'],
              ['Warranty', a.warrantyMonths ? `${String(a.warrantyMonths)} months` : '—'],
              ['Capacity', a.capacity ? String(a.capacity) : '—'],
              ['Accuracy', a.accuracy ? String(a.accuracy) : '—'],
              ['Platform', a.platform ? String(a.platform) : '—'],
              ['Brand', a.brand ? String(a.brand) : '—'],
              ['Active', viewProduct.isActive === false ? 'No' : 'Yes'],
              [
                'Description',
                viewProduct.description ? String(viewProduct.description) : '—',
              ],
            ]
            return (
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <ProductImage
                    src={viewProduct.imageUrl ? String(viewProduct.imageUrl) : null}
                    alt={String(viewProduct.name)}
                    className="h-20 w-20 rounded-lg object-cover ring-1 ring-border"
                    fallbackClassName="h-20 w-20 rounded-lg ring-1 ring-border"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold text-text-primary">
                      {String(viewProduct.name)}
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      {[meta.familyName, meta.industryName].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="mt-1 font-mono text-xs text-text-secondary">
                      {String(viewProduct.sku)}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {rows.map(([label, value]) => (
                    <div
                      key={label}
                      className={label === 'Description' ? 'sm:col-span-2' : undefined}
                    >
                      <div className="text-xs text-text-secondary">{label}</div>
                      <div className="mt-0.5 font-medium text-text-primary">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </Modal>
      ) : null}

      {editProduct ? (
        <Modal
          open
          accent="theme"
          size="xl"
          title="Edit product"
          subtitle={String(editProduct.sku)}
          onClose={() => setEditProduct(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setEditProduct(null)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void saveEdit()}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          }
        >
          {renderCascadeFields(editForm, setEditForm, 'edit')}
        </Modal>
      ) : null}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete product?' : `Delete ${confirm?.ids.length ?? 0} products?`}
        body="This removes the catalog item. Serial stock linked to it may still exist in inventory history."
      />
    </div>
  )
}

/** Kept for ProductCreatePage / Contacts imports that reference catalog kinds */
export const CATALOG_PRODUCT_OPTIONS = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing Machine' },
  { value: 'CCM', label: 'Currency Counting Machine' },
  { value: 'BIOMETRIC', label: 'Biometric machine' },
  { value: 'PAPER_SHREDDER', label: 'Paper Shredder' },
  { value: 'PAPER_ROLL', label: 'Paper Role for Billing printer' },
  { value: 'CCTV', label: 'CCTV' },
  { value: 'TOUCH_POS', label: 'Touch POS' },
  { value: 'BILLING_SOFTWARE', label: 'Billing Software' },
] as const

export default ProductsPage
