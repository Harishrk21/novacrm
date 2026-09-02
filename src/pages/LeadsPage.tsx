import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { firstError, validateLeadForm, type FieldErrors } from '@/lib/formValidation'
import { formatDate, formatPhone, formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin } from '@/lib/roles'

/** Internal API statuses with labels matching sales desk language */
const STATUS_OPTIONS = [
  { value: 'NEW', label: 'Pending' },
  { value: 'DEMO', label: 'Demo' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'LOST', label: 'Not interested' },
] as const

const LEGACY_STATUSES = ['CONTACTED', 'QUALIFIED', 'UNQUALIFIED'] as const
const ALL_STATUS_VALUES = [
  ...STATUS_OPTIONS.map((s) => s.value),
  ...LEGACY_STATUSES,
] as const

function statusLabel(code: string) {
  return STATUS_OPTIONS.find((s) => s.value === code)?.label ?? code
}

const emptyForm = {
  contactId: '',
  name: '',
  email: '',
  phone: '',
  company: '',
  website: '',
  city: '',
  state: '',
  country: 'IN',
  sourceId: '',
  status: 'NEW',
  score: '40',
  assignedToId: '',
  description: '',
  productInterest: '',
  productId: '',
  budget: '',
  enquiryDate: new Date().toISOString().slice(0, 10),
  timeline: '',
  tags: '',
  customerType: 'NEW' as 'NEW' | 'EXISTING',
}

