import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Package, Plus, Search, ShieldCheck, TrendingUp, UserX, Users } from 'lucide-react'
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
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { firstError, validateLeadForm, type FieldErrors } from '@/lib/formValidation'
import { formatDate, formatPhone, formatCurrency } from '@/lib/utils'
import { productRequiresStamping } from '@/lib/productCatalog'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { WhatsAppSendConfirm, type WhatsAppConfirmPayload } from '@/components/whatsapp/WhatsAppSendConfirm'
import { isCompanyAdmin, isSalesExecutive, filterSalesExecutives, type LookupUser } from '@/lib/roles'
import {
  HMS_FAMILY_OPTIONS,
  industryOptions,
  productCatalogMeta,
} from '@/lib/hmsCatalog'
import { productAttrs } from '@/lib/productCatalog'
import { formatEnquiryId } from '@/lib/serviceId'

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

function statusBadgeColor(code: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (code === 'DEMO') return 'amber'
  if (code === 'CONVERTED') return 'green'
  if (code === 'LOST') return 'gray'
  if (code === 'NEW') return 'blue'
  return 'blue'
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
  familyCode: '',
  industryCode: '',
  demoSerialId: '',
  budget: '',
  enquiryDate: new Date().toISOString().slice(0, 10),
  timeline: '',
  tags: '',
  customerType: 'NEW' as 'NEW' | 'EXISTING',
}

