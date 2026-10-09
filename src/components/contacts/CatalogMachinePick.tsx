import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Select } from '@/components/ui/Select'
import {
  HMS_MACHINE_TYPES,
  assetTypeFromHmsType,
  productAttrs,
  productMatchesBrand,
  productMatchesHmsType,
} from '@/lib/productCatalog'

export type CatalogProductRow = {
  id: string
  name: string
  sku?: string
  attributes?: Record<string, unknown> | null
}

export type CatalogBrandRow = { id: string; name: string }

/** Machine type → brand → model (same cascade as inventory add/reduce). */
export function CatalogMachinePick({
  products,
  brands,
  stockType,
  brandId,
  productId,
  onChange,
}: {
  products: CatalogProductRow[]
  brands: CatalogBrandRow[]
  stockType: string
  brandId: string
  productId: string
  onChange: (next: {
    stockType: string
    brandId: string
    productId: string
    name: string
    model: string
    machineType: string
    capacity: string
  }) => void
}) {
  const brandName = brands.find((b) => b.id === brandId)?.name ?? ''
  const models = products.filter((p) => {
    if (stockType && !productMatchesHmsType(p, stockType)) return false
    if (brandId && !productMatchesBrand(p, brandId, brandName)) return false
    return true
  })

  function pickProduct(id: string) {
    const p = products.find((x) => x.id === id)
    const a = productAttrs(p)
    onChange({
      stockType,
      brandId,
      productId: id,
      name: p?.name ?? '',
      model: a.model ? String(a.model) : p?.sku ? String(p.sku) : p?.name ?? '',
      machineType: assetTypeFromHmsType(stockType),
      capacity: a.capacity ? String(a.capacity) : '',
    })
  }

  return (
    <>
      <Select
        label="Machine type *"
        value={stockType}
        onChange={(e) => {
          const next = e.target.value
          onChange({
            stockType: next,
            brandId: '',
            productId: '',
            name: '',
            model: '',
            machineType: assetTypeFromHmsType(next),
            capacity: '',
          })
        }}
        options={[
          { value: '', label: 'Weighing / Billing / Touch POS / …' },
          ...HMS_MACHINE_TYPES.map((t) => ({ value: t.value, label: t.label })),
        ]}
      />
      <SearchableSelect
        label="Brand *"
        value={brandId}
        placeholder={stockType ? 'Search brand…' : 'Pick machine type first'}
        options={brands.map((b) => ({ value: b.id, label: b.name }))}
        onChange={(id) =>
          onChange({
            stockType,
            brandId: id,
            productId: '',
            name: '',
            model: '',
            machineType: assetTypeFromHmsType(stockType),
            capacity: '',
          })
        }
      />
      <SearchableSelect
        label="Model *"
        className="sm:col-span-2"
        value={productId}
        placeholder={
          !stockType ? 'Pick machine type first' : !brandId ? 'Pick brand first' : 'Search model…'
        }
        options={models.map((p) => ({
          value: p.id,
          label: p.name,
          sublabel: p.sku,
        }))}
        onChange={pickProduct}
      />
    </>
  )
}