export function LeadsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isAgent = authUser?.role === 'AGENT'
  const isAdmin = isCompanyAdmin(authUser?.role)
  const tip = DEFAULT_TIPS['crm.leads'] ?? {
    title: 'Sale tracking',
    body: 'Record every sale enquiry — pick an existing customer or add a new one, then track demo units and conversion.',
    tipType: 'TIP' as const,
  }

  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; sku: string }>>([])
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [search, setSearch] = useState('')
  const initialStatus = searchParams.get('status') ?? ''
  const [status, setStatus] = useState(
    ALL_STATUS_VALUES.includes(initialStatus as (typeof ALL_STATUS_VALUES)[number]) ? initialStatus : '',
  )
  const [ownerFilter, setOwnerFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertStageId, setConvertStageId] = useState('')
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoUnits, setDemoUnits] = useState<
    Array<{
      id: string
      serialNo: string
      productId?: string
      stampingDate?: string | null
      notes?: string | null
      product?: {
        name?: string
        sku?: string
        salePrice?: number
        purchasePrice?: number
        unit?: string
        productType?: string
        attributes?: Record<string, unknown> | null
      } | null
      warehouse?: { name?: string } | null
    }>
  >([])
  const [demoUnitId, setDemoUnitId] = useState('')
  const [demoProductFilter, setDemoProductFilter] = useState('')
  const [demoSaving, setDemoSaving] = useState(false)
  const [demoReturning, setDemoReturning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const ids = useMemo(() => items.map((i) => String(i.id)), [items])
  const selection = useRowSelection(ids)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [leads, lookups, productPage] = await Promise.all([
        api.leads({
          limit: 500,
          search: search || undefined,
          status: status || undefined,
          ...(isAgent && authUser?.id
            ? { assignedToId: authUser.id }
            : ownerFilter && ownerFilter !== 'unassigned'
              ? { assignedToId: ownerFilter }
              : {}),
        }),
        api.lookups(),
        api.products({ limit: 500 }),
      ])
      let rows = leads.items ?? []
      if (!isAgent && ownerFilter === 'unassigned') {
        rows = rows.filter((l) => !l.assignedToId)
      }
      setItems(rows)
      setSources(lookups.sources)
      setUsers(lookups.users)
      setStages(lookups.stages)
      const catalog = (productPage.items ?? []).map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ''),
        sku: String(p.sku ?? ''),
      }))
      const byId = new Map(catalog.map((p) => [p.id, p]))
      for (const p of lookups.products) {
        if (!byId.has(p.id)) byId.set(p.id, { id: p.id, name: p.name, sku: p.sku })
      }
      setProducts([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)))
      if (!convertStageId && lookups.stages[0]) setConvertStageId(lookups.stages[0].id)
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to load leads'
      setLoadError(message)
      addToast({ type: 'error', message })
    } finally {
      setLoading(false)
    }
  }, [addToast, authUser?.id, convertStageId, isAgent, ownerFilter, search, status])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const next = searchParams.get('status') ?? ''
    if (next === '' || ALL_STATUS_VALUES.includes(next as (typeof ALL_STATUS_VALUES)[number])) {
      setStatus(next)
    }
  }, [searchParams])

  const sourceName = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.name])),
    [sources],
  )
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users])
  const productName = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )
  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: p.sku,
      })),
    [products],
  )

  const selectedDemoUnit = useMemo(
    () => demoUnits.find((u) => u.id === demoUnitId) ?? null,
    [demoUnits, demoUnitId],
  )

  const filteredDemoUnits = useMemo(() => {
    if (!demoProductFilter) return demoUnits
    return demoUnits.filter((u) => u.productId === demoProductFilter)
  }, [demoUnits, demoProductFilter])

  const onPickContact = useCallback((c: ContactPick | null) => {
    setPickedContact(c)
    if (c) {
      setForm((f) => ({
        ...f,
        contactId: c.id,
        customerType: 'EXISTING',
        name: c.name || f.name,
        phone: c.phone || c.mobile || f.phone,
        email: c.email || f.email,
        company: f.company || c.name,
      }))
    } else {
      setForm((f) => ({ ...f, contactId: '', customerType: 'NEW' }))
    }
  }, [])

  useEffect(() => {
    const shouldOpen = searchParams.get('open') === '1'
    const contactId = searchParams.get('contactId')
    if (shouldOpen) setOpen(true)
    if (contactId) {
      setForm((f) => ({ ...f, contactId, customerType: 'EXISTING' }))
    }
  }, [searchParams])

  async function createLead(e: FormEvent) {
    e.preventDefault()
    const nextErrors = validateLeadForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      return
    }
    setSaving(true)
    try {
      const customFields: Record<string, unknown> = {}
      if (form.contactId) customFields.contact_id = form.contactId
      if (form.enquiryDate) customFields.enquiry_date = form.enquiryDate
      if (form.productId) {
        customFields.interested_product_id = form.productId
        customFields.interested_product_name = productName[form.productId] ?? form.productInterest
      }
      if (form.productInterest) customFields.product_interest = form.productInterest
      if (form.budget) customFields.budget = Number(form.budget)
      if (form.timeline) customFields.timeline = form.timeline
      customFields.customer_type = form.customerType === 'EXISTING' ? 'Existing customer' : 'New customer'

      let website = form.website.trim()
      if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`

      await api.createLead({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        website: website || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country || 'IN',
        sourceId: form.sourceId || null,
        status: form.status,
        score: Number(form.score) || 0,
        assignedToId: form.assignedToId || null,
        description: form.description.trim() || null,
        tags: form.tags
          ? form.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        customFields,
      })
      setOpen(false)
      setForm(emptyForm)
      setPickedContact(null)
      setErrors({})
      addToast({ type: 'success', message: 'Sale enquiry saved — follow-up task assigned to executive' })
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    } finally {
      setSaving(false)
    }
  }

  async function convert() {
    if (!selected) return
    try {
      const result = await api.convertLead(String(selected.id), {
        stageId: convertStageId,
        dealName: `${selected.company || selected.name} — Deal`,
        amount: num((selected.customFields as Record<string, unknown>)?.budget),
        createAccount: true,
      })
      const dealId = String((result as { deal?: { id?: string } }).deal?.id ?? '')
      setConvertOpen(false)
      setSelected(null)
      addToast({
        type: 'success',
        message: 'Lead converted — opening deal',
      })
      if (dealId) {
        navigate(`/deals/${dealId}`)
      } else {
        await load()
        navigate('/deals')
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Convert failed' })
    }
  }

  async function reassignLead(assignedToId: string) {
    if (!selected) return
    try {
      const updated = await api.updateLead(String(selected.id), {
        assignedToId: assignedToId || null,
      })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      addToast({
        type: 'success',
        message: assignedToId
          ? `Assigned to ${userName[assignedToId] ?? 'employee'} — follow-up task created`
          : 'Lead unassigned',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update owner',
      })
    }
  }

  async function openDemoPicker() {
    if (!selected) return
    try {
      const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
      const interestedProductId = String(cf.interested_product_id ?? cf.demoProductId ?? '')
      const units = await api.stockUnits({ status: 'IN_STOCK', limit: 300 })
      const mapped = (units as Array<Record<string, unknown>>).map((u) => {
        const product = (u.product as Record<string, unknown> | null) ?? null
        return {
          id: String(u.id),
          serialNo: String(u.serialNo),
          productId: String(u.productId ?? ''),
          stampingDate: (u.stampingDate as string | null) ?? null,
          notes: u.notes ? String(u.notes) : null,
          product: product
            ? {
                name: product.name ? String(product.name) : undefined,
                sku: product.sku ? String(product.sku) : undefined,
                salePrice: product.salePrice != null ? num(product.salePrice) : undefined,
                purchasePrice: product.purchasePrice != null ? num(product.purchasePrice) : undefined,
                unit: product.unit ? String(product.unit) : undefined,
                productType: product.productType ? String(product.productType) : undefined,
                attributes: (product.attributes as Record<string, unknown> | null) ?? null,
              }
            : null,
          warehouse: (u.warehouse as { name?: string } | null) ?? null,
        }
      })
      setDemoUnits(mapped)
      setDemoProductFilter(interestedProductId)
      setDemoUnitId('')
      setDemoOpen(true)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load stock units',
      })
    }
  }

  async function returnDemoFromLead() {
    if (!selected) return
    setDemoReturning(true)
    try {
      const result = await api.returnLeadDemo(String(selected.id))
      const lead = (result as { lead?: Record<string, unknown> }).lead ?? result
      setSelected(lead as Record<string, unknown>)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...lead } : l)),
      )
      addToast({
        type: 'success',
        message: 'Demo unit returned — stock restored in inventory',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not return demo unit',
      })
    } finally {
      setDemoReturning(false)
    }
  }

  async function confirmDemoIssue() {
    if (!selected || !demoUnitId) {
      addToast({ type: 'error', message: 'Select a serial number for the demo' })
      return
    }
    setDemoSaving(true)
    try {
      const result = await api.issueLeadDemo(String(selected.id), demoUnitId)
      const lead = (result as { lead?: Record<string, unknown> }).lead ?? result
      setSelected(lead as Record<string, unknown>)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...lead } : l)),
      )
      setDemoOpen(false)
      addToast({
        type: 'success',
        message: 'Demo issued — serial reserved / stock reduced',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not issue demo unit',
      })
    } finally {
      setDemoSaving(false)
    }
  }

  async function updateLeadStatus(nextStatus: string) {
    if (!selected) return
    if (nextStatus === 'DEMO') {
      const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
      if (cf.demoStockUnitId || selected.status === 'DEMO') {
        try {
          const updated = await api.updateLead(String(selected.id), { status: 'DEMO' })
          setSelected(updated)
          setItems((prev) =>
            prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
          )
          addToast({ type: 'success', message: 'Status → Demo' })
        } catch (err) {
          addToast({
            type: 'error',
            message: err instanceof ApiClientError ? err.message : 'Could not update status',
          })
        }
        return
      }
      await openDemoPicker()
      return
    }
    try {
      const updated = await api.updateLead(String(selected.id), { status: nextStatus })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      addToast({ type: 'success', message: `Status → ${statusLabel(nextStatus)}` })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update status',
      })
    }
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteLead(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      if (selected && deleteIds.includes(String(selected.id))) setSelected(null)
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

  return (
    <div>
      <PageHeader
        title="Sale tracking"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Sale tracking' }]}
        actions={
          <Button onClick={() => setOpen((v) => !v)} variant={open ? 'outline' : 'primary'}>
            <Plus size={16} /> {open ? 'Close form' : 'New sale enquiry'}
          </Button>
        }
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <FormPanel
        open={open}
        accent="sky"
        eyebrow="Sale tracking"
        title="New sale enquiry"
        subtitle="Customer details, interested product, price, executive and status — demo issues a serial from inventory."
        onClose={() => {
          setOpen(false)
          setForm(emptyForm)
          setPickedContact(null)
          setErrors({})
        }}
        footer={
          <>
            <FormPanelCancel
              onClick={() => {
                setOpen(false)
                setForm(emptyForm)
                setPickedContact(null)
                setErrors({})
              }}
            />
            <Button type="submit" form="add-lead" disabled={saving}>
              {saving ? 'Saving…' : 'Save enquiry'}
            </Button>
          </>
        }
      >
        <form id="add-lead" onSubmit={createLead} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ContactPicker
            className="sm:col-span-2 lg:col-span-3"
            label="Customer — search by name, CUS-ID or phone"
            valueId={form.contactId}
            selected={pickedContact}
            onSelect={onPickContact}
            returnTo="/sale-tracking?open=1"
          />
          <Input label="Full name *" placeholder="e.g. Meena Krishnan" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Company / shop" placeholder="e.g. Harbour Traders" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <Input label="Email" type="email" placeholder="name@company.in" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" placeholder="+91 98400 10001" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Enquiry date *" type="date" value={form.enquiryDate} onChange={(e) => setForm({ ...form, enquiryDate: e.target.value })} />
          <SearchableSelect
            label="Interested product"
            value={form.productId}
            options={productOptions}
            onChange={(productId) => {
              const name = productName[productId] ?? ''
              setForm({ ...form, productId, productInterest: name || form.productInterest })
            }}
            placeholder="Search catalog product…"
          />
          <Input label="Product notes" placeholder="Variant / capacity if not in catalog" value={form.productInterest} onChange={(e) => setForm({ ...form, productInterest: e.target.value })} />
          <Input label="Quoted price ₹" type="number" placeholder="185000" value={form.budget} error={errors.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
          <Select
            label="Executive"
            value={form.assignedToId}
            onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
            options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={STATUS_OPTIONS.filter((s) => s.value !== 'CONVERTED').map((s) => ({
              value: s.value,
              label: s.label,
            }))}
          />
          <Input label="Website" value={form.website} error={errors.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://company.in" />
          <Select
            label="Source"
            value={form.sourceId}
            onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
            options={[{ value: '', label: 'Select source' }, ...sources.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <Input label="City" placeholder="Chennai" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" placeholder="Tamil Nadu" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="Buy timeline" value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="This month / Q2" />
          <Input label="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="hot, exhibition" />
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Comments</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder="Enquiry notes, how they found you…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>
      </FormPanel>

      <FormPanel
        open={convertOpen}
        accent="sky"
        eyebrow="Leads"
        title="Convert lead"
        subtitle="Creates a contact, account and deal — you’ll land on the new deal page."
        onClose={() => setConvertOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setConvertOpen(false)} />
            <Button onClick={() => void convert()}>Convert</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Deal stage"
            value={convertStageId}
            onChange={(e) => setConvertStageId(e.target.value)}
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
          />
          <p className="text-sm text-text-secondary sm:col-span-2 lg:col-span-2">
            Creates Contact + Account + Deal and marks the lead CONVERTED.
          </p>
        </div>
      </FormPanel>

      <Card className="mb-4 flex flex-wrap gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={16} />
          <Input className="pl-9" placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label })),
          ]}
          className="w-44"
        />
        {!isAgent && (
          <Select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="w-44"
            options={[
              { value: '', label: 'All owners' },
              { value: 'unassigned', label: 'Unassigned' },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        )}
      </Card>

      <Card padding={false}>
        {loading ? (
          <p className="p-6 text-sm text-text-secondary">Loading leads from database…</p>
        ) : loadError && items.length === 0 ? (
          <EmptyState
            title="Could not load leads"
            subtitle={loadError}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : items.length === 0 ? (
          <EmptyState title="No leads" subtitle="Add your first enquiry with full buyer details." actionLabel="Add lead" onAction={() => setOpen(true)} />
        ) : (
          <div className="p-4 pt-3">
            {isAdmin && selection.someSelected ? (
              <BulkActionBar
                count={selection.selectedCount}
                noun="lead"
                busy={busyDelete}
                onClear={selection.clear}
                onDelete={() => setConfirm({ ids: selection.selectedIds })}
              />
            ) : null}
            <table className="w-full min-w-[1000px] text-left text-sm">
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
                  {['Customer', 'Product', 'Price', 'Executive', 'Date', 'Status', 'Demo serial', 'Actions'].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((lead) => {
                  const id = String(lead.id)
                  const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
                  const productLabel =
                    String(cf.interested_product_name ?? cf.product_interest ?? '—')
                  const enquiryDate = cf.enquiry_date
                    ? formatDate(String(cf.enquiry_date))
                    : lead.createdAt
                      ? formatDate(String(lead.createdAt))
                      : '—'
                  return (
                    <tr
                      key={id}
                      className="cursor-pointer border-t border-border hover:bg-surface"
                      onClick={() => setSelected(lead)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <SelectCheckbox
                          checked={selection.isSelected(id)}
                          onChange={() => selection.toggle(id)}
                          aria-label={`Select ${String(lead.name)}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-medium">
                          <Avatar name={String(lead.name)} size="sm" />
                          <span>
                            {String(lead.name)}
                            {lead.company ? (
                              <span className="block text-xs font-normal text-text-secondary">
                                {String(lead.company)}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <div className="mt-0.5 text-xs text-text-secondary">
                          {formatPhone(String(lead.phone || '')) || '—'}
                        </div>
                      </td>
                      <td className="max-w-[160px] px-4 py-3">{productLabel}</td>
                      <td className="px-4 py-3">
                        {cf.budget != null ? `₹${Number(cf.budget).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {lead.assignedToId ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={userName[String(lead.assignedToId)] ?? '?'} size="sm" />
                            <span>{userName[String(lead.assignedToId)] ?? '—'}</span>
                          </span>
                        ) : (
                          <span className="text-text-secondary">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{enquiryDate}</td>
                      <td className="px-4 py-3">
                        <Badge color="blue">{statusLabel(String(lead.status))}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {cf.demoSerialNo ? String(cf.demoSerialNo) : '—'}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-0.5">
                          <ViewIconButton onClick={() => setSelected(lead)} />
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

      <Drawer
        open={Boolean(selected) && !convertOpen}
        onClose={() => setSelected(null)}
        width={580}
        title={
          selected ? (
            <div className="flex items-center gap-3">
              <Avatar name={String(selected.name)} size="md" />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-text-primary">{String(selected.name)}</div>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <Badge color="blue">{statusLabel(String(selected.status))}</Badge>
                  {selected.company ? (
                    <span className="text-sm text-text-secondary">{String(selected.company)}</span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            'Sale enquiry'
          )
        }
      >
        {selected && (() => {
          const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
          const contactId = cf.contact_id ? String(cf.contact_id) : ''
          const enquiryDate = cf.enquiry_date
            ? formatDate(String(cf.enquiry_date))
            : selected.createdAt
              ? formatDate(String(selected.createdAt))
              : '—'
          const productName = String(cf.interested_product_name ?? cf.product_interest ?? '—')
          const price =
            cf.budget != null ? `₹${Number(cf.budget).toLocaleString('en-IN')}` : '—'
          return (
          <div className="space-y-4 px-5 pb-6">
            {/* Executive & status */}
            <section className="rounded-xl border border-accent-blue/25 bg-gradient-to-br from-sky-50/80 to-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Executive</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Avatar name={userName[String(selected.assignedToId)] ?? 'Unassigned'} size="sm" />
                    <span className="font-semibold">{userName[String(selected.assignedToId)] ?? 'Unassigned'}</span>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-xs text-text-secondary">Enquiry date</div>
                  <div className="font-semibold">{enquiryDate}</div>
                </div>
              </div>
              {!isAgent && (
                <Select
                  className="mt-3"
                  label="Reassign executive"
                  value={String(selected.assignedToId ?? '')}
                  onChange={(e) => void reassignLead(e.target.value)}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...users.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                />
              )}
              <Select
                className="mt-3"
                label="Status"
                value={String(selected.status ?? 'NEW')}
                onChange={(e) => void updateLeadStatus(e.target.value)}
                options={[
                  ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label })),
                  ...(LEGACY_STATUSES.includes(String(selected.status) as (typeof LEGACY_STATUSES)[number])
                    ? [{ value: String(selected.status), label: String(selected.status) }]
                    : []),
                ]}
              />
            </section>

            {/* Customer */}
            <section className="rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Customer details</h3>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">Name</dt>
                  <dd className="font-medium">{String(selected.name)}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Company / shop</dt>
                  <dd className="font-medium">{String(selected.company || '—')}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Phone</dt>
                  <dd>{formatPhone(String(selected.phone || '')) || '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Email</dt>
                  <dd className="break-all">{String(selected.email || '—')}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Location</dt>
                  <dd>{[selected.city, selected.state, selected.country].filter(Boolean).join(', ') || '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Customer type</dt>
                  <dd>{String(cf.customer_type ?? 'New customer')}</dd>
                </div>
                {contactId ? (
                  <div className="sm:col-span-2">
                    <Link to={`/contacts/${contactId}`} className="text-sm font-semibold text-accent-blue hover:underline">
                      Open linked customer profile →
                    </Link>
                  </div>
                ) : null}
              </dl>
            </section>

            {/* Sale enquiry */}
            <section className="rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Sale enquiry</h3>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-text-secondary">Interested product</dt>
                  <dd className="text-base font-semibold text-text-primary">{productName}</dd>
                  {cf.product_interest && cf.interested_product_name ? (
                    <dd className="mt-0.5 text-xs text-text-secondary">{String(cf.product_interest)}</dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-text-secondary">Quoted price</dt>
                  <dd className="text-lg font-bold text-accent-blue">{price}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Buy timeline</dt>
                  <dd>{String(cf.timeline ?? '—')}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Source</dt>
                  <dd>{sourceName[String(selected.sourceId)] ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">Score</dt>
                  <dd>{num(selected.score)}</dd>
                </div>
              </dl>
            </section>

            {/* Demo block */}
            {(String(selected.status) === 'DEMO' || cf.demoSerialNo) ? (
              <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Demo unit</h3>
                <dl className="mt-2 grid gap-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-amber-800">Serial</dt>
                    <dd className="font-mono font-bold">{String(cf.demoSerialNo ?? '—')}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-amber-800">Product</dt>
                    <dd className="font-medium">{String(cf.demoProductName ?? '—')}</dd>
                  </div>
                  {cf.demoIssuedAt ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-amber-800">Issued</dt>
                      <dd>{formatDate(String(cf.demoIssuedAt))}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <Link to="/erp/inventory?tab=demo" className="font-semibold text-accent-blue hover:underline">
                    Demo inventory
                  </Link>
                  {String(selected.status) === 'DEMO' && cf.demoStockUnitId ? (
                    <button
                      type="button"
                      className="font-semibold text-accent-blue hover:underline disabled:opacity-50"
                      disabled={demoReturning}
                      onClick={() => void returnDemoFromLead()}
                    >
                      {demoReturning ? 'Returning…' : 'Return to stock'}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
            {String(selected.status) !== 'DEMO' &&
            String(selected.status) !== 'CONVERTED' &&
            String(selected.status) !== 'LOST' ? (
              <Button variant="outline" className="w-full" onClick={() => void openDemoPicker()}>
                Issue demo unit (pick serial)
              </Button>
            ) : null}

            {/* Comments */}
            {selected.description ? (
              <section className="rounded-xl border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Comments</h3>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{String(selected.description)}</p>
              </section>
            ) : null}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="flex-1" onClick={() => navigate(`/activities?leadId=${String(selected.id)}&open=1`)}>
                Log activity
              </Button>
              {selected.phone ? (
                <Button variant="outline" className="flex-1" onClick={() => navigate('/whatsapp')}>
                  WhatsApp
                </Button>
              ) : null}
            </div>

            {selected.convertedContactId || selected.convertedAccountId || selected.convertedDealId ? (
              <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <h3 className="text-xs font-semibold uppercase text-accent-green">Converted</h3>
                <div className="mt-2 flex flex-col gap-2 text-sm font-medium">
                  {selected.convertedContactId ? (
                    <button type="button" className="text-accent-blue hover:underline" onClick={() => navigate(`/contacts/${String(selected.convertedContactId)}`)}>
                      Open contact →
                    </button>
                  ) : null}
                  {selected.convertedAccountId ? (
                    <button type="button" className="text-accent-blue hover:underline" onClick={() => navigate(`/accounts/${String(selected.convertedAccountId)}`)}>
                      Open account →
                    </button>
                  ) : null}
                  {selected.convertedDealId ? (
                    <button type="button" className="text-accent-blue hover:underline" onClick={() => navigate(`/deals/${String(selected.convertedDealId)}`)}>
                      Open deal →
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {selected.status !== 'CONVERTED' && (
              <Button className="w-full" onClick={() => setConvertOpen(true)}>
                Convert → Contact + Account + Deal
              </Button>
            )}

            <p className="text-center text-xs text-text-secondary">
              Created {selected.createdAt ? formatDate(String(selected.createdAt)) : '—'}
              {selected.website ? ` · ${String(selected.website)}` : ''}
            </p>
          </div>
          )
        })()}
      </Drawer>

      <Modal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        title="Issue demo product"
        subtitle="Select the exact serial going to the customer site. Stock count drops immediately; return from Demo inventory when the unit comes back."
        accent="amber"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setDemoOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmDemoIssue()} disabled={demoSaving || !demoUnitId}>
              {demoSaving ? 'Issuing…' : 'Issue demo & reduce stock'}
            </Button>
          </>
        }
      >
        {demoUnits.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No in-stock serials. Add stock under Inventory first.
          </p>
        ) : (
          <div className="space-y-4">
            <SearchableSelect
              label="Filter by product (optional)"
              value={demoProductFilter}
              options={[
                { value: '', label: 'All products in stock' },
                ...productOptions.filter((p) =>
                  demoUnits.some((u) => u.productId === p.value),
                ),
              ]}
              onChange={(v) => {
                setDemoProductFilter(v)
                setDemoUnitId('')
              }}
              placeholder="All products…"
            />
            <Select
              label="Serial number *"
              value={demoUnitId}
              onChange={(e) => setDemoUnitId(e.target.value)}
              options={[
                { value: '', label: 'Select serial' },
                ...filteredDemoUnits.map((u) => ({
                  value: u.id,
                  label: `${u.serialNo} · ${u.product?.name ?? 'Product'}${
                    u.warehouse?.name ? ` · ${u.warehouse.name}` : ''
                  }${u.stampingDate ? ` · stamp ${formatDate(u.stampingDate)}` : ''}`,
                })),
              ]}
            />
            {selectedDemoUnit ? (
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
                <div className="font-semibold text-text-primary">Product details</div>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-text-secondary">Product</dt>
                    <dd className="font-medium">{selectedDemoUnit.product?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">SKU</dt>
                    <dd className="font-mono">{selectedDemoUnit.product?.sku ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">Serial</dt>
                    <dd className="font-mono font-semibold">{selectedDemoUnit.serialNo}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">Warehouse</dt>
                    <dd>{selectedDemoUnit.warehouse?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">Stamping date</dt>
                    <dd>
                      {selectedDemoUnit.stampingDate
                        ? formatDate(selectedDemoUnit.stampingDate)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-secondary">Sale price</dt>
                    <dd>
                      {selectedDemoUnit.product?.salePrice != null
                        ? formatCurrency(selectedDemoUnit.product.salePrice)
                        : '—'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-amber-800">
                  Issuing removes 1 unit from available stock and tracks this serial under Demo inventory until
                  sold or returned.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete lead?' : `Delete ${confirm?.ids.length ?? 0} leads?`}
        body={
          confirm?.ids.length === 1
            ? 'This lead will be permanently removed.'
            : 'Selected leads will be permanently removed.'
        }
      />
    </div>
  )
}
