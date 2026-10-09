import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bell,
  Clock,
  Package,
  FileText,
  MessageSquare,
  Pencil,
  UserRound,
} from 'lucide-react'
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
import {
  HMS_LEAD_PIPELINE,
  HMS_SERVICE_TYPES,
  HMS_WAY_OF_ENQUIRIES,
  enquiryWayFromSourceName,
  leadOrderedProducts,
  leadPipelineLabel,
} from '@/lib/hmsLead'
import { OrderedProductsList } from '@/components/sales/OrderedProductsList'
import { LeadSaleSheet } from '@/components/sales/LeadSaleSheet'
import { productAttrs, productRequiresStamping } from '@/lib/productCatalog'
import { canAccessErp, canAccessProformaInvoices, isCompanyAdmin, isSalesExecutive, isServiceDesk } from '@/lib/roles'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'
import { formatEnquiryId } from '@/lib/serviceId'
import {
  challanFromCustomFields,
  saleChallanFromCustomFields,
  buildDeliveryChallanHtml,
  openPrintableDeliveryChallan,
} from '@/lib/deliveryChallanPrint'
import { AiAssistCard } from '@/components/ai/AiAssistCard'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { FlowStepBar } from '@/components/ui/FlowStepBar'
import { cn } from '@/lib/utils'
import { can } from '@/lib/permissions'
import {
  SALES_FLOW_STEPS,
  buildSaleProformaHref,
  resolveSaleRelease,
  saleAllStepsDone,
  saleIsCompleted,
  saleReadyForProforma,
  salesStepBlockers,
  salesStepDoneFlags,
  salesStepSectionId,
  type SalesRequisitionRow,
} from '@/lib/salesFlow'
import { isWarehouse } from '@/lib/roles'

const STATUS_OPTIONS = HMS_LEAD_PIPELINE.map((s) => ({
  value: s.value,
  label: s.label,
}))

