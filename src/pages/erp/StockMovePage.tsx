import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { downloadXlsx } from '@/lib/reportExport'
import { productAttrs } from '@/lib/productCatalog'
import { expandSerialRange, bumpSerial } from '@/lib/stockSerial'
import { filterServiceEngineers } from '@/lib/roles'
import { useUIStore } from '@/store/uiStore'
import { APP_NAME } from '@/lib/branding'
import { TableSkeleton } from '@/components/ui/Skeleton'

type Category = 'MACHINE' | 'SPARE'
type StockMode = 'add' | 'reduce'
type Family = 'WEIGHING' | 'BILLING'

const STOCK_MACHINE_TYPES = [
  { value: 'WEIGHING_SCALES', label: 'Weighing' },
  { value: 'BILLING_MACHINE', label: 'Billing' },
  { value: 'TOUCH_POS', label: 'Touch POS' },
  { value: 'CASH_COUNTING', label: 'Cash Counting' },
  { value: 'OFFICE_AUTOMATION', label: 'Office Automation' },
  { value: 'BILLING_SOFTWARE', label: 'Billing Software' },
] as const

type StockMachineType = (typeof STOCK_MACHINE_TYPES)[number]['value']

function productMatchesStockType(p: Record<string, unknown>, type: StockMachineType) {
  const a = productAttrs(p)
  const fam = String(a.catalogFamily ?? '')
  const kind = String(a.catalogKind ?? '')
  if (type === 'CASH_COUNTING') return kind === 'CCM'
  if (type === 'OFFICE_AUTOMATION') return fam === 'OFFICE_AUTOMATION' && kind !== 'CCM'
  return fam === type
}