export function LeadsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isSales = isSalesExecutive(authUser?.role)
  const isAdmin = isCompanyAdmin(authUser?.role)
  const tip = DEFAULT_TIPS['crm.leads'] ?? {
    title: 'Sale tracking',
    body: 'Record every sale enquiry — pick an existing customer or add a new one, then track demo units and conversion.',
    tipType: 'TIP' as const,
  }

  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<LookupUser[]>([])
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; salePrice?: number; taxPercent?: number; attributes?: Record<string, unknown> | null }>
  >([])
  const [createDemoUnits, setCreateDemoUnits] = useState<Array<{ id: string; serialNo: string; stampingDate?: string | null }>>([])
  const [stampingGateOpen, setStampingGateOpen] = useState(false)
  const [pendingStampUnitId, setPendingStampUnitId] = useState('')
  const [invoicePromptOpen, setInvoicePromptOpen] = useState(false)
  const [invoicePromptCtx, setInvoicePromptCtx] = useState<{
    contactId: string
    productId: string
    serialNo: string
    dealId: string
  } | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)
  const [waPending, setWaPending] = useState<{
    payload: WhatsAppConfirmPayload
    execute: (sendWhatsApp: boolean) => Promise<void>
  } | null>(null)
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [search, setSearch] = useState('')
  const initialStatus = searchParams.get('status') ?? ''
  const [status, setStatus] = useState(
    ALL_STATUS_VALUES.includes(initialStatus as (typeof ALL_STATUS_VALUES)[number]) ? initialStatus : '',
  )
  const [ownerFilter, setOwnerFilter] = useState('')
  const [pageTab, setPageTab] = useState<'list' | 'create' | 'demo-updates'>(() =>
    searchParams.get('open') === '1' ? 'create' : 'list',
  )
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    assignedToId: '',
  }))
  const [dailyNote, setDailyNote] = useState('')
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().slice(0, 10))
  const [dailySaving, setDailySaving] = useState(false)
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
  const [demoFamilyCode, setDemoFamilyCode] = useState('')
  const [demoIndustryCode, setDemoIndustryCode] = useState('')
  const [demoSaving, setDemoSaving] = useState(false)
  const [demoReturning, setDemoReturning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  useEffect(() => {
    setDailyNote('')
    setDailyDate(new Date().toISOString().slice(0, 10))
  }, [selected?.id])

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
          ...(isSales && authUser?.id
            ? { assignedToId: authUser.id }
            : ownerFilter && ownerFilter !== 'unassigned'
              ? { assignedToId: ownerFilter }
              : {}),
        }),
        api.lookups(),
        api.products({ limit: 500 }),
      ])
      let rows = leads.items ?? []
      if (!isSales && ownerFilter === 'unassigned') {
        rows = rows.filter((l) => !l.assignedToId)
      }
      setItems(
        [...rows].sort((a, b) => {
          // createdAt desc client — newest enquiries on top
          const ta = new Date(String(a.createdAt ?? 0)).getTime()
          const tb = new Date(String(b.createdAt ?? 0)).getTime()
          return tb - ta
        }),
      )
      setSources(lookups.sources)
      setUsers(lookups.users)
      setStages(lookups.stages)
      const catalog = (productPage.items ?? []).map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ''),
        sku: String(p.sku ?? ''),
        salePrice: p.salePrice != null ? num(p.salePrice) : undefined,
        taxPercent: p.taxPercent != null ? num(p.taxPercent) : undefined,
        attributes: (p.attributes as Record<string, unknown> | null) ?? null,
      }))
      const byId = new Map(catalog.map((p) => [p.id, p]))
      for (const p of lookups.products) {
        if (!byId.has(p.id)) {
          byId.set(p.id, {
            id: p.id,
            name: p.name,
            sku: p.sku,
            salePrice: num(p.salePrice),
            taxPercent: num(p.taxPercent),
            attributes: (p.attributes as Record<string, unknown> | null) ?? null,
          })
        }
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
  }, [addToast, authUser?.id, convertStageId, isSales, ownerFilter, search, status])

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
  const salesExecs = useMemo(() => filterSalesExecutives(users), [users])
  /** Admins see everyone; sales execs only themselves (locked owner). */
  const salesOptions = useMemo(() => {
    const list =
      isSales && authUser?.id
        ? salesExecs.filter((u) => u.id === authUser.id)
        : salesExecs
    const opts = list.map((u) => ({
      value: u.id,
      label: u.phone ? `${u.name} · ${u.phone}` : u.name,
    }))
    // If lookups lag, still show the logged-in executive by name.
    if (isSales && authUser?.id && !opts.some((o) => o.value === authUser.id)) {
      opts.push({
        value: authUser.id,
        label: authUser.name || 'You (sales executive)',
      })
    }
    return opts
  }, [salesExecs, isSales, authUser?.id, authUser?.name])

  function openCreateEnquiry() {
    setPageTab('create')
    setForm({
      ...emptyForm,
      assignedToId: isSales && authUser?.id ? authUser.id : '',
    })
    setPickedContact(null)
    setErrors({})
    setCreateDemoUnits([])
  }
  const productName = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )
  const productsForDemo = useMemo(() => {
    return products.filter((p) => {
      const meta = productCatalogMeta(productAttrs(p))
      if (form.familyCode) {
        if (meta.familyCode) {
          if (meta.familyCode !== form.familyCode) return false
        } else if (form.familyCode === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        }
      }
      if (form.industryCode && meta.industryCode !== form.industryCode) return false
      return true
    })
  }, [products, form.familyCode, form.industryCode])

  const demoUpdateFeed = useMemo(() => {
    const rows: Array<{
      leadId: string
      leadName: string
      company?: string
      serial?: string
      product?: string
      dcNo?: string
      executive?: string
      update: Record<string, unknown>
    }> = []
    for (const lead of items) {
      if (String(lead.status) !== 'DEMO') continue
      const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
      const updates = Array.isArray(cf.demoDailyUpdates)
        ? (cf.demoDailyUpdates as Array<Record<string, unknown>>)
        : []
      for (const u of updates) {
        rows.push({
          leadId: String(lead.id),
          leadName: String(lead.name ?? ''),
          company: lead.company ? String(lead.company) : undefined,
          serial: cf.demoSerialNo ? String(cf.demoSerialNo) : undefined,
          product: cf.demoProductName ? String(cf.demoProductName) : undefined,
          dcNo: cf.demoDcNo ? String(cf.demoDcNo) : undefined,
          executive: cf.demoExecutiveName
            ? String(cf.demoExecutiveName)
            : userName[String(lead.assignedToId ?? '')],
          update: u,
        })
      }
    }
    return rows.sort(
      (a, b) =>
        new Date(String(b.update.at ?? b.update.updateDate ?? 0)).getTime() -
        new Date(String(a.update.at ?? a.update.updateDate ?? 0)).getTime(),
    )
  }, [items, userName])

  async function saveDailyUpdate() {
    if (!selected || !dailyNote.trim()) {
      addToast({ type: 'error', message: 'Write today’s demo update' })
      return
    }
    setDailySaving(true)
    try {
      const updated = await api.addLeadDemoUpdate(String(selected.id), {
        note: dailyNote.trim(),
        updateDate: dailyDate,
      })
      setSelected(updated)
      setItems((prev) =>
        prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
      )
      setDailyNote('')
      addToast({ type: 'success', message: 'Daily demo update saved — visible to admin' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save update',
      })
    } finally {
      setDailySaving(false)
    }
  }

  const productOptions = useMemo(
    () =>
      (form.status === 'DEMO' ? productsForDemo : products).map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: p.sku,
      })),
    [products, productsForDemo, form.status],
  )

  const selectedDemoUnit = useMemo(
    () => demoUnits.find((u) => u.id === demoUnitId) ?? null,
    [demoUnits, demoUnitId],
  )

  const filteredDemoUnits = useMemo(() => {
    return demoUnits.filter((u) => {
      if (demoProductFilter && u.productId !== demoProductFilter) return false
      if (!demoFamilyCode && !demoIndustryCode) return true
      const meta = productCatalogMeta(productAttrs(u.product))
      if (demoFamilyCode) {
        if (meta.familyCode) {
          if (meta.familyCode !== demoFamilyCode) return false
        } else if (demoFamilyCode === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        }
      }
      if (demoIndustryCode && meta.industryCode !== demoIndustryCode) return false
      return true
    })
  }, [demoUnits, demoProductFilter, demoFamilyCode, demoIndustryCode])

  const demoPickerProductOptions = useMemo(() => {
    const matching = demoUnits.filter((u) => {
      if (!demoFamilyCode && !demoIndustryCode) return true
      const meta = productCatalogMeta(productAttrs(u.product))
      if (demoFamilyCode) {
        if (meta.familyCode) {
          if (meta.familyCode !== demoFamilyCode) return false
        } else if (demoFamilyCode === 'WEIGHING_SCALES' && meta.catalogKind !== 'WEIGHING') {
          return false
        }
      }
      if (demoIndustryCode && meta.industryCode !== demoIndustryCode) return false
      return true
    })
    const ids = new Set(matching.map((u) => u.productId).filter(Boolean) as string[])
    return products
      .filter((p) => ids.has(p.id))
      .map((p) => ({ value: p.id, label: p.name, sublabel: p.sku }))
  }, [demoUnits, products, demoFamilyCode, demoIndustryCode])

  const statusCounts = useMemo(() => {
    const counts = { NEW: 0, DEMO: 0, CONVERTED: 0, LOST: 0 }
    for (const l of items) {
      const s = String(l.status)
      if (s in counts) counts[s as keyof typeof counts] += 1
    }
    return counts
  }, [items])

  useEffect(() => {
    if (form.status !== 'DEMO' || !form.productId) {
      setCreateDemoUnits([])
      return
    }
    let cancelled = false
    void api
      .stockUnits({ status: 'IN_STOCK', productId: form.productId, limit: 200 })
      .then((rows) => {
        if (cancelled) return
        setCreateDemoUnits(
          (rows as Array<Record<string, unknown>>).map((u) => ({
            id: String(u.id),
            serialNo: String(u.serialNo),
            stampingDate: (u.stampingDate as string | null) ?? null,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setCreateDemoUnits([])
      })
    return () => {
      cancelled = true
    }
  }, [form.status, form.productId])

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

  function closeCreateForm() {
    setPageTab('list')
    setForm({
      ...emptyForm,
      assignedToId: isSales && authUser?.id ? authUser.id : '',
    })
    setPickedContact(null)
    setErrors({})
    setCreateDemoUnits([])
    if (searchParams.get('open') || searchParams.get('contactId')) {
      setSearchParams({}, { replace: true })
    }
  }

  useEffect(() => {
    const shouldOpen = searchParams.get('open') === '1'
    const contactId = searchParams.get('contactId')
    if (shouldOpen) {
      setPageTab('create')
      setForm((f) => ({
        ...f,
        assignedToId: isSales && authUser?.id ? authUser.id : f.assignedToId,
        ...(contactId ? { contactId, customerType: 'EXISTING' as const } : {}),
      }))
    } else if (contactId) {
      setForm((f) => ({ ...f, contactId, customerType: 'EXISTING' }))
    }
  }, [searchParams, setSearchParams, isSales, authUser?.id])

  // Keep sales executive locked to self whenever the create form is open.
  useEffect(() => {
    if (pageTab !== 'create' || !isSales || !authUser?.id) return
    setForm((f) => (f.assignedToId === authUser.id ? f : { ...f, assignedToId: authUser.id }))
  }, [pageTab, isSales, authUser?.id])

  async function createLead(e: FormEvent) {
    e.preventDefault()
    const nextErrors = validateLeadForm(form)
    if (form.status === 'DEMO') {
      if (!form.familyCode) nextErrors.familyCode = 'Select product family'
      if (form.familyCode === 'WEIGHING_SCALES' && !form.industryCode) {
        nextErrors.industryCode = 'Select industry'
      }
      if (!form.productId) nextErrors.productId = 'Select the demo product / machine'
      if (!form.demoSerialId) nextErrors.demoSerialId = 'Select the serial number going out on demo'
      if (!form.assignedToId && !isSales) nextErrors.assignedToId = 'Assign an executive for the demo unit'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: `Missing — ${firstError(nextErrors)}` })
      const firstKey = Object.keys(nextErrors)[0]
      const el =
        document.querySelector(`[name="${firstKey}"]`) ||
        document.getElementById(`lead-field-${firstKey}`) ||
        document.getElementById('add-lead')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setWaPending({
      payload: {
        title: 'Save enquiry & WhatsApp customer?',
        lines: [
          'Template sale_enquiry_received → customer phone',
          ...(form.status === 'DEMO' && form.demoSerialId
            ? ['Template demo_dc_customer → customer (DC + serial)']
            : []),
        ],
        note: 'Needs customer mobile with country code. Product / DC fields come from this form.',
      },
      execute: (send) => doCreateLead(send),
    })
  }

  async function doCreateLead(sendWhatsApp: boolean) {
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

      const created = await api.createLead({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        company: form.company.trim() || null,
        website: website || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        country: form.country || 'IN',
        sourceId: form.sourceId || null,
        status: form.status === 'DEMO' ? 'NEW' : form.status,
        score: Number(form.score) || 0,
        assignedToId: isSales && authUser?.id ? authUser.id : form.assignedToId || null,
        description: form.description.trim() || null,
        tags: form.tags
          ? form.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        customFields,
        ...(form.status === 'DEMO' && form.demoSerialId
          ? { demoStockUnitId: form.demoSerialId }
          : {}),
        sendWhatsApp,
      })

      const leadId = String(created.id ?? '')
      if (!leadId) throw new Error('Enquiry saved but id missing — refresh and open from list')

      addToast({
        type: 'success',
        message:
          form.status === 'DEMO' && form.demoSerialId
            ? 'Demo enquiry saved — delivery challan created & serial in Demo inventory'
            : 'Sale enquiry saved (prospect only — not in customer list until convert)',
      })

      closeCreateForm()
      await load()
      navigate(`/sale-tracking/${leadId}`)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    } finally {
      setSaving(false)
    }
  }

  async function beginConvert() {
    if (!selected) return
    const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
    const unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : ''
    if (unitId) {
      try {
        const unit = await api.getStockUnit(unitId)
        const product = unit.product as Record<string, unknown> | null
        const needsStamp = productRequiresStamping(product)
        if (needsStamp && !unit.stampingDate) {
          setPendingStampUnitId(unitId)
          setStampingGateOpen(true)
          return
        }
      } catch {
        /* proceed if unit lookup fails */
      }
    }
    setConvertOpen(true)
  }

  async function convert() {
    if (!selected) return
    setWaPending({
      payload: {
        title: 'Convert sale & WhatsApp customer?',
        lines: ['Template sale_order_confirmed → customer'],
        note: 'Uses customer name, product interest / demo product, and enquiry reference.',
      },
      execute: (send) => doConvert(send),
    })
  }

  async function doConvert(sendWhatsApp: boolean) {
    if (!selected) return
    setConvertBusy(true)
    try {
      const cf = (selected.customFields as Record<string, unknown> | null) ?? {}
      const result = await api.convertLead(String(selected.id), {
        stageId: convertStageId,
        dealName: `${selected.company || selected.name} — Sale`,
        amount: num(cf.budget),
        createAccount: true,
        sendWhatsApp,
      })
      const dealId = String((result as { deal?: { id?: string } }).deal?.id ?? '')
      const contactId = String(
        (result as { contact?: { id?: string } }).contact?.id ??
          selected.convertedContactId ??
          cf.contact_id ??
          '',
      )
      setConvertOpen(false)
      setSelected(null)
      addToast({ type: 'success', message: 'Sale converted — customer & deal created' })
      if (cf.demoStockUnitId || cf.demoSerialNo) {
        setInvoicePromptCtx({
          contactId,
          productId: String(cf.demoProductId ?? cf.interested_product_id ?? ''),
          serialNo: String(cf.demoSerialNo ?? ''),
          dealId,
        })
        setInvoicePromptOpen(true)
      } else if (dealId) {
        navigate(`/deals/${dealId}`)
      } else {
        await load()
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Convert failed' })
    } finally {
      setConvertBusy(false)
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
      const interested = mapped.find((u) => u.productId === interestedProductId)
      const meta = interested ? productCatalogMeta(productAttrs(interested.product)) : null
      setDemoFamilyCode(meta?.familyCode ?? '')
      setDemoIndustryCode(meta?.industryCode ?? '')
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
    if (nextStatus === 'CONVERTED') {
      await beginConvert()
      return
    }
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
    if (nextStatus === 'LOST' && String(selected.status) === 'DEMO') {
      const hadDemo = cfHasDemo(selected)
      try {
        const updated = await api.updateLead(String(selected.id), { status: nextStatus })
        setSelected(updated)
        setItems((prev) =>
          prev.map((l) => (String(l.id) === String(selected.id) ? { ...l, ...updated } : l)),
        )
        addToast({
          type: 'success',
          message: hadDemo
            ? 'Not interested — demo unit returned to Main warehouse'
            : `Status → ${statusLabel(nextStatus)}`,
        })
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Could not update status',
        })
      }
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

  function cfHasDemo(lead: Record<string, unknown>) {
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
    return Boolean(cf.demoStockUnitId)
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
    <div className="min-w-0 max-w-full">
      <PageHeader
        title="Sale tracking"
        count={pageTab === 'list' ? items.length : undefined}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Sale tracking', to: '/sale-tracking' },
          ...(pageTab === 'create' ? [{ label: 'New enquiry' }] : []),
        ]}
        actions={
          pageTab === 'list' ? (
            <Button onClick={() => openCreateEnquiry()} className="w-full sm:w-auto">
              <Plus size={16} /> New sale enquiry
            </Button>
          ) : undefined
        }
      />

      <PageTabs
        accent="theme"
        active={pageTab}
        onChange={(id) => {
          if (id === 'list' || id === 'demo-updates') {
            setPageTab(id as 'list' | 'demo-updates')
            setForm({
              ...emptyForm,
              assignedToId: isSales && authUser?.id ? authUser.id : '',
            })
            setPickedContact(null)
            setErrors({})
            return
          }
          openCreateEnquiry()
        }}
        tabs={[
          { id: 'list', label: isSales ? 'My enquiries' : 'All enquiries', count: items.length },
          ...(isAdmin
            ? [{ id: 'demo-updates', label: 'Demo daily updates', count: demoUpdateFeed.length }]
            : []),
          { id: 'create', label: 'New sale enquiry' },
        ]}
      />

      {pageTab === 'demo-updates' && isAdmin ? (
        <Card padding={false} className="mb-4">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold text-text-primary">Demo progress from sales executives</h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              Every daily update posted on an active demo appears here for admin review.
            </p>
          </div>
          {demoUpdateFeed.length === 0 ? (
            <EmptyState
              title="No demo updates yet"
              subtitle="When executives post daily notes on demo enquiries, they show up in this board."
            />
          ) : (
            <ul className="divide-y divide-border">
              {demoUpdateFeed.map((row) => (
                <li key={`${row.leadId}-${String(row.update.id ?? row.update.at)}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between"
                    onClick={() => navigate(`/sale-tracking/${row.leadId}`)}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary">
                        {row.leadName}
                        {row.company ? ` · ${row.company}` : ''}
                      </div>
                      <div className="text-sm text-text-secondary">
                        {[
                          row.update.dayNumber != null ? `Day ${row.update.dayNumber}` : null,
                          row.product,
                          row.serial ? `S/No ${row.serial}` : null,
                          row.dcNo,
                          row.executive,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <p className="mt-1 text-sm text-text-primary">{String(row.update.note ?? '')}</p>
                    </div>
                    <div className="shrink-0 text-xs text-text-secondary">
                      {String(row.update.updateDate ?? '').slice(0, 10) ||
                        formatDate(String(row.update.at ?? ''))}
                      <div className="mt-0.5">{String(row.update.authorName ?? row.executive ?? '')}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {pageTab === 'create' ? (
        <>
          <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />
          <FormPanel
            open
            accent="sky"
            eyebrow="Sale tracking"
            title="New sale enquiry"
            subtitle="Prospect details stay on the enquiry until Convert sale — then they become a permanent customer. Demo status issues a serial from stock immediately."
            onClose={closeCreateForm}
            footer={
              <>
                <FormPanelCancel onClick={closeCreateForm} />
                <Button type="submit" form="add-lead" disabled={saving}>
                  {saving ? 'Saving…' : 'Save enquiry'}
                </Button>
              </>
            }
          >
        <form id="add-lead" onSubmit={createLead} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ContactPicker
            className="sm:col-span-2 lg:col-span-3"
            label="Existing customer (optional)"
            valueId={form.contactId}
            selected={pickedContact}
            onSelect={onPickContact}
            returnTo="/sale-tracking?open=1"
            prospectMode
          />
          <p className="sm:col-span-2 lg:col-span-3 -mt-2 text-xs text-text-secondary">
            New prospects: leave search empty and fill name / phone below. They are <strong>not</strong> added to
            Customers until you convert the sale.
          </p>
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
            label="Sales executive"
            value={form.assignedToId}
            onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
            options={
              isSales
                ? salesOptions
                : [
                    {
                      value: '',
                      label: salesOptions.length
                        ? 'Select executive…'
                        : 'No sales executives — add in Users & Roles',
                    },
                    ...salesOptions,
                  ]
            }
            disabled={isSales}
          />
          {isSales ? (
            <p className="-mt-2 text-xs text-text-secondary sm:col-span-2 lg:col-span-3">
              This enquiry is assigned to you — you cannot assign it to another executive.
            </p>
          ) : null}
          <Select
            label="Status"
            value={form.status}
            onChange={(e) =>
              setForm({
                ...form,
                status: e.target.value,
                demoSerialId: e.target.value === 'DEMO' ? form.demoSerialId : '',
                familyCode: e.target.value === 'DEMO' ? form.familyCode : '',
                industryCode: e.target.value === 'DEMO' ? form.industryCode : '',
              })
            }
            options={STATUS_OPTIONS.filter((s) => s.value !== 'CONVERTED').map((s) => ({
              value: s.value,
              label: s.label,
            }))}
          />
          {form.status === 'DEMO' ? (
            <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
              <h4 className="text-sm font-semibold text-text-primary">Demo unit — from inventory</h4>
              <p className="mt-1 text-xs text-text-secondary">
                Select product family → industry (weighing) → machine → serial. Stock drops and the unit appears in{' '}
                <strong>Inventory → Demo inventory</strong> with customer &amp; executive details.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Select
                  label="1. Product family *"
                  value={form.familyCode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      familyCode: e.target.value,
                      industryCode: '',
                      productId: '',
                      demoSerialId: '',
                      productInterest: '',
                    })
                  }
                  options={[{ value: '', label: 'Select product…' }, ...HMS_FAMILY_OPTIONS]}
                  error={errors.familyCode}
                />
                {form.familyCode === 'WEIGHING_SCALES' ? (
                  <Select
                    label="2. Industry *"
                    value={form.industryCode}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        industryCode: e.target.value,
                        productId: '',
                        demoSerialId: '',
                        productInterest: '',
                      })
                    }
                    options={[
                      { value: '', label: 'Select industry…' },
                      ...industryOptions('WEIGHING_SCALES'),
                    ]}
                    error={errors.industryCode}
                  />
                ) : null}
                <SearchableSelect
                  label={form.familyCode === 'WEIGHING_SCALES' ? '3. Machine *' : '2. Machine *'}
                  value={form.productId}
                  options={productOptions}
                  onChange={(productId) => {
                    const name = productName[productId] ?? ''
                    setForm({
                      ...form,
                      productId,
                      productInterest: name || form.productInterest,
                      demoSerialId: '',
                    })
                  }}
                  placeholder={
                    !form.familyCode
                      ? 'Select product family first…'
                      : form.familyCode === 'WEIGHING_SCALES' && !form.industryCode
                        ? 'Select industry first…'
                        : 'Select machine…'
                  }
                  error={errors.productId}
                />
                <Select
                  label={form.familyCode === 'WEIGHING_SCALES' ? '4. Serial number *' : '3. Serial number *'}
                  value={form.demoSerialId}
                  onChange={(e) => setForm({ ...form, demoSerialId: e.target.value })}
                  options={[
                    {
                      value: '',
                      label: createDemoUnits.length
                        ? 'Select in-stock serial'
                        : form.productId
                          ? 'No stock — add serial in Inventory first'
                          : 'Select machine first',
                    },
                    ...createDemoUnits.map((u) => ({
                      value: u.id,
                      label: `${u.serialNo}${u.stampingDate ? ` · stamped ${formatDate(u.stampingDate)}` : ''}`,
                    })),
                  ]}
                />
                {errors.demoSerialId ? (
                  <p className="text-xs text-accent-red sm:col-span-2">{errors.demoSerialId}</p>
                ) : null}
              </div>
            </div>
          ) : null}
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
        </>
      ) : pageTab === 'list' ? (
        <>
          {/* Hero + billing map */}
          <div className="st-enter mb-4 overflow-hidden rounded-[16px] border border-sky-200/80 bg-gradient-to-br from-[#0B1F3A] via-[#123456] to-[#1e4a7a] text-white shadow-[var(--shadow-card)] dark:border-sky-900/40">
            <div className="relative px-5 py-5 sm:px-6 sm:py-6">
              <div
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sky-400/10"
                aria-hidden
              />
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-200/90">
                    Sales pipeline
                  </div>
                  <h2 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
                    Enquiry → Demo → Convert → Proforma
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-sky-100/85">
                    Sales executives own the lead and demo. When converted / ready to buy,{' '}
                    <strong className="text-white">admin + warehouse</strong> raise a CRM{' '}
                    <strong className="text-white">proforma</strong>. Final GST tax invoice &amp; collection stay in{' '}
                    <strong className="text-white">Tally</strong> — sales never invoices.
                  </p>
                </div>
                <Button
                  className="st-enter-scale shrink-0 bg-white text-slate-900 hover:bg-sky-50"
                  onClick={() => openCreateEnquiry()}
                >
                  <Plus size={16} /> New sale enquiry
                </Button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { n: '1', t: 'Sales creates lead', d: 'Quoted price on enquiry' },
                  { n: '2', t: 'Demo + DC', d: 'Serial out · daily updates' },
                  { n: '3', t: 'Convert / ready', d: 'Notifies billing team' },
                  { n: '4', t: 'Proforma → Tally', d: 'Warehouse/admin · GST in Tally' },
                ].map((s, i) => (
                  <div
                    key={s.n}
                    className={`st-enter-scale rounded-[10px] border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm st-delay-${i + 1}`}
                  >
                    <div className="text-[10px] font-bold text-sky-200">STEP {s.n}</div>
                    <div className="text-sm font-semibold">{s.t}</div>
                    <div className="text-[11px] text-sky-100/75">{s.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KPI strip — clickable filters */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: 'Pending',
                value: statusCounts.NEW,
                icon: Users,
                tint: 'from-blue-500/15 to-blue-500/5 border-blue-200/80 text-accent-blue',
                iconBg: 'bg-blue-600 text-white',
                filter: 'NEW',
              },
              {
                label: 'On demo',
                value: statusCounts.DEMO,
                icon: Package,
                tint: 'from-amber-500/15 to-amber-500/5 border-amber-200/80 text-accent-amber',
                iconBg: 'bg-amber-500 text-white',
                filter: 'DEMO',
              },
              {
                label: 'Converted',
                value: statusCounts.CONVERTED,
                icon: ShieldCheck,
                tint: 'from-emerald-500/15 to-emerald-500/5 border-emerald-200/80 text-accent-green',
                iconBg: 'bg-emerald-600 text-white',
                filter: 'CONVERTED',
              },
              {
                label: 'Not interested',
                value: statusCounts.LOST,
                icon: UserX,
                tint: 'from-slate-500/10 to-slate-500/5 border-slate-200/80 text-text-secondary',
                iconBg: 'bg-slate-600 text-white',
                filter: 'LOST',
              },
            ].map((s, i) => {
              const active = status === s.filter
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setStatus(active ? '' : s.filter)}
                  className={`st-kpi st-enter st-delay-${i + 1} rounded-[14px] border bg-gradient-to-br p-4 text-left shadow-[var(--shadow-card)] ${s.tint} ${
                    active ? 'ring-2 ring-accent-blue/50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${s.iconBg}`}>
                      <s.icon size={18} />
                    </div>
                    <TrendingUp size={14} className="opacity-40" />
                  </div>
                  <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-text-primary">
                    {s.value}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-text-secondary">{s.label}</div>
                </button>
              )
            })}
          </div>

          <Card className="st-enter st-delay-3 mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                size={16}
              />
              <Input
                className="pl-9"
                placeholder="Search leads…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label })),
              ]}
              className="w-full sm:w-44"
            />
            {!isSales && (
              <Select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="w-full sm:w-44"
                options={[
                  { value: '', label: 'All owners' },
                  { value: 'unassigned', label: 'Unassigned' },
                  ...salesOptions,
                ]}
              />
            )}
          </Card>

          <Card padding={false} className="st-enter st-delay-4 overflow-hidden">
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
              <EmptyState
                title="No leads"
                subtitle="Add your first enquiry with full buyer details."
                actionLabel="Add lead"
                onAction={() => openCreateEnquiry()}
              />
            ) : (
              <div className="overflow-x-auto p-4 pt-3">
                {isAdmin && selection.someSelected ? (
                  <BulkActionBar
                    count={selection.selectedCount}
                    noun="lead"
                    busy={busyDelete}
                    onClear={selection.clear}
                    onDelete={() => setConfirm({ ids: selection.selectedIds })}
                  />
                ) : null}
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
                      {['Enquiry ID', 'Customer', 'Product', 'Price', 'Executive', 'Date', 'Status', 'Demo / DC', 'Actions'].map(
                        (h) => (
                          <th key={h} className="px-4 py-3 font-medium">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((lead, rowIdx) => {
                      const id = String(lead.id)
                      const cf = (lead.customFields as Record<string, unknown> | null) ?? {}
                      const productLabel = String(
                        cf.interested_product_name ?? cf.product_interest ?? '—',
                      )
                      const enquiryDate = cf.enquiry_date
                        ? formatDate(String(cf.enquiry_date))
                        : lead.createdAt
                          ? formatDate(String(lead.createdAt))
                          : '—'
                      const enquiryId = formatEnquiryId(lead)
                      return (
                        <tr
                          key={id}
                          className="st-row st-enter cursor-pointer border-t border-border"
                          style={{ animationDelay: `${Math.min(rowIdx, 12) * 35}ms` }}
                          onClick={() => navigate(`/sale-tracking/${id}`)}
                        >
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <SelectCheckbox
                              checked={selection.isSelected(id)}
                              onChange={() => selection.toggle(id)}
                              aria-label={`Select ${String(lead.name)}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-accent-blue">
                            {enquiryId}
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
                            <Badge color={statusBadgeColor(String(lead.status))}>
                              {statusLabel(String(lead.status))}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {cf.demoSerialNo || cf.demoDcNo ? (
                              <div>
                                {cf.demoSerialNo ? <div>{String(cf.demoSerialNo)}</div> : null}
                                {cf.demoDcNo ? (
                                  <div className="text-amber-800 dark:text-amber-200">
                                    {String(cf.demoDcNo)}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-0.5">
                              <ViewIconButton onClick={() => navigate(`/sale-tracking/${id}`)} />
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
        </>
      ) : null}

      <FormPanel
        open={convertOpen}
        accent="theme"
        eyebrow="Leads"
        title="Convert sale"
        subtitle="Creates customer + deal. Demo serial is marked sold. Admin/warehouse raise CRM proforma next — final GST invoice stays in Tally."
        onClose={() => setConvertOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setConvertOpen(false)} />
            <Button onClick={() => void convert()} disabled={convertBusy}>
              {convertBusy ? 'Converting…' : 'Confirm conversion'}
            </Button>
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
            Marks enquiry as Converted, links customer & deal, and finalises the demo serial as sold when applicable.
          </p>
        </div>
      </FormPanel>

      {/* Lead detail opens at /sale-tracking/:id */}




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

      <WhatsAppSendConfirm
        open={Boolean(waPending)}
        payload={waPending?.payload ?? null}
        busy={saving || convertBusy}
        onCancel={() => setWaPending(null)}
        onConfirmSend={() => {
          const run = waPending?.execute
          setWaPending(null)
          if (run) void run(true)
        }}
        onConfirmSkip={() => {
          const run = waPending?.execute
          setWaPending(null)
          if (run) void run(false)
        }}
      />
    </div>
  )
}
