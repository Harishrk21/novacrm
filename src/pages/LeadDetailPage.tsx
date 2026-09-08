import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Package, Phone } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, leadStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { api, ApiClientError, num } from '@/lib/api'
import {
  HMS_FAMILY_OPTIONS,
  industryOptions,
  productCatalogMeta,
} from '@/lib/hmsCatalog'
import { productAttrs, productRequiresStamping } from '@/lib/productCatalog'
import { canAccessErp, canAccessProformaInvoices, isCompanyAdmin, isSalesExecutive } from '@/lib/roles'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'
import { formatEnquiryId } from '@/lib/serviceId'
import {
  challanFromCustomFields,
  buildDeliveryChallanHtml,
  openPrintableDeliveryChallan,
} from '@/lib/deliveryChallanPrint'
import { AiAssistCard } from '@/components/ai/AiAssistCard'

const STATUS_OPTIONS = [
  { value: 'NEW', label: 'Pending' },
  { value: 'DEMO', label: 'Demo' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'LOST', label: 'Closed' },
] as const

function statusLabel(s: string) {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
}

type StockUnitRow = {
  id: string
  serialNo: string
  productId?: string
  stampingDate?: string | null
  product?: {
    name?: string
    sku?: string
    salePrice?: number
    attributes?: Record<string, unknown> | null
  } | null
  warehouse?: { name?: string } | null
}

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isSales = isSalesExecutive(authUser?.role)
  const isAdmin = isCompanyAdmin(authUser?.role)
  const canBill = canAccessProformaInvoices(authUser?.role)
  const companyName = authUser?.tenantName || APP_NAME

  const [lead, setLead] = useState<Record<string, unknown> | null>(null)
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; attributes?: Record<string, unknown> | null }>
  >([])
  const [loading, setLoading] = useState(true)
  const [dailyNote, setDailyNote] = useState('')
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().slice(0, 10))
  const [dailySaving, setDailySaving] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoUnits, setDemoUnits] = useState<StockUnitRow[]>([])
  const [demoFamilyCode, setDemoFamilyCode] = useState('')
  const [demoIndustryCode, setDemoIndustryCode] = useState('')
  const [demoProductFilter, setDemoProductFilter] = useState('')
  const [demoUnitId, setDemoUnitId] = useState('')
  const [demoSaving, setDemoSaving] = useState(false)
  const [demoReturning, setDemoReturning] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnOutcome, setReturnOutcome] = useState<'NOT_INTERESTED' | 'READY_TO_BUY'>(
    'READY_TO_BUY',
  )
  const [returnNotes, setReturnNotes] = useState('')
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertStageId, setConvertStageId] = useState('')
  const [convertBusy, setConvertBusy] = useState(false)
  const [stampingGateOpen, setStampingGateOpen] = useState(false)
  const [pendingStampUnitId, setPendingStampUnitId] = useState('')
  const [dcPreviewOpen, setDcPreviewOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups, productPage] = await Promise.all([
        api.getLead(id),
        api.lookups(),
        api.products({ limit: 500 }),
      ])
      setLead(row)
      setUsers(lookups.users ?? [])
      setStages(lookups.stages ?? [])
      setProducts(
        (productPage.items ?? []).map((p) => ({
          id: String(p.id),
          name: String(p.name),
          sku: String(p.sku ?? ''),
          attributes: (p.attributes as Record<string, unknown> | null) ?? null,
        })),
      )
      const firstStage = lookups.stages?.[0]?.id ?? ''
      setConvertStageId((prev) => prev || firstStage)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load enquiry',
      })
      setLead(null)
    } finally {
      setLoading(false)
    }
  }, [addToast, id])

  useEffect(() => {
    void load()
  }, [load])

  const cf = useMemo(
    () => ((lead?.customFields as Record<string, unknown> | null) ?? {}),
    [lead],
  )
  const challan = useMemo(() => challanFromCustomFields(cf), [cf])
  const status = String(lead?.status ?? 'NEW')
  const updates = useMemo(
    () =>
      Array.isArray(cf.demoDailyUpdates)
        ? (cf.demoDailyUpdates as Array<Record<string, unknown>>)
        : [],
    [cf.demoDailyUpdates],
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

  const demoPickerProducts = useMemo(() => {
    const matching = demoUnits.filter((u) => {
      if (!demoFamilyCode && !demoIndustryCode) return true
      const meta = productCatalogMeta(productAttrs(u.product))
      if (demoFamilyCode && meta.familyCode && meta.familyCode !== demoFamilyCode) return false
      if (demoIndustryCode && meta.industryCode !== demoIndustryCode) return false
      return true
    })
    const ids = new Set(matching.map((u) => u.productId).filter(Boolean) as string[])
    return products
      .filter((p) => ids.has(p.id))
      .map((p) => ({ value: p.id, label: p.name, sublabel: p.sku }))
  }, [demoUnits, products, demoFamilyCode, demoIndustryCode])

  const selectedDemoUnit = filteredDemoUnits.find((u) => u.id === demoUnitId) ?? null

  async function saveDailyUpdate() {
    if (!lead || !dailyNote.trim()) {
      addToast({ type: 'error', message: 'Write today’s activity note' })
      return
    }
    setDailySaving(true)
    try {
      const updated = await api.addLeadDemoUpdate(String(lead.id), {
        note: dailyNote.trim(),
        updateDate: dailyDate,
      })
      setLead(updated)
      setDailyNote('')
      addToast({ type: 'success', message: 'Day update saved — admin notified' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save update',
      })
    } finally {
      setDailySaving(false)
    }
  }

  async function openDemoPicker() {
    if (!lead) return
    try {
      const interestedProductId = String(cf.interested_product_id ?? cf.demoProductId ?? '')
      const units = await api.stockUnits({ status: 'IN_STOCK', limit: 300 })
      const mapped: StockUnitRow[] = (units as Array<Record<string, unknown>>).map((u) => {
        const product = (u.product as Record<string, unknown> | null) ?? null
        return {
          id: String(u.id),
          serialNo: String(u.serialNo),
          productId: String(u.productId ?? ''),
          stampingDate: (u.stampingDate as string | null) ?? null,
          product: product
            ? {
                name: product.name ? String(product.name) : undefined,
                sku: product.sku ? String(product.sku) : undefined,
                salePrice: product.salePrice != null ? num(product.salePrice) : undefined,
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
        message: err instanceof ApiClientError ? err.message : 'Could not load stock',
      })
    }
  }

  async function confirmDemoIssue() {
    if (!lead || !demoUnitId) {
      addToast({ type: 'error', message: 'Select a serial number' })
      return
    }
    setDemoSaving(true)
    try {
      const result = await api.issueLeadDemo(String(lead.id), demoUnitId)
      const next = (result as { lead?: Record<string, unknown> }).lead ?? result
      setLead(next as Record<string, unknown>)
      setDemoOpen(false)
      addToast({ type: 'success', message: 'Demo issued — delivery challan created automatically' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not issue demo',
      })
    } finally {
      setDemoSaving(false)
    }
  }

  async function returnDemo() {
    if (!lead) return
    setDemoReturning(true)
    try {
      const result = await api.returnLeadDemo(String(lead.id), {
        outcome: returnOutcome,
        notes: returnNotes.trim() || undefined,
        stageId: convertStageId || undefined,
      })
      setReturnOpen(false)
      setReturnNotes('')

      if (result.outcome === 'READY_TO_BUY' || result.next === 'invoice') {
        const contactId = String(result.contactId ?? '')
        const productId = String(result.productId ?? cf.demoProductId ?? '')
        const serialNo = String(result.serialNo ?? cf.demoSerialNo ?? '')
        if (canBill && contactId) {
          addToast({
            type: 'success',
            message: 'Customer converted & product added — create proforma invoice next',
          })
          navigate(
            `/erp/invoices?open=1&contactId=${encodeURIComponent(contactId)}&productId=${encodeURIComponent(productId)}&serialNo=${encodeURIComponent(serialNo)}`,
          )
          return
        }
        addToast({
          type: 'success',
          message: contactId
            ? 'Customer converted & product added — billing team notified for proforma'
            : 'Sale converted — billing team notified for proforma',
        })
        if (contactId) {
          navigate(`/contacts/${contactId}`)
          return
        }
      } else {
        addToast({
          type: 'success',
          message: 'Demo returned — enquiry closed (not interested). Admin notified.',
        })
      }

      const nextLead = (result as { lead?: Record<string, unknown> }).lead
      if (nextLead) setLead(nextLead)
      else await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not process demo return',
      })
    } finally {
      setDemoReturning(false)
    }
  }

  async function updateStatus(next: string) {
    if (!lead) return
    if (next === 'CONVERTED') {
      await beginConvert()
      return
    }
    if (next === 'DEMO') {
      if (cf.demoStockUnitId || status === 'DEMO') {
        try {
          const updated = await api.updateLead(String(lead.id), { status: 'DEMO' })
          setLead(updated)
        } catch (err) {
          addToast({
            type: 'error',
            message: err instanceof ApiClientError ? err.message : 'Update failed',
          })
        }
        return
      }
      await openDemoPicker()
      return
    }
    try {
      const updated = await api.updateLead(String(lead.id), { status: next })
      setLead(updated)
      addToast({ type: 'success', message: `Status → ${statusLabel(next)}` })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    }
  }

  async function beginConvert() {
    if (!lead) return
    const unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : ''
    if (unitId) {
      try {
        const unit = await api.getStockUnit(unitId)
        const product = unit.product as Record<string, unknown> | null
        if (productRequiresStamping(product) && !unit.stampingDate) {
          setPendingStampUnitId(unitId)
          setStampingGateOpen(true)
          return
        }
      } catch {
        /* proceed */
      }
    }
    setConvertOpen(true)
  }

  async function convert() {
    if (!lead) return
    setConvertBusy(true)
    try {
      const result = await api.convertLead(String(lead.id), {
        stageId: convertStageId,
        dealName: `${lead.company || lead.name} — Sale`,
        amount: num(cf.budget),
        createAccount: true,
      })
      setConvertOpen(false)
      const contactId = String(
        (result as { contactId?: string; contact?: { id?: string } }).contactId ??
          (result as { contact?: { id?: string } }).contact?.id ??
          '',
      )
      addToast({
        type: 'success',
        message: isSales
          ? 'Converted to customer — admin notified to create invoice & payment'
          : 'Converted to permanent customer',
      })
      if (canBill && contactId) {
        navigate(
          `/erp/invoices?open=1&contactId=${encodeURIComponent(contactId)}&productId=${encodeURIComponent(String(cf.demoProductId ?? cf.interested_product_id ?? ''))}&serialNo=${encodeURIComponent(String(cf.demoSerialNo ?? ''))}`,
        )
        return
      }
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Convert failed',
      })
    } finally {
      setConvertBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-sm text-text-secondary">Loading enquiry…</div>
    )
  }

  if (!lead) {
    return (
      <EmptyState
        title="Enquiry not found"
        subtitle="It may have been deleted or you don’t have access."
        actionLabel="Back to sale tracking"
        onAction={() => navigate('/sale-tracking')}
      />
    )
  }

  const executiveName =
    String(cf.demoExecutiveName ?? '') ||
    users.find((u) => u.id === String(lead.assignedToId ?? ''))?.name ||
    '—'

  const productLabel = String(
    cf.demoProductName ?? cf.interested_product_name ?? cf.product_interest ?? '—',
  )
  const dcHtml = challan ? buildDeliveryChallanHtml(challan, companyName) : ''

  function viewOrPrintDc() {
    if (!challan) return
    setDcPreviewOpen(true)
  }

  function printDc() {
    if (!challan) return
    const ok = openPrintableDeliveryChallan(challan, companyName)
    if (!ok) {
      addToast({ type: 'error', message: 'Could not open print dialog — try again' })
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-base text-accent-blue">{formatEnquiryId(lead)}</span>
            <span>{String(lead.name)}</span>
          </span>
        }
        breadcrumbs={[
          { label: APP_NAME, to: '/' },
          { label: 'Sale tracking', to: '/sale-tracking' },
          { label: String(lead.name) },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/sale-tracking')}>
              <ArrowLeft size={16} /> Back
            </Button>
            {status !== 'DEMO' && status !== 'CONVERTED' && status !== 'LOST' ? (
              <Button variant="outline" onClick={() => void openDemoPicker()}>
                <Package size={16} /> Issue demo
              </Button>
            ) : null}
            {status !== 'CONVERTED' && status !== 'LOST' ? (
              <Button onClick={() => void beginConvert()}>Convert sale</Button>
            ) : null}
          </div>
        }
      />

      {/* Status strip */}
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Badge color={leadStatusColor[status] ?? 'gray'}>{statusLabel(status)}</Badge>
        {!cf.contact_id && status !== 'CONVERTED' ? (
          <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Prospect only — not in Customers until convert
          </span>
        ) : null}
        {status === 'CONVERTED' ? <Badge color="green">Permanent customer</Badge> : null}
        <span className="text-sm text-text-secondary">
          {lead.createdAt ? formatDate(String(lead.createdAt)) : '—'}
          {executiveName !== '—' ? ` · ${executiveName}` : ''}
        </span>
        <div className="ml-auto min-w-[160px]">
          <Select
            value={status === 'CONVERTED' ? 'CONVERTED' : status}
            disabled={status === 'CONVERTED'}
            onChange={(e) => void updateStatus(e.target.value)}
            options={[
              ...STATUS_OPTIONS.filter((o) => o.value !== 'CONVERTED'),
              ...(status === 'CONVERTED' ? [{ value: 'CONVERTED', label: 'Converted' }] : []),
            ]}
          />
        </div>
      </Card>

      {/* At-a-glance facts */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Phone</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            <Phone size={14} className="shrink-0 text-text-secondary" />
            {lead.phone ? formatPhone(String(lead.phone)) : '—'}
          </div>
        </Card>
        <Card className="px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Product</div>
          <div className="mt-1 truncate text-sm font-semibold" title={productLabel}>
            {productLabel}
          </div>
          {(cf.demoCatalogFamily || cf.demoCatalogIndustry) && (
            <div className="mt-0.5 truncate text-xs text-text-secondary">
              {[cf.demoCatalogFamily, cf.demoCatalogIndustry].filter(Boolean).map(String).join(' · ')}
            </div>
          )}
        </Card>
        <Card className="px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Demo serial
          </div>
          <div className="mt-1 font-mono text-sm font-bold">
            {cf.demoSerialNo ? String(cf.demoSerialNo) : '—'}
          </div>
        </Card>
        <Card className="border-amber-200/70 bg-amber-50/40 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Delivery challan
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-amber-900 dark:text-amber-200">
            {challan?.number ?? String(cf.demoDcNo ?? '—')}
          </div>
          {challan ? (
            <div className="mt-1.5 flex flex-wrap gap-3 text-xs font-semibold">
              <button type="button" className="text-accent-blue hover:underline" onClick={viewOrPrintDc}>
                View DC
              </button>
              <button type="button" className="text-accent-blue hover:underline" onClick={printDc}>
                Print DC
              </button>
            </div>
          ) : null}
        </Card>
      </div>

      {/* Details + demo actions */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Enquiry details</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {[
                ['Name', String(lead.name)],
                ['Company / shop', String(lead.company ?? '—')],
                ['Phone', lead.phone ? formatPhone(String(lead.phone)) : '—'],
                [
                  'Customer type',
                  cf.contact_id
                    ? 'Linked existing customer'
                    : String(cf.customer_type ?? 'New prospect'),
                ],
                ['Quoted price', cf.budget != null ? formatCurrency(num(cf.budget)) : '—'],
                ['Buy timeline', String(cf.timeline ?? '—')],
                [
                  'Enquiry date',
                  cf.enquiry_date
                    ? String(cf.enquiry_date).slice(0, 10)
                    : lead.createdAt
                      ? formatDate(String(lead.createdAt))
                      : '—',
                ],
                ['Executive', executiveName],
              ].map(([label, value]) => (
                <tr key={String(label)}>
                  <th className="w-[38%] bg-muted/40 px-4 py-2.5 text-left text-xs font-medium text-text-secondary">
                    {label}
                  </th>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cf.contact_id ? (
            <div className="border-t border-border px-4 py-3">
              <Link
                to={`/contacts/${String(cf.contact_id)}`}
                className="text-sm font-semibold text-accent-blue hover:underline"
              >
                Open customer profile →
              </Link>
            </div>
          ) : null}
          {lead.description ? (
            <div className="border-t border-border px-4 py-3">
              <div className="text-xs font-medium text-text-secondary">Notes</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                {String(lead.description)}
              </p>
            </div>
          ) : null}
        </Card>

        <Card padding={false}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Demo & delivery</h2>
          </div>
          {status === 'DEMO' || cf.demoSerialNo ? (
            <div className="space-y-0">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {[
                    ['Product', String(cf.demoProductName ?? productLabel)],
                    [
                      'Family / industry',
                      [cf.demoCatalogFamily, cf.demoCatalogIndustry].filter(Boolean).map(String).join(' · ') ||
                        '—',
                    ],
                    ['Serial', String(cf.demoSerialNo ?? '—')],
                    ['DC number', challan?.number ?? String(cf.demoDcNo ?? '—')],
                    ['Issued', cf.demoIssuedAt ? formatDate(String(cf.demoIssuedAt)) : '—'],
                    ['Executive', String(cf.demoExecutiveName ?? executiveName)],
                  ].map(([label, value]) => (
                    <tr key={String(label)}>
                      <th className="w-[38%] bg-muted/40 px-4 py-2.5 text-left text-xs font-medium text-text-secondary">
                        {label}
                      </th>
                      <td className="px-4 py-2.5 font-medium text-text-primary">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                {challan ? (
                  <>
                    <Button size="sm" onClick={viewOrPrintDc}>
                      View delivery challan
                    </Button>
                    <Button size="sm" variant="outline" onClick={printDc}>
                      Print DC
                    </Button>
                  </>
                ) : null}
                {isAdmin || canAccessErp(authUser?.role) ? (
                  <Link to="/erp/inventory?tab=demo">
                    <Button size="sm" variant="outline">
                      Demo inventory
                    </Button>
                  </Link>
                ) : null}
                {status === 'DEMO' && cf.demoStockUnitId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReturnOutcome('READY_TO_BUY')
                      setReturnNotes('')
                      setReturnOpen(true)
                    }}
                  >
                    Close demo / return
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-3 px-4 py-6">
              <p className="text-sm text-text-secondary">
                No demo unit yet. Issue a serial to generate a delivery challan automatically and move stock to Demo
                inventory.
              </p>
              <Button onClick={() => void openDemoPicker()}>
                <Package size={16} /> Issue demo unit
              </Button>
            </div>
          )}
        </Card>
      </div>

      {status === 'DEMO' ? (
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Daily activity updates</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Day 1, Day 2… — admin sees these on Sale tracking and in notifications.
            </p>
          </div>
          <div className="border-b border-border p-4">
            <AiAssistCard
              title="Sales AI coach"
              subtitle="Suggest only — never auto-converts or invents serials/prices."
              actions={[
                {
                  id: 'demo_coach',
                  label: 'Coach me today',
                  run: () => api.aiSalesAssist({ action: 'demo_coach', leadId: id }),
                },
                {
                  id: 'draft_daily_update',
                  label: 'Draft daily update',
                  run: () =>
                    api.aiSalesAssist({
                      action: 'draft_daily_update',
                      leadId: id,
                      notes: dailyNote || 'Visited customer; waiting feedback',
                    }),
                },
                {
                  id: 'followup_tone',
                  label: 'Follow-up tone',
                  run: () => api.aiSalesAssist({ action: 'followup_tone', leadId: id }),
                },
                {
                  id: 'ready_handoff',
                  label: 'Ready-to-buy handoff',
                  run: () =>
                    api.aiSalesAssist({
                      action: 'ready_handoff',
                      leadId: id,
                      outcome: 'READY_TO_BUY',
                    }),
                },
              ]}
              onApply={(actionId, result) => {
                if (actionId === 'draft_daily_update' && typeof result.updateText === 'string') {
                  setDailyNote(String(result.updateText))
                }
              }}
            />
          </div>
          <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-[160px_1fr_auto]">
            <Input
              label="Date"
              type="date"
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-text-secondary">
                Day {(updates.length || 0) + 1} note *
              </span>
              <textarea
                className="min-h-[42px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
                placeholder="Visited site, customer feedback, next step…"
                value={dailyNote}
                onChange={(e) => setDailyNote(e.target.value)}
              />
            </label>
            <div className="flex items-end">
              <Button
                disabled={dailySaving || !dailyNote.trim()}
                onClick={() => void saveDailyUpdate()}
              >
                {dailySaving ? 'Saving…' : 'Post update'}
              </Button>
            </div>
          </div>
          {updates.length > 0 ? (
            <ul className="divide-y divide-border">
              {updates.map((u, idx) => (
                <li key={String(u.id ?? u.at)} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <Badge color="blue">Day {Number(u.dayNumber ?? updates.length - idx)}</Badge>
                    <span>
                      {String(u.updateDate ?? '').slice(0, 10) || formatDate(String(u.at ?? ''))}
                    </span>
                    {u.authorName ? <span>· {String(u.authorName)}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-text-primary">{String(u.note ?? '')}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-text-secondary">No day updates yet.</p>
          )}
        </Card>
      ) : null}

      <Modal
        open={dcPreviewOpen}
        onClose={() => setDcPreviewOpen(false)}
        title={challan ? `Delivery challan ${challan.number}` : 'Delivery challan'}
        subtitle="Preview below — use Print to save as PDF."
        accent="amber"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setDcPreviewOpen(false)}>
              Close
            </Button>
            <Button onClick={printDc}>Print / Save PDF</Button>
          </>
        }
      >
        {dcHtml ? (
          <iframe
            title="Delivery challan preview"
            srcDoc={dcHtml}
            className="h-[70vh] w-full rounded-lg border border-border bg-white"
          />
        ) : (
          <p className="text-sm text-text-secondary">No delivery challan on this enquiry.</p>
        )}
      </Modal>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Close demo — why is the unit coming back?"
        subtitle="Choose the outcome. This decides stock, customer record, and next steps."
        accent="amber"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button disabled={demoReturning} onClick={() => void returnDemo()}>
              {demoReturning
                ? 'Processing…'
                : returnOutcome === 'READY_TO_BUY'
                  ? 'Convert & open invoice'
                  : 'Return stock & close enquiry'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label
            className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${
              returnOutcome === 'READY_TO_BUY'
                ? 'border-accent-blue bg-accent-blue/5'
                : 'border-border'
            }`}
          >
            <input
              type="radio"
              className="mt-1"
              checked={returnOutcome === 'READY_TO_BUY'}
              onChange={() => setReturnOutcome('READY_TO_BUY')}
            />
            <div>
              <div className="font-semibold text-text-primary">
                Customer is okay — ready to buy / stamp
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                Converts this prospect to a permanent customer, adds the demo product & serial to their
                machines list, marks the unit sold, notifies admin, and opens invoice for this client.
              </p>
            </div>
          </label>

          <label
            className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${
              returnOutcome === 'NOT_INTERESTED'
                ? 'border-accent-red bg-accent-red/5'
                : 'border-border'
            }`}
          >
            <input
              type="radio"
              className="mt-1"
              checked={returnOutcome === 'NOT_INTERESTED'}
              onChange={() => setReturnOutcome('NOT_INTERESTED')}
            />
            <div>
              <div className="font-semibold text-text-primary">Customer not interested</div>
              <p className="mt-1 text-sm text-text-secondary">
                Returns the serial to main stock, marks the enquiry as closed (not interested), and
                notifies admin.
              </p>
            </div>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">Note (optional)</span>
            <textarea
              className="min-h-20 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder={
                returnOutcome === 'READY_TO_BUY'
                  ? 'e.g. Ready for stamping, wants invoice this week…'
                  : 'e.g. Price too high / chose another brand…'
              }
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={demoOpen}
        onClose={() => setDemoOpen(false)}
        title="Issue demo product"
        subtitle="Family → industry → machine → serial. Stock drops until sold or returned. DC is created automatically."
        accent="amber"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setDemoOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmDemoIssue()} disabled={demoSaving || !demoUnitId}>
              {demoSaving ? 'Issuing…' : 'Issue demo'}
            </Button>
          </>
        }
      >
        {demoUnits.length === 0 ? (
          <p className="text-sm text-text-secondary">No in-stock serials available.</p>
        ) : (
          <div className="space-y-4">
            <Select
              label="1. Product family"
              value={demoFamilyCode}
              onChange={(e) => {
                setDemoFamilyCode(e.target.value)
                setDemoIndustryCode('')
                setDemoProductFilter('')
                setDemoUnitId('')
              }}
              options={[{ value: '', label: 'All families' }, ...HMS_FAMILY_OPTIONS]}
            />
            {demoFamilyCode === 'WEIGHING_SCALES' ? (
              <Select
                label="2. Industry"
                value={demoIndustryCode}
                onChange={(e) => {
                  setDemoIndustryCode(e.target.value)
                  setDemoProductFilter('')
                  setDemoUnitId('')
                }}
                options={[{ value: '', label: 'All industries' }, ...industryOptions(demoFamilyCode)]}
              />
            ) : null}
            <SearchableSelect
              label="Machine (optional)"
              value={demoProductFilter}
              options={[{ value: '', label: 'All matching machines' }, ...demoPickerProducts]}
              onChange={(v) => {
                setDemoProductFilter(v)
                setDemoUnitId('')
              }}
              placeholder="All machines…"
            />
            <Select
              label="Serial number *"
              value={demoUnitId}
              onChange={(e) => setDemoUnitId(e.target.value)}
              options={[
                { value: '', label: 'Select serial' },
                ...filteredDemoUnits.map((u) => ({
                  value: u.id,
                  label: `${u.serialNo} · ${u.product?.name ?? 'Product'}`,
                })),
              ]}
            />
            {selectedDemoUnit ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="font-medium">{selectedDemoUnit.product?.name}</div>
                <div className="font-mono text-xs text-text-secondary">{selectedDemoUnit.serialNo}</div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="Convert sale → permanent customer"
        subtitle={
          isSales
            ? 'Creates the customer record and notifies admin to raise invoice & collect payment.'
            : 'Creates customer + deal. You can raise the invoice next.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void convert()} disabled={convertBusy || !convertStageId}>
              {convertBusy ? 'Converting…' : 'Convert & notify admin'}
            </Button>
          </>
        }
      >
        <Select
          label="Pipeline stage"
          value={convertStageId}
          onChange={(e) => setConvertStageId(e.target.value)}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
        />
      </Modal>

      <ConfirmModal
        open={stampingGateOpen}
        onClose={() => setStampingGateOpen(false)}
        title="Stamping required"
        body="This demo serial needs govt. stamping before convert."
        confirmLabel="Open stamping"
        onConfirm={() => {
          setStampingGateOpen(false)
          navigate(`/stamping?unitId=${encodeURIComponent(pendingStampUnitId)}`)
        }}
      />
    </div>
  )
}