function spareFamilyFromStockType(type: StockMachineType): Family {
  return type === 'WEIGHING_SCALES' ? 'WEIGHING' : 'BILLING'
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Full-page Add / Reduce stock — preview HMS + serials before commit.
 * Weighing machines: HMS Unique ID only (no manufacturer serial).
 */
export function StockMovePage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)

  const mode: StockMode = params.get('mode') === 'reduce' ? 'reduce' : 'add'
  const [category, setCategory] = useState<Category>(
    () => (params.get('category') === 'SPARE' ? 'SPARE' : 'MACHINE'),
  )
  const [stockMachineType, setStockMachineType] = useState<StockMachineType | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [products, setProducts] = useState<Array<Record<string, unknown>>>([])
  const [spares, setSpares] = useState<Array<Record<string, unknown>>>([])
  const [vendors, setVendors] = useState<Array<Record<string, unknown>>>([])
  const [brands, setBrands] = useState<Array<Record<string, unknown>>>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [units, setUnits] = useState<Array<Record<string, unknown>>>([])
  const [engineers, setEngineers] = useState<Array<{ id: string; name: string }>>([])

  const [productId, setProductId] = useState(() => params.get('productId') ?? '')
  const [vendorId, setVendorId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [qty, setQty] = useState('1')
  const [serialStart, setSerialStart] = useState('')
  const [serialEnd, setSerialEnd] = useState('')
  const [hmsStart, setHmsStart] = useState('')
  const [hmsEnd, setHmsEnd] = useState('')
  const [previewHmsIds, setPreviewHmsIds] = useState<string[]>([])
  const [hmsManual, setHmsManual] = useState(false)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [unitCost, setUnitCost] = useState('')

  const [spareId, setSpareId] = useState(() => params.get('spareId') ?? '')
  const [spareQty, setSpareQty] = useState('1')
  const [supplierName, setSupplierName] = useState('')
  const [spareNotes, setSpareNotes] = useState('')
  const [spareUniqStart, setSpareUniqStart] = useState('')
  const [spareUniqEnd, setSpareUniqEnd] = useState('')

  const [reduceUnitIds, setReduceUnitIds] = useState<string[]>(() => {
    const one = params.get('unitId')
    return one ? [one] : []
  })
  /** Machine reduce purpose — Sales (sold) or Demo (taken to customer site). */
  const [reducePurpose, setReducePurpose] = useState<'SALE' | 'DEMO' | ''>('')
  const [reduceReasonNote, setReduceReasonNote] = useState('')
  const [reduceReason, setReduceReason] = useState('')
  const [engineerId, setEngineerId] = useState('')
  const [demoContact, setDemoContact] = useState<ContactPick | null>(null)
  const [reducePageTab, setReducePageTab] = useState<'form' | 'history'>('form')
  const [histMonth, setHistMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [histPurpose, setHistPurpose] = useState<'ALL' | 'SALE' | 'DEMO'>('ALL')
  const [reduceHistory, setReduceHistory] = useState<
    Array<{
      when: string
      what: string
      qty: string
      hms: string
      serial: string
      purpose: string
      customer: string
      engineer: string
      reason: string
    }>
  >([])

  function monthRange(ym: string) {
    const [y, m] = ym.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const last = new Date(y, m, 0).getDate()
    const end = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    return { from: start, to: end }
  }

  function toggleReduceUnit(id: string) {
    setReduceUnitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const isWeighingStock = stockMachineType === 'WEIGHING_SCALES'
  const nQty = Math.max(1, Math.min(200, Math.floor(Number(qty) || 1)))
  const nSpareQty = Math.max(1, Math.min(500, Math.floor(Number(spareQty || qty) || 1)))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const workspace = await api.inventoryWorkspace()
      setProducts(workspace.products ?? [])
      setSpares(workspace.spares ?? [])
      setVendors(workspace.vendors ?? [])
      setBrands(workspace.brands ?? [])
      setWarehouses(
        (workspace.warehouses ?? []).map((w) => ({ id: String(w.id), name: String(w.name) })),
      )
      setUnits(
        (workspace.units ?? []).filter((u) => {
          const st = String(u.status)
          return st === 'IN_STOCK' || st === 'DEMO'
        }),
      )
      setWarehouseId(
        (prev) => prev || (workspace.warehouses?.[0] ? String(workspace.warehouses[0].id) : ''),
      )
      const allUsers = (workspace.users ?? []).map((u) => ({
        id: String(u.id),
        name: String(u.name ?? ''),
        roleCode: String((u.role as { code?: string } | null)?.code ?? u.roleCode ?? ''),
      }))
      const eng = filterServiceEngineers(allUsers)
      setEngineers((eng.length ? eng : allUsers).map((e) => ({ id: e.id, name: e.name })))
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load stock form',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  // Infer machine type from preselected product / spare
  useEffect(() => {
    if (stockMachineType) return
    if (productId) {
      const p = products.find((x) => String(x.id) === productId)
      if (p) {
        const fam = String(productAttrs(p).catalogFamily ?? '')
        const kind = String(productAttrs(p).catalogKind ?? '')
        if (kind === 'CCM') setStockMachineType('CASH_COUNTING')
        else if (STOCK_MACHINE_TYPES.some((t) => t.value === fam)) {
          setStockMachineType(fam as StockMachineType)
        }
      }
    }
    if (spareId) {
      const spare = spares.find((s) => String(s.id) === spareId)
      if (spare) {
        setStockMachineType(
          String(spare.machineFamily) === 'BILLING' ? 'BILLING_MACHINE' : 'WEIGHING_SCALES',
        )
      }
    }
  }, [productId, spareId, products, spares, stockMachineType])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (mode === 'reduce') next.set('mode', 'reduce')
    else next.delete('mode')
    if (category === 'SPARE') next.set('category', 'SPARE')
    else next.delete('category')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, category])

  async function loadReduceHistory() {
    try {
      const { from, to } = monthRange(histMonth)
      const [moves, spareTxns] = await Promise.all([
        api.inventoryHistory({ limit: 400, action: 'reduce', from, to }).catch(() => []),
        api.spareStockHistory({ limit: 400, from, to }).catch(() => []),
      ])
      const machineRows = (Array.isArray(moves) ? moves : [])
        .filter(
          (m) =>
            String(m.referenceType) === 'STOCK_REDUCE' ||
            String(m.referenceType) === 'DEMO_ISSUE' ||
            String(m.action) === 'REDUCE',
        )
        .map((m) => {
          const unit = m.stockUnit as { hmsUniqId?: string; serialNo?: string } | null
          const purpose = String(m.reducePurpose ?? (m.referenceType === 'DEMO_ISSUE' ? 'DEMO' : 'SALE'))
          return {
            when: String(m.createdAt ?? m.movedAt ?? m.performedAt ?? ''),
            what: String(
              (m.product as { name?: string } | null)?.name ?? m.productName ?? 'Machine unit',
            ),
            qty: String(m.quantity ?? 1),
            hms: String(unit?.hmsUniqId ?? ''),
            serial: String(unit?.serialNo ?? ''),
            purpose,
            customer: String(m.customerName ?? ''),
            engineer:
              String(m.issuedToName ?? '') ||
              String(m.notes ?? '')
                .match(/Issued to:\s*([^·]+)/)?.[1]
                ?.trim() ||
              '—',
            reason: String(m.reduceReason ?? m.notes ?? '—'),
          }
        })
      const spareRows = (Array.isArray(spareTxns) ? spareTxns : [])
        .filter((t) => String(t.txnType) === 'OUT')
        .map((t) => ({
          when: String(t.createdAt ?? t.txnDate ?? ''),
          what: String((t.sparePart as { name?: string } | null)?.name ?? t.spareName ?? 'Spare'),
          qty: String(t.quantity ?? ''),
          hms: '',
          serial: '',
          purpose: 'SPARE',
          customer: '',
          engineer: String(
            (t.customFields as { issuedToName?: string } | null)?.issuedToName ??
              t.issuedToName ??
              '—',
          ),
          reason: String(
            (t.customFields as { reduceReason?: string } | null)?.reduceReason ?? t.notes ?? '—',
          ),
        }))
      setReduceHistory(
        [...machineRows, ...spareRows].sort((a, b) => (a.when < b.when ? 1 : -1)),
      )
    } catch {
      setReduceHistory([])
    }
  }

  useEffect(() => {
    if (mode === 'reduce') void loadReduceHistory()
  }, [mode, histMonth])

  // Server HMS preview when model + qty ready
  useEffect(() => {
    if (mode !== 'add' || category !== 'MACHINE' || !productId || hmsManual) {
      if (!productId) setPreviewHmsIds([])
      return
    }
    let cancelled = false
    void api
      .previewHmsUniqIds({ productId, quantity: nQty })
      .then((ids) => {
        if (cancelled) return
        const list = Array.isArray(ids) ? ids.map(String) : []
        setPreviewHmsIds(list)
        if (list.length) {
          setHmsStart(list[0] ?? '')
          setHmsEnd(list[list.length - 1] ?? '')
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewHmsIds([])
      })
    return () => {
      cancelled = true
    }
  }, [mode, category, productId, nQty, hmsManual])

  // Local expand when user typed HMS start manually
  useEffect(() => {
    if (!hmsManual || !hmsStart.trim()) return
    const ids = expandSerialRange(hmsStart.trim(), nQty)
    setPreviewHmsIds(ids)
    setHmsEnd(ids.length ? ids[ids.length - 1]! : '')
  }, [hmsManual, hmsStart, nQty])

  // Serial start → end autopopulate (non-weighing)
  useEffect(() => {
    if (isWeighingStock || !serialStart.trim()) {
      if (isWeighingStock) setSerialEnd('')
      return
    }
    setSerialEnd(bumpSerial(serialStart.trim(), nQty - 1))
  }, [serialStart, nQty, isWeighingStock])

  // Spare uniq start → end
  useEffect(() => {
    if (!spareUniqStart.trim()) {
      setSpareUniqEnd('')
      return
    }
    const ids = expandSerialRange(spareUniqStart.trim(), nSpareQty)
    setSpareUniqEnd(ids.length ? ids[ids.length - 1]! : '')
  }, [spareUniqStart, nSpareQty])

  const productOptions = useMemo(() => {
    return products
      .filter((p) => !stockMachineType || productMatchesStockType(p, stockMachineType))
      .map((p) => {
        const onHand = units.filter(
          (u) => String(u.productId) === String(p.id) && String(u.status) === 'IN_STOCK',
        ).length
        return {
          value: String(p.id),
          label: String(p.name),
          sublabel: `${p.sku ?? ''}${onHand ? ` · ${onHand} in stock` : ''}`,
        }
      })
  }, [products, stockMachineType, units])

  const spareOptions = useMemo(() => {
    const fam = stockMachineType ? spareFamilyFromStockType(stockMachineType) : null
    return spares
      .filter((s) => !fam || String(s.machineFamily) === fam)
      .map((s) => ({
        value: String(s.id),
        label: String(s.name),
        sublabel: `${s.machineFamily} · On hand: ${s.quantityOnHand ?? 0}`,
      }))
  }, [spares, stockMachineType])

  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ value: String(v.id), label: String(v.name) })),
    [vendors],
  )
  const brandOptions = useMemo(
    () => brands.map((b) => ({ value: String(b.id), label: String(b.name) })),
    [brands],
  )
  const engineerOptions = useMemo(
    () => engineers.map((e) => ({ value: e.id, label: e.name })),
    [engineers],
  )

  const reduceProductUnits = useMemo(() => {
    if (!productId) return []
    return units.filter(
      (u) =>
        String(u.productId) === productId &&
        (String(u.status) === 'IN_STOCK' || String(u.status) === 'DEMO'),
    )
  }, [units, productId])

  const hmsPreviewDisplay = useMemo(() => {
    if (previewHmsIds.length) return previewHmsIds
    if (!hmsStart.trim()) return [] as string[]
    return expandSerialRange(hmsStart.trim(), nQty)
  }, [previewHmsIds, hmsStart, nQty])

  const serialPreviewList = useMemo(() => {
    if (isWeighingStock) return [] as string[]
    if (!serialStart.trim()) return [] as string[]
    return expandSerialRange(serialStart.trim(), nQty)
  }, [isWeighingStock, serialStart, nQty])

  const spareUniqPreview = useMemo(() => {
    if (!spareUniqStart.trim()) return [] as string[]
    return expandSerialRange(spareUniqStart.trim(), nSpareQty)
  }, [spareUniqStart, nSpareQty])

  const unitPreviewRows = useMemo(() => {
    return Array.from({ length: nQty }, (_, i) => ({
      index: i + 1,
      hms: hmsPreviewDisplay[i] ?? '—',
      serial: isWeighingStock ? '—' : serialPreviewList[i] || '(auto / blank)',
    }))
  }, [nQty, hmsPreviewDisplay, serialPreviewList, isWeighingStock])

  function setMode(next: StockMode) {
    const p = new URLSearchParams(params)
    if (next === 'reduce') p.set('mode', 'reduce')
    else p.delete('mode')
    setParams(p, { replace: true })
  }

  async function ensureVendorId(raw: string): Promise<string | null> {
    const v = raw.trim()
    if (!v) return null
    const existing = vendors.find(
      (x) => String(x.id) === v || String(x.name).toLowerCase() === v.toLowerCase(),
    )
    if (existing) return String(existing.id)
    const created = await api.createVendor({ name: v })
    const id = String(created.id)
    setVendors((prev) => [...prev, created])
    return id
  }

  async function ensureBrandId(raw: string): Promise<string | null> {
    const v = raw.trim()
    if (!v) return null
    const existing = brands.find(
      (x) => String(x.id) === v || String(x.name).toLowerCase() === v.toLowerCase(),
    )
    if (existing) return String(existing.id)
    const created = await api.createInventoryBrand({ name: v })
    const id = String(created.id)
    setBrands((prev) => [...prev, created])
    return id
  }

  async function addMachineStock() {
    if (!stockMachineType) {
      addToast({ type: 'error', message: 'Select machine type (Weighing / Billing / …)' })
      return
    }
    if (!productId || !warehouseId) {
      addToast({ type: 'error', message: 'Model and warehouse required' })
      return
    }
    if (!hmsPreviewDisplay.length) {
      addToast({ type: 'error', message: 'HMS Unique IDs are required — wait for preview or type a start ID' })
      return
    }
    if (!isWeighingStock && !serialStart.trim()) {
      addToast({ type: 'error', message: 'Enter starting serial number' })
      return
    }
    setSaving(true)
    try {
      const vId = await ensureVendorId(vendorId)
      const bId = await ensureBrandId(brandId)
      if (!vId) {
        addToast({ type: 'error', message: 'Select or type a supplier' })
        setSaving(false)
        return
      }
      if (!bId) {
        addToast({ type: 'error', message: 'Select or type a brand' })
        setSaving(false)
        return
      }
      const hmsIds = hmsPreviewDisplay.slice(0, nQty)
      const serials = isWeighingStock
        ? hmsIds
        : expandSerialRange(serialStart.trim(), nQty)
      await api.receiveStockBatch({
        productId,
        warehouseId,
        vendorId: vId,
        brandId: bId,
        quantity: nQty,
        invoiceNo: invoiceNo.trim() || null,
        invoiceDate: invoiceDate || null,
        receivedDate: invoiceDate || todayIso(),
        unitAmount: unitCost ? Number(unitCost) : 0,
        startSerial: isWeighingStock ? null : serialStart.trim() || null,
        units: Array.from({ length: nQty }, (_, i) => ({
          serialNo: serials[i] || '',
          hmsUniqId: hmsIds[i] || undefined,
          status: 'IN_STOCK',
        })),
      })
      addToast({ type: 'success', message: `Received ${nQty} machine unit(s)` })
      navigate('/erp/stock')
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not add stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function addSpareStock() {
    if (!stockMachineType) {
      addToast({ type: 'error', message: 'Select machine type first' })
      return
    }
    if (!(nSpareQty > 0)) {
      addToast({ type: 'error', message: 'Enter quantity received' })
      return
    }
    const isNew = spareId.startsWith('__new__:')
    const name = isNew ? spareId.slice('__new__:'.length) : undefined
    if (!spareId && !name) {
      addToast({ type: 'error', message: 'Select or type spare name' })
      return
    }
    if (!supplierName.trim() && !vendorId.trim()) {
      addToast({ type: 'error', message: 'Supplier name required' })
      return
    }
    const fam = spareFamilyFromStockType(stockMachineType)
    setSaving(true)
    try {
      const supplier =
        supplierName.trim() ||
        vendors.find((v) => String(v.id) === vendorId)?.name?.toString() ||
        vendorId
      await api.receiveSpareStock({
        machineFamily: fam,
        sparePartId: isNew || !spareId ? null : spareId,
        spareName: name || undefined,
        quantity: nSpareQty,
        supplierName: String(supplier),
        invoiceDate: invoiceDate || todayIso(),
        invoiceNo: invoiceNo.trim() || null,
        notes: spareNotes.trim() || null,
        unitAmount: unitCost ? Number(unitCost) : null,
        spareUniqIds: spareUniqPreview.length ? spareUniqPreview : undefined,
      })
      addToast({ type: 'success', message: 'Spare stock received' })
      navigate('/erp/stock?category=SPARE')
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not receive spare stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function reduceMachineStock() {
    if (!stockMachineType) {
      addToast({ type: 'error', message: 'Select machine type (Billing / Weighing / …)' })
      return
    }
    if (!productId) {
      addToast({ type: 'error', message: 'Select the model (e.g. HMS 3T Superstar)' })
      return
    }
    if (!reduceUnitIds.length) {
      addToast({
        type: 'error',
        message: isWeighingStock
          ? 'Pick one or more units by HMS Unique ID'
          : 'Pick one or more units by serial + HMS Unique ID',
      })
      return
    }
    if (reducePurpose !== 'SALE' && reducePurpose !== 'DEMO') {
      addToast({ type: 'error', message: 'Select reason: Sale or Demo' })
      return
    }
    if (reducePurpose === 'DEMO' && !demoContact?.id) {
      addToast({ type: 'error', message: 'Map this demo to a customer' })
      return
    }
    const reason =
      reducePurpose === 'DEMO'
        ? reduceReasonNote.trim() ||
          `Demo — ${demoContact?.name ?? 'customer site'}`
        : reduceReasonNote.trim() || 'Sale'
    setSaving(true)
    try {
      for (const unitId of reduceUnitIds) {
        await api.reduceStockUnit(unitId, {
          purpose: reducePurpose,
          reason,
          notes: reason.slice(0, 500),
          issuedToUserId: engineerId || null,
          contactId: demoContact?.id || null,
        })
      }
      const n = reduceUnitIds.length
      addToast({
        type: 'success',
        message:
          reducePurpose === 'DEMO'
            ? n === 1
              ? '1 unit issued for demo — admin notified. Monitor on the Demo tab.'
              : `${n} units issued for demo — admin notified. Monitor on the Demo tab.`
            : n === 1
              ? '1 unit reduced for sale'
              : `${n} units reduced for sale`,
      })
      setReduceUnitIds([])
      setReducePurpose('')
      setReduceReasonNote('')
      setDemoContact(null)
      await load()
      void loadReduceHistory()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not reduce machine stock',
      })
    } finally {
      setSaving(false)
    }
  }

  async function reduceSpareStock() {
    if (!spareId || spareId.startsWith('__new__:')) {
      addToast({ type: 'error', message: 'Select an existing spare to reduce' })
      return
    }
    if (!(nSpareQty > 0)) {
      addToast({ type: 'error', message: 'Enter quantity to reduce' })
      return
    }
    if (!engineerId) {
      addToast({ type: 'error', message: 'Select service engineer (issued to)' })
      return
    }
    if (!reduceReason.trim()) {
      addToast({ type: 'error', message: 'Enter reduce reason' })
      return
    }
    setSaving(true)
    try {
      await api.issueSpareStock({
        sparePartId: spareId,
        quantity: nSpareQty,
        issuedToUserId: engineerId,
        reason: reduceReason.trim(),
        notes: reduceReason.trim().slice(0, 500),
        txnDate: todayIso(),
      })
      addToast({ type: 'success', message: `Reduced ${nSpareQty} from spare stock` })
      navigate('/erp/stock?category=SPARE')
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not reduce spare stock',
      })
    } finally {
      setSaving(false)
    }
  }

  function submit() {
    if (mode === 'add') {
      void (category === 'MACHINE' ? addMachineStock() : addSpareStock())
    } else {
      void (category === 'MACHINE' ? reduceMachineStock() : reduceSpareStock())
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Stock move" breadcrumbs={[{ label: APP_NAME }, { label: 'Stock' }]} />
        <TableSkeleton rows={8} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === 'add' ? 'Add stock' : 'Reduce stock'}
        breadcrumbs={[
          { label: APP_NAME },
          { label: 'Stock', to: '/erp/stock' },
          { label: mode === 'add' ? 'Add' : 'Reduce' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/erp/stock">
              <Button variant="outline">
                <ArrowLeft size={16} /> Back to stock
              </Button>
            </Link>
            <Button
              variant={mode === 'add' ? 'primary' : 'danger'}
              onClick={submit}
              disabled={saving}
            >
              {saving
                ? 'Saving…'
                : mode === 'add'
                  ? 'Add to stock'
                  : 'Reduce stock'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('add')}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            mode === 'add'
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700'
              : 'border-border text-text-secondary hover:bg-muted/40'
          }`}
        >
          <ArrowDownToLine size={16} /> Add stock
        </button>
        <button
          type="button"
          onClick={() => setMode('reduce')}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
            mode === 'reduce'
              ? 'border-red-500 bg-red-500/10 text-red-700'
              : 'border-border text-text-secondary hover:bg-muted/40'
          }`}
        >
          <ArrowUpFromLine size={16} /> Reduce stock
        </button>
      </div>

      {mode === 'reduce' ? (
        <PageTabs
          tabs={[
            { id: 'form', label: 'Reduce' },
            { id: 'history', label: 'Reduce history', count: reduceHistory.length },
          ]}
          active={reducePageTab}
          onChange={(id) => setReducePageTab(id === 'history' ? 'history' : 'form')}
        />
      ) : null}

      {mode === 'reduce' && reducePageTab === 'history' ? (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Month"
              type="month"
              className="w-[180px]"
              value={histMonth}
              onChange={(e) => setHistMonth(e.target.value)}
            />
            <Select
              label="Purpose"
              value={histPurpose}
              onChange={(e) => setHistPurpose(e.target.value as 'ALL' | 'SALE' | 'DEMO')}
              options={[
                { value: 'ALL', label: 'Sale + Demo + spare' },
                { value: 'SALE', label: 'Sale only' },
                { value: 'DEMO', label: 'Demo only' },
              ]}
            />
            <Button variant="outline" onClick={() => void loadReduceHistory()}>
              Refresh
            </Button>
            <Button
              onClick={() => {
                const rows = reduceHistory
                  .filter((h) => histPurpose === 'ALL' || h.purpose === histPurpose)
                  .map((h) => ({
                    When: h.when ? new Date(h.when).toLocaleString() : '',
                    Purpose: h.purpose,
                    Item: h.what,
                    Qty: h.qty,
                    'HMS Unique ID': h.hms,
                    Serial: h.serial,
                    Customer: h.customer,
                    'Issued to': h.engineer,
                    Reason: h.reason,
                  }))
                if (!rows.length) {
                  addToast({ type: 'error', message: 'No reduce rows this month' })
                  return
                }
                const saleQty = reduceHistory
                  .filter((h) => h.purpose === 'SALE')
                  .reduce((n, h) => n + Number(h.qty || 0), 0)
                const demoQty = reduceHistory
                  .filter((h) => h.purpose === 'DEMO')
                  .reduce((n, h) => n + Number(h.qty || 0), 0)
                downloadXlsx(`reduce-stock-${histMonth}.xlsx`, [
                  { name: 'Reduce history', rows },
                  {
                    name: 'Monthly summary',
                    rows: [
                      {
                        Month: histMonth,
                        Rows: rows.length,
                        'Sale qty': saleQty,
                        'Demo qty': demoQty,
                        'Spare / other':
                          reduceHistory
                            .filter((h) => h.purpose !== 'SALE' && h.purpose !== 'DEMO')
                            .reduce((n, h) => n + Number(h.qty || 0), 0),
                      },
                    ],
                  },
                ])
                addToast({ type: 'success', message: 'Monthly reduce report downloaded' })
              }}
              disabled={!reduceHistory.length}
            >
              Download monthly report
            </Button>
          </div>
          {(() => {
            const visible = reduceHistory.filter(
              (h) => histPurpose === 'ALL' || h.purpose === histPurpose,
            )
            const saleQty = visible
              .filter((h) => h.purpose === 'SALE')
              .reduce((n, h) => n + Number(h.qty || 0), 0)
            const demoQty = visible
              .filter((h) => h.purpose === 'DEMO')
              .reduce((n, h) => n + Number(h.qty || 0), 0)
            if (!visible.length) {
              return (
                <p className="py-8 text-center text-sm text-text-secondary">
                  No reduce movements in {histMonth}. Change month or reduce stock first.
                </p>
              )
            }
            return (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge color="red">Sale {saleQty}</Badge>
                  <Badge color="amber">Demo {demoQty}</Badge>
                  <span className="text-text-secondary">{visible.length} rows</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-semibold">When</th>
                        <th className="px-3 py-2 font-semibold">Purpose</th>
                        <th className="px-3 py-2 font-semibold">Item</th>
                        <th className="px-3 py-2 font-semibold">HMS ID</th>
                        <th className="px-3 py-2 font-semibold">Serial</th>
                        <th className="px-3 py-2 font-semibold">Customer</th>
                        <th className="px-3 py-2 font-semibold">Qty</th>
                        <th className="px-3 py-2 font-semibold">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((h, i) => (
                        <tr key={`${h.when}-${i}`} className="border-t border-border/70">
                          <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                            {h.when ? new Date(h.when).toLocaleString() : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              color={
                                h.purpose === 'DEMO'
                                  ? 'amber'
                                  : h.purpose === 'SALE'
                                    ? 'red'
                                    : 'gray'
                              }
                            >
                              {h.purpose}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-medium">{h.what}</td>
                          <td className="px-3 py-2 font-mono text-xs">{h.hms || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{h.serial || '—'}</td>
                          <td className="px-3 py-2">{h.customer || '—'}</td>
                          <td className="px-3 py-2 tabular-nums">{h.qty}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-text-secondary">
                            {h.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </Card>
      ) : null}

      {!(mode === 'reduce' && reducePageTab === 'history') ? (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <Card className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Category *"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as Category)
                setProductId('')
                setSpareId('')
                setStockMachineType('')
              }}
              options={[
                { value: 'MACHINE', label: 'Machine' },
                { value: 'SPARE', label: 'Spare' },
              ]}
            />
            <Select
              label="Machine type *"
              value={stockMachineType}
              onChange={(e) => {
                setStockMachineType(e.target.value as StockMachineType | '')
                setProductId('')
                setSpareId('')
                setHmsManual(false)
                setPreviewHmsIds([])
              }}
              options={[
                { value: '', label: 'Weighing / Billing / Touch POS / …' },
                ...STOCK_MACHINE_TYPES.map((t) => ({ value: t.value, label: t.label })),
              ]}
            />
          </div>

          {mode === 'add' && category === 'MACHINE' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect
                label="Brand *"
                value={brandId}
                allowCreate
                placeholder="Search or type brand…"
                options={brandOptions}
                onChange={setBrandId}
              />
              <SearchableSelect
                label="Model *"
                value={productId}
                onChange={(v) => {
                  setProductId(v)
                  setHmsManual(false)
                }}
                placeholder={stockMachineType ? 'Search model…' : 'Pick machine type first'}
                options={productOptions}
              />
              <SearchableSelect
                label="Supplier *"
                value={vendorId}
                allowCreate
                placeholder="Search or type supplier…"
                options={vendorOptions}
                onChange={setVendorId}
              />
              <Select
                label="Warehouse *"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                options={[
                  { value: '', label: 'Select…' },
                  ...warehouses.map((w) => ({ value: w.id, label: w.name })),
                ]}
              />
              <Input
                label="Invoice date *"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
              <Input
                label="Qty received *"
                inputMode="numeric"
                value={qty}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onBlur={() => {
                  const n = Math.floor(Number(qty) || 0)
                  if (n < 1) setQty('1')
                  else if (n > 200) setQty('200')
                  else setQty(String(n))
                }}
              />
              <Input
                label="Invoice number"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />
              <Input
                label="Per unit amount"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
              <Input
                label="HMS Unique ID (start) *"
                value={hmsStart}
                onChange={(e) => {
                  setHmsManual(true)
                  setHmsStart(e.target.value)
                }}
                placeholder="Auto from model, or type start"
              />
              <Input
                label="HMS Unique ID (end)"
                value={hmsEnd}
                readOnly
                className="bg-muted/30"
                placeholder="Auto from start + qty"
              />
              {!isWeighingStock ? (
                <>
                  <Input
                    label="Serial number (start) *"
                    value={serialStart}
                    onChange={(e) => setSerialStart(e.target.value)}
                    placeholder="Start serial"
                  />
                  <Input
                    label="Serial number (end)"
                    value={serialEnd}
                    readOnly
                    className="bg-muted/30"
                    placeholder="Auto from start + qty"
                  />
                </>
              ) : (
                <div className="sm:col-span-2 rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-sm text-text-secondary">
                  Weighing machines do not use a manufacturer serial — only HMS Unique ID is stored
                  and shown.
                </div>
              )}
            </div>
          ) : null}

          {mode === 'add' && category === 'SPARE' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect
                label="Spare *"
                value={spareId}
                allowCreate
                createLabel={(q) => `New spare “${q}”`}
                placeholder={stockMachineType ? 'Search or type spare…' : 'Pick machine type first'}
                options={spareOptions}
                onChange={(v) => {
                  const known = spareOptions.find((o) => o.value === v)
                  if (known) setSpareId(v)
                  else setSpareId(`__new__:${v}`)
                }}
              />
              <SearchableSelect
                label="Supplier *"
                value={supplierName || vendorId}
                allowCreate
                placeholder="Search or type supplier…"
                options={vendorOptions.map((v) => ({ value: v.label, label: v.label }))}
                onChange={(v) => {
                  setSupplierName(v)
                  setVendorId('')
                }}
              />
              <Input
                label="Invoice date *"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
              <Input
                label="Qty received *"
                inputMode="numeric"
                value={spareQty}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                  setSpareQty(v)
                  setQty(v)
                }}
                onBlur={() => {
                  const n = Math.floor(Number(spareQty || qty) || 0)
                  const next = n < 1 ? '1' : n > 200 ? '200' : String(n)
                  setSpareQty(next)
                  setQty(next)
                }}
              />
              <Input
                label="Invoice number"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />
              <Input
                label="Per unit amount"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
              <Input
                label="Spare unique ID (start)"
                value={spareUniqStart}
                onChange={(e) => setSpareUniqStart(e.target.value)}
                placeholder="e.g. SP-2026-0001"
              />
              <Input
                label="Spare unique ID (end)"
                value={spareUniqEnd}
                readOnly
                className="bg-muted/30"
                placeholder="Auto from start + qty"
              />
              <div className="sm:col-span-2">
                <Input
                  label="Notes"
                  value={spareNotes}
                  onChange={(e) => setSpareNotes(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {mode === 'reduce' && category === 'MACHINE' ? (
            <div className="space-y-4">
              <ol className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                {[
                  { n: 1, label: 'Category', done: true },
                  { n: 2, label: 'Machine type', done: Boolean(stockMachineType) },
                  { n: 3, label: 'Model', done: Boolean(productId) },
                  { n: 4, label: 'Pick unit(s)', done: reduceUnitIds.length > 0 },
                  { n: 5, label: 'Reason', done: Boolean(reducePurpose) },
                  {
                    n: 6,
                    label: 'Customer',
                    done: reducePurpose !== 'DEMO' || Boolean(demoContact?.id),
                  },
                ].map((s) => (
                  <li
                    key={s.n}
                    className={`rounded-full border px-2.5 py-1 ${
                      s.done
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700'
                        : 'border-border bg-muted/30'
                    }`}
                  >
                    {s.n}. {s.label}
                  </li>
                ))}
              </ol>

              <p className="text-xs text-text-secondary">
                Path: Machine → type → model → pick unit(s) → reason (Sale / Demo). Select more
                than one unit when the customer ordered multiple of the same model.
                {isWeighingStock
                  ? ' Weighing units use HMS Unique ID only (no manufacturer serial).'
                  : ' Billing / other: each unit has serial + HMS Unique ID.'}
              </p>

              {!stockMachineType ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {STOCK_MACHINE_TYPES.map((t) => {
                    const count = units.filter((u) => {
                      const p = products.find((x) => String(x.id) === String(u.productId))
                      return (
                        p &&
                        productMatchesStockType(p, t.value) &&
                        String(u.status) === 'IN_STOCK'
                      )
                    }).length
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => {
                          setStockMachineType(t.value)
                          setProductId('')
                          setReduceUnitIds([])
                          setReducePurpose('')
                        }}
                        className="rounded-lg border border-border bg-card px-3 py-3 text-left transition hover:border-accent-blue/50"
                      >
                        <div className="text-sm font-semibold text-text-primary">{t.label}</div>
                        <div className="mt-0.5 text-[11px] text-text-secondary">
                          {count} unit{count === 1 ? '' : 's'} available
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    Type: {STOCK_MACHINE_TYPES.find((t) => t.value === stockMachineType)?.label}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-accent-blue hover:underline"
                    onClick={() => {
                      setStockMachineType('')
                      setProductId('')
                      setReduceUnitIds([])
                      setReducePurpose('')
                    }}
                  >
                    Change type
                  </button>
                </div>
              )}

              {stockMachineType ? (
                <SearchableSelect
                  label="Model *"
                  value={productId}
                  onChange={(v) => {
                    setProductId(v)
                    setReduceUnitIds([])
                    setReducePurpose('')
                  }}
                  placeholder="Search model — e.g. HMS 3T Superstar…"
                  options={productOptions.filter((o) => {
                    const onHand = units.filter(
                      (u) =>
                        String(u.productId) === o.value && String(u.status) === 'IN_STOCK',
                    ).length
                    return onHand > 0 || o.value === productId
                  })}
                />
              ) : null}

              {productId ? (
                <div>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold text-text-primary">
                      Units in stock — select one or more
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-text-secondary">
                        {reduceProductUnits.filter((u) => String(u.status) === 'IN_STOCK').length}{' '}
                        in stock
                        {reduceUnitIds.length > 0
                          ? ` · ${reduceUnitIds.length} selected`
                          : ''}
                      </span>
                      {reduceProductUnits.filter((u) => String(u.status) === 'IN_STOCK').length >
                      1 ? (
                        <button
                          type="button"
                          className="font-medium text-accent-blue hover:underline"
                          onClick={() => {
                            const all = reduceProductUnits
                              .filter((u) => String(u.status) === 'IN_STOCK')
                              .map((u) => String(u.id))
                            setReduceUnitIds((prev) =>
                              prev.length === all.length ? [] : all,
                            )
                          }}
                        >
                          {reduceUnitIds.length ===
                          reduceProductUnits.filter((u) => String(u.status) === 'IN_STOCK')
                            .length
                            ? 'Clear all'
                            : 'Select all'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-text-secondary">
                    Tick every unit you need (same model, qty 2+). Then choose Sale or Demo below.
                  </p>
                  {reduceProductUnits.filter((u) => String(u.status) === 'IN_STOCK').length ===
                  0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-sm text-text-secondary">
                      No units for this model. Receive stock first (Add stock).
                    </p>
                  ) : (
                    <ul className="max-h-[min(50vh,360px)] space-y-1.5 overflow-auto">
                      {reduceProductUnits
                        .filter((u) => String(u.status) === 'IN_STOCK')
                        .map((u) => {
                          const id = String(u.id)
                          const selected = reduceUnitIds.includes(id)
                          const hms = u.hmsUniqId ? String(u.hmsUniqId) : ''
                          const serial = u.serialNo ? String(u.serialNo) : ''
                          const serialSameAsHms =
                            Boolean(hms) && Boolean(serial) && hms === serial
                          return (
                            <li key={id}>
                              <button
                                type="button"
                                onClick={() => toggleReduceUnit(id)}
                                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                                  selected
                                    ? 'border-red-500 bg-red-500/10'
                                    : 'border-border hover:border-accent-blue/40'
                                }`}
                              >
                                <div className="flex min-w-0 items-start gap-2.5">
                                  <span
                                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                                      selected
                                        ? 'border-red-600 bg-red-600 text-white'
                                        : 'border-border bg-card text-transparent'
                                    }`}
                                    aria-hidden
                                  >
                                    ✓
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-mono text-sm font-semibold text-text-primary">
                                      HMS {hms || '—'}
                                    </div>
                                    <div className="font-mono text-[11px] text-text-secondary">
                                      Serial{' '}
                                      {serial
                                        ? serialSameAsHms && isWeighingStock
                                          ? `${serial} (same as HMS)`
                                          : serial
                                        : isWeighingStock
                                          ? 'none (weighing)'
                                          : '—'}{' '}
                                      · {String(u.status)}
                                    </div>
                                  </div>
                                </div>
                                {selected ? (
                                  <span className="shrink-0 text-xs font-bold text-red-600">
                                    Added
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-xs text-text-secondary">Add</span>
                                )}
                              </button>
                            </li>
                          )
                        })}
                    </ul>
                  )}
                </div>
              ) : null}

              {reduceUnitIds.length > 0 ? (
                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Reason * — why reduce stock?
                    </h3>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      Warehouse / inventory: Sale removes units for a customer order. Demo issues
                      units temporarily to the customer site (still trackable, can return).
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        {
                          id: 'SALE' as const,
                          title: 'Sale',
                          body: 'Customer ordered — stock out for sale / dispatch.',
                        },
                        {
                          id: 'DEMO' as const,
                          title: 'Demo',
                          body: 'Taken from warehouse to customer place for demo.',
                        },
                      ] as const
                    ).map((opt) => {
                      const on = reducePurpose === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setReducePurpose(opt.id)}
                          className={`rounded-lg border px-3 py-3 text-left transition ${
                            on
                              ? 'border-accent-blue bg-accent-blue/10 ring-2 ring-accent-blue/25'
                              : 'border-border hover:border-accent-blue/40'
                          }`}
                        >
                          <div className="text-sm font-semibold text-text-primary">{opt.title}</div>
                          <div className="mt-0.5 text-[11px] text-text-secondary">{opt.body}</div>
                        </button>
                      )
                    })}
                  </div>
                  {reducePurpose === 'DEMO' ? (
                    <ContactPicker
                      label="Demo customer *"
                      valueId={demoContact?.id ?? ''}
                      selected={demoContact}
                      onSelect={setDemoContact}
                      returnTo="/erp/stock/move?mode=reduce"
                    />
                  ) : null}
                  {reducePurpose ? (
                    <Input
                      label={
                        reducePurpose === 'DEMO'
                          ? 'Demo note (optional)'
                          : 'Sale note (optional)'
                      }
                      value={reduceReasonNote}
                      onChange={(e) => setReduceReasonNote(e.target.value)}
                      placeholder={
                        reducePurpose === 'DEMO'
                          ? 'e.g. Demo at Anna Nagar Fresh Mart'
                          : 'e.g. SO-1042 / walk-in sale'
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'reduce' && category === 'SPARE' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <SearchableSelect
                label="Spare *"
                value={spareId}
                onChange={setSpareId}
                placeholder={stockMachineType ? 'Select spare…' : 'Pick machine type first'}
                options={spareOptions}
              />
              <Input
                label="Qty to reduce *"
                inputMode="numeric"
                value={spareQty}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                  setSpareQty(v)
                  setQty(v)
                }}
              />
              {spareId && !spareId.startsWith('__new__:') ? (
                <p className="sm:col-span-2 text-sm text-text-secondary">
                  On hand:{' '}
                  <span className="font-semibold text-text-primary">
                    {String(spares.find((s) => String(s.id) === spareId)?.quantityOnHand ?? 0)}
                  </span>
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <Input
                  label="Reduce reason *"
                  value={reduceReason}
                  onChange={(e) => setReduceReason(e.target.value)}
                  placeholder="Why reducing?"
                />
              </div>
              <div className="sm:col-span-2">
                <SearchableSelect
                  label="Issued to (service engineer) *"
                  value={engineerId}
                  onChange={setEngineerId}
                  placeholder="Select engineer…"
                  options={engineerOptions}
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Link to="/erp/stock">
              <Button variant="outline" disabled={saving}>
                Cancel
              </Button>
            </Link>
            <Button
              variant={mode === 'add' ? 'primary' : 'danger'}
              onClick={submit}
              disabled={saving}
            >
              {saving
                ? 'Saving…'
                : mode === 'add'
                  ? 'Add to stock'
                  : 'Reduce stock'}
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          {mode === 'add' ? (
            <Card className="overflow-hidden p-0">
              <div className="border-b border-border bg-muted/20 px-4 py-3">
                <h2 className="text-sm font-semibold text-text-primary">
                  Preview before adding
                </h2>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {category === 'MACHINE'
                    ? isWeighingStock
                      ? `${nQty} unit(s) · HMS Unique ID only (weighing)`
                      : `${nQty} unit(s) · HMS Unique ID + serial`
                    : `${nSpareQty} spare unit(s)`}
                </p>
              </div>
              {category === 'MACHINE' ? (
                unitPreviewRows.length === 0 || !hmsPreviewDisplay.length ? (
                  <p className="px-4 py-6 text-sm text-text-secondary">
                    Select model and qty — HMS IDs fill automatically. Review the list, then click
                    Add to stock.
                  </p>
                ) : (
                  <div className="max-h-[min(60vh,520px)] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-text-secondary">
                        <tr>
                          <th className="px-3 py-2 font-medium">#</th>
                          <th className="px-3 py-2 font-medium">HMS Unique ID</th>
                          {!isWeighingStock ? (
                            <th className="px-3 py-2 font-medium">Serial</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {unitPreviewRows.map((row) => (
                          <tr key={row.index} className="border-t border-border">
                            <td className="px-3 py-1.5 text-text-secondary">{row.index}</td>
                            <td className="px-3 py-1.5 font-mono text-[13px] text-text-primary">
                              {row.hms}
                            </td>
                            {!isWeighingStock ? (
                              <td className="px-3 py-1.5 font-mono text-[13px] text-text-primary">
                                {row.serial}
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : spareUniqPreview.length ? (
                <div className="max-h-[min(60vh,520px)] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Spare unique ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spareUniqPreview.map((id, i) => (
                        <tr key={`${id}-${i}`} className="border-t border-border">
                          <td className="px-3 py-1.5 text-text-secondary">{i + 1}</td>
                          <td className="px-3 py-1.5 font-mono text-[13px]">{id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-sm text-text-secondary">
                  Optional: enter a spare unique ID start to preview the range for qty {nSpareQty}.
                </p>
              )}
            </Card>
          ) : (
            <>
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold text-text-primary">
                  Selected unit{reduceUnitIds.length === 1 ? '' : 's'}
                </h2>
                {!stockMachineType || !productId ? (
                  <p className="text-xs text-text-secondary">
                    Choose type → model → unit(s) → Sale or Demo. Same model can pick multiple
                    units (e.g. customer ordered 2).
                  </p>
                ) : reduceUnitIds.length === 0 ? (
                  <p className="text-xs text-text-secondary">
                    {
                      reduceProductUnits.filter((u) => String(u.status) === 'IN_STOCK').length
                    }{' '}
                    unit(s) of this model — tap to select one or more
                    {isWeighingStock ? ' (HMS ID).' : ' (serial + HMS).'}
                  </p>
                ) : (
                  (() => {
                    const model = products.find((p) => String(p.id) === productId)
                    const picked = reduceProductUnits.filter((x) =>
                      reduceUnitIds.includes(String(x.id)),
                    )
                    return (
                      <div className="space-y-2 text-sm">
                        <div>
                          <div className="text-[11px] text-text-secondary">Model</div>
                          <div className="font-semibold">{String(model?.name ?? '—')}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-text-secondary">
                            Reason{' '}
                            {reducePurpose
                              ? `· ${reducePurpose === 'DEMO' ? 'Demo' : 'Sale'}`
                              : '· pick Sale or Demo'}
                            {reducePurpose === 'DEMO' && demoContact
                              ? ` · ${demoContact.name}`
                              : ''}
                          </div>
                        </div>
                        <ul className="space-y-1.5">
                          {picked.map((u) => {
                            const hms = u.hmsUniqId ? String(u.hmsUniqId) : ''
                            const serial = u.serialNo ? String(u.serialNo) : ''
                            return (
                              <li
                                key={String(u.id)}
                                className="rounded-md border border-border px-2 py-1.5 font-mono text-xs"
                              >
                                {`HMS ${hms || '—'} · Serial ${serial || (isWeighingStock ? 'none' : '—')}`}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })()
                )}
              </Card>
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold text-text-primary">Reduce history</h2>
                <p className="text-xs text-text-secondary">
                  Monthly sale / demo report with HMS ID, serial, and mapped customer.
                </p>
                <Button variant="outline" onClick={() => setReducePageTab('history')}>
                  Open reduce history
                </Button>
              </Card>
            </>
          )}
        </div>
      </div>
      ) : null}
    </div>
  )
}

export default StockMovePage
