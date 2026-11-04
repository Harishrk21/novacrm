import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FlowStepBar } from '@/components/ui/FlowStepBar'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import {
  openPrintableDeliveryChallan,
  parseDeliveryChallan,
} from '@/lib/deliveryChallanPrint'
import {
  INVENTORY_FLOW_STEPS,
  inventoryStepDoneFlags,
  parseProductStampLines,
  preferReleaseActiveLine,
  productMatchesOrderLabel,
  releaseStockProgress,
  suggestStampingRequired,
  type ReleaseOrderLine,
} from '@/lib/inventoryFlow'
import { cn } from '@/lib/utils'
import { stampQuarterFromDate, STAMP_QUARTERS } from '@/lib/hmsCoverage'
import { isWeighingCatalogProduct, productAttrs } from '@/lib/productCatalog'
import { APP_NAME } from '@/lib/branding'
import { can } from '@/lib/permissions'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { formatDate } from '@/lib/utils'

type Queue = 'pending' | 'approved' | 'fulfill' | 'shipped'

type Props = {
  /** pending = admin sign-off; approved/fulfill = warehouse release */
  defaultQueue?: Queue
  title?: string
  subtitle?: string
}

const STOCK_MACHINE_TYPES = [
  { value: 'WEIGHING_SCALES', label: 'Weighing' },
  { value: 'BILLING_MACHINE', label: 'Billing' },
  { value: 'TOUCH_POS', label: 'Touch POS' },
  { value: 'CASH_COUNTING', label: 'Cash Counting' },
  { value: 'OFFICE_AUTOMATION', label: 'Office Automation' },
  { value: 'BILLING_SOFTWARE', label: 'Billing Software' },
] as const

type StockMachineType = (typeof STOCK_MACHINE_TYPES)[number]['value']

type StockPick = {
  id: string
  productId?: string
  serialNo?: string
  hmsUniqId?: string | null
  status?: string
  productName?: string
}

type SaleCustomer = {
  name: string
  customerCode?: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  reqNumber?: string | null
  productHint?: string | null
  leadId?: string | null
}

function productMatchesStockType(p: Record<string, unknown>, type: StockMachineType) {
  const a = productAttrs(p)
  const fam = String(a.catalogFamily ?? '')
  const kind = String(a.catalogKind ?? '')
  if (type === 'CASH_COUNTING') return kind === 'CCM'
  if (type === 'OFFICE_AUTOMATION') return fam === 'OFFICE_AUTOMATION' && kind !== 'CCM'
  return fam === type
}

function inferStockType(p: Record<string, unknown> | null | undefined): StockMachineType | '' {
  if (!p) return ''
  const a = productAttrs(p)
  const fam = String(a.catalogFamily ?? '')
  const kind = String(a.catalogKind ?? '')
  if (kind === 'CCM') return 'CASH_COUNTING'
  if (STOCK_MACHINE_TYPES.some((t) => t.value === fam)) return fam as StockMachineType
  if (isWeighingCatalogProduct(p)) return 'WEIGHING_SCALES'
  return ''
}

/** Guess machine type from ordered product label (Billing vs Weighing). */
function typeFromOrderLabel(label: string): StockMachineType | '' {
  const n = label.toLowerCase()
  if (/bill|pos|touch|ccm|cash count|software/.test(n)) return 'BILLING_MACHINE'
  if (/weigh|scale|balance|platform|ws\b|superstar|jewellery|jewel/.test(n)) return 'WEIGHING_SCALES'
  return ''
}

function customerFromRow(row: Record<string, unknown>): SaleCustomer {
  const lead = row.lead as Record<string, unknown> | null
  const contact = row.contact as Record<string, unknown> | null
  const name = String(contact?.name ?? lead?.name ?? 'Customer')
  const address = [
    contact?.doorNo,
    contact?.street,
    contact?.area ?? lead?.area,
    contact?.city ?? lead?.city,
    contact?.state ?? lead?.state,
    contact?.pincode,
  ]
    .filter(Boolean)
    .map(String)
    .join(', ')
  return {
    name,
    customerCode: contact?.customerCode != null ? String(contact.customerCode) : null,
    company: lead?.company != null ? String(lead.company) : null,
    phone: String(contact?.phone ?? contact?.mobile ?? lead?.phone ?? '') || null,
    email: String(contact?.email ?? lead?.email ?? '') || null,
    address: address || null,
    reqNumber: row.reqNumber != null ? String(row.reqNumber) : null,
    productHint: row.productName != null ? String(row.productName) : null,
    leadId: lead?.id != null ? String(lead.id) : row.leadId != null ? String(row.leadId) : null,
  }
}

type StampLineDraft = {
  label: string
  stampingRequired: boolean
  stampingDate: string
  nextDueDate: string
  /** Govt stamp / VC number — shown when Required = Yes */
  stampingNumber: string
  /** A Jan–Mar · B Apr–Jun · C Jul–Sep · D Oct–Dec — shown when Required = Yes */
  stampingQuarter: '' | 'A' | 'B' | 'C' | 'D'
}

const STAMP_QUARTER_OPTIONS = [
  { value: '', label: 'Select quarter…' },
  ...STAMP_QUARTERS.map((q) => ({
    value: q.code,
    label: `Quarter ${q.code} · ${q.months}`,
  })),
]

function stampingIsConfirmed(cf: Record<string, unknown>): boolean {
  if (cf.stampingSkipped) return true
  if (Array.isArray(cf.stampLines) && cf.stampLines.length) {
    // Multi-product: every line must be confirmed (partial Release & ship merges per tab)
    return (cf.stampLines as Array<{ confirmed?: boolean }>).every((l) => l.confirmed)
  }
  if (cf.stampingConfirmedAt) return true
  return Boolean(cf.stampingDone)
}

/**
 * Warehouse actions — one primary button runs stamp + reduce + DC + ship together.
 * Optional “steps” link keeps the old path for edge cases.
 */
function WarehouseReleaseSteps({
  busy,
  stamped,
  reduced,
  reducedCount,
  needed,
  hasDc,
  dcNo,
  shipped,
  onReleaseAll,
  onStamp,
  onReduce,
  onPrintDc,
  onShip,
}: {
  busy: boolean
  stamped: boolean
  reduced: boolean
  reducedCount: number
  needed: number
  hasDc: boolean
  dcNo: string | null
  shipped: boolean
  onReleaseAll: () => void
  onStamp: () => void
  onReduce: () => void
  onCreateDc: () => void
  onPrintDc: () => void
  onShip: () => void
}) {
  if (shipped) {
    return (
      <div className="flex flex-wrap gap-1">
        {hasDc ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onPrintDc}>
            Print {dcNo || 'DC'}
          </Button>
        ) : null}
        <Badge color="green">Shipped</Badge>
      </div>
    )
  }

  if (reduced && hasDc) {
    return (
      <div className="flex min-w-[200px] flex-col gap-1.5">
        <Button size="sm" disabled={busy} onClick={onShip}>
          Ready to ship
        </Button>
        <p className="text-[10px] leading-snug text-text-secondary">
          Next after DC — pack & mark ready (notifies sales · Shipped tab)
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onPrintDc}>
          Print {dcNo || 'DC'}
        </Button>
      </div>
    )
  }

  if (reduced && !hasDc) {
    return (
      <div className="flex min-w-[200px] flex-col gap-1.5">
        <Button size="sm" disabled={busy} onClick={onReleaseAll}>
          Create DC + ready to ship
        </Button>
        <p className="text-[10px] text-text-secondary">
          Stock reduced · serials on customer Machines — next: sale DC
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-[220px] flex-col gap-1.5">
      <Button size="sm" disabled={busy} onClick={onReleaseAll}>
        {reducedCount > 0
          ? `Finish release (${reducedCount}/${needed})`
          : 'Release & ship'}
      </Button>
      <p className="text-[10px] leading-snug text-text-secondary">
        One screen: stamping Yes/No → pick unit(s) → DC + ready to ship
      </p>
      <details className="text-[10px] text-text-secondary">
        <summary className="cursor-pointer hover:text-accent-blue">Step by step instead</summary>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={onStamp}>
            {stamped ? 'Edit stamp' : '1. Stamp'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !stamped} onClick={onReduce}>
            2. Reduce
          </Button>
        </div>
      </details>
    </div>
  )
}

