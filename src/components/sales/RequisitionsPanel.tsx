import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FlowStepBar } from '@/components/ui/FlowStepBar'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
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
  productMatchesOrderLabel,
  releaseStockProgress,
  suggestStampingRequired,
  type ReleaseOrderLine,
} from '@/lib/inventoryFlow'
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
}

function stampingIsConfirmed(cf: Record<string, unknown>): boolean {
  if (cf.stampingConfirmedAt || cf.stampingSkipped) return true
  if (Array.isArray(cf.stampLines) && cf.stampLines.length) {
    return (cf.stampLines as Array<{ confirmed?: boolean }>).every((l) => l.confirmed)
  }
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
  onCreateDc,
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
  const canViewSale = can(role, 'leads:view')
  const [searchParams] = useSearchParams()
  const focusReqId = searchParams.get('reqId')

  const [queue, setQueue] = useState<Queue>(defaultQueue)
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stampOpen, setStampOpen] = useState<string | null>(null)
  const [stampLines, setStampLines] = useState<StampLineDraft[]>([])
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const status =
        queue === 'pending'
          ? 'PENDING_APPROVAL'
          : queue === 'approved'
            ? 'APPROVED'
            : 'APPROVED,FULFILLED'
      const res = await api.requisitions({
        limit: 100,
        status,
        ...(queue === 'fulfill' || queue === 'shipped' || queue === 'pending' || queue === 'approved'
          ? { queue }
          : {}),
      })
      let rows = res.items ?? []
      if (queue === 'fulfill') {
        rows = rows.filter((r) => !r.shippedAt)
      } else if (queue === 'shipped') {
        rows = rows.filter((r) => Boolean(r.shippedAt))
      }
      setItems(rows)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load requisitions',
      })
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [addToast, queue])

  useEffect(() => {
    setQueue(defaultQueue)
  }, [defaultQueue])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!focusReqId || loading) return
    const el = document.getElementById(`req-row-${focusReqId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusReqId, loading, items])

  function openStampConfirm(row: Record<string, unknown>) {
    const id = String(row.id)
    const cf =
      row.customFields && typeof row.customFields === 'object'
        ? (row.customFields as Record<string, unknown>)
        : {}
    const today = new Date().toISOString().slice(0, 10)
    if (Array.isArray(cf.stampLines) && cf.stampLines.length) {
      setStampLines(
        (cf.stampLines as Array<Record<string, unknown>>).map((l) => ({
          label: String(l.label ?? 'Product'),
          stampingRequired: Boolean(l.stampingRequired),
          stampingDate: l.stampingDate ? String(l.stampingDate) : today,
          nextDueDate: l.nextDueDate ? String(l.nextDueDate) : '',
        })),
      )
    } else {
      setStampLines(
        parseProductStampLines(row.productName ? String(row.productName) : null).map((label) => {
          const required =
            typeof cf.stampingRequired === 'boolean'
              ? Boolean(cf.stampingRequired)
              : suggestStampingRequired(label)
          return {
            label,
            stampingRequired: required,
            stampingDate: cf.stampingDate ? String(cf.stampingDate) : today,
            nextDueDate: cf.nextDueDate ? String(cf.nextDueDate) : '',
          }
        }),
      )
    }
    setPickedUnitIds(row.stockUnitId ? [String(row.stockUnitId)] : [])
    setStampOpen(id)
  }

  function applyPickerSelection(
    products: Array<Record<string, unknown>>,
    progress: ReturnType<typeof releaseStockProgress>,
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
      applyPickerSelection(products, progress)
      const usedUnitIds = new Set(
        progress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
      )
      setStockOptions(
        (workspace.units ?? [])
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
          }),
      )
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

  const pickIsWeighing = pickMachineType === 'WEIGHING_SCALES'

  async function approve(id: string) {
    setBusyId(id)
    try {
      await api.approveRequisition(id)
      addToast({ type: 'success', message: 'Signed — sales will notify inventory' })
      await load()
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
      await load()
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
      if (line.stampingRequired && !line.stampingDate) {
        addToast({
          type: 'error',
          message: `Enter stamping date for "${line.label}" (or set Required = No)`,
        })
        return
      }
    }
    setBusyId(id)
    try {
      await api.recordRequisitionStamping(id, {
        stockUnitId: pickedUnitIds[0] || null,
        lines: stampLines.map((l) => ({
          label: l.label,
          stampingRequired: l.stampingRequired,
          stampingDate: l.stampingRequired ? l.stampingDate : null,
          nextDueDate: l.stampingRequired && l.nextDueDate ? l.nextDueDate : null,
        })),
      })
      setStampOpen(null)
      addToast({
        type: 'success',
        message: 'Stamping confirmed — you can reduce stock now',
      })
      await load()
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
      await load()

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
      await load()
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
      await load()
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
      await load()
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

  /** Stamp → reduce selected units → create DC → ready to ship (one click) */
  async function completeReleaseAll() {
    if (!pickOpen || pickOpen.mode !== 'complete' || busyId === pickOpen.id) return
    const active = pickOpen.activeLine
    if (!active) {
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
    for (const line of stampLines) {
      if (line.stampingRequired && !line.stampingDate) {
        addToast({
          type: 'error',
          message: `Enter stamping date for "${line.label}" (or set Required = No)`,
        })
        return
      }
    }
    const id = pickOpen.id
    const ids = pickedUnitIds.slice(0, need)
    setBusyId(id)
    try {
      await api.recordRequisitionStamping(id, {
        lines: stampLines.map((l) => ({
          label: l.label,
          stampingRequired: l.stampingRequired,
          stampingDate: l.stampingRequired ? l.stampingDate : null,
          nextDueDate: l.stampingRequired && l.nextDueDate ? l.nextDueDate : null,
        })),
      })
      let updated: Record<string, unknown> | null = null
      for (const stockUnitId of ids) {
        updated = (await api.fulfillRequisition(id, {
          markShipped: false,
          stockUnitId,
        })) as Record<string, unknown>
      }
      const progress = releaseStockProgress(updated ?? {})
      if (!progress.allReduced) {
        setPickedUnitIds([])
        setPickOpen((prev) => (prev ? syncPickOpenProgress(prev, progress) : prev))
        const next = progress.activeLine
        addToast({
          type: 'success',
          message: next
            ? `“${active.label}” done · next: “${next.label}” (need ${next.remaining})`
            : `Reduced ${ids.length} · ${progress.reducedCount}/${progress.needed}`,
        })
        const workspace = await api.inventoryWorkspace()
        const products = workspace.products ?? []
        setCatalogProducts(products)
        applyPickerSelection(products, progress)
        const usedUnitIds = new Set(
          progress.releaseLines.map((l) => String(l.stockUnitId ?? '')).filter(Boolean),
        )
        setStockOptions(
          (workspace.units ?? [])
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
            }),
        )
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
      await load()
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
          <h2 className="font-semibold text-text-primary">
            {title ??
              (queue === 'pending'
                ? 'Pending requisitions'
                : queue === 'shipped'
                  ? 'Shipped releases'
                  : 'Approved for stock release')}
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {queue === 'shipped'
              ? 'Completed releases — DC, machines out, customer, and ship date. Active work stays on Release queue.'
              : subtitle ??
                (queue === 'pending'
                  ? 'Sign like the paper HMS form — inventory only sees the job after sales notifies them.'
                  : 'Step 1 Stamping → Step 2 Reduce → Step 3 Ship. Create DC after reduce. PI stays with sales.')}
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
              variant={queue === 'pending' ? 'primary' : 'outline'}
              onClick={() => setQueue('pending')}
            >
              Pending
            </Button>
          ) : null}
          {canFulfill || canApprove ? (
            <Button
              size="sm"
              variant={queue === 'approved' || queue === 'fulfill' ? 'primary' : 'outline'}
              onClick={() => setQueue(canFulfill ? 'fulfill' : 'approved')}
            >
              Release queue
            </Button>
          ) : null}
          {canFulfill || canApprove ? (
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

      {loading ? (
        <p className="p-6 text-sm text-text-secondary">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing in this queue"
          subtitle={
            queue === 'pending'
              ? 'When sales submits a requisition, it lands here for your signature.'
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
                              : 'amber'
                        }
                      >
                        {st.replaceAll('_', ' ')}
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
                        {canApprove && st === 'PENDING_APPROVAL' ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busyId === id}
                              onClick={() => void approve(id)}
                            >
                              Sign
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
                            onShip={() => void ship(id)}
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
            ? 'One go for inventory: stamping → pick unit(s) → reduce stock → delivery challan → ready to ship.'
            : 'Customer is fixed from the sale. Pick type → model → unit (same path as Stock → Reduce).'
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
                !pickedUnitIds.length ||
                (activeLineRemaining > 0 && pickedUnitIds.length !== activeLineRemaining)
              }
              onClick={() => void confirmPick()}
            >
              {busyId === pickOpen?.id
                ? pickOpen?.mode === 'complete'
                  ? 'Releasing…'
                  : 'Reducing…'
                : pickOpen?.mode === 'complete'
                  ? pickOpen.activeLine && !pickOpen.orderLines.every((l) => l.done || l.index === pickOpen.activeLine?.index)
                    ? `Reduce “${pickOpen.activeLine.label}” (${pickedUnitIds.length}/${activeLineRemaining}) → next`
                    : `Finish release (${pickedUnitIds.length}/${activeLineRemaining || pickedUnitIds.length})`
                  : activeLineRemaining > 0
                    ? `Reduce ${pickedUnitIds.length}/${activeLineRemaining} for this product`
                    : 'Reduce stock'}
            </Button>
          </>
        }
      >
        {pickOpen?.customer ? (
          <div className="mb-5 rounded-xl border border-sky-200/90 bg-sky-50/70 px-4 py-4 dark:border-sky-500/30 dark:bg-sky-950/40">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  Reducing for customer
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-lg font-semibold text-text-primary">
                    {pickOpen.customer.name}
                  </span>
                  {pickOpen.customer.customerCode ? (
                    <span className="font-mono text-xs font-medium text-text-secondary">
                      {pickOpen.customer.customerCode}
                    </span>
                  ) : null}
                </div>
              </div>
              {pickOpen.needed > 1 ? (
                <div className="rounded-lg border border-sky-300/60 bg-card px-3 py-1.5 text-sm font-semibold text-text-primary">
                  {pickOpen.reducedCount}/{pickOpen.needed} reduced
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-text-secondary sm:grid-cols-2">
              {pickOpen.customer.phone ? (
                <div>
                  <span className="text-text-secondary/80">Phone · </span>
                  <span className="text-text-primary">{pickOpen.customer.phone}</span>
                </div>
              ) : null}
              {pickOpen.customer.email ? (
                <div className="min-w-0 truncate">
                  <span className="text-text-secondary/80">Email · </span>
                  <span className="text-text-primary">{pickOpen.customer.email}</span>
                </div>
              ) : null}
              {pickOpen.customer.reqNumber ? (
                <div>
                  <span className="text-text-secondary/80">Req · </span>
                  <span className="font-mono text-text-primary">{pickOpen.customer.reqNumber}</span>
                </div>
              ) : null}
              {pickOpen.customer.address ? (
                <div className="sm:col-span-2 text-[13px] leading-snug">
                  {pickOpen.customer.address}
                </div>
              ) : null}
            </div>
            {(pickOpen.orderLines?.length ? pickOpen.orderLines : null) ? (
              <ul className="mt-3 space-y-1.5 border-t border-sky-200/70 pt-3 dark:border-sky-800/50">
                {pickOpen.orderLines.map((line) => {
                  const isActive = pickOpen.activeLine?.index === line.index && !line.done
                  return (
                    <li
                      key={`${line.label}-${line.index}`}
                      className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                        line.done
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : isActive
                            ? 'bg-sky-100/80 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100'
                            : 'text-text-primary'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                          line.done
                            ? 'bg-emerald-500 text-white'
                            : isActive
                              ? 'bg-sky-600 text-white'
                              : 'bg-card text-text-secondary ring-1 ring-border'
                        }`}
                      >
                        {line.done ? '✓' : line.index + 1}
                      </span>
                      <span className="font-medium">{line.label}</span>
                      <span className="text-xs text-text-secondary">
                        Qty {line.reduced}/{line.qty}
                        {line.done
                          ? ' · done'
                          : isActive
                            ? ` · reduce ${line.remaining} now`
                            : ' · waiting'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {pickOpen.customer.leadId && canViewSale ? (
              <Link
                to={`/sale-tracking/${pickOpen.customer.leadId}`}
                className="mt-3 inline-block text-sm font-medium text-accent-blue hover:underline"
              >
                Open sale overview
              </Link>
            ) : null}
          </div>
        ) : null}

        {pickOpen?.mode === 'complete' ? (
          <div className="mb-4 space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">1. Stamping</h3>
              <p className="text-xs text-text-secondary">
                Yes = stamped (enter date). No = not required (billing/POS). Then pick units below.
              </p>
            </div>
            {stampLines.map((line, idx) => (
              <div
                key={`${line.label}-${idx}`}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="text-sm font-semibold">{line.label}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={line.stampingRequired ? 'primary' : 'outline'}
                    onClick={() =>
                      setStampLines((prev) =>
                        prev.map((l, i) => (i === idx ? { ...l, stampingRequired: true } : l)),
                      )
                    }
                  >
                    Yes
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
                    No
                  </Button>
                </div>
                {line.stampingRequired ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input
                      label="Stamped date *"
                      type="date"
                      value={line.stampingDate}
                      onChange={(e) =>
                        setStampLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, stampingDate: e.target.value } : l,
                          ),
                        )
                      }
                    />
                    <Input
                      label="Next due (optional)"
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
                  <p className="mt-2 text-xs text-text-secondary">No stamping for this line.</p>
                )}
              </div>
            ))}
            <h3 className="pt-1 text-sm font-semibold text-text-primary">2. Pick unit(s)</h3>
          </div>
        ) : null}

        <ol className="mb-4 grid grid-cols-3 gap-2">
          {[
            { n: 1, label: 'Type', done: Boolean(pickMachineType) },
            { n: 2, label: 'Model', done: Boolean(pickProductId) },
            { n: 3, label: 'Unit(s)', done: pickedUnitIds.length > 0 },
          ].map((s) => (
            <li
              key={s.n}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                s.done
                  ? 'border-emerald-300/80 bg-emerald-50/80 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                  : 'border-border bg-muted/40 text-text-secondary'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  s.done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-card text-text-secondary ring-1 ring-border'
                }`}
              >
                {s.done ? '✓' : s.n}
              </span>
              <span className="font-semibold">{s.label}</span>
            </li>
          ))}
        </ol>

        {stockLoading ? (
          <p className="py-8 text-center text-sm text-text-secondary">Loading stock…</p>
        ) : (
          <div className="space-y-4">
            {pickOpen?.activeLine ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm dark:border-sky-800 dark:bg-sky-950/30">
                Now reducing:{' '}
                <span className="font-semibold">{pickOpen.activeLine.label}</span>
                <span className="text-text-secondary">
                  {' '}
                  · need exactly {pickOpen.activeLine.remaining} unit
                  {pickOpen.activeLine.remaining === 1 ? '' : 's'}
                </span>
              </div>
            ) : null}

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
                label="Model (must match order)"
                value={pickProductId}
                onChange={(v) => {
                  const p = catalogProducts.find((x) => String(x.id) === v)
                  const orderLabel = pickOpen?.activeLine?.label
                  if (orderLabel && p && !productMatchesOrderLabel(p, orderLabel)) {
                    addToast({
                      type: 'error',
                      message: `Pick a model matching “${orderLabel}”`,
                    })
                    return
                  }
                  setPickProductId(v)
                  setPickedUnitIds([])
                }}
                placeholder={
                  pickOpen?.activeLine
                    ? `Match “${pickOpen.activeLine.label}”…`
                    : pickMachineType
                      ? 'Search model…'
                      : 'Select machine type first'
                }
                options={pickProductOptions}
                emptyText={
                  pickOpen?.activeLine
                    ? `No catalog models match “${pickOpen.activeLine.label}”`
                    : pickMachineType
                      ? 'No models for this type in stock catalog'
                      : 'Pick type first'
                }
              />
            </div>

            {!pickProductId ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-text-secondary">
                Choose type and the ordered model, then pick exactly the qty for this line.
              </p>
            ) : pickUnitsForModel.length === 0 ? (
              <p className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-4 py-6 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                No in-stock units for this model. Add stock first, or open{' '}
                <Link
                  to="/erp/stock/move?mode=reduce"
                  className="font-medium text-accent-blue hover:underline"
                >
                  Reduce stock
                </Link>
                .
              </p>
            ) : (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text-primary">
                    Units — select exactly {activeLineRemaining || 1}
                  </h3>
                  <span className="text-xs text-text-secondary">
                    {pickUnitsForModel.filter((u) => String(u.status) === 'IN_STOCK').length} in
                    stock
                    {pickedUnitIds.length > 0
                      ? ` · ${pickedUnitIds.length}/${activeLineRemaining || 1} selected`
                      : ''}
                  </span>
                </div>
                <p className="mb-2 text-xs text-text-secondary">
                  Qty is fixed by the order
                  {pickOpen?.activeLine
                    ? ` (“${pickOpen.activeLine.label}” × ${pickOpen.activeLine.qty})`
                    : ''}
                  . Finish this product before the next (e.g. billing, then weighing).
                </p>
                <ul className="max-h-[min(22rem,42vh)] space-y-2 overflow-auto rounded-xl border border-border bg-muted/15 p-2">
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
                          className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left transition ${
                            selected
                              ? 'border-sky-400 bg-sky-50 shadow-sm dark:border-sky-600 dark:bg-sky-950/50'
                              : 'border-border bg-card hover:border-sky-300/70'
                          }`}
                        >
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                                selected
                                  ? 'border-sky-600 bg-sky-600 text-white'
                                  : 'border-border bg-card text-transparent'
                              }`}
                              aria-hidden
                            >
                              ✓
                            </span>
                            <div className="min-w-0">
                              {pickIsWeighing ? (
                                <>
                                  <div className="font-mono text-sm font-semibold text-text-primary">
                                    HMS {weighingLabel}
                                  </div>
                                  <div className="mt-0.5 text-xs text-text-secondary">
                                    Weighing · {String(u.status)}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="font-mono text-sm font-semibold text-text-primary">
                                    S/No {serial || '—'}
                                  </div>
                                  <div className="mt-0.5 font-mono text-xs text-text-secondary">
                                    HMS {hms || '—'} · {String(u.status)}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          {selected ? (
                            <span className="shrink-0 rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white">
                              Added
                            </span>
                          ) : (
                            <span className="shrink-0 text-xs font-medium text-text-secondary">
                              Add
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(stampOpen)}
        onClose={() => setStampOpen(null)}
        title="Confirm stamping"
        subtitle="You stamp machines manually. Confirm per product: Required Yes → date + end date. Billing usually No."
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
                      prev.map((l, i) => (i === idx ? { ...l, stampingRequired: true } : l)),
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
                  <Input
                    label="Stamped date *"
                    type="date"
                    value={line.stampingDate}
                    onChange={(e) =>
                      setStampLines((prev) =>
                        prev.map((l, i) =>
                          i === idx ? { ...l, stampingDate: e.target.value } : l,
                        ),
                      )
                    }
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
