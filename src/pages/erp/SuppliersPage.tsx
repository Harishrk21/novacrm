import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Pencil, Plus, Tag, Trash2, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Drawer } from '@/components/ui/Drawer'
import { Input } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { Switch } from '@/components/ui/Switch'
import { api, ApiClientError } from '@/lib/api'
import { toStoredIndianMobile } from '@/lib/phoneIndia'
import { useUIStore } from '@/store/uiStore'

type Supplier = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  gstin?: string | null
  paymentTerms?: string | null
  address?: {
    line1?: string | null
    city?: string | null
    state?: string | null
    pincode?: string | null
  } | null
}

type Brand = {
  id: string
  name: string
  code: string
  isActive: boolean
}

type TabId = 'suppliers' | 'brands'

const emptySupplierForm = () => ({
  name: '',
  phone: '',
  email: '',
  gstin: '',
  paymentTerms: 'Net 30',
  line1: '',
  city: '',
  state: '',
  pincode: '',
})

const emptyBrandForm = () => ({
  name: '',
  code: '',
  isActive: true,
})

export function SuppliersPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: TabId = searchParams.get('tab') === 'brands' ? 'brands' : 'suppliers'

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [saving, setSaving] = useState(false)

  const [supplierPanelOpen, setSupplierPanelOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm)
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null)

  const [brandPanelOpen, setBrandPanelOpen] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [brandForm, setBrandForm] = useState(emptyBrandForm)
  const [deleteBrand, setDeleteBrand] = useState<Brand | null>(null)
  const [deleting, setDeleting] = useState(false)

  const setTab = (id: string) => {
    const next = id === 'brands' ? 'brands' : 'suppliers'
    setSearchParams(next === 'brands' ? { tab: 'brands' } : {})
  }

  const loadSuppliers = useCallback(async () => {
    try {
      const rows = await api.vendors()
      setSuppliers(rows as Supplier[])
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load suppliers',
      })
    }
  }, [addToast])

  const loadBrands = useCallback(async () => {
    try {
      const rows = await api.inventoryBrands({ all: true })
      setBrands(
        rows.map((b) => ({
          id: String(b.id),
          name: String(b.name ?? ''),
          code: String(b.code ?? ''),
          isActive: b.isActive !== false,
        })),
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load brands',
      })
    }
  }, [addToast])

  useEffect(() => {
    void loadSuppliers()
    void loadBrands()
  }, [loadSuppliers, loadBrands])

  function openCreateSupplier() {
    setEditingSupplier(null)
    setSupplierForm(emptySupplierForm())
    setSupplierPanelOpen(true)
  }

  function openEditSupplier(row: Supplier) {
    const addr = (row.address ?? {}) as NonNullable<Supplier['address']>
    setEditingSupplier(row)
    setSupplierForm({
      name: row.name ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      gstin: row.gstin ?? '',
      paymentTerms: row.paymentTerms ?? 'Net 30',
      line1: addr.line1 ?? '',
      city: addr.city ?? '',
      state: addr.state ?? '',
      pincode: addr.pincode ?? '',
    })
    setSupplierPanelOpen(true)
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) {
      addToast({ type: 'error', message: 'Supplier name is required' })
      return
    }
    setSaving(true)
    try {
      const body = {
        name: supplierForm.name.trim(),
        phone: toStoredIndianMobile(supplierForm.phone),
        email: supplierForm.email.trim() || null,
        gstin: supplierForm.gstin.trim() || null,
        paymentTerms: supplierForm.paymentTerms.trim() || null,
        address: {
          line1: supplierForm.line1.trim() || null,
          city: supplierForm.city.trim() || null,
          state: supplierForm.state.trim() || null,
          pincode: supplierForm.pincode.trim() || null,
        },
      }
      if (editingSupplier) {
        await api.updateVendor(editingSupplier.id, body)
        addToast({ type: 'success', message: 'Supplier updated' })
      } else {
        await api.createVendor(body)
        addToast({ type: 'success', message: 'Supplier added' })
      }
      setSupplierPanelOpen(false)
      setEditingSupplier(null)
      setSupplierForm(emptySupplierForm())
      await loadSuppliers()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save supplier',
      })
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteSupplier() {
    if (!deleteSupplier) return
    setDeleting(true)
    try {
      await api.deleteVendor(deleteSupplier.id)
      addToast({ type: 'success', message: `Deleted ${deleteSupplier.name}` })
      setDeleteSupplier(null)
      await loadSuppliers()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete supplier',
      })
    } finally {
      setDeleting(false)
    }
  }

  function openCreateBrand() {
    setEditingBrand(null)
    setBrandForm(emptyBrandForm())
    setBrandPanelOpen(true)
  }

  function openEditBrand(row: Brand) {
    setEditingBrand(row)
    setBrandForm({
      name: row.name,
      code: row.code,
      isActive: row.isActive,
    })
    setBrandPanelOpen(true)
  }

  async function saveBrand() {
    if (!brandForm.name.trim()) {
      addToast({ type: 'error', message: 'Brand name is required' })
      return
    }
    setSaving(true)
    try {
      if (editingBrand) {
        await api.updateInventoryBrand(editingBrand.id, {
          name: brandForm.name.trim(),
          code: brandForm.code.trim() || null,
          isActive: brandForm.isActive,
        })
        addToast({ type: 'success', message: 'Brand updated' })
      } else {
        await api.createInventoryBrand({
          name: brandForm.name.trim(),
          code: brandForm.code.trim() || null,
        })
        addToast({ type: 'success', message: 'Brand added' })
      }
      setBrandPanelOpen(false)
      setEditingBrand(null)
      setBrandForm(emptyBrandForm())
      await loadBrands()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save brand',
      })
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteBrand() {
    if (!deleteBrand) return
    setDeleting(true)
    try {
      await api.deleteInventoryBrand(deleteBrand.id)
      addToast({ type: 'success', message: `Deleted ${deleteBrand.name}` })
      setDeleteBrand(null)
      await loadBrands()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete brand',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Suppliers & brands"
        count={tab === 'suppliers' ? suppliers.length : brands.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Suppliers' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/erp/inventory">
              <Button variant="outline">Stock</Button>
            </Link>
            <Link to="/erp/purchase-orders">
              <Button variant="outline">Purchase orders</Button>
            </Link>
            {tab === 'suppliers' ? (
              <Button onClick={openCreateSupplier}>
                <Plus size={16} /> Add supplier
              </Button>
            ) : (
              <Button onClick={openCreateBrand}>
                <Plus size={16} /> Add brand
              </Button>
            )}
          </div>
        }
      />

      <PageTabs
        accent="theme"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'suppliers', label: 'Suppliers', count: suppliers.length },
          { id: 'brands', label: 'Brands', count: brands.length },
        ]}
      />

      {tab === 'suppliers' ? (
        <Card padding={false}>
          {suppliers.length === 0 ? (
            <EmptyState
              icon={<Truck size={22} />}
              title="No suppliers yet"
              subtitle="Add suppliers here first, then pick them when receiving stock or raising a PO."
              actionLabel="Add supplier"
              onAction={openCreateSupplier}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Name', 'Phone', 'GSTIN', 'Terms', 'City', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((v) => {
                    const city = (v.address as { city?: string } | null)?.city
                    return (
                      <tr key={v.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          <div className="font-medium">{v.name}</div>
                          <div className="text-xs text-text-secondary">{v.email || '—'}</div>
                        </td>
                        <td className="px-4 py-3">{v.phone || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs">{v.gstin || '—'}</td>
                        <td className="px-4 py-3">
                          {v.paymentTerms ? <Badge color="gray">{v.paymentTerms}</Badge> : '—'}
                        </td>
                        <td className="px-4 py-3">{city || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Edit"
                              onClick={() => openEditSupplier(v)}
                            >
                              <Pencil size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Delete"
                              onClick={() => setDeleteSupplier(v)}
                            >
                              <Trash2 size={14} />
                            </Button>
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
        <Card padding={false}>
          {brands.length === 0 ? (
            <EmptyState
              icon={<Tag size={22} />}
              title="No brands yet"
              subtitle="Add makes like RETSOL, SMART, ISTHA — then select them when receiving stock."
              actionLabel="Add brand"
              onAction={openCreateBrand}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Name', 'Code', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{b.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{b.code || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge color={b.isActive ? 'green' : 'gray'}>
                          {b.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit"
                            onClick={() => openEditBrand(b)}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Delete"
                            onClick={() => setDeleteBrand(b)}
                          >
                            <Trash2 size={14} />
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
      )}

      <Drawer
        open={supplierPanelOpen}
        width={520}
        storageKey="nova.drawer.suppliers"
        onClose={() => {
          setSupplierPanelOpen(false)
          setEditingSupplier(null)
        }}
        title={
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Suppliers
            </div>
            <div className="text-lg font-semibold text-text-primary">
              {editingSupplier ? 'Edit supplier' : 'Add supplier'}
            </div>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSupplierPanelOpen(false)
                setEditingSupplier(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveSupplier()} disabled={saving}>
              {saving ? 'Saving…' : editingSupplier ? 'Save changes' : 'Add supplier'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <p className="text-sm text-text-secondary sm:col-span-2">
            Used when receiving stock and creating purchase orders.
          </p>
          <div className="sm:col-span-2">
            <Input
              label="Supplier name *"
              value={supplierForm.name}
              onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
            />
          </div>
          <PhoneInput
            label="Phone"
            value={supplierForm.phone}
            onChange={(phone) => setSupplierForm({ ...supplierForm, phone })}
            hint="India (+91) — 10 digits"
          />
          <Input
            label="Email"
            value={supplierForm.email}
            onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
          />
          <Input
            label="GSTIN"
            value={supplierForm.gstin}
            onChange={(e) => setSupplierForm({ ...supplierForm, gstin: e.target.value })}
          />
          <Input
            label="Payment terms"
            value={supplierForm.paymentTerms}
            onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Input
              label="Address"
              value={supplierForm.line1}
              onChange={(e) => setSupplierForm({ ...supplierForm, line1: e.target.value })}
            />
          </div>
          <Input
            label="City"
            value={supplierForm.city}
            onChange={(e) => setSupplierForm({ ...supplierForm, city: e.target.value })}
          />
          <Input
            label="State"
            value={supplierForm.state}
            onChange={(e) => setSupplierForm({ ...supplierForm, state: e.target.value })}
          />
          <Input
            label="PIN"
            value={supplierForm.pincode}
            onChange={(e) => setSupplierForm({ ...supplierForm, pincode: e.target.value })}
          />
        </div>
      </Drawer>

      <Drawer
        open={brandPanelOpen}
        width={440}
        storageKey="nova.drawer.brands"
        onClose={() => {
          setBrandPanelOpen(false)
          setEditingBrand(null)
        }}
        title={
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              Brands
            </div>
            <div className="text-lg font-semibold text-text-primary">
              {editingBrand ? 'Edit brand' : 'Add brand'}
            </div>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setBrandPanelOpen(false)
                setEditingBrand(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveBrand()} disabled={saving}>
              {saving ? 'Saving…' : editingBrand ? 'Save changes' : 'Add brand'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 p-5">
          <p className="text-sm text-text-secondary">
            Machine / product makes used when receiving stock (RETSOL, SMART, ISTHA, …).
          </p>
          <Input
            label="Brand name *"
            value={brandForm.name}
            onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
            placeholder="e.g. RETSOL, SMART, ISTHA"
          />
          <Input
            label="Code"
            value={brandForm.code}
            onChange={(e) => setBrandForm({ ...brandForm, code: e.target.value.toUpperCase() })}
            placeholder="Auto from name if blank"
          />
          {editingBrand ? (
            <div className="flex items-center gap-3 pt-1">
              <Switch
                label={brandForm.isActive ? 'Active' : 'Inactive'}
                checked={brandForm.isActive}
                onChange={(isActive) => setBrandForm({ ...brandForm, isActive })}
              />
              <span className="text-sm text-text-secondary">
                {brandForm.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          ) : null}
        </div>
      </Drawer>

      <ConfirmModal
        open={Boolean(deleteSupplier)}
        onClose={() => setDeleteSupplier(null)}
        onConfirm={() => void confirmDeleteSupplier()}
        title="Delete supplier?"
        body={
          deleteSupplier
            ? `Remove ${deleteSupplier.name} from the supplier list? Stock history stays; open POs must be closed first.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
      />

      <ConfirmModal
        open={Boolean(deleteBrand)}
        onClose={() => setDeleteBrand(null)}
        onConfirm={() => void confirmDeleteBrand()}
        title="Delete brand?"
        body={
          deleteBrand
            ? `Remove ${deleteBrand.name}? If it is used on stock, deactivate it from Edit instead.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
      />
    </div>
  )
}