export function RequisitionsPanel({
  defaultQueue = 'pending',
  title,
  subtitle,
}: Props) {
  const role = useAuthStore((s) => s.user?.role)
  const addToast = useUIStore((s) => s.addToast)
  const canApprove = can(role, 'requisitions:approve')
  const canFulfill = can(role, 'requisitions:fulfill')
  const canViewReqs = can(role, 'requisitions:view')
  const canViewSale = can(role, 'leads:view')
  /** Sales desk has view but not fulfill — still need Release / Shipped tabs. */
  const canBrowseReleaseQueues = canFulfill || canApprove || canViewReqs
  const [searchParams] = useSearchParams()
  const focusReqId = searchParams.get('reqId')
  const autoOpenedReqRef = useRef<string | null>(null)

  const [queue, setQueue] = useState<Queue>(defaultQueue)
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stampOpen, setStampOpen] = useState<string | null>(null)
  const [stampLines, setStampLines] = useState<StampLineDraft[]>([])
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [confirmAction, setConfirmAction] = useState<null | { type: 'approve' | 'ship'; id: string }>(
    null,
  )
  const [pickOpen, setPickOpen] = useState<{
    id: string
    productId?: string | null
    markShipped: boolean
    /** fulfill = reduce only; complete = stamp + reduce + DC + ship in one go */
    mode: 'fulfill' | 'stamp' | 'complete'
    customer: SaleCustomer
    needed: number
    reducedCount: number
    productLabels: string[]
    orderLines: ReleaseOrderLine[]
    /** Current product line that must be reduced now (strict qty) */
    activeLine: ReleaseOrderLine | null
    releaseLines: Array<Record<string, unknown>>
  } | null>(null)
  const [catalogProducts, setCatalogProducts] = useState<Array<Record<string, unknown>>>([])
  const [stockOptions, setStockOptions] = useState<StockPick[]>([])
  const [pickMachineType, setPickMachineType] = useState<StockMachineType | ''>('')
  const [pickProductId, setPickProductId] = useState('')
  const [pickedUnitIds, setPickedUnitIds] = useState<string[]>([])
  const [stockLoading, setStockLoading] = useState(false)

  /** Max units allowed for the active ordered product (e.g. billing qty 1 → strict 1). */
  const activeLineRemaining = pickOpen?.activeLine?.remaining ?? 0

  function togglePickedUnit(id: string) {
    setPickedUnitIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      const max = activeLineRemaining > 0 ? activeLineRemaining : 1
      if (prev.length >= max) {
        addToast({
          type: 'error',
          message:
            max === 1
              ? `Only ${max} unit allowed for “${pickOpen?.activeLine?.label ?? 'this product'}”`
              : `Select exactly ${max} unit(s) for “${pickOpen?.activeLine?.label ?? 'this product'}”`,
        })
        return prev
      }
      return [...prev, id]
    })
  }

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    try {
      const status =
        queue === 'pending'
          ? 'PENDING_APPROVAL'
          : queue === 'approved'
            ? 'APPROVED'
            : 'APPROVED,FULFILLED'
      const [res, pendRes] = await Promise.all([
        api.requisitions({
          limit: 100,
          status,
          ...(queue === 'fulfill' || queue === 'shipped' || queue === 'pending' || queue === 'approved'
            ? { queue }
            : {}),
        }),
        canApprove
          ? api.requisitions({
              limit: 100,
              status: 'PENDING_APPROVAL',
              queue: 'pending',
            })
          : Promise.resolve(null),
      ])
      let rows = res.items ?? []
      if (queue === 'fulfill') {
        rows = rows.filter((r) => !r.shippedAt)
      } else if (queue === 'shipped') {
        rows = rows.filter((r) => Boolean(r.shippedAt))
      }
      setItems(rows)
      if (pendRes) setPendingCount((pendRes.items ?? []).length)
      else if (queue === 'pending') setPendingCount(rows.length)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load requisitions',
      })
      if (!silent) setItems([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [addToast, canApprove, queue])

  useEffect(() => {
    setQueue(defaultQueue)
  }, [defaultQueue])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!focusReqId || loading) return
    const row =
      items.find((r) => String(r.id) === focusReqId) ??
      items.find((r) => String(r.reqNumber ?? '') === focusReqId)
    const rowId = row ? String(row.id) : focusReqId
    const el =
      document.getElementById(`req-row-${rowId}`) ??
      document.getElementById(`req-row-${focusReqId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Deep-link from notifications: open the Sign / approve dialog for pending reqs
    if (
      canApprove &&
      row &&
      String(row.status) === 'PENDING_APPROVAL' &&
      autoOpenedReqRef.current !== rowId
    ) {
      autoOpenedReqRef.current = rowId
      setQueue('pending')
      setConfirmAction({ type: 'approve', id: rowId })
    }
  }, [focusReqId, loading, items, canApprove])

  function openStampConfirm(row: Record<string, unknown>) {
    const id = String(row.id)
    const cf =
      row.customFields && typeof row.customFields === 'object'
        ? (row.customFields as Record<string, unknown>)
        : {}
    const today = new Date().toISOString().slice(0, 10)
    if (Array.isArray(cf.stampLines) && cf.stampLines.length) {
      setStampLines(
        (cf.stampLines as Array<Record<string, unknown>>).map((l) => {
          const date = l.stampingDate ? String(l.stampingDate) : today
          const qRaw = String(l.stampingQuarter ?? cf.stampingQuarter ?? '')
            .trim()
            .toUpperCase()
          const quarter =
            qRaw === 'A' || qRaw === 'B' || qRaw === 'C' || qRaw === 'D'
              ? qRaw
              : stampQuarterFromDate(date)
          return {
            label: String(l.label ?? 'Product'),
            stampingRequired: Boolean(l.stampingRequired),
            stampingDate: date,
            nextDueDate: l.nextDueDate ? String(l.nextDueDate) : '',
            stampingNumber: String(l.stampingNumber ?? l.vcNumber ?? cf.vcNumber ?? ''),
            stampingQuarter: quarter,
          }
        }),
      )
    } else {
      setStampLines(
        parseProductStampLines(row.productName ? String(row.productName) : null).map((label) => {
          const required =
            typeof cf.stampingRequired === 'boolean'
              ? Boolean(cf.stampingRequired)
              : suggestStampingRequired(label)
          const date = cf.stampingDate ? String(cf.stampingDate) : today
          const qRaw = String(cf.stampingQuarter ?? '')
            .trim()
            .toUpperCase()
          const quarter =
            qRaw === 'A' || qRaw === 'B' || qRaw === 'C' || qRaw === 'D'
              ? qRaw
              : stampQuarterFromDate(date)
          return {
            label,
            stampingRequired: required,
            stampingDate: date,
            nextDueDate: cf.nextDueDate ? String(cf.nextDueDate) : '',
            stampingNumber: cf.vcNumber ? String(cf.vcNumber) : '',
            stampingQuarter: quarter,
          }
        }),
      )
    }
    setPickedUnitIds(row.stockUnitId ? [String(row.stockUnitId)] : [])
    setStampOpen(id)
  }

  function applyPickerSelection(
    products: Array<Record<string, unknown>>,
    progress: { activeLine: ReleaseOrderLine | null },
    preferredProductId?: string,
  ) {
    const active = progress.activeLine
    const nextLabel = active?.label ?? ''

    // Prefer catalog product that matches the ordered label
    let nextProductId = preferredProductId || ''
    if (nextProductId) {
      const p = products.find((x) => String(x.id) === nextProductId)
      if (nextLabel && p && !productMatchesOrderLabel(p, nextLabel)) nextProductId = ''
    }
    if (!nextProductId && nextLabel) {
      const match = products.find((p) => productMatchesOrderLabel(p, nextLabel))
      if (match) nextProductId = String(match.id)
    }

    const linked = nextProductId
      ? products.find((p) => String(p.id) === nextProductId)
      : null
    const nextType =
      inferStockType(linked) || (nextLabel ? typeFromOrderLabel(nextLabel) : '') || ''
    setPickProductId(nextProductId)
    setPickMachineType(nextType)
    setPickedUnitIds([])
  }

  /** In-stock unit count matching an ordered product label. */
  function stockCountForOrderLabel(
    label: string,
    products: Array<Record<string, unknown>>,
    units: StockPick[],
  ) {
    const matchingIds = new Set(
      products
        .filter((p) => productMatchesOrderLabel(p, label))
        .map((p) => String(p.id)),
    )
    if (!matchingIds.size) return 0
    return units.filter(
      (u) => matchingIds.has(String(u.productId)) && String(u.status) === 'IN_STOCK',
    ).length
  }

  /** Open one product accordion panel at a time; re-click closes it. */
  function selectReleaseProductTab(lineIndex: number) {
    if (!pickOpen) return
    const line = pickOpen.orderLines.find((l) => l.index === lineIndex)
    if (!line) return
    // Re-click the open row → collapse
    if (pickOpen.activeLine?.index === lineIndex) {
      setPickOpen((prev) => (prev ? { ...prev, activeLine: null } : prev))
      setPickProductId('')
      setPickMachineType('')
      setPickedUnitIds([])
      return
    }
    setPickOpen((prev) => (prev ? { ...prev, activeLine: line } : prev))
    setPickedUnitIds([])
    if (line.done) {
      setPickProductId('')
      setPickMachineType('')
      return
    }
    applyPickerSelection(catalogProducts, { activeLine: line })
  }

  function resolveActiveLineWithStock(
    orderLines: ReleaseOrderLine[],
    products: Array<Record<string, unknown>>,
    units: StockPick[],
    preferred?: ReleaseOrderLine | null,
  ) {
    if (preferred && !preferred.done) {
      const n = stockCountForOrderLabel(preferred.label, products, units)
      if (n > 0) return preferred
    }
    return preferReleaseActiveLine(orderLines, (line) =>
      stockCountForOrderLabel(line.label, products, units),
    )
  }

  function stampIndexForOrderLine(line: ReleaseOrderLine | null | undefined): number {
    if (!line || !stampLines.length) return -1
    const exact = stampLines.findIndex(
      (l) => l.label.trim().toLowerCase() === line.label.trim().toLowerCase(),
    )
    if (exact >= 0) return exact
    if (line.index >= 0 && line.index < stampLines.length) return line.index
    return stampLines.findIndex((l) => {
      const a = l.label.trim().toLowerCase()
      const b = line.label.trim().toLowerCase()
      return Boolean(a && b && (a.includes(b) || b.includes(a)))
    })
  }

  function syncPickOpenProgress(
    prev: NonNullable<typeof pickOpen>,
    progress: ReturnType<typeof releaseStockProgress>,
  ) {
    return {
      ...prev,
      needed: progress.needed,
      reducedCount: progress.reducedCount,
      productLabels: progress.productLabels,
      orderLines: progress.orderLines,
      activeLine: progress.activeLine,
      releaseLines: progress.releaseLines,
    }
  }

  /** One screen: stamp Yes/No → pick unit(s) → reduce + DC + ready to ship */
  async function openReleaseAll(row: Record<string, unknown>) {
    const id = String(row.id)
    const progress = releaseStockProgress(row)
    if (progress.allReduced) {
      const cf =
        row.customFields && typeof row.customFields === 'object'
          ? (row.customFields as Record<string, unknown>)
          : {}
      if (!cf.saleDcNo && !cf.saleDeliveryChallan) {
        await createSaleDc(id)
      }
      if (!row.shippedAt) await ship(id)
      return
    }
    openStampConfirm(row)
    setStampOpen(null)
    setPickedUnitIds([])
    setPickProductId('')
    setPickMachineType('')
    setStockLoading(true)
    try {
      const workspace = await api.inventoryWorkspace()
      const products = workspace.products ?? []
      setCatalogProducts(products)
      const usedUnitIds = new Set(
        progress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
      )
      const units: StockPick[] = (workspace.units ?? [])
        .filter((u) => {
          if (usedUnitIds.has(String(u.id))) return false
          return String(u.status) === 'IN_STOCK'
        })
        .map((u) => {
          const prod = products.find((p) => String(p.id) === String(u.productId))
          return {
            id: String(u.id),
            productId: u.productId ? String(u.productId) : undefined,
            serialNo: u.serialNo ? String(u.serialNo) : undefined,
            hmsUniqId: u.hmsUniqId != null ? String(u.hmsUniqId) : null,
            status: u.status ? String(u.status) : undefined,
            productName: prod?.name ? String(prod.name) : undefined,
          }
        })
      setStockOptions(units)
      const activeLine = resolveActiveLineWithStock(
        progress.orderLines,
        products,
        units,
        progress.activeLine,
      )
      setPickOpen({
        id,
        productId: row.productId ? String(row.productId) : null,
        markShipped: true,
        mode: 'complete',
        customer: customerFromRow(row),
        needed: progress.needed,
        reducedCount: progress.reducedCount,
        productLabels: progress.productLabels,
        orderLines: progress.orderLines,
        activeLine,
        releaseLines: progress.releaseLines,
      })
      applyPickerSelection(products, { activeLine })
    } finally {
      setStockLoading(false)
    }
  }

  async function openStockPicker(row: Record<string, unknown>, markShipped = false) {
    const id = String(row.id)
    const cf =
      row.customFields && typeof row.customFields === 'object'
        ? (row.customFields as Record<string, unknown>)
        : {}
    if (!stampingIsConfirmed(cf)) {
      addToast({
        type: 'error',
        message: 'Confirm stamping (Yes + date, or No) before reducing stock',
      })
      openStampConfirm(row)
      return
    }

    const progress = releaseStockProgress(row)
    if (progress.allReduced) {
      addToast({
        type: 'success',
        message: 'All machines already reduced — create DC / Ready to ship',
      })
      return
    }

    // Only auto-use linked unit for single-machine sales that have nothing reduced yet
    const existing = row.stockUnitId ? String(row.stockUnitId) : ''
    if (existing && progress.needed <= 1 && progress.reducedCount === 0) {
      await fulfill(id, markShipped, existing)
      return
    }

    const customer = customerFromRow(row)
    setPickOpen({
      id,
      productId: row.productId ? String(row.productId) : null,
      markShipped,
      mode: 'fulfill',
      customer,
      needed: progress.needed,
      reducedCount: progress.reducedCount,
      productLabels: progress.productLabels,
      orderLines: progress.orderLines,
      activeLine: progress.activeLine,
      releaseLines: progress.releaseLines,
    })
    setPickedUnitIds([])
    setPickProductId('')
    setPickMachineType('')
    setStockLoading(true)
    try {
      const workspace = await api.inventoryWorkspace()
      const products = workspace.products ?? []
      setCatalogProducts(products)
      applyPickerSelection(
        products,
        progress,
        row.productId && progress.reducedCount === 0 ? String(row.productId) : undefined,
      )

      const usedUnitIds = new Set(
        progress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
      )
      setStockOptions(
        (workspace.units ?? [])
          .filter((u) => {
            const st = String(u.status)
            if (usedUnitIds.has(String(u.id))) return false
            return st === 'IN_STOCK' || st === 'DEMO'
          })
          .map((u) => {
            const prod = products.find((p) => String(p.id) === String(u.productId))
            return {
              id: String(u.id),
              productId: u.productId ? String(u.productId) : undefined,
              serialNo: u.serialNo ? String(u.serialNo) : undefined,
              hmsUniqId: u.hmsUniqId != null ? String(u.hmsUniqId) : null,
              status: u.status ? String(u.status) : undefined,
              productName: prod?.name ? String(prod.name) : undefined,
            }
          }),
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load stock units',
      })
      setStockOptions([])
      setCatalogProducts([])
    } finally {
      setStockLoading(false)
    }
  }

  const pickProductOptions = useMemo(() => {
    const orderLabel = pickOpen?.activeLine?.label ?? ''
    return catalogProducts
      .filter((p) => !pickMachineType || productMatchesStockType(p, pickMachineType))
      .filter((p) => !orderLabel || productMatchesOrderLabel(p, orderLabel))
      .map((p) => {
        const onHand = stockOptions.filter(
          (u) => String(u.productId) === String(p.id) && String(u.status) === 'IN_STOCK',
        ).length
        return {
          value: String(p.id),
          label: String(p.name),
          sublabel: `${p.sku ?? ''}${onHand ? ` · ${onHand} in stock` : ''}`,
        }
      })
  }, [catalogProducts, pickMachineType, stockOptions, pickOpen?.activeLine?.label])

  const pickUnitsForModel = useMemo(() => {
    if (!pickProductId) return [] as StockPick[]
    return stockOptions.filter(
      (u) =>
        String(u.productId) === pickProductId &&
        (String(u.status) === 'IN_STOCK' || String(u.status) === 'DEMO'),
    )
  }, [stockOptions, pickProductId])

  const activeStampIdx = stampIndexForOrderLine(pickOpen?.activeLine)
  const activeStampLine = activeStampIdx >= 0 ? stampLines[activeStampIdx] : null

  const pickIsWeighing = pickMachineType === 'WEIGHING_SCALES'

  async function approve(id: string) {
    setBusyId(id)
    try {
      await api.approveRequisition(id)
      addToast({ type: 'success', message: 'Signed — sales will notify inventory' })
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Approve failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function reject() {
    if (!rejectId || !rejectReason.trim()) return
    setBusyId(rejectId)
    try {
      await api.rejectRequisition(rejectId, rejectReason.trim())
      setRejectId(null)
      setRejectReason('')
      addToast({ type: 'success', message: 'Rejected — sales can resubmit' })
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Reject failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function saveStampConfirm(id: string) {
    for (const line of stampLines) {
      if (line.stampingRequired && !line.stampingNumber.trim()) {
        addToast({
          type: 'error',
          message: `Enter stamping number for "${line.label}" (or set Required = No)`,
        })
        return
      }
      if (line.stampingRequired && !line.stampingDate) {
        addToast({
          type: 'error',
          message: `Enter stamping date for "${line.label}" (or set Required = No)`,
        })
        return
      }
      if (line.stampingRequired && !line.stampingQuarter) {
        addToast({
          type: 'error',
          message: `Select stamping quarter (A–D) for "${line.label}"`,
        })
        return
      }
    }
    const primaryStampNo =
      stampLines.find((l) => l.stampingRequired && l.stampingNumber.trim())?.stampingNumber.trim() ||
      null
    setBusyId(id)
    try {
      await api.recordRequisitionStamping(id, {
        stockUnitId: pickedUnitIds[0] || null,
        vcNumber: primaryStampNo,
        lines: stampLines.map((l) => ({
          label: l.label,
          stampingRequired: l.stampingRequired,
          stampingDate: l.stampingRequired ? l.stampingDate : null,
          nextDueDate: l.stampingRequired && l.nextDueDate ? l.nextDueDate : null,
          stampingNumber:
            l.stampingRequired && l.stampingNumber.trim() ? l.stampingNumber.trim() : null,
          stampingQuarter:
            l.stampingRequired && l.stampingQuarter ? l.stampingQuarter : null,
        })),
      })
      setStampOpen(null)
      addToast({
        type: 'success',
        message: 'Stamping confirmed — you can reduce stock now',
      })
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Stamping confirm failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function fulfill(id: string, markShipped: boolean, stockUnitId?: string) {
    if (busyId === id) return
    setBusyId(id)
    try {
      const updated = await api.fulfillRequisition(id, {
        markShipped,
        ...(stockUnitId ? { stockUnitId } : {}),
      })
      const progress = releaseStockProgress(updated)
      await load({ silent: true })

      if (!progress.allReduced) {
        addToast({
          type: 'success',
          message: `Machine ${progress.reducedCount}/${progress.needed} reduced — pick the next product`,
        })
        // Keep picker open for the next machine on this sale
        setPickOpen((prev) =>
          prev && prev.id === id
            ? syncPickOpenProgress(prev, progress)
            : {
                id,
                markShipped,
                mode: 'fulfill' as const,
                customer: customerFromRow(updated),
                needed: progress.needed,
                reducedCount: progress.reducedCount,
                productLabels: progress.productLabels,
                orderLines: progress.orderLines,
                activeLine: progress.activeLine,
                releaseLines: progress.releaseLines,
              },
        )
        setStockLoading(true)
        try {
          const workspace = await api.inventoryWorkspace()
          const products = workspace.products ?? []
          setCatalogProducts(products)
          applyPickerSelection(products, progress)
          const usedUnitIds = new Set(
            progress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
          )
          setStockOptions(
            (workspace.units ?? [])
              .filter((u) => {
                if (usedUnitIds.has(String(u.id))) return false
                const st = String(u.status)
                return st === 'IN_STOCK' || st === 'DEMO'
              })
              .map((u) => {
                const prod = products.find((p) => String(p.id) === String(u.productId))
                return {
                  id: String(u.id),
                  productId: u.productId ? String(u.productId) : undefined,
                  serialNo: u.serialNo ? String(u.serialNo) : undefined,
                  hmsUniqId: u.hmsUniqId != null ? String(u.hmsUniqId) : null,
                  status: u.status ? String(u.status) : undefined,
                  productName: prod?.name ? String(prod.name) : undefined,
                }
              }),
          )
        } finally {
          setStockLoading(false)
        }
        return
      }

      setPickOpen(null)
      setPickedUnitIds([])
      addToast({
        type: 'success',
        message: markShipped
          ? 'All machines reduced + ready to ship — on customer Machines · sales notified'
          : `All ${progress.needed} machine(s) reduced — create DC / Ready to ship`,
      })
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Stock out failed'
      addToast({ type: 'error', message: msg })
      if (msg.toLowerCase().includes('stamp')) {
        const row = items.find((r) => String(r.id) === id)
        if (row) openStampConfirm(row)
      } else if (
        msg.toLowerCase().includes('serial') ||
        msg.toLowerCase().includes('stock') ||
        msg.toLowerCase().includes('unit')
      ) {
        const row = items.find((r) => String(r.id) === id)
        if (row) void openStockPicker(row, markShipped)
      }
    } finally {
      setBusyId(null)
    }
  }

  async function ship(id: string) {
    setBusyId(id)
    try {
      await api.shipRequisition(id)
      addToast({
        type: 'success',
        message: 'Ready to ship — moved to Shipped tab · sales notified',
      })
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Ship failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function createSaleDc(id: string) {
    setBusyId(id)
    try {
      const row = await api.createRequisitionDeliveryChallan(id)
      setItems((prev) => prev.map((r) => (String(r.id) === id ? { ...r, ...row } : r)))
      const cf =
        row.customFields && typeof row.customFields === 'object'
          ? (row.customFields as Record<string, unknown>)
          : {}
      const challan = parseDeliveryChallan(cf.saleDeliveryChallan)
      addToast({
        type: 'success',
        message: challan
          ? `DC ${challan.number} created with serials — next: Ready to ship`
          : 'Delivery challan created — next: Ready to ship',
      })
      if (challan) openPrintableDeliveryChallan(challan, APP_NAME)
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create delivery challan',
      })
    } finally {
      setBusyId(null)
    }
  }

  function printSaleDc(row: Record<string, unknown>) {
    const cf =
      row.customFields && typeof row.customFields === 'object'
        ? (row.customFields as Record<string, unknown>)
        : {}
    const challan = parseDeliveryChallan(cf.saleDeliveryChallan)
    if (!challan) {
      addToast({ type: 'error', message: 'No sale delivery challan on this release yet' })
      return
    }
    openPrintableDeliveryChallan(challan, APP_NAME)
  }

  async function confirmPick() {
    if (!pickOpen || !pickedUnitIds.length || busyId === pickOpen.id) return
    if (pickOpen.mode === 'complete') {
      await completeReleaseAll()
      return
    }
    const active = pickOpen.activeLine
    if (active && pickedUnitIds.length !== active.remaining) {
      addToast({
        type: 'error',
        message: `“${active.label}” needs exactly ${active.remaining} unit(s)`,
      })
      return
    }
    if (active) {
      const pickedProduct = catalogProducts.find((p) => String(p.id) === pickProductId)
      if (!productMatchesOrderLabel(pickedProduct, active.label)) {
        addToast({
          type: 'error',
          message: `Model must match ordered product “${active.label}”`,
        })
        return
      }
    }
    const id = pickOpen.id
    const markShipped = pickOpen.markShipped
    const ids = [...pickedUnitIds]
    setBusyId(id)
    setPickedUnitIds([])
    try {
      let updated: Record<string, unknown> | null = null
      for (let i = 0; i < ids.length; i++) {
        const isLast = i === ids.length - 1
        updated = (await api.fulfillRequisition(id, {
          markShipped: isLast ? markShipped : false,
          stockUnitId: ids[i],
        })) as Record<string, unknown>
      }
      const progress = releaseStockProgress(updated ?? {})
      await load({ silent: true })
      if (!progress.allReduced) {
        addToast({
          type: 'success',
          message: `Reduced ${ids.length} unit(s) · ${progress.reducedCount}/${progress.needed} — pick next if needed`,
        })
        setPickOpen((prev) =>
          prev && prev.id === id ? syncPickOpenProgress(prev, progress) : prev,
        )
        setStockLoading(true)
        try {
          const workspace = await api.inventoryWorkspace()
          const products = workspace.products ?? []
          setCatalogProducts(products)
          applyPickerSelection(products, progress)
          const usedUnitIds = new Set(
            progress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
          )
          setStockOptions(
            (workspace.units ?? [])
              .filter((u) => {
                if (usedUnitIds.has(String(u.id))) return false
                const st = String(u.status)
                return st === 'IN_STOCK' || st === 'DEMO'
              })
              .map((u) => {
                const prod = products.find((p) => String(p.id) === String(u.productId))
                return {
                  id: String(u.id),
                  productId: u.productId ? String(u.productId) : undefined,
                  serialNo: u.serialNo ? String(u.serialNo) : undefined,
                  hmsUniqId: u.hmsUniqId != null ? String(u.hmsUniqId) : null,
                  status: u.status ? String(u.status) : undefined,
                  productName: prod?.name ? String(prod.name) : undefined,
                }
              }),
          )
        } finally {
          setStockLoading(false)
        }
        return
      }
      setPickOpen(null)
      addToast({
        type: 'success',
        message: markShipped
          ? 'All machines reduced (serials on customer) + ready to ship'
          : `All ${progress.needed} machine(s) reduced — serials on customer Machines · next: Sale DC`,
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Stock out failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  /** True only when every ordered product line is fully reduced — never finish early. */
  function releaseFullyComplete(
    expected: { needed: number; orderLines: ReleaseOrderLine[] },
    progress: ReturnType<typeof releaseStockProgress>,
  ) {
    const expectedUnits = Math.max(
      expected.needed,
      expected.orderLines.reduce((sum, line) => sum + line.qty, 0),
      expected.orderLines.length,
      progress.needed,
    )
    if (progress.releaseLines.length < expectedUnits) return false
    if (progress.reducedCount < expectedUnits) return false
    if (progress.orderLines.some((line) => !line.done)) return false
    // Keep original product list in sync (backend may under-count products)
    for (const line of expected.orderLines) {
      const match =
        progress.orderLines.find(
          (p) =>
            p.index === line.index ||
            p.label.trim().toLowerCase() === line.label.trim().toLowerCase(),
        ) ?? null
      if (!match || !match.done) return false
    }
    return true
  }

  /** Stamp → reduce selected units; only when ALL products done → DC → ready to ship */
  async function completeReleaseAll() {
    if (!pickOpen || pickOpen.mode !== 'complete' || busyId === pickOpen.id) return
    const active = pickOpen.activeLine
    if (!active) {
      addToast({
        type: 'error',
        message: 'Open a product below and reduce it before saving',
      })
      return
    }
    if (active.done) {
      addToast({
        type: 'error',
        message: `“${active.label}” is already done — open the next unfinished product`,
      })
      return
    }
    const remainingProducts = pickOpen.orderLines.filter((l) => !l.done)
    if (remainingProducts.length === 0) {
      addToast({ type: 'error', message: 'All ordered products are already reduced' })
      return
    }
    const need = active.remaining
    if (pickedUnitIds.length !== need) {
      addToast({
        type: 'error',
        message: `“${active.label}” needs exactly ${need} unit(s) — you selected ${pickedUnitIds.length}`,
      })
      return
    }
    const pickedProduct = catalogProducts.find((p) => String(p.id) === pickProductId)
    if (!productMatchesOrderLabel(pickedProduct, active.label)) {
      addToast({
        type: 'error',
        message: `Model must match ordered product “${active.label}”`,
      })
      return
    }
    const stampIdx = stampIndexForOrderLine(active)
    const activeStamp = stampIdx >= 0 ? stampLines[stampIdx] : null
    if (activeStamp?.stampingRequired && !activeStamp.stampingNumber.trim()) {
      addToast({
        type: 'error',
        message: `Enter stamping number for "${activeStamp.label}" (or set Required = No)`,
      })
      return
    }
    if (activeStamp?.stampingRequired && !activeStamp.stampingDate) {
      addToast({
        type: 'error',
        message: `Enter stamping date for "${activeStamp.label}" (or set Required = No)`,
      })
      return
    }
    if (activeStamp?.stampingRequired && !activeStamp.stampingQuarter) {
      addToast({
        type: 'error',
        message: `Select stamping quarter (A–D) for "${activeStamp.label}"`,
      })
      return
    }
    const id = pickOpen.id
    const expectedSnapshot = {
      needed: pickOpen.needed,
      orderLines: pickOpen.orderLines.map((l) => ({ ...l })),
    }
    const ids = pickedUnitIds.slice(0, need)
    const primaryStampNo =
      (activeStamp?.stampingRequired && activeStamp.stampingNumber.trim()
        ? activeStamp.stampingNumber.trim()
        : null) ||
      stampLines.find((l) => l.stampingRequired && l.stampingNumber.trim())?.stampingNumber.trim() ||
      null
    setBusyId(id)
    try {
      // Confirm stamping for this product only — backend merges by label
      const stampPayload =
        activeStamp && stampIdx >= 0
          ? [
              {
                label: activeStamp.label,
                stampingRequired: activeStamp.stampingRequired,
                stampingDate: activeStamp.stampingRequired ? activeStamp.stampingDate : null,
                nextDueDate:
                  activeStamp.stampingRequired && activeStamp.nextDueDate
                    ? activeStamp.nextDueDate
                    : null,
                stampingNumber:
                  activeStamp.stampingRequired && activeStamp.stampingNumber.trim()
                    ? activeStamp.stampingNumber.trim()
                    : null,
                stampingQuarter:
                  activeStamp.stampingRequired && activeStamp.stampingQuarter
                    ? activeStamp.stampingQuarter
                    : null,
              },
            ]
          : stampLines.map((l) => ({
              label: l.label,
              stampingRequired: l.stampingRequired,
              stampingDate: l.stampingRequired ? l.stampingDate : null,
              nextDueDate: l.stampingRequired && l.nextDueDate ? l.nextDueDate : null,
              stampingNumber:
                l.stampingRequired && l.stampingNumber.trim() ? l.stampingNumber.trim() : null,
              stampingQuarter:
                l.stampingRequired && l.stampingQuarter ? l.stampingQuarter : null,
            }))
      await api.recordRequisitionStamping(id, {
        vcNumber: primaryStampNo,
        lines: stampPayload,
      })
      let updated: Record<string, unknown> | null = null
      for (const stockUnitId of ids) {
        updated = (await api.fulfillRequisition(id, {
          markShipped: false,
          stockUnitId,
        })) as Record<string, unknown>
      }
      const progress = releaseStockProgress(updated ?? {})
      // Merge expected product list so a backend under-count cannot finish early
      const mergedOrderLines =
        expectedSnapshot.orderLines.length > progress.orderLines.length
          ? expectedSnapshot.orderLines.map((line) => {
              const hit = progress.orderLines.find(
                (p) =>
                  p.index === line.index ||
                  p.label.trim().toLowerCase() === line.label.trim().toLowerCase(),
              )
              if (!hit) {
                // Count release lines matched to this label after this save
                const releaseHits = progress.releaseLines.filter((r) => {
                  const rel = String(r.label ?? r.productName ?? '')
                    .trim()
                    .toLowerCase()
                  const want = line.label.trim().toLowerCase()
                  return rel === want || rel.includes(want) || want.includes(rel)
                }).length
                const reduced = Math.min(line.qty, Math.max(line.reduced, releaseHits))
                const remaining = Math.max(0, line.qty - reduced)
                return { ...line, reduced, remaining, done: remaining === 0 }
              }
              return { ...line, ...hit, label: line.label, qty: line.qty, index: line.index }
            })
          : progress.orderLines
      const mergedProgress = {
        ...progress,
        orderLines: mergedOrderLines,
        needed: Math.max(
          progress.needed,
          expectedSnapshot.needed,
          mergedOrderLines.reduce((s, l) => s + l.qty, 0),
        ),
        reducedCount: mergedOrderLines.reduce((s, l) => s + l.reduced, 0),
        remaining: mergedOrderLines.reduce((s, l) => s + l.remaining, 0),
        allReduced: mergedOrderLines.every((l) => l.done),
        activeLine: mergedOrderLines.find((l) => !l.done) ?? null,
      }
      const fullyDone = releaseFullyComplete(expectedSnapshot, mergedProgress)

      if (!fullyDone) {
        setPickedUnitIds([])
        const workspace = await api.inventoryWorkspace()
        const products = workspace.products ?? []
        setCatalogProducts(products)
        const usedUnitIds = new Set(
          mergedProgress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
        )
        const units: StockPick[] = (workspace.units ?? [])
          .filter((u) => !usedUnitIds.has(String(u.id)) && String(u.status) === 'IN_STOCK')
          .map((u) => {
            const prod = products.find((p) => String(p.id) === String(u.productId))
            return {
              id: String(u.id),
              productId: u.productId ? String(u.productId) : undefined,
              serialNo: u.serialNo ? String(u.serialNo) : undefined,
              hmsUniqId: u.hmsUniqId != null ? String(u.hmsUniqId) : null,
              status: u.status ? String(u.status) : undefined,
              productName: prod?.name ? String(prod.name) : undefined,
            }
          })
        setStockOptions(units)
        const next = resolveActiveLineWithStock(
          mergedOrderLines,
          products,
          units,
          mergedProgress.activeLine,
        )
        setPickOpen((prev) =>
          prev
            ? {
                ...syncPickOpenProgress(prev, {
                  ...mergedProgress,
                  orderLines: mergedOrderLines,
                  activeLine: next,
                  productLabels: mergedOrderLines.map((l) => l.label),
                }),
                orderLines: mergedOrderLines,
                activeLine: next,
                needed: mergedProgress.needed,
                reducedCount: mergedProgress.reducedCount,
              }
            : prev,
        )
        const left = mergedOrderLines.filter((l) => !l.done).length
        const oosNote =
          next && stockCountForOrderLabel(next.label, products, units) === 0
            ? ` · “${next.label}” has no stock yet — add stock or finish later`
            : ''
        addToast({
          type: 'success',
          message: next
            ? `“${active.label}” saved (${mergedProgress.reducedCount}/${mergedProgress.needed}). Open next: “${next.label}” — ${left} product${left === 1 ? '' : 's'} left${oosNote}`
            : `Saved ${ids.length} · ${mergedProgress.reducedCount}/${mergedProgress.needed} — reduce remaining products before finish`,
        })
        applyPickerSelection(products, { activeLine: next })
        return
      }
      const dcRow = await api.createRequisitionDeliveryChallan(id)
      await api.shipRequisition(id)
      setPickOpen(null)
      setPickedUnitIds([])
      const cf =
        dcRow.customFields && typeof dcRow.customFields === 'object'
          ? (dcRow.customFields as Record<string, unknown>)
          : {}
      const challan = parseDeliveryChallan(cf.saleDeliveryChallan)
      addToast({
        type: 'success',
        message: challan
          ? `Released · DC ${challan.number} · ready to ship — sales notified`
          : 'Released · DC created · ready to ship — sales notified',
      })
      if (challan) openPrintableDeliveryChallan(challan, APP_NAME)
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Release failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card padding={false} className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2
            className={cn(
              'font-semibold',
              queue === 'pending'
                ? 'text-red-800 dark:text-red-200'
                : 'text-text-primary',
            )}
          >
            {title ??
              (queue === 'pending'
                ? 'Awaiting accept'
                : queue === 'shipped'
                  ? 'Shipped releases'
                  : 'Approved for stock release')}
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {queue === 'shipped'
              ? 'Completed releases — DC, machines out, customer, and ship date. Active work stays on Release queue.'
              : subtitle ??
                (queue === 'pending'
                  ? 'Sales requisitions waiting for your sign-off — highlighted in red until you Accept.'
                  : 'One product at a time: stamp → pick unit → reduce. Then DC → Ready to ship.')}
          </p>
          {(queue === 'fulfill' || queue === 'approved') && canFulfill ? (
            <div className="mt-3">
              <FlowStepBar
                steps={INVENTORY_FLOW_STEPS}
                doneFlags={inventoryStepDoneFlags(
                  items[0]
                    ? {
                        status: String(items[0].status),
                        shippedAt: items[0].shippedAt
                          ? String(items[0].shippedAt)
                          : null,
                        serialNo: items[0].serialNo ? String(items[0].serialNo) : null,
                        stockUnitId: items[0].stockUnitId
                          ? String(items[0].stockUnitId)
                          : null,
                        productName: items[0].productName
                          ? String(items[0].productName)
                          : null,
                        customFields:
                          items[0].customFields && typeof items[0].customFields === 'object'
                            ? (items[0].customFields as Record<string, unknown>)
                            : null,
                      }
                    : null,
                )}
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setQueue('pending')}
              className={cn(
                'border-red-400/70 text-red-700 hover:bg-red-50 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-950/40',
                queue === 'pending' &&
                  'border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white dark:border-red-500 dark:bg-red-600 dark:hover:bg-red-700',
              )}
            >
              Awaiting accept
              {pendingCount > 0 ? (
                <span
                  className={cn(
                    'ml-1.5 rounded-full px-1.5 text-[11px] tabular-nums',
                    queue === 'pending'
                      ? 'bg-white/20 text-white'
                      : 'bg-red-500/15 text-red-700 dark:text-red-300',
                  )}
                >
                  {pendingCount}
                </span>
              ) : null}
            </Button>
          ) : null}
          {canBrowseReleaseQueues ? (
            <Button
              size="sm"
              variant={queue === 'approved' || queue === 'fulfill' ? 'primary' : 'outline'}
              onClick={() => setQueue(canFulfill ? 'fulfill' : canApprove ? 'approved' : 'fulfill')}
            >
              Release queue
            </Button>
          ) : null}
          {canBrowseReleaseQueues ? (
            <Button
              size="sm"
              variant={queue === 'shipped' ? 'primary' : 'outline'}
              onClick={() => setQueue('shipped')}
            >
              Shipped
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <p className="p-6 text-sm text-text-secondary">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing in this queue"
          subtitle={
            queue === 'pending'
              ? 'When sales submits a requisition, it lands here in red for your Accept.'
              : queue === 'shipped'
                ? 'After Ready to ship, completed releases appear here with DC and machine details.'
                : 'After sales notifies inventory, approved sales appear here for stamping / stock / delivery.'
          }
        />
      ) : queue === 'shipped' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-surface text-xs text-text-secondary">
              <tr className="border-b border-border">
                {[
                  'Req',
                  'Customer',
                  'Products / machines',
                  'DC',
                  'Shipped',
                  'Actions',
                ].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...items]
                .sort((a, b) => {
                  const ta = a.shippedAt ? new Date(String(a.shippedAt)).getTime() : 0
                  const tb = b.shippedAt ? new Date(String(b.shippedAt)).getTime() : 0
                  return tb - ta
                })
                .map((row) => {
                  const id = String(row.id)
                  const lead = row.lead as { id?: string; name?: string; company?: string } | null
                  const contact = row.contact as {
                    name?: string
                    customerCode?: string
                    phone?: string
                    mobile?: string
                  } | null
                  const cf =
                    row.customFields && typeof row.customFields === 'object'
                      ? (row.customFields as Record<string, unknown>)
                      : {}
                  const progress = releaseStockProgress(row)
                  const releaseLines = progress.releaseLines
                  const focused = focusReqId === id
                  return (
                    <tr
                      key={id}
                      id={`req-row-${id}`}
                      className={
                        focused
                          ? 'border-b border-amber-300 bg-amber-50/70 last:border-0 dark:border-amber-800 dark:bg-amber-950/40'
                          : 'border-b border-border last:border-0'
                      }
                    >
                      <td className="px-3 py-3 align-top">
                        <div className="font-mono text-xs font-semibold text-text-primary">
                          {String(row.reqNumber ?? '—')}
                        </div>
                        <Badge color="green" className="mt-1">
                          Shipped
                        </Badge>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-text-primary">
                          {contact?.name ?? lead?.name ?? 'Customer'}
                        </div>
                        <div className="mt-0.5 text-xs text-text-secondary">
                          {[
                            contact?.customerCode || null,
                            contact?.phone || contact?.mobile || null,
                            lead?.company || null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-text-primary">
                          {String(row.productName ?? '—')}
                        </div>
                        <div className="mt-0.5 text-xs text-text-secondary">
                          {progress.reducedCount}/{progress.needed} machine
                          {progress.needed === 1 ? '' : 's'}
                        </div>
                        {releaseLines.length > 0 ? (
                          <ul className="mt-1.5 space-y-0.5">
                            {releaseLines.map((line, idx) => (
                              <li
                                key={`${String(line.stockUnitId ?? idx)}-${idx}`}
                                className="font-mono text-[11px] text-text-secondary"
                              >
                                {String(line.label ?? `Unit ${idx + 1}`)}
                                {' · '}
                                {line.weighing
                                  ? `HMS ${String(line.hmsUniqId || line.serialNo || '—')}`
                                  : `S/No ${String(line.serialNo || '—')}`}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1 font-mono text-[11px] text-text-secondary">
                            {String(row.serialNo ?? '—')}
                            {cf.hmsUniqId ? ` · HMS ${String(cf.hmsUniqId)}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {cf.saleDcNo ? (
                          <span className="font-mono text-xs font-semibold text-accent-blue">
                            {String(cf.saleDcNo)}
                          </span>
                        ) : (
                          <span className="text-xs text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-text-secondary">
                        {row.shippedAt ? formatDate(String(row.shippedAt)) : '—'}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap gap-1">
                          {cf.saleDcNo || cf.saleDeliveryChallan ? (
                            <Button size="sm" variant="outline" onClick={() => printSaleDc(row)}>
                              Print DC
                            </Button>
                          ) : null}
                          {lead?.id && canViewSale ? (
                            <Link to={`/sale-tracking/${lead.id}`}>
                              <Button size="sm" variant="outline">
                                Open sale
                              </Button>
                            </Link>
                          ) : null}
                          {row.contactId ? (
                            <Link to={`/contacts/${String(row.contactId)}`}>
                              <Button size="sm" variant="ghost">
                                Customer
                              </Button>
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface text-xs text-text-secondary">
              <tr className="border-b border-border">
                {['Req', 'Customer', 'Product', 'Serial', 'Advance', 'Status', 'Work steps'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const id = String(row.id)
                const lead = row.lead as { id?: string; name?: string; company?: string } | null
                const contact = row.contact as { name?: string; customerCode?: string } | null
                const st = String(row.status)
                const cf =
                  row.customFields && typeof row.customFields === 'object'
                    ? (row.customFields as Record<string, unknown>)
                    : {}
                const stockProgress = releaseStockProgress(row)
                const focused = focusReqId === id
                const awaitingAccept = st === 'PENDING_APPROVAL'
                return (
                  <tr
                    key={id}
                    id={`req-row-${id}`}
                    className={cn(
                      'border-b last:border-0',
                      focused
                        ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/40'
                        : awaitingAccept
                          ? 'border-red-200/80 bg-red-50/80 hover:bg-red-50 dark:border-red-900/40 dark:bg-red-950/30 dark:hover:bg-red-950/45'
                          : 'border-border',
                    )}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold">
                      {String(row.reqNumber ?? '—')}
                      <div className="text-[10px] text-text-secondary">
                        {row.createdAt ? formatDate(String(row.createdAt)) : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">
                        {contact?.name ?? lead?.name ?? '—'}
                      </div>
                      <div className="text-[11px] text-text-secondary">
                        {contact?.customerCode ?? lead?.company ?? ''}
                      </div>
                      {lead?.id && canViewSale ? (
                        <Link
                          to={`/sale-tracking/${lead.id}`}
                          className="text-[11px] font-medium text-accent-blue hover:underline"
                        >
                          Open sale
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{String(row.productName ?? '—')}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {String(row.serialNo ?? '—')}
                      {cf.hmsUniqId ? (
                        <div className="text-[10px] text-text-secondary">HMS {String(cf.hmsUniqId)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{Number(row.advanceAmount ?? 0)}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        color={
                          st === 'APPROVED' || st === 'FULFILLED'
                            ? 'green'
                            : st === 'REJECTED'
                              ? 'red'
                              : awaitingAccept
                                ? 'red'
                                : 'amber'
                        }
                        solid={awaitingAccept}
                      >
                        {awaitingAccept ? 'Awaiting accept' : st.replaceAll('_', ' ')}
                      </Badge>
                      {cf.inventoryNotifiedAt ? (
                        <div className="mt-0.5 text-[10px] text-emerald-600">Inv. notified</div>
                      ) : null}
                      {stampingIsConfirmed(cf) ? (
                        <div className="mt-0.5 text-[10px] text-emerald-600">
                          {cf.stampingRequired === true ||
                          (Array.isArray(cf.stampLines) &&
                            (cf.stampLines as Array<{ stampingRequired?: boolean }>).some(
                              (l) => l.stampingRequired,
                            ))
                            ? 'Stamping: Yes'
                            : 'Stamping: No'}
                        </div>
                      ) : st === 'APPROVED' ? (
                        <div className="mt-0.5 text-[10px] text-amber-600">Stamping unconfirmed</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {canApprove && awaitingAccept ? (
                          <>
                            <Button
                              size="sm"
                              className="bg-red-600 text-white hover:bg-red-700"
                              disabled={busyId === id}
                              onClick={() => setConfirmAction({ type: 'approve', id })}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === id}
                              onClick={() => {
                                setRejectId(id)
                                setRejectReason('')
                              }}
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                        {canFulfill &&
                        (st === 'APPROVED' || st === 'FULFILLED') &&
                        !row.shippedAt ? (
                          <WarehouseReleaseSteps
                            busy={busyId === id}
                            stamped={stampingIsConfirmed(cf)}
                            reduced={stockProgress.allReduced}
                            reducedCount={stockProgress.reducedCount}
                            needed={stockProgress.needed}
                            hasDc={Boolean(cf.saleDcNo || cf.saleDeliveryChallan)}
                            dcNo={cf.saleDcNo ? String(cf.saleDcNo) : null}
                            shipped={Boolean(row.shippedAt)}
                            onReleaseAll={() => void openReleaseAll(row)}
                            onStamp={() => openStampConfirm(row)}
                            onReduce={() => void openStockPicker(row, false)}
                            onCreateDc={() => void createSaleDc(id)}
                            onPrintDc={() => printSaleDc(row)}
                            onShip={() => setConfirmAction({ type: 'ship', id })}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={confirmAction?.type === 'approve'}
        onClose={() => setConfirmAction(null)}
        title="Accept this requisition?"
        body="Confirms the sales requisition. Sales can then notify inventory to release stock. Continue?"
        confirmLabel={busyId === confirmAction?.id ? 'Accepting…' : 'Accept & sign'}
        confirmVariant="primary"
        onConfirm={() => {
          const id = confirmAction?.id
          if (id) void approve(id)
        }}
      />
      <ConfirmModal
        open={confirmAction?.type === 'ship'}
        onClose={() => setConfirmAction(null)}
        title="Mark ready to ship?"
        body="Moves this release to Shipped and notifies sales. Continue?"
        confirmLabel={busyId === confirmAction?.id ? 'Shipping…' : 'Ready to ship'}
        confirmVariant="primary"
        onConfirm={() => {
          const id = confirmAction?.id
          if (id) void ship(id)
        }}
      />

      <Modal
        open={Boolean(rejectId)}
        onClose={() => setRejectId(null)}
        title="Reject requisition"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button disabled={!rejectReason.trim() || busyId === rejectId} onClick={() => void reject()}>
              Reject
            </Button>
          </>
        }
      >
        <Input
          label="Reason *"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(pickOpen)}
        onClose={() => setPickOpen(null)}
        title={
          pickOpen?.mode === 'complete' ? 'Release & ship' : 'Reduce stock for this sale'
        }
        subtitle={
          pickOpen?.mode === 'complete'
            ? 'Open one product at a time → stamp → pick serial → Reduce. Repeat until all products are done, then DC + ship.'
            : 'Open the product, pick type → model → unit, then reduce.'
        }
        size="2xl"
        accent="sky"
        footer={
          <>
            <Button variant="outline" onClick={() => setPickOpen(null)} disabled={busyId === pickOpen?.id}>
              {pickOpen && pickOpen.reducedCount > 0 && pickOpen.reducedCount < pickOpen.needed
                ? 'Close — finish later'
                : 'Cancel'}
            </Button>
            <Button
              disabled={
                busyId === pickOpen?.id ||
                !pickOpen?.activeLine ||
                Boolean(pickOpen?.activeLine?.done) ||
                !pickedUnitIds.length ||
                (activeLineRemaining > 0 && pickedUnitIds.length !== activeLineRemaining)
              }
              onClick={() => void confirmPick()}
            >
              {busyId === pickOpen?.id
                ? pickOpen?.mode === 'complete'
                  ? 'Saving…'
                  : 'Reducing…'
                : !pickOpen?.activeLine
                  ? 'Open a product below'
                  : pickOpen.activeLine.done
                    ? 'Already done — open next'
                    : pickOpen.mode === 'complete'
                      ? pickOpen.orderLines.filter((l) => !l.done).length > 1
                        ? `Save this product (${pickedUnitIds.length}/${activeLineRemaining || 1}) — ${pickOpen.orderLines.filter((l) => !l.done).length - 1} more left`
                        : `Save last product (${pickedUnitIds.length}/${activeLineRemaining || pickedUnitIds.length}) & finish`
                      : activeLineRemaining > 0
                        ? `Reduce ${pickedUnitIds.length}/${activeLineRemaining}`
                        : 'Reduce stock'}
            </Button>
          </>
        }
      >
        {pickOpen?.customer ? (
          <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">
                  {pickOpen.customer.name}
                  {pickOpen.customer.customerCode ? (
                    <span className="ml-2 font-mono text-xs font-normal text-text-secondary">
                      {pickOpen.customer.customerCode}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-text-secondary">
                  {[pickOpen.customer.phone, pickOpen.customer.reqNumber]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-text-primary">
                {pickOpen.orderLines.filter((l) => l.done).length}/{pickOpen.orderLines.length || 1}{' '}
                products done
                {pickOpen.needed > 1 ? (
                  <span className="ml-1.5 font-normal text-text-secondary">
                    · {pickOpen.reducedCount}/{pickOpen.needed} units
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {pickOpen && pickOpen.orderLines.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-text-secondary">
              Click a product to open it, click again to close. Finish one, then open the next.
            </p>
            {pickOpen.orderLines.map((line) => {
              const isOpen = pickOpen.activeLine?.index === line.index
              const inStock = stockCountForOrderLabel(
                line.label,
                catalogProducts,
                stockOptions,
              )
              const status = line.done
                ? `Done · ${line.reduced}/${line.qty}`
                : inStock > 0
                  ? `Need ${line.remaining} · ${inStock} in stock`
                  : `Need ${line.remaining} · no stock`
              return (
                <div
                  key={`${line.label}-${line.index}`}
                  className={cn(
                    'overflow-hidden rounded-lg border transition',
                    isOpen
                      ? 'border-sky-400 shadow-sm dark:border-sky-600'
                      : line.done
                        ? 'border-emerald-200/80 dark:border-emerald-800/50'
                        : 'border-border',
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => selectReleaseProductTab(line.index)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3.5 py-3 text-left transition',
                      isOpen
                        ? 'bg-sky-50 dark:bg-sky-950/40'
                        : line.done
                          ? 'bg-emerald-50/70 hover:bg-emerald-50 dark:bg-emerald-950/25'
                          : 'bg-card hover:bg-muted/40',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        line.done
                          ? 'bg-emerald-500 text-white'
                          : isOpen
                            ? 'bg-sky-600 text-white'
                            : 'bg-muted text-text-secondary ring-1 ring-border',
                      )}
                    >
                      {line.done ? <Check size={14} strokeWidth={2.5} /> : line.index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-primary">
                        {line.label}
                      </span>
                      <span className="block text-xs text-text-secondary">{status}</span>
                    </span>
                    <ChevronDown
                      size={18}
                      className={cn(
                        'shrink-0 text-text-secondary transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    />
                  </button>

                  {isOpen ? (
                    <div className="border-t border-border bg-card px-3.5 py-4">
                      {line.done ? (
                        <p className="text-sm text-emerald-800 dark:text-emerald-200">
                          This product is already reduced ({line.reduced}/{line.qty}). Open the next
                          unfinished product above.
                        </p>
                      ) : (
                        <div className="space-y-5">
                          {pickOpen.mode === 'complete' &&
                          activeStampLine &&
                          activeStampIdx >= 0 ? (
                            <section className="space-y-2">
                              <h3 className="text-sm font-semibold text-text-primary">
                                1. Stamping needed?
                              </h3>
                              <p className="text-xs text-text-secondary">
                                Yes for weighing (number + dates). No for billing / POS.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant={
                                    activeStampLine.stampingRequired ? 'primary' : 'outline'
                                  }
                                  onClick={() =>
                                    setStampLines((prev) =>
                                      prev.map((l, i) =>
                                        i === activeStampIdx
                                          ? {
                                              ...l,
                                              stampingRequired: true,
                                              stampingQuarter:
                                                l.stampingQuarter ||
                                                stampQuarterFromDate(l.stampingDate),
                                            }
                                          : l,
                                      ),
                                    )
                                  }
                                >
                                  Yes
                                </Button>
                                <Button
                                  size="sm"
                                  variant={
                                    !activeStampLine.stampingRequired ? 'primary' : 'outline'
                                  }
                                  onClick={() =>
                                    setStampLines((prev) =>
                                      prev.map((l, i) =>
                                        i === activeStampIdx
                                          ? { ...l, stampingRequired: false }
                                          : l,
                                      ),
                                    )
                                  }
                                >
                                  No
                                </Button>
                              </div>
                              {activeStampLine.stampingRequired ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="sm:col-span-2">
                                    <Input
                                      label="Stamping number *"
                                      value={activeStampLine.stampingNumber}
                                      onChange={(e) =>
                                        setStampLines((prev) =>
                                          prev.map((l, i) =>
                                            i === activeStampIdx
                                              ? { ...l, stampingNumber: e.target.value }
                                              : l,
                                          ),
                                        )
                                      }
                                      placeholder="Govt stamp / VC number"
                                    />
                                  </div>
                                  <Select
                                    label="Stamping quarter *"
                                    value={activeStampLine.stampingQuarter}
                                    onChange={(e) =>
                                      setStampLines((prev) =>
                                        prev.map((l, i) =>
                                          i === activeStampIdx
                                            ? {
                                                ...l,
                                                stampingQuarter: e.target
                                                  .value as StampLineDraft['stampingQuarter'],
                                              }
                                            : l,
                                        ),
                                      )
                                    }
                                    options={STAMP_QUARTER_OPTIONS}
                                  />
                                  <Input
                                    label="Stamped date *"
                                    type="date"
                                    value={activeStampLine.stampingDate}
                                    onChange={(e) => {
                                      const date = e.target.value
                                      setStampLines((prev) =>
                                        prev.map((l, i) =>
                                          i === activeStampIdx
                                            ? {
                                                ...l,
                                                stampingDate: date,
                                                stampingQuarter: date
                                                  ? stampQuarterFromDate(date)
                                                  : l.stampingQuarter,
                                              }
                                            : l,
                                        ),
                                      )
                                    }}
                                  />
                                  <Input
                                    label="Next due (optional)"
                                    type="date"
                                    value={activeStampLine.nextDueDate}
                                    onChange={(e) =>
                                      setStampLines((prev) =>
                                        prev.map((l, i) =>
                                          i === activeStampIdx
                                            ? { ...l, nextDueDate: e.target.value }
                                            : l,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                              ) : (
                                <p className="text-xs text-text-secondary">
                                  No stamping for this product.
                                </p>
                              )}
                            </section>
                          ) : null}

                          <section className="space-y-3">
                            <h3 className="text-sm font-semibold text-text-primary">
                              {pickOpen.mode === 'complete' ? '2. Pick stock unit' : 'Pick stock unit'}
                            </h3>
                            {stockLoading ? (
                              <p className="py-6 text-center text-sm text-text-secondary">
                                Loading stock…
                              </p>
                            ) : (
                              <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Select
                                    label="Machine type"
                                    value={pickMachineType}
                                    placeholder="Select type…"
                                    options={STOCK_MACHINE_TYPES.map((t) => ({
                                      value: t.value,
                                      label: t.label,
                                    }))}
                                    onChange={(e) => {
                                      setPickMachineType(
                                        e.target.value as StockMachineType | '',
                                      )
                                      setPickProductId('')
                                      setPickedUnitIds([])
                                    }}
                                  />
                                  <SearchableSelect
                                    label="Model (match order)"
                                    value={pickProductId}
                                    onChange={(v) => {
                                      const p = catalogProducts.find((x) => String(x.id) === v)
                                      const orderLabel = line.label
                                      if (
                                        orderLabel &&
                                        p &&
                                        !productMatchesOrderLabel(p, orderLabel)
                                      ) {
                                        addToast({
                                          type: 'error',
                                          message: `Pick a model matching “${orderLabel}”`,
                                        })
                                        return
                                      }
                                      setPickProductId(v)
                                      setPickedUnitIds([])
                                    }}
                                    placeholder={`Match “${line.label}”…`}
                                    options={pickProductOptions}
                                    emptyText={`No models match “${line.label}”`}
                                  />
                                </div>

                                {!pickProductId ? (
                                  <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-sm text-text-secondary">
                                    Choose type and model, then select{' '}
                                    {activeLineRemaining || 1} unit
                                    {(activeLineRemaining || 1) === 1 ? '' : 's'}.
                                  </p>
                                ) : pickUnitsForModel.length === 0 ? (
                                  <div className="space-y-2 rounded-lg border border-amber-200/80 bg-amber-50/50 px-3 py-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                                    <p className="font-semibold text-amber-950 dark:text-amber-100">
                                      No in-stock units for this model
                                    </p>
                                    <p className="text-xs text-text-secondary">
                                      Add stock, or open another product that has stock.
                                    </p>
                                    <div className="flex flex-wrap gap-2 pt-1">
                                      <Link to="/erp/stock/move">
                                        <Button size="sm" variant="outline">
                                          Add stock
                                        </Button>
                                      </Link>
                                      {pickOpen.orderLines.some(
                                        (l) =>
                                          !l.done &&
                                          l.index !== line.index &&
                                          stockCountForOrderLabel(
                                            l.label,
                                            catalogProducts,
                                            stockOptions,
                                          ) > 0,
                                      ) ? (
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            const next = preferReleaseActiveLine(
                                              pickOpen.orderLines,
                                              (l) =>
                                                l.index === line.index
                                                  ? 0
                                                  : stockCountForOrderLabel(
                                                      l.label,
                                                      catalogProducts,
                                                      stockOptions,
                                                    ),
                                            )
                                            if (next) selectReleaseProductTab(next.index)
                                          }}
                                        >
                                          Open product with stock
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-sm font-medium text-text-primary">
                                        Select {activeLineRemaining || 1} unit
                                        {(activeLineRemaining || 1) === 1 ? '' : 's'}
                                      </p>
                                      <span className="text-xs text-text-secondary">
                                        {pickedUnitIds.length}/{activeLineRemaining || 1} selected
                                      </span>
                                    </div>
                                    <ul className="max-h-[min(18rem,38vh)] space-y-1.5 overflow-auto rounded-lg border border-border bg-muted/10 p-1.5">
                                      {pickUnitsForModel.map((u) => {
                                        const selected = pickedUnitIds.includes(u.id)
                                        const hms = u.hmsUniqId ? String(u.hmsUniqId) : ''
                                        const serial = u.serialNo ? String(u.serialNo) : ''
                                        const weighingLabel = hms || serial || '—'
                                        return (
                                          <li key={u.id}>
                                            <button
                                              type="button"
                                              onClick={() => togglePickedUnit(u.id)}
                                              className={cn(
                                                'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition',
                                                selected
                                                  ? 'border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-950/50'
                                                  : 'border-border bg-card hover:border-sky-300/70',
                                              )}
                                            >
                                              <div className="min-w-0">
                                                {pickIsWeighing ? (
                                                  <>
                                                    <div className="font-mono text-sm font-semibold text-text-primary">
                                                      HMS {weighingLabel}
                                                    </div>
                                                    <div className="text-xs text-text-secondary">
                                                      Weighing · {String(u.status)}
                                                    </div>
                                                  </>
                                                ) : (
                                                  <>
                                                    <div className="font-mono text-sm font-semibold text-text-primary">
                                                      S/No {serial || '—'}
                                                    </div>
                                                    <div className="font-mono text-xs text-text-secondary">
                                                      HMS {hms || '—'} · {String(u.status)}
                                                    </div>
                                                  </>
                                                )}
                                              </div>
                                              <span
                                                className={cn(
                                                  'shrink-0 text-xs font-semibold',
                                                  selected
                                                    ? 'text-sky-700 dark:text-sky-300'
                                                    : 'text-text-secondary',
                                                )}
                                              >
                                                {selected ? 'Selected' : 'Select'}
                                              </span>
                                            </button>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </section>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : pickOpen ? (
          <div className="min-w-0 space-y-4">
            {stockLoading ? (
              <p className="py-8 text-center text-sm text-text-secondary">Loading stock…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Machine type"
                    value={pickMachineType}
                    placeholder="Select type…"
                    options={STOCK_MACHINE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                    onChange={(e) => {
                      setPickMachineType(e.target.value as StockMachineType | '')
                      setPickProductId('')
                      setPickedUnitIds([])
                    }}
                  />
                  <SearchableSelect
                    label="Model"
                    value={pickProductId}
                    onChange={(v) => {
                      setPickProductId(v)
                      setPickedUnitIds([])
                    }}
                    placeholder={pickMachineType ? 'Search model…' : 'Select machine type first'}
                    options={pickProductOptions}
                    emptyText={
                      pickMachineType
                        ? 'No models for this type'
                        : 'Pick type first'
                    }
                  />
                </div>
                {pickProductId && pickUnitsForModel.length > 0 ? (
                  <ul className="max-h-[min(22rem,42vh)] space-y-2 overflow-auto rounded-xl border border-border bg-muted/15 p-2">
                    {pickUnitsForModel.map((u) => {
                      const selected = pickedUnitIds.includes(u.id)
                      const hms = u.hmsUniqId ? String(u.hmsUniqId) : ''
                      const serial = u.serialNo ? String(u.serialNo) : ''
                      return (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => togglePickedUnit(u.id)}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left',
                              selected
                                ? 'border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-950/50'
                                : 'border-border bg-card',
                            )}
                          >
                            <span className="font-mono text-sm font-semibold">
                              {pickIsWeighing
                                ? `HMS ${hms || serial || '—'}`
                                : `S/No ${serial || '—'}`}
                            </span>
                            <span className="text-xs font-medium text-text-secondary">
                              {selected ? 'Selected' : 'Select'}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(stampOpen)}
        onClose={() => setStampOpen(null)}
        title="Confirm stamping"
        subtitle="You stamp machines manually. Confirm per product: Required Yes → stamping number + dates. Billing usually No."
        size="xl"
        accent="amber"
        footer={
          <>
            <Button variant="outline" onClick={() => setStampOpen(null)}>
              Cancel
            </Button>
            <Button
              disabled={!stampLines.length || busyId === stampOpen}
              onClick={() => stampOpen && void saveStampConfirm(stampOpen)}
            >
              Save confirmation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {stampLines.map((line, idx) => (
            <div
              key={`${line.label}-${idx}`}
              className="rounded-[8px] border border-border bg-surface/60 p-3"
            >
              <div className="text-sm font-semibold text-text-primary">{line.label}</div>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                Suggested:{' '}
                {suggestStampingRequired(line.label) ? 'Yes (weighing-like)' : 'No (billing/other)'} —
                you confirm.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={line.stampingRequired ? 'primary' : 'outline'}
                  onClick={() =>
                    setStampLines((prev) =>
                      prev.map((l, i) =>
                        i === idx
                          ? {
                              ...l,
                              stampingRequired: true,
                              stampingQuarter:
                                l.stampingQuarter || stampQuarterFromDate(l.stampingDate),
                            }
                          : l,
                      ),
                    )
                  }
                >
                  Required: Yes
                </Button>
                <Button
                  size="sm"
                  variant={!line.stampingRequired ? 'primary' : 'outline'}
                  onClick={() =>
                    setStampLines((prev) =>
                      prev.map((l, i) => (i === idx ? { ...l, stampingRequired: false } : l)),
                    )
                  }
                >
                  Required: No
                </Button>
              </div>
              {line.stampingRequired ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Input
                      label="Stamping number *"
                      value={line.stampingNumber}
                      onChange={(e) =>
                        setStampLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, stampingNumber: e.target.value } : l,
                          ),
                        )
                      }
                      placeholder="Govt stamp / VC number"
                    />
                  </div>
                  <Select
                    label="Stamping quarter *"
                    value={line.stampingQuarter}
                    onChange={(e) =>
                      setStampLines((prev) =>
                        prev.map((l, i) =>
                          i === idx
                            ? {
                                ...l,
                                stampingQuarter: e.target.value as StampLineDraft['stampingQuarter'],
                              }
                            : l,
                        ),
                      )
                    }
                    options={STAMP_QUARTER_OPTIONS}
                  />
                  <Input
                    label="Stamped date *"
                    type="date"
                    value={line.stampingDate}
                    onChange={(e) => {
                      const date = e.target.value
                      setStampLines((prev) =>
                        prev.map((l, i) =>
                          i === idx
                            ? {
                                ...l,
                                stampingDate: date,
                                stampingQuarter: date
                                  ? stampQuarterFromDate(date)
                                  : l.stampingQuarter,
                              }
                            : l,
                        ),
                      )
                    }}
                  />
                  <Input
                    label="End / next due date"
                    type="date"
                    value={line.nextDueDate}
                    onChange={(e) =>
                      setStampLines((prev) =>
                        prev.map((l, i) =>
                          i === idx ? { ...l, nextDueDate: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs text-text-secondary">No stamping for this product — skip dates.</p>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </Card>
  )
}