function statusLabel(s: string) {
  return leadPipelineLabel(s)
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
  const isDesk = isServiceDesk(authUser?.role)
  const isWh = isWarehouse(authUser?.role)
  const canBill = canAccessProformaInvoices(authUser?.role)
  const canReqWrite = can(authUser?.role, 'requisitions:write')
  const canReqApprove = can(authUser?.role, 'requisitions:approve')
  const canReqFulfill = can(authUser?.role, 'requisitions:fulfill')
  const companyName = authUser?.tenantName || APP_NAME
  const [triageBusy, setTriageBusy] = useState(false)

  const [lead, setLead] = useState<Record<string, unknown> | null>(null)
  const [activities, setActivities] = useState<Array<Record<string, unknown>>>([])
  const [requisition, setRequisition] = useState<SalesRequisitionRow | null>(null)
  const [reqBusy, setReqBusy] = useState(false)
  const [reqConfirmOpen, setReqConfirmOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [lostOpen, setLostOpen] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [lostBusy, setLostBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [payNote, setPayNote] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [saleTotal, setSaleTotal] = useState('')
  const [saleAdvance, setSaleAdvance] = useState('')
  const [paySaving, setPaySaving] = useState(false)
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
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [verifyServiceType, setVerifyServiceType] = useState<
    'SALES' | 'SERVICE' | 'STAMPING' | 'RENTAL'
  >('SALES')
  const [verifyArea, setVerifyArea] = useState('')
  const [verifyRequirement, setVerifyRequirement] = useState('')
  const [verifyValue, setVerifyValue] = useState('')
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [relatedSection, setRelatedSection] = useState<
    'overview' | 'followup' | 'updates' | 'products' | 'demo' | 'requisition'
  >('overview')
  const [detailTab, setDetailTab] = useState<'overview' | 'timeline'>('overview')
  const [followUpDate, setFollowUpDate] = useState('')
  const [reminderAt, setReminderAt] = useState('')
  const [followSaving, setFollowSaving] = useState(false)
  const [leadUpdateNote, setLeadUpdateNote] = useState('')
  const [leadUpdateSaving, setLeadUpdateSaving] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups, productPage, reqRow, actPage] = await Promise.all([
        api.getLead(id),
        api.lookups(),
        api.products({ limit: 200 }).catch(() => ({ items: [] as Record<string, unknown>[] })),
        api.getRequisitionByLead(id).catch(() => null),
        api.activities({ leadId: id, limit: 50 }).catch(() => ({ items: [] as Record<string, unknown>[] })),
      ])
      setLead(row)
      setRequisition((reqRow as SalesRequisitionRow | null) ?? null)
      setActivities((actPage.items ?? []) as Array<Record<string, unknown>>)
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
        message: err instanceof ApiClientError ? err.message : 'Could not load lead',
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

  // Keep payment fields in sync with lead (and requisition advance if higher)
  useEffect(() => {
    const total = Number(cf.salePaymentTotal ?? cf.budget ?? 0)
    const adv = Number(
      requisition?.advanceAmount ?? cf.saleAdvanceAmount ?? 0,
    )
    setSaleTotal(total > 0 ? String(total) : '')
    setSaleAdvance(adv > 0 ? String(adv) : '')
    if (adv > 0 && !payAmount) setPayAmount(String(adv))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate from server row only
  }, [lead?.id, cf.salePaymentTotal, cf.budget, cf.saleAdvanceAmount, requisition?.advanceAmount])
  const needsVerify = cf.verified === false
  const serviceTypeLabel = String(cf.serviceType ?? 'SALES')
  const challan = useMemo(() => challanFromCustomFields(cf), [cf])
  const saleChallan = useMemo(() => {
    const fromReq =
      requisition?.customFields && typeof requisition.customFields === 'object'
        ? saleChallanFromCustomFields(requisition.customFields)
        : null
    return fromReq ?? saleChallanFromCustomFields(cf)
  }, [cf, requisition?.customFields])
  const status = String(lead?.status ?? 'NEW')
  /** Step 3 — customer already on the sale (picker / convert). Not the same as clicking Convert. */
  const readyForBuy = useMemo(
    () =>
      status === 'CONVERTED' ||
      Boolean(lead?.convertedContactId) ||
      Boolean(cf.contact_id),
    [status, lead?.convertedContactId, cf.contact_id],
  )
  const salesFlags = useMemo(
    () => salesStepDoneFlags({ lead, activities, requisition }),
    [lead, activities, requisition],
  )
  const saleStepsComplete = saleAllStepsDone(salesFlags)
  const saleCompleted = saleIsCompleted(lead)
  const releaseSnapshot = resolveSaleRelease(lead, requisition)
  const readyForPi = saleReadyForProforma(lead, requisition)
  const proformaHref =
    lead?.id && readyForPi
      ? buildSaleProformaHref({
          leadId: String(lead.id),
          requisitionId: requisition?.id ?? null,
          contactId: String(
            lead.convertedContactId ?? cf.contact_id ?? '',
          ),
          productId: String(
            requisition?.productId ??
              releaseSnapshot.releaseLines[0]?.productId ??
              cf.demoProductId ??
              '',
          ),
          serialNo: String(
            requisition?.serialNo ??
              releaseSnapshot.releaseLines[0]?.serialNo ??
              cf.demoSerialNo ??
              '',
          ),
          stockUnitId: String(
            requisition?.stockUnitId ??
              releaseSnapshot.releaseLines[0]?.stockUnitId ??
              '',
          ),
          unitPrice:
            Number(cf.salePaymentTotal ?? cf.budget ?? 0) > 0
              ? Number(cf.salePaymentTotal ?? cf.budget)
              : null,
        })
      : null
  const salesActiveStep = useMemo(() => {
    if (saleStepsComplete || saleCompleted) return salesFlags.length - 1
    for (let i = 0; i < salesFlags.length; i++) {
      if (!salesFlags[i]) return i
    }
    return Math.max(0, salesFlags.length - 1)
  }, [salesFlags, saleStepsComplete, saleCompleted])
  const updates = useMemo(
    () =>
      Array.isArray(cf.demoDailyUpdates)
        ? (cf.demoDailyUpdates as Array<Record<string, unknown>>)
        : [],
    [cf.demoDailyUpdates],
  )
  const leadUpdates = useMemo(() => {
    const rows = Array.isArray(cf.leadUpdates)
      ? (cf.leadUpdates as Array<Record<string, unknown>>)
      : []
    return [...rows].reverse()
  }, [cf.leadUpdates])

  const interestedProducts = useMemo(() => leadOrderedProducts(cf), [cf])

  /** Inventory release + stamping (Product 1, Product 2…) from requisition or lead mirror */
  const inventoryRelease = useMemo(() => {
    const fromLead =
      cf.inventoryRelease && typeof cf.inventoryRelease === 'object'
        ? (cf.inventoryRelease as Record<string, unknown>)
        : null
    const reqCf =
      requisition?.customFields && typeof requisition.customFields === 'object'
        ? requisition.customFields
        : null
    const productsRaw =
      fromLead?.products ??
      reqCf?.stampLines ??
      fromLead?.stampLines ??
      cf.inventoryStampProducts
    const products = Array.isArray(productsRaw)
      ? (productsRaw as Array<Record<string, unknown>>).map((p, i) => ({
          index: Number(p.index ?? i + 1),
          label: String(p.label ?? `Product ${i + 1}`),
          stampingRequired:
            typeof p.stampingRequired === 'boolean' ? Boolean(p.stampingRequired) : null,
          stampingDate: p.stampingDate ? String(p.stampingDate) : null,
          nextDueDate: p.nextDueDate ? String(p.nextDueDate) : null,
          confirmed: Boolean(p.confirmed ?? reqCf?.stampingConfirmedAt ?? fromLead?.stampingConfirmedAt),
          serialNo: p.serialNo ? String(p.serialNo) : null,
          hmsUniqId: p.hmsUniqId ? String(p.hmsUniqId) : null,
          stockReduced: Boolean(p.stockReduced),
        }))
      : []
    if (!products.length && (requisition?.productName || fromLead?.productName)) {
      const name = String(requisition?.productName ?? fromLead?.productName ?? '')
      name.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean).forEach((label, i) => {
        products.push({
          index: i + 1,
          label,
          stampingRequired:
            typeof reqCf?.stampingRequired === 'boolean'
              ? Boolean(reqCf.stampingRequired)
              : typeof fromLead?.stampingRequired === 'boolean'
                ? Boolean(fromLead.stampingRequired)
                : null,
          stampingDate: reqCf?.stampingDate
            ? String(reqCf.stampingDate)
            : fromLead?.stampingDate
              ? String(fromLead.stampingDate)
              : null,
          nextDueDate: reqCf?.nextDueDate
            ? String(reqCf.nextDueDate)
            : fromLead?.nextDueDate
              ? String(fromLead.nextDueDate)
              : null,
          confirmed: Boolean(reqCf?.stampingConfirmedAt || fromLead?.stampingConfirmedAt),
          serialNo: null,
          hmsUniqId: null,
          stockReduced: false,
        })
      })
    }
    return {
      reqNumber: String(requisition?.reqNumber ?? fromLead?.reqNumber ?? cf.inventoryReqNumber ?? ''),
      status: String(requisition?.status ?? fromLead?.status ?? ''),
      serialNo: String(requisition?.serialNo ?? fromLead?.serialNo ?? cf.inventorySerialNo ?? ''),
      hmsUniqId: String(reqCf?.hmsUniqId ?? fromLead?.hmsUniqId ?? ''),
      inventoryNotifiedAt: String(reqCf?.inventoryNotifiedAt ?? fromLead?.inventoryNotifiedAt ?? ''),
      stampingConfirmedAt: String(
        reqCf?.stampingConfirmedAt ?? fromLead?.stampingConfirmedAt ?? cf.inventoryStampingConfirmedAt ?? '',
      ),
      stockReducedAt: String(reqCf?.stockReducedAt ?? fromLead?.stockReducedAt ?? ''),
      shippedAt: String(requisition?.shippedAt ?? fromLead?.shippedAt ?? ''),
      products,
    }
  }, [cf.inventoryRelease, cf.inventoryStampProducts, cf.inventoryReqNumber, cf.inventorySerialNo, cf.inventoryStampingConfirmedAt, requisition])

  const timelineEvents = useMemo(() => {
    const events: Array<{ at: string; message: string; by?: string; type?: string }> = []
    const hist = Array.isArray(cf.timelineHistory)
      ? (cf.timelineHistory as Array<Record<string, unknown>>)
      : []
    for (const h of hist) {
      events.push({
        at: String(h.at ?? ''),
        message: String(h.message ?? ''),
        by: h.by ? String(h.by) : undefined,
        type: h.type ? String(h.type) : 'change',
      })
    }
    for (const u of Array.isArray(cf.leadUpdates) ? (cf.leadUpdates as Array<Record<string, unknown>>) : []) {
      events.push({
        at: String(u.at ?? ''),
        message: `Update: ${String(u.note ?? '')}`,
        by: u.by ? String(u.by) : undefined,
        type: 'update',
      })
    }
    for (const u of updates) {
      events.push({
        at: String(u.at ?? u.updateDate ?? ''),
        message: `Demo day update: ${String(u.note ?? '')}`,
        by: u.authorName ? String(u.authorName) : undefined,
        type: 'demo',
      })
    }
    if (lead?.createdAt) {
      events.push({
        at: String(lead.createdAt),
        message: 'Lead record created',
        type: 'created',
      })
    }
    // de-dupe by at+message
    const seen = new Set<string>()
    return events
      .filter((e) => {
        const k = `${e.at}|${e.message}`
        if (seen.has(k)) return false
        seen.add(k)
        return Boolean(e.message)
      })
      .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
  }, [cf.timelineHistory, cf.leadUpdates, updates, lead?.createdAt])

  const timelineByDate = useMemo(() => {
    const map = new Map<string, typeof timelineEvents>()
    for (const e of timelineEvents) {
      const d = e.at ? formatDate(e.at) : 'Unknown'
      const list = map.get(d) ?? []
      list.push(e)
      map.set(d, list)
    }
    return [...map.entries()]
  }, [timelineEvents])

  async function pushTimeline(
    currentCf: Record<string, unknown>,
    message: string,
    type = 'change',
  ) {
    const prev = Array.isArray(currentCf.timelineHistory)
      ? [...(currentCf.timelineHistory as Array<Record<string, unknown>>)]
      : []
    prev.push({
      type,
      message,
      at: new Date().toISOString(),
      by: authUser?.name ?? 'User',
    })
    return prev
  }

  useEffect(() => {
    setFollowUpDate(cf.follow_up_date ? String(cf.follow_up_date).slice(0, 10) : '')
    setReminderAt(
      cf.reminder_at
        ? String(cf.reminder_at).slice(0, 16)
        : '',
    )
  }, [cf.follow_up_date, cf.reminder_at, lead?.id])

  const sourceName =
    lead?.source && typeof lead.source === 'object'
      ? String((lead.source as { name?: string }).name ?? '')
      : ''
  const enquiryWayLabel =
    HMS_WAY_OF_ENQUIRIES.find((w) => w.code === String(cf.enquiry_way ?? ''))?.label ||
    enquiryWayFromSourceName(sourceName) ||
    sourceName ||
    '—'

  async function saveFollowUp() {
    if (!lead) return
    setFollowSaving(true)
    try {
      const history = await pushTimeline(
        cf,
        `Follow-up set to ${followUpDate || '—'}; reminder ${reminderAt || '—'}`,
        'followup',
      )
      const updated = await api.updateLead(String(lead.id), {
        customFields: {
          ...cf,
          follow_up_date: followUpDate || null,
          reminder_at: reminderAt || null,
          timelineHistory: history,
        },
      })
      setLead(updated)
      addToast({ type: 'success', message: 'Follow-up & reminder saved' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save follow-up',
      })
    } finally {
      setFollowSaving(false)
    }
  }

  async function postLeadUpdate() {
    if (!lead || !leadUpdateNote.trim()) {
      addToast({ type: 'error', message: 'Write an update first' })
      return
    }
    setLeadUpdateSaving(true)
    try {
      const next = [
        ...(Array.isArray(cf.leadUpdates) ? (cf.leadUpdates as Array<Record<string, unknown>>) : []),
        {
          note: leadUpdateNote.trim(),
          at: new Date().toISOString(),
          by: authUser?.name ?? 'User',
          byId: authUser?.id ?? null,
        },
      ]
      const history = await pushTimeline(cf, `Update: ${leadUpdateNote.trim()}`, 'update')
      const updated = await api.updateLead(String(lead.id), {
        customFields: { ...cf, leadUpdates: next, timelineHistory: history },
        description: lead.description
          ? `${String(lead.description)}\n\n[${new Date().toLocaleString()}] ${leadUpdateNote.trim()}`
          : leadUpdateNote.trim(),
      })
      setLead(updated)
      setLeadUpdateNote('')
      addToast({ type: 'success', message: 'Update posted' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not post update',
      })
    } finally {
      setLeadUpdateSaving(false)
    }
  }

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

      if (result.outcome === 'READY_TO_BUY' || result.next === 'requisition' || result.next === 'invoice') {
        const reqErr = (result as { requisitionError?: string | null }).requisitionError
        addToast({
          type: reqErr ? 'warning' : 'success',
          message: reqErr
            ? `Converted — ${reqErr}. Open Sales requisition below.`
            : 'Converted — approve the sales requisition, then inventory reduces stock (proforma after that)',
        })
        setDetailTab('overview')
        setRelatedSection('requisition')
        await load()
        return
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

  async function confirmVerify() {
    if (!id) return
    setVerifyBusy(true)
    try {
      const updated = await api.verifyLead(id, {
        verified: true,
        serviceType: verifyServiceType,
        area: verifyArea.trim() || null,
        requirement: verifyRequirement.trim() || null,
        enquiryValue: verifyValue.trim() ? Number(verifyValue) : null,
      })
      setLead(updated)
      setVerifyOpen(false)
      addToast({ type: 'success', message: 'Lead confirmed — follow-up unlocked' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not verify lead',
      })
    } finally {
      setVerifyBusy(false)
    }
  }

  function requestStatusChange(next: string) {
    if (!lead || next === status) return
    if (next === 'LOST' || next === 'UNQUALIFIED') {
      setLostReason('')
      setLostOpen(true)
      return
    }
    void updateStatus(next)
  }

  async function confirmCloseLead() {
    if (!lead) return
    if (!lostReason.trim()) {
      addToast({ type: 'error', message: 'Enter a reason to close this lead' })
      return
    }
    setLostBusy(true)
    try {
      const reason = lostReason.trim()
      const history = await pushTimeline(
        cf,
        `Lead closed (${statusLabel('LOST')}): ${reason}`,
        'status',
      )
      const updated = await api.updateLead(String(lead.id), {
        status: 'LOST',
        customFields: {
          ...cf,
          lostReason: reason,
          lostAt: new Date().toISOString(),
          lostBy: authUser?.name ?? 'User',
          timelineHistory: history,
        },
      })
      setLead(updated)
      setLostOpen(false)
      setLostReason('')
      addToast({ type: 'success', message: 'Lead closed — admin notified' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not close lead',
      })
    } finally {
      setLostBusy(false)
    }
  }

  async function updateStatus(next: string) {
    if (!lead) return
    if (next === 'CONVERTED') {
      await beginConvert()
      return
    }
    if (next === 'LOST' || next === 'UNQUALIFIED') {
      setLostReason('')
      setLostOpen(true)
      return
    }
    if (next === 'DEMO') {
      if (cf.demoStockUnitId || status === 'DEMO') {
        setStatusBusy(true)
        try {
          const history = await pushTimeline(
            cf,
            `Lead Status was updated from ${statusLabel(status)} to ${statusLabel('DEMO')}`,
            'status',
          )
          const updated = await api.updateLead(String(lead.id), {
            status: 'DEMO',
            customFields: { ...cf, timelineHistory: history },
          })
          setLead(updated)
          addToast({ type: 'success', message: `Status → ${statusLabel('DEMO')}` })
        } catch (err) {
          addToast({
            type: 'error',
            message: err instanceof ApiClientError ? err.message : 'Update failed',
          })
        } finally {
          setStatusBusy(false)
        }
        return
      }
      await openDemoPicker()
      return
    }
    setStatusBusy(true)
    try {
      const history = await pushTimeline(
        cf,
        `Lead Status was updated from ${statusLabel(status)} to ${statusLabel(next)}`,
        'status',
      )
      const updated = await api.updateLead(String(lead.id), {
        status: next,
        customFields: { ...cf, timelineHistory: history },
      })
      setLead(updated)
      addToast({ type: 'success', message: `Status → ${statusLabel(next)}` })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    } finally {
      setStatusBusy(false)
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
      setDetailTab('overview')
      setRelatedSection('requisition')
      const reqErr = String((result as { requisitionError?: string | null }).requisitionError ?? '')
      addToast({
        type: reqErr ? 'warning' : 'success',
        message: reqErr
          ? `Converted — ${reqErr}`
          : 'Converted — sales requisition submitted for admin sign-off',
      })
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

  async function skipDemo() {
    if (!lead) return
    setReqBusy(true)
    try {
      const history = await pushTimeline(cf, 'Demo skipped — proceeding without demo machine', 'demo')
      const updated = await api.updateLead(String(lead.id), {
        customFields: { ...cf, demoSkipped: true, timelineHistory: history },
      })
      setLead(updated)
      addToast({ type: 'success', message: 'Demo skipped' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not skip demo',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function saveSalePayment() {
    if (!lead) return
    const total = Math.max(0, Number(saleTotal) || 0)
    const advance = Math.max(0, Number(saleAdvance) || 0)
    if (advance > total && total > 0) {
      addToast({ type: 'error', message: 'Advance cannot be more than total' })
      return
    }
    setPaySaving(true)
    try {
      const due = Math.max(0, total - advance)
      const updated = await api.updateLead(String(lead.id), {
        customFields: {
          ...cf,
          salePaymentTotal: total || null,
          saleAdvanceAmount: advance || null,
          saleDueAmount: due,
          budget: total || cf.budget || null,
        },
      })
      setLead(updated)
      addToast({ type: 'success', message: 'Payment saved on this sale' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save payment',
      })
    } finally {
      setPaySaving(false)
    }
  }

  function requestSubmitRequisition() {
    if (!lead) return
    setRelatedSection('requisition')
    setReqConfirmOpen(true)
  }

  async function submitRequisition() {
    if (!lead) return
    setReqConfirmOpen(false)
    setReqBusy(true)
    try {
      // Persist latest payment on the lead before raising requisition
      const total = Math.max(0, Number(saleTotal) || Number(cf.salePaymentTotal ?? cf.budget) || 0)
      const advance = Math.max(
        0,
        Number(saleAdvance) || Number(payAmount) || Number(cf.saleAdvanceAmount) || 0,
      )
      if (total > 0 || advance > 0) {
        await api.updateLead(String(lead.id), {
          customFields: {
            ...cf,
            salePaymentTotal: total || null,
            saleAdvanceAmount: advance || null,
            saleDueAmount: Math.max(0, total - advance),
            budget: total || cf.budget || null,
          },
        })
      }
      const row = await api.submitRequisition({
        leadId: String(lead.id),
        advanceAmount: advance || undefined,
        paymentNotes: payNote.trim() || undefined,
      })
      setRequisition(row as SalesRequisitionRow)
      addToast({ type: 'success', message: 'Requisition sent to admin for sign-off' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not submit requisition',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function approveReq() {
    if (!requisition?.id) return
    setReqBusy(true)
    try {
      const row = await api.approveRequisition(String(requisition.id))
      setRequisition(row as SalesRequisitionRow)
      addToast({
        type: 'success',
        message: 'Signed — sales can now notify inventory',
      })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Approve failed',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function rejectReq() {
    if (!requisition?.id || !rejectReason.trim()) return
    setReqBusy(true)
    try {
      const row = await api.rejectRequisition(String(requisition.id), rejectReason.trim())
      setRequisition(row as SalesRequisitionRow)
      setRejectOpen(false)
      setRejectReason('')
      addToast({ type: 'success', message: 'Requisition rejected' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Reject failed',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function fulfillReq(markShipped = false) {
    if (!requisition?.id) return
    setReqBusy(true)
    try {
      const row = await api.fulfillRequisition(String(requisition.id), { markShipped })
      setRequisition(row as SalesRequisitionRow)
      addToast({
        type: 'success',
        message: markShipped
          ? 'Stock reduced, machine on customer, ready to ship — raise proforma when ready'
          : 'Stock reduced — machine added to customer. Create sale DC / proforma next',
      })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Fulfill failed',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function shipReq() {
    if (!requisition?.id) return
    setReqBusy(true)
    try {
      const row = await api.shipRequisition(String(requisition.id))
      setRequisition(row as SalesRequisitionRow)
      addToast({ type: 'success', message: 'Marked ready to ship' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Ship update failed',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function markSaleComplete() {
    if (!lead?.id) return
    if (!saleStepsComplete) {
      addToast({
        type: 'error',
        message: 'Finish all progress steps (including PI/payment) before marking complete',
      })
      return
    }
    setReqBusy(true)
    try {
      const prev =
        lead.customFields && typeof lead.customFields === 'object'
          ? (lead.customFields as Record<string, unknown>)
          : {}
      const updated = await api.updateLead(String(lead.id), {
        ...(status !== 'CONVERTED' && status !== 'LOST' ? { status: 'CONVERTED' } : {}),
        customFields: {
          ...prev,
          saleCompletedAt: new Date().toISOString(),
          saleCompletedBy: authUser?.name ?? 'Sales',
          saleCompletedById: authUser?.id ?? null,
        },
      })
      setLead(updated)
      addToast({
        type: 'success',
        message: 'Sale marked complete — it left My leads. Open the Completed chip to find it.',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not mark sale complete',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function savePaymentNote() {
    if (!requisition?.id || !payNote.trim()) {
      addToast({ type: 'error', message: 'Enter a payment note' })
      return
    }
    setReqBusy(true)
    try {
      const row = await api.requisitionPaymentNote(String(requisition.id), {
        note: payNote.trim(),
        amount: payAmount ? Number(payAmount) : undefined,
      })
      setRequisition(row as SalesRequisitionRow)
      setPayNote('')
      setPayAmount('')
      addToast({ type: 'success', message: 'Payment follow-up saved' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save payment note',
      })
    } finally {
      setReqBusy(false)
    }
  }

  async function notifyInventory() {
    if (!requisition?.id) return
    setReqBusy(true)
    try {
      const row = await api.notifyRequisitionInventory(String(requisition.id))
      setRequisition(row as SalesRequisitionRow)
      addToast({ type: 'success', message: 'Inventory notified — they will stamp (if weighing) then reduce stock' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not notify inventory',
      })
    } finally {
      setReqBusy(false)
    }
  }

  function deskMark(next: 'UNQUALIFIED' | 'LOST') {
    if (!lead) return
    if (next === 'LOST') {
      setLostReason('')
      setLostOpen(true)
      return
    }
    void (async () => {
      setTriageBusy(true)
      try {
        await api.statusLead(String(lead.id), next)
        addToast({ type: 'success', message: 'Marked not qualified for service' })
        await load()
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Update failed',
        })
      } finally {
        setTriageBusy(false)
      }
    })()
  }

  async function deskHandoff() {
    if (!lead) return
    const stype = String(cf.serviceType ?? 'SERVICE').toUpperCase()
    if (stype === 'RENTAL' && cf.rentalAgreementId) {
      navigate('/rentals')
      return
    }
    if (cf.serviceTicketId) {
      navigate(`/tickets/${String(cf.serviceTicketId)}`)
      return
    }
    setTriageBusy(true)
    try {
      const area = String(lead.area ?? cf.area ?? '').trim() || null
      const res = await api.prepareLeadHandoff(String(lead.id), { area })
      addToast({
        type: 'success',
        message:
          res.serviceType === 'RENTAL'
            ? `${res.enquiryId ?? formatEnquiryId(lead)} → open Rentals to issue a serial`
            : res.serviceType === 'STAMPING'
              ? `${res.enquiryId ?? formatEnquiryId(lead)} → pick / add machine, then create stamping job`
              : `${res.enquiryId ?? formatEnquiryId(lead)} → pick / add machine, then create service ticket`,
      })
      if (res.href) navigate(res.href)
      else await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not start handoff',
      })
    } finally {
      setTriageBusy(false)
    }
  }

  if (loading) {
    return <DetailSkeleton />
  }

  if (!lead) {
    return (
      <EmptyState
        title="Enquiry not found"
        subtitle="It may have been deleted or you don’t have access."
        actionLabel={isWh ? 'Back to releases' : 'Back to sale tracking'}
        onAction={() => navigate(isWh ? '/erp/releases' : '/sale-tracking')}
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

  function printSaleDc() {
    if (!saleChallan) return
    const ok = openPrintableDeliveryChallan(saleChallan, companyName)
    if (!ok) {
      addToast({ type: 'error', message: 'Could not open print dialog — try again' })
    }
  }

  async function createSaleDcFromSale() {
    if (!requisition?.id) return
    setReqBusy(true)
    try {
      const row = await api.createRequisitionDeliveryChallan(String(requisition.id))
      setRequisition(row as SalesRequisitionRow)
      addToast({ type: 'success', message: 'Sale delivery challan created' })
      await load()
      const cfRow =
        row.customFields && typeof row.customFields === 'object'
          ? (row.customFields as Record<string, unknown>)
          : {}
      const created = saleChallanFromCustomFields(cfRow)
      if (created) openPrintableDeliveryChallan(created, companyName)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create sale DC',
      })
    } finally {
      setReqBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Zoho-style lead header */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-violet-700 dark:text-violet-300">
              <UserRound size={22} />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-xs text-accent-blue">{formatEnquiryId(lead)}</div>
              <h1 className="truncate text-xl font-bold tracking-tight text-text-primary">
                {String(lead.name)}
              </h1>
              <p className="truncate text-sm text-text-secondary">
                {String(lead.company || '—')}
                {executiveName !== '—' ? ` · Owner: ${executiveName}` : ''}
              </p>
              <p className="mt-1 text-[11px] text-text-secondary">
                Visible to sales desk, inventory, and admin
              </p>
              <button
                type="button"
                className="mt-1 text-xs font-medium text-violet-600 hover:underline"
                onClick={() => navigate(isWh ? '/erp/releases' : '/sale-tracking')}
              >
                {isWh ? '← Back to releases' : '← Back to Leads'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {needsVerify ? (
              <Button
                variant="outline"
                onClick={() => {
                  setVerifyServiceType(
                    (['SALES', 'SERVICE', 'STAMPING', 'RENTAL'].includes(String(cf.serviceType))
                      ? String(cf.serviceType)
                      : 'SALES') as 'SALES' | 'SERVICE' | 'STAMPING' | 'RENTAL',
                  )
                  setVerifyArea(String(cf.area ?? lead.area ?? ''))
                  setVerifyRequirement(String(cf.requirement ?? ''))
                  setVerifyValue(cf.enquiryValue != null ? String(cf.enquiryValue) : '')
                  setVerifyOpen(true)
                }}
              >
                Confirm lead
              </Button>
            ) : null}
            {(isDesk || isAdmin) &&
            String(cf.serviceType ?? 'SALES') !== 'SALES' &&
            !['LOST', 'UNQUALIFIED', 'CONVERTED'].includes(status) ? (
              <>
                {String(cf.serviceType).toUpperCase() === 'RENTAL' && cf.rentalAgreementId ? (
                  <Button variant="outline" onClick={() => navigate('/rentals')}>
                    Open rentals
                  </Button>
                ) : cf.serviceTicketId ? (
                  <Button variant="outline" onClick={() => navigate(`/tickets/${String(cf.serviceTicketId)}`)}>
                    Open ticket
                  </Button>
                ) : (
                  <Button disabled={triageBusy || needsVerify} onClick={() => void deskHandoff()}>
                    {String(cf.serviceType).toUpperCase() === 'RENTAL'
                      ? 'Issue rental'
                      : String(cf.serviceType).toUpperCase() === 'STAMPING'
                        ? 'Start stamping job'
                        : 'Start service job'}
                  </Button>
                )}
                {!cf.serviceTicketId && !cf.rentalAgreementId ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={triageBusy}
                      onClick={() => void deskMark('UNQUALIFIED')}
                    >
                      Not qualified
                    </Button>
                    <Button variant="ghost" disabled={triageBusy} onClick={() => void deskMark('LOST')}>
                      Close
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            {status !== 'DEMO' && status !== 'CONVERTED' && status !== 'LOST' && !isDesk && !isWh ? (
              <Button variant="outline" onClick={() => void openDemoPicker()} disabled={needsVerify}>
                <Package size={16} /> Issue demo
              </Button>
            ) : null}
            {status !== 'CONVERTED' && status !== 'LOST' && !isDesk && !isWh && !readyForBuy ? (
              <Button onClick={() => void beginConvert()} disabled={needsVerify}>
                Convert / ready to buy
              </Button>
            ) : null}
            {status !== 'LOST' && status !== 'UNQUALIFIED' && !isDesk && !isWh ? (
              <Button
                variant="outline"
                disabled={statusBusy || lostBusy}
                onClick={() => {
                  setLostReason('')
                  setLostOpen(true)
                }}
              >
                Mark as lost
              </Button>
            ) : null}
            {isWh ? (
              <Button variant="outline" onClick={() => navigate('/erp/releases')}>
                Open releases
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setDetailTab('overview')}>
              <Pencil size={14} /> Overview
            </Button>
          </div>
        </div>

        {/* Overview | Timeline tabs */}
        <div className="flex gap-6 border-b border-border px-5">
          {(
            [
              { id: 'overview' as const, label: 'Overview' },
              { id: 'timeline' as const, label: 'Timeline' },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDetailTab(t.id)}
              className={cn(
                'relative py-3 text-sm font-semibold transition',
                detailTab === t.id
                  ? 'text-violet-700 dark:text-violet-300'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {t.label}
              {detailTab === t.id ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-violet-600" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {detailTab === 'timeline' ? (
        <Card className="p-5">
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
              <Clock size={16} className="text-accent-blue" />
              Timeline
            </h2>
            <span className="text-xs text-text-secondary">{timelineEvents.length} events</span>
          </div>
          {timelineByDate.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-secondary">
              No timeline events yet. Status changes and updates will appear here.
            </p>
          ) : (
            <div className="relative space-y-6 pl-1">
              <div className="absolute bottom-2 left-[15px] top-2 w-px bg-border" aria-hidden />
              {timelineByDate.map(([date, events]) => (
                <div key={date}>
                  <div className="relative z-[1] mb-3 inline-flex rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-text-secondary">
                    {date}
                  </div>
                  <ul className="space-y-4">
                    {events.map((e, i) => {
                      const time = e.at
                        ? new Date(e.at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''
                      return (
                        <li key={`${e.at}-${i}`} className="relative flex gap-3 pl-8">
                          <span className="absolute left-[7px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent-blue" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-text-secondary">{time}</div>
                            <p className="mt-0.5 text-sm text-text-primary">
                              {e.message}
                              {e.by ? (
                                <span className="text-text-secondary"> by {e.by}</span>
                              ) : null}
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <>
      {/* Sale progress — Overview only (not on Timeline) */}
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">Sale progress</h2>
              {saleCompleted ? <Badge color="green">Completed</Badge> : null}
              {!saleCompleted && saleStepsComplete ? (
                <Badge color="blue">All steps done</Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">
              {saleCompleted
                ? `Sale completed${cf.saleCompletedAt ? ` · ${formatDate(String(cf.saleCompletedAt))}` : ''}`
                : saleStepsComplete
                  ? 'All progress steps done — mark sale complete when PI/payment is settled'
                  : `Step ${salesActiveStep + 1} of ${SALES_FLOW_STEPS.length}`}
              {requisition?.reqNumber
                ? ` · ${requisition.reqNumber} (${String(requisition.status ?? '').replaceAll('_', ' ')})`
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!readyForBuy && status !== 'CONVERTED' && status !== 'LOST' && !isDesk && !isWh ? (
              <Button size="sm" disabled={needsVerify} onClick={() => void beginConvert()}>
                Convert / ready to buy
              </Button>
            ) : null}
            {canReqWrite && readyForBuy && (!requisition || requisition.status === 'REJECTED') ? (
              <Button
                size="sm"
                disabled={reqBusy}
                onClick={() => requestSubmitRequisition()}
              >
                {reqBusy ? 'Submitting…' : 'Request requisition'}
              </Button>
            ) : null}
            {canReqApprove && requisition?.status === 'PENDING_APPROVAL' ? (
              <>
                <Button size="sm" disabled={reqBusy} onClick={() => void approveReq()}>
                  Approve & sign
                </Button>
                <Button size="sm" variant="outline" disabled={reqBusy} onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
              </>
            ) : null}
            {canReqWrite && requisition?.status === 'APPROVED' ? (
              <Button size="sm" variant="outline" disabled={reqBusy} onClick={() => void notifyInventory()}>
                Notify inventory
              </Button>
            ) : null}
            {canReqFulfill && requisition?.status === 'APPROVED' ? (
              <Button size="sm" disabled={reqBusy} onClick={() => void fulfillReq(false)}>
                Reduce stock
              </Button>
            ) : null}
            {canReqFulfill &&
            (requisition?.status === 'FULFILLED' || requisition?.status === 'APPROVED') &&
            !requisition.shippedAt ? (
              <Button size="sm" disabled={reqBusy} onClick={() => void shipReq()}>
                Mark ready to ship
              </Button>
            ) : null}
            {canBill && readyForPi && proformaHref ? (
              <Button size="sm" onClick={() => navigate(proformaHref)}>
                Create proforma
              </Button>
            ) : null}
            {canReqWrite && saleStepsComplete && !saleCompleted ? (
              <Button size="sm" disabled={reqBusy} onClick={() => void markSaleComplete()}>
                Mark sale complete
              </Button>
            ) : null}
          </div>
        </div>
        {readyForPi && proformaHref && !saleCompleted ? (
          <div className="rounded-xl border border-sky-300/70 bg-sky-50/70 px-4 py-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
            <div className="font-semibold">Stock sold — next step: CRM proforma</div>
            <p className="mt-0.5 text-xs opacity-90">
              Units below were already picked at reduce-stock (serial / uniq / DC). Create proforma
              from this sale — do not select stock again. Final GST bill stays in Tally.
            </p>
            {releaseSnapshot.releaseLines.length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {releaseSnapshot.releaseLines.map((r, i) => (
                  <li
                    key={String(r.stockUnitId ?? r.serialNo ?? i)}
                    className="flex flex-wrap gap-x-3 font-mono opacity-95"
                  >
                    <span className="font-sans font-semibold">{String(r.label ?? 'Machine')}</span>
                    {r.serialNo ? <span>S/N {String(r.serialNo)}</span> : null}
                    {r.hmsUniqId ? <span>Uniq {String(r.hmsUniqId)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canBill ? (
              <Button size="sm" className="mt-2" onClick={() => navigate(proformaHref)}>
                Create proforma from this sale
              </Button>
            ) : (
              <p className="mt-2 text-xs opacity-80">Sales desk / admin raises the proforma.</p>
            )}
          </div>
        ) : null}
        {saleCompleted ? (
          <div className="rounded-xl border border-emerald-300/70 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            <div className="font-semibold">Sale completed</div>
            <p className="mt-0.5 text-xs opacity-90">
              Stock out, ship, and payment steps are done. This sale stays on the customer record;
              filter Completed on My leads / sale tracking to find it later.
            </p>
          </div>
        ) : null}
        <FlowStepBar
          steps={SALES_FLOW_STEPS}
          doneFlags={salesFlags}
          onStepClick={(i, step) => {
            const blockers = salesStepBlockers(i, salesFlags, {
              status,
              requisition,
              lead,
              role: authUser?.role,
            })
            if (blockers.length && i > salesActiveStep) {
              addToast({ type: 'error', message: blockers[0] })
              return
            }
            if (step.key === 'followup') setRelatedSection('followup')
            else if (step.key === 'ready') setRelatedSection('products')
            else if (step.key === 'requisition' || step.key === 'inventory' || step.key === 'ship' || step.key === 'payment') {
              setRelatedSection('requisition')
            } else setRelatedSection('overview')
            const sectionId = salesStepSectionId(step.key)
            window.setTimeout(() => {
              document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }, 50)
          }}
        />
      </Card>

      {/* Lead status + key facts */}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              Lead status
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {saleCompleted ? (
                <Badge color="green" solid>
                  Completed
                </Badge>
              ) : (
                <Badge color={leadStatusColor[status] ?? 'gray'} solid>
                  {statusLabel(status)}
                </Badge>
              )}
              <Badge color="blue">
                {HMS_SERVICE_TYPES.find((t) => t.value === serviceTypeLabel)?.label ?? serviceTypeLabel}
              </Badge>
              <Badge color="purple">{enquiryWayLabel}</Badge>
              {needsVerify && !saleCompleted ? (
                <Badge color="amber">Needs confirm</Badge>
              ) : null}
              {status === 'CONVERTED' && !saleCompleted ? (
                <Badge color="green">Won · Customer linked</Badge>
              ) : null}
              {status === 'LOST' && cf.lostReason ? (
                <span className="text-xs text-text-secondary">
                  Closed: {String(cf.lostReason)}
                </span>
              ) : null}
              {!cf.contact_id && status !== 'CONVERTED' && status !== 'LOST' ? (
                <span className="text-xs text-amber-800 dark:text-amber-200">
                  Prospect — convert to add customer
                </span>
              ) : null}
              {cf.follow_up_date ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-200">
                  <Bell size={12} /> Follow-up {String(cf.follow_up_date).slice(0, 10)}
                </span>
              ) : null}
            </div>
          </div>
          {status !== 'LOST' && status !== 'UNQUALIFIED' && !isDesk && !saleCompleted ? (
            <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
              {status !== 'CONVERTED' ? (
                <Select
                  label="Update status"
                  value={status}
                  disabled={statusBusy || lostBusy}
                  onChange={(e) => requestStatusChange(e.target.value)}
                  className="min-w-[180px] flex-1 sm:flex-none"
                  options={STATUS_OPTIONS.filter(
                    (s) => s.value !== 'CONVERTED' && s.value !== 'UNQUALIFIED',
                  )}
                />
              ) : (
                <p className="max-w-xs text-xs text-text-secondary">
                  Won / customer linked — if they back out, mark as lost to close.
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={statusBusy || lostBusy}
                onClick={() => {
                  setLostReason('')
                  setLostOpen(true)
                }}
              >
                Mark as lost
              </Button>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Owner', executiveName],
            ['Email', String(lead.email || '—')],
            ['Phone', lead.phone ? formatPhone(String(lead.phone)) : '—'],
            ['Created', lead.createdAt ? formatDate(String(lead.createdAt)) : '—'],
            ['Status', saleCompleted ? 'Completed' : statusLabel(status)],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0">
              <div className="text-[11px] font-medium text-text-secondary">{label}</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-text-primary">{value}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card padding={false} className="h-fit overflow-hidden lg:sticky lg:top-4">
          <div className="border-b border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Sections
          </div>
          <nav className="p-1.5">
            {(
              [
                { id: 'overview' as const, label: 'Sale sheet', icon: FileText },
                { id: 'followup' as const, label: 'Follow-up & reminder', icon: Bell },
                { id: 'updates' as const, label: 'Notes / updates', icon: MessageSquare },
                { id: 'products' as const, label: 'Product details', icon: Package },
                { id: 'demo' as const, label: 'Demo & DC', icon: Package },
                { id: 'requisition' as const, label: 'Sales requisition', icon: FileText },
              ]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRelatedSection(item.id)}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition',
                  relatedSection === item.id
                    ? 'bg-accent-blue/10 font-semibold text-accent-blue shadow-[inset_3px_0_0_0_var(--color-accent-blue)]'
                    : 'text-text-secondary hover:bg-muted/60',
                )}
              >
                <item.icon size={14} />
                {item.label}
              </button>
            ))}
          </nav>
        </Card>

        <div className="min-w-0 space-y-4">
          {relatedSection === 'followup' ? (
            <Card id="section-followup" className="scroll-mt-24">
              <h2 className="mb-3 text-sm font-semibold">Follow-up & reminder</h2>
              <p className="mb-3 text-xs text-text-secondary">
                Saves to Workqueue (Follow-ups due / Tasks) and sends a bell notification to the
                assignee. Reminder time wins if both are set.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Next follow-up date"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
                <Input
                  label="Reminder (date & time)"
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                />
              </div>
              <Button className="mt-4" disabled={followSaving} onClick={() => void saveFollowUp()}>
                {followSaving ? 'Saving…' : 'Save follow-up'}
              </Button>
            </Card>
          ) : null}

          {relatedSection === 'updates' ? (
            <div className="space-y-4">
              {status !== 'LOST' && status !== 'UNQUALIFIED' ? (
                <Card padding={false}>
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-text-primary">Day-wise updates</h2>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      Day 1, Day 2… — posts notify admin and appear on My leads → Daily updates.
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
                            <Badge color="blue">
                              Day {Number(u.dayNumber ?? updates.length - idx)}
                            </Badge>
                            <span>
                              {String(u.updateDate ?? '').slice(0, 10) ||
                                formatDate(String(u.at ?? ''))}
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
              ) : (
                <Card className="p-4">
                  <p className="text-sm text-text-secondary">
                    This lead is closed — day-wise updates are locked.
                  </p>
                </Card>
              )}

              <Card>
                <h2 className="mb-3 text-sm font-semibold">Quick notes</h2>
                <textarea
                  className="min-h-24 w-full rounded-lg border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
                  placeholder="Call connected / quoted / waiting for PO…"
                  value={leadUpdateNote}
                  onChange={(e) => setLeadUpdateNote(e.target.value)}
                />
                <Button
                  className="mt-3"
                  disabled={leadUpdateSaving}
                  onClick={() => void postLeadUpdate()}
                >
                  {leadUpdateSaving ? 'Posting…' : 'Post note'}
                </Button>
                {leadUpdates.length ? (
                  <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto border-t border-border pt-3">
                    {leadUpdates.map((u, i) => (
                      <li
                        key={`${u.at}-${i}`}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                          <Badge color="blue">{String(u.by ?? 'User')}</Badge>
                          <span>{u.at ? formatDate(String(u.at)) : ''}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{String(u.note ?? '')}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-text-secondary">No quick notes yet.</p>
                )}
              </Card>
            </div>
          ) : null}

          {relatedSection === 'requisition' ? (
            <Card id="section-requisition" className="scroll-mt-24 space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Sales requisition</h2>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Admin signs → notify inventory → they confirm stamping & reduce stock. Sales raises PI after ready to ship.
                  </p>
                </div>
                {requisition?.reqNumber ? (
                  <Badge
                    color={
                      requisition.status === 'APPROVED' || requisition.status === 'FULFILLED'
                        ? 'green'
                        : requisition.status === 'REJECTED'
                          ? 'red'
                          : 'amber'
                    }
                  >
                    {requisition.reqNumber} · {String(requisition.status ?? '').replaceAll('_', ' ')}
                  </Badge>
                ) : (
                  <Badge color="gray">Not submitted</Badge>
                )}
              </div>
              <dl className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] text-text-secondary">Customer</dt>
                  <dd className="mt-0.5 text-sm font-medium">{String(lead.name)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-text-secondary">Serial / HMS</dt>
                  <dd className="mt-0.5 font-mono text-xs">
                    {inventoryRelease.serialNo || String(cf.demoSerialNo ?? '—')}
                    {inventoryRelease.hmsUniqId ? ` · HMS ${inventoryRelease.hmsUniqId}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-text-secondary">Payment</dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    Total {formatCurrency(Number(cf.salePaymentTotal ?? cf.budget ?? 0))}
                    {' · '}
                    Adv{' '}
                    {formatCurrency(
                      Number(requisition?.advanceAmount ?? cf.saleAdvanceAmount ?? 0),
                    )}
                    {' · '}
                    Due{' '}
                    {formatCurrency(
                      Math.max(
                        0,
                        Number(cf.salePaymentTotal ?? cf.budget ?? 0) -
                          Number(requisition?.advanceAmount ?? cf.saleAdvanceAmount ?? 0),
                      ),
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-text-secondary">Inventory</dt>
                  <dd className="mt-0.5 text-xs text-text-secondary">
                    {inventoryRelease.inventoryNotifiedAt ? 'Notified · ' : ''}
                    {inventoryRelease.stampingConfirmedAt ? 'Stamping confirmed · ' : ''}
                    {inventoryRelease.stockReducedAt ? 'Stock out · ' : ''}
                    {inventoryRelease.shippedAt ? 'Ready to ship' : '—'}
                  </dd>
                </div>
              </dl>

              {inventoryRelease.products.length ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    Product release & stamping
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {inventoryRelease.products.map((p) => (
                      <div
                        key={`${p.index}-${p.label}`}
                        className="rounded-lg border border-border bg-card px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase text-accent-blue">
                            Product {p.index}
                          </span>
                          {p.confirmed ? (
                            <Badge color={p.stampingRequired ? 'amber' : 'green'}>
                              {p.stampingRequired ? 'Stamping Yes' : 'Stamping No'}
                            </Badge>
                          ) : (
                            <Badge color="gray">Awaiting inventory</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-semibold text-text-primary">{p.label}</p>
                        {p.confirmed && p.stampingRequired ? (
                          <dl className="mt-2 space-y-1 text-xs text-text-secondary">
                            <div className="flex justify-between gap-2">
                              <dt>Stamped date</dt>
                              <dd className="font-medium text-text-primary">
                                {p.stampingDate ? formatDate(p.stampingDate) : '—'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>End / next due</dt>
                              <dd className="font-medium text-text-primary">
                                {p.nextDueDate ? formatDate(p.nextDueDate) : '—'}
                              </dd>
                            </div>
                          </dl>
                        ) : p.confirmed ? (
                          <p className="mt-1 text-xs text-text-secondary">No stamping required for this product.</p>
                        ) : (
                          <p className="mt-1 text-xs text-text-secondary">
                            Inventory will confirm stamping Yes/No after notify.
                          </p>
                        )}
                        {p.stockReduced || p.hmsUniqId || p.serialNo ? (
                          <dl className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-text-secondary">
                            {p.serialNo ? (
                              <div className="flex justify-between gap-2">
                                <dt>Serial</dt>
                                <dd className="font-mono font-medium text-text-primary">{p.serialNo}</dd>
                              </div>
                            ) : null}
                            {p.hmsUniqId ? (
                              <div className="flex justify-between gap-2">
                                <dt>HMS ID</dt>
                                <dd className="font-mono font-medium text-text-primary">{p.hmsUniqId}</dd>
                              </div>
                            ) : null}
                            {p.stockReduced ? (
                              <div className="text-emerald-600">On customer Machines</div>
                            ) : null}
                          </dl>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-secondary">
                  Products:{' '}
                  {String(
                    requisition?.productName ??
                      cf.demoProductName ??
                      cf.interested_product_name ??
                      '—',
                  )}
                </p>
              )}
              {requisition?.rejectedReason ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  Rejected: {String(requisition.rejectedReason)}
                </p>
              ) : null}
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    label="Total ₹"
                    type="number"
                    value={saleTotal}
                    onChange={(e) => setSaleTotal(e.target.value)}
                    placeholder="0"
                  />
                  <Input
                    label="Advance ₹"
                    type="number"
                    value={saleAdvance}
                    onChange={(e) => {
                      setSaleAdvance(e.target.value)
                      setPayAmount(e.target.value)
                    }}
                    placeholder="0"
                  />
                  <div className="rounded-[8px] border border-border bg-card px-3 py-2">
                    <div className="text-xs text-text-secondary">Due (auto)</div>
                    <div className="text-lg font-bold text-accent-amber">
                      {formatCurrency(
                        Math.max(0, (Number(saleTotal) || 0) - (Number(saleAdvance) || 0)),
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Input
                    label="Payment note"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder="Advance received / follow-up…"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={paySaving}
                      onClick={() => void saveSalePayment()}
                    >
                      {paySaving ? 'Saving…' : 'Save payment'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={reqBusy || !requisition?.id || !payNote.trim()}
                      onClick={() => void savePaymentNote()}
                    >
                      Add follow-up
                    </Button>
                  </div>
                </div>
              </div>
              {saleChallan ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/40 px-3 py-2 text-sm dark:border-sky-900/40 dark:bg-sky-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Sale DC{' '}
                      <span className="font-mono font-semibold">{saleChallan.number}</span>
                    </span>
                    <Button size="sm" variant="outline" onClick={printSaleDc}>
                      Print
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {canReqFulfill && requisition?.id && !saleChallan ? (
                  <Button
                    variant="outline"
                    disabled={reqBusy}
                    onClick={() => void createSaleDcFromSale()}
                  >
                    Create sale delivery challan
                  </Button>
                ) : null}
                {canReqWrite && (!requisition || requisition.status === 'REJECTED') ? (
                  <Button disabled={reqBusy} onClick={() => requestSubmitRequisition()}>
                    {reqBusy ? 'Sending…' : 'Send requisition to admin'}
                  </Button>
                ) : null}
                {canReqApprove && requisition?.status === 'PENDING_APPROVAL' ? (
                  <>
                    <Button disabled={reqBusy} onClick={() => void approveReq()}>
                      Approve & sign
                    </Button>
                    <Button variant="outline" disabled={reqBusy} onClick={() => setRejectOpen(true)}>
                      Reject
                    </Button>
                  </>
                ) : null}
                {canReqWrite && requisition?.status === 'APPROVED' ? (
                  <Button disabled={reqBusy} onClick={() => void notifyInventory()}>
                    {requisition.customFields?.inventoryNotifiedAt
                      ? 'Notify inventory again'
                      : 'Notify inventory team'}
                  </Button>
                ) : null}
                {canReqFulfill && requisition?.status === 'APPROVED' ? (
                  <>
                    <Button disabled={reqBusy} onClick={() => void fulfillReq(false)}>
                      Reduce stock
                    </Button>
                    <Button variant="outline" disabled={reqBusy} onClick={() => void fulfillReq(true)}>
                      Reduce + ready to ship
                    </Button>
                  </>
                ) : null}
                {canReqApprove ? (
                  <Button variant="outline" onClick={() => navigate('/sale-tracking?queue=requisitions')}>
                    Open admin requisitions
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          {relatedSection === 'products' ? (
            <Card id="section-ready" className="scroll-mt-24 space-y-4">
              <div>
                <h2 className="mb-3 text-sm font-semibold">Interested products</h2>
                {interestedProducts.length ? (
                  <div className="rounded-lg border border-border px-3 py-2">
                    <OrderedProductsList products={interestedProducts} />
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">No products selected.</p>
                )}
              </div>

              {inventoryRelease.products.length ? (
                <div>
                  <h2 className="mb-2 text-sm font-semibold">Release & stamping (from inventory)</h2>
                  <p className="mb-3 text-xs text-text-secondary">
                    {inventoryRelease.reqNumber
                      ? `${inventoryRelease.reqNumber} · `
                      : ''}
                    Updated when inventory confirms stamping / reduces stock.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {inventoryRelease.products.map((p) => (
                      <div
                        key={`prod-${p.index}-${p.label}`}
                        className="rounded-lg border border-border px-3 py-3 text-sm"
                      >
                        <div className="text-[11px] font-semibold uppercase text-accent-blue">
                          Product {p.index}
                        </div>
                        <div className="mt-0.5 font-semibold">{p.label}</div>
                        <div className="mt-2 space-y-0.5 text-xs text-text-secondary">
                          <div>
                            Stamping:{' '}
                            <span className="font-medium text-text-primary">
                              {!p.confirmed
                                ? 'Pending'
                                : p.stampingRequired
                                  ? 'Yes'
                                  : 'No'}
                            </span>
                          </div>
                          {p.confirmed && p.stampingRequired ? (
                            <>
                              <div>
                                Stamped:{' '}
                                <span className="font-medium text-text-primary">
                                  {p.stampingDate ? formatDate(p.stampingDate) : '—'}
                                </span>
                              </div>
                              <div>
                                End date:{' '}
                                <span className="font-medium text-text-primary">
                                  {p.nextDueDate ? formatDate(p.nextDueDate) : '—'}
                                </span>
                              </div>
                            </>
                          ) : null}
                          {inventoryRelease.serialNo ? (
                            <div>
                              Serial:{' '}
                              <span className="font-mono font-medium text-text-primary">
                                {inventoryRelease.serialNo}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  <tr>
                    <th className="bg-muted/40 px-3 py-2 text-left text-xs text-text-secondary">Notes</th>
                    <td className="px-3 py-2">{String(cf.product_interest ?? '—')}</td>
                  </tr>
                  <tr>
                    <th className="bg-muted/40 px-3 py-2 text-left text-xs text-text-secondary">
                      Quoted price
                    </th>
                    <td className="px-3 py-2">
                      {cf.budget != null ? formatCurrency(num(cf.budget)) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
          ) : null}

          {(relatedSection === 'overview' || relatedSection === 'demo') && (
            <div id="section-enquiry" className="scroll-mt-24 space-y-4">
      <LeadSaleSheet
        enquiryId={formatEnquiryId(lead)}
        customerName={String(lead.name)}
        company={lead.company ? String(lead.company) : null}
        phone={lead.phone ? String(lead.phone) : null}
        area={String(cf.area ?? lead.area ?? '')}
        contactId={
          lead.convertedContactId
            ? String(lead.convertedContactId)
            : cf.contact_id
              ? String(cf.contact_id)
              : null
        }
        ownerName={executiveName}
        serviceType={serviceTypeLabel}
        products={interestedProducts}
        releaseProducts={inventoryRelease.products}
        challanLines={saleChallan?.lines ?? []}
        quoteTotal={Number(cf.salePaymentTotal ?? cf.budget ?? 0)}
        quoteAdvance={Number(requisition?.advanceAmount ?? cf.saleAdvanceAmount ?? 0)}
        saleDcNo={saleChallan?.number ?? (cf.saleDcNo ? String(cf.saleDcNo) : null)}
        reqNumber={inventoryRelease.reqNumber || requisition?.reqNumber || null}
        inventoryStatus={
          inventoryRelease.shippedAt
            ? 'Ready to ship'
            : inventoryRelease.stockReducedAt
              ? 'Stock reduced'
              : inventoryRelease.stampingConfirmedAt
                ? 'Stamping confirmed'
                : inventoryRelease.inventoryNotifiedAt
                  ? 'Notified'
                  : requisition?.reqNumber
                    ? String(requisition.status ?? 'Requisition').replaceAll('_', ' ')
                    : 'Waiting for requisition'
        }
      />

      {readyForPi && proformaHref ? (
        <Card className="space-y-3 border-sky-300/70 bg-sky-50/60 p-4 dark:border-sky-800 dark:bg-sky-950/35">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-sky-950 dark:text-sky-100">
                Create proforma
              </h2>
              <p className="mt-0.5 text-xs text-sky-900/85 dark:text-sky-200/85">
                Stock reduce already locked serial / uniq ID
                {saleChallan?.number || cf.saleDcNo
                  ? ` and DC ${saleChallan?.number ?? String(cf.saleDcNo)}`
                  : ''}
                . Proforma uses these units — no second stock pick.
              </p>
            </div>
            {canBill ? (
              <Button size="sm" onClick={() => navigate(proformaHref)}>
                Create proforma
              </Button>
            ) : null}
          </div>
          {releaseSnapshot.releaseLines.length ? (
            <div className="overflow-x-auto rounded-lg border border-sky-200/70 bg-white/70 dark:border-sky-900/50 dark:bg-black/20">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-sky-100/60 text-[10px] uppercase tracking-wide text-sky-900/70 dark:bg-sky-950/50 dark:text-sky-200/70">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Product</th>
                    <th className="px-3 py-2 font-semibold">Serial</th>
                    <th className="px-3 py-2 font-semibold">Uniq ID</th>
                  </tr>
                </thead>
                <tbody>
                  {releaseSnapshot.releaseLines.map((r, i) => (
                    <tr
                      key={String(r.stockUnitId ?? r.serialNo ?? i)}
                      className="border-t border-sky-100 dark:border-sky-900/40"
                    >
                      <td className="px-3 py-2 font-medium">{String(r.label ?? '—')}</td>
                      <td className="px-3 py-2 font-mono">{String(r.serialNo ?? '—')}</td>
                      <td className="px-3 py-2 font-mono">{String(r.hmsUniqId ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-sky-900/80 dark:text-sky-200/80">
              Sale units will appear here after inventory reduces stock.
            </p>
          )}
        </Card>
      ) : null}

      {relatedSection === 'demo' || cf.demoSerialNo || challan ? (
        <div className="grid gap-3 sm:grid-cols-2">
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
              Demo DC
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
      ) : null}

      <Card id="section-payment" className="scroll-mt-24 space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Payment</h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {isWh
                ? 'Sales desk sets total / advance. Inventory sees the same figures on DC.'
                : 'Set from enquiry — Total / Advance / Due follow the whole sale (requisition & PI).'}
            </p>
          </div>
          {!isWh ? (
            <Button size="sm" disabled={paySaving} onClick={() => void saveSalePayment()}>
              {paySaving ? 'Saving…' : 'Save payment'}
            </Button>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Total ₹"
            type="number"
            value={saleTotal}
            disabled={isWh}
            onChange={(e) => setSaleTotal(e.target.value)}
            placeholder="0"
          />
          <Input
            label="Advance ₹"
            type="number"
            value={saleAdvance}
            disabled={isWh}
            onChange={(e) => {
              setSaleAdvance(e.target.value)
              setPayAmount(e.target.value)
            }}
            placeholder="0"
          />
          <div className="rounded-[8px] border border-border bg-muted/40 px-3 py-2">
            <div className="text-xs text-text-secondary">Due (auto)</div>
            <div className="text-lg font-bold text-accent-amber">
              {formatCurrency(
                Math.max(0, (Number(saleTotal) || 0) - (Number(saleAdvance) || 0)),
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-sky-200/80 bg-sky-50/50 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              Sale delivery challan
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-sky-900 dark:text-sky-200">
              {saleChallan?.number ?? '—'}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              Created by inventory after stock reduce · shown here for sales & warehouse
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {saleChallan ? (
              <Button size="sm" variant="outline" onClick={printSaleDc}>
                View / print sale DC
              </Button>
            ) : canReqFulfill && requisition?.id ? (
              <Button size="sm" disabled={reqBusy} onClick={() => void createSaleDcFromSale()}>
                {reqBusy ? 'Creating…' : 'Create sale DC'}
              </Button>
            ) : (
              <span className="text-xs text-text-secondary">Waiting for inventory after stock out</span>
            )}
          </div>
        </div>
        {saleChallan?.lines?.length ? (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {saleChallan.lines.map((l, i) => (
              <li
                key={`${l.productName}-${i}`}
                className="rounded-md border border-sky-200/60 bg-card/80 px-2.5 py-1.5 text-xs"
              >
                <span className="font-semibold">Product {i + 1}:</span> {l.productName}
                <div className="font-mono text-text-secondary">
                  {l.serialNo ? `S/No ${l.serialNo}` : ''}
                  {l.hmsUniqId ? `${l.serialNo ? ' · ' : ''}HMS ${l.hmsUniqId}` : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* Lead Information 2-col — Zoho style */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Lead Information</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {[
                ['Lead Owner', executiveName],
                ['Lead Name', String(lead.name)],
                ['Company', String(lead.company ?? '—')],
                ['Phone', lead.phone ? formatPhone(String(lead.phone)) : '—'],
                ['Email', String(lead.email ?? '—')],
                ['Service type', serviceTypeLabel],
                ['Way of enquiry / Lead Source', enquiryWayLabel],
                ['Lead Status', saleCompleted ? 'Completed' : statusLabel(status)],
                [
                  'Customer type',
                  cf.contact_id
                    ? 'Linked existing customer'
                    : String(cf.customer_type ?? 'New prospect'),
                ],
                [
                  'Payment',
                  Number(cf.salePaymentTotal ?? cf.budget ?? 0) > 0 ||
                  Number(cf.saleAdvanceAmount ?? 0) > 0
                    ? `Total ${formatCurrency(Number(cf.salePaymentTotal ?? cf.budget ?? 0))} · Adv ${formatCurrency(Number(cf.saleAdvanceAmount ?? 0))} · Due ${formatCurrency(Math.max(0, Number(cf.salePaymentTotal ?? cf.budget ?? 0) - Number(cf.saleAdvanceAmount ?? 0)))}`
                    : '—',
                ],
                ['Area', String(cf.area ?? '—')],
                ['Requirement', String(cf.requirement ?? '—')],
                ['Buy timeline', String(cf.timeline ?? '—')],
                [
                  'Enquiry date',
                  cf.enquiry_date
                    ? String(cf.enquiry_date).slice(0, 10)
                    : lead.createdAt
                      ? formatDate(String(lead.createdAt))
                      : '—',
                ],
                ['Follow-up', cf.follow_up_date ? String(cf.follow_up_date).slice(0, 10) : '—'],
                [
                  'Reminder',
                  cf.reminder_at ? String(cf.reminder_at).replace('T', ' ').slice(0, 16) : '—',
                ],
                ['Website', String(lead.website ?? '—')],
              ].map(([label, value]) => (
                <tr key={String(label)}>
                  <th className="w-[42%] bg-muted/40 px-4 py-2.5 text-left text-xs font-medium text-text-secondary">
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

            </div>
          )}
        </div>
      </div>
        </>
      )}

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
          <p className="text-sm text-text-secondary">No delivery challan on this lead.</p>
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
            ? 'Creates the customer record, then admin must sign the sales requisition before inventory releases stock.'
            : 'Creates customer + deal. Next: admin requisition → inventory stock out → sales PI.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void convert()} disabled={convertBusy || !convertStageId}>
              {convertBusy ? 'Converting…' : 'Convert & request requisition'}
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

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject requisition"
        subtitle="Sales can fix details and resubmit."
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button disabled={reqBusy || !rejectReason.trim()} onClick={() => void rejectReq()}>
              Reject
            </Button>
          </>
        }
      >
        <Input
          label="Reason *"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Missing product / wrong serial / price…"
        />
      </Modal>

      <Modal
        open={lostOpen}
        onClose={() => {
          if (lostBusy) return
          setLostOpen(false)
        }}
        title="Close lead as lost"
        subtitle="Customer backed out or not buying — this updates lead status and notifies admin."
        accent="amber"
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={lostBusy} onClick={() => setLostOpen(false)}>
              Cancel
            </Button>
            <Button disabled={lostBusy || !lostReason.trim()} onClick={() => void confirmCloseLead()}>
              {lostBusy ? 'Closing…' : 'Close lead'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Current status: <span className="font-semibold text-text-primary">{statusLabel(status)}</span>
            {readyForBuy || status === 'CONVERTED'
              ? ' — customer was ready / converted; closing will mark the sale as lost.'
              : null}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">Reason to close *</span>
            <textarea
              className="min-h-[88px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
              placeholder="Price, competitor, delayed project, not interested…"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              autoFocus
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="Confirm portal lead"
        subtitle="IndiaMART / Just Dial and similar sources stay unverified until sales confirms the enquiry is real."
        footer={
          <>
            <Button variant="outline" onClick={() => setVerifyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmVerify()} disabled={verifyBusy}>
              {verifyBusy ? 'Confirming…' : 'Confirm lead'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Service type *"
            value={verifyServiceType}
            onChange={(e) =>
              setVerifyServiceType(e.target.value as 'SALES' | 'SERVICE' | 'STAMPING' | 'RENTAL')
            }
            options={[
              { value: 'SALES', label: 'Sales' },
              { value: 'SERVICE', label: 'Service' },
              { value: 'STAMPING', label: 'Stamping' },
              { value: 'RENTAL', label: 'Rental' },
            ]}
          />
          <Input
            label="Area"
            value={verifyArea}
            onChange={(e) => setVerifyArea(e.target.value)}
            placeholder="City / locality"
          />
          <Input
            label="Enquiry value"
            type="number"
            value={verifyValue}
            onChange={(e) => setVerifyValue(e.target.value)}
            placeholder="Optional amount"
          />
          <Input
            className="sm:col-span-2"
            label="Requirement"
            value={verifyRequirement}
            onChange={(e) => setVerifyRequirement(e.target.value)}
            placeholder="What they asked for"
          />
        </div>
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

      <ConfirmModal
        open={reqConfirmOpen}
        onClose={() => setReqConfirmOpen(false)}
        title="Send requisition to admin?"
        body="This asks admin to sign off before inventory can release stock. Continue?"
        confirmLabel={reqBusy ? 'Sending…' : 'Send requisition'}
        onConfirm={() => void submitRequisition()}
      />
    </div>
  )
}
