import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Eye, Package, Plus, Truck, Warehouse } from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type LineDraft = {
  key: string
  productId: string
  description: string
  quantity: string
  unitPrice: string
  taxPercent: string
}

type Vendor = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  gstin?: string | null
  paymentTerms?: string | null
  address?: Record<string, unknown> | null
}

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    productId: '',
    description: '',
    quantity: '1',
    unitPrice: '',
    taxPercent: '18',
  }
}

function lineTotals(line: LineDraft) {
  const base = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
  const tax = (base * (Number(line.taxPercent) || 0)) / 100
  return { base, tax, total: base + tax }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function printPurchaseOrder(po: Record<string, unknown>, companyName = 'NovaCRM Workspace') {
  const vendor = (po.vendor as Record<string, unknown> | null) ?? {}
  const lines = ((po.lines as Array<Record<string, unknown>>) ?? []).map((l) => ({
    description: String(l.description ?? ''),
    quantity: num(l.quantity),
    receivedQty: num(l.receivedQty),
    unitPrice: num(l.unitPrice),
    taxPercent: num(l.taxPercent),
    lineTotal: num(l.lineTotal),
  }))
  const addr = vendor.address as Record<string, unknown> | null | undefined
  const addressLine = addr
    ? [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')
    : ''
  const cf = (po.customFields as Record<string, string> | null) ?? {}

  const rows = lines
    .map(
      (l, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(l.description)}</td>
      <td style="text-align:right">${l.quantity}</td>
      <td style="text-align:right">${formatCurrency(l.unitPrice)}</td>
      <td style="text-align:right">${l.taxPercent}%</td>
      <td style="text-align:right">${formatCurrency(l.lineTotal)}</td>
    </tr>`,
    )
    .join('')

  const html = `<!doctype html><html><head><title>${escapeHtml(String(po.poNumber ?? 'PO'))}</title>
<style>
  body{font-family:Georgia,serif;color:#0f172a;margin:28px;font-size:13px}
  .brand{font-size:22px;font-weight:700;letter-spacing:.02em}
  .muted{color:#64748b}
  .box{border:1px solid #cbd5e1;padding:14px;border-radius:4px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}
  table{width:100%;border-collapse:collapse;margin-top:18px}
  th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}
  th{background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .totals{width:280px;margin-left:auto;margin-top:14px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0}
  .grand{font-weight:700;font-size:15px;border-top:2px solid #0f172a;margin-top:6px;padding-top:8px}
  .stamp{display:inline-block;border:2px solid #0f172a;padding:4px 10px;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
  @media print{button{display:none} body{margin:12px}}
</style></head><body>
  <button onclick="window.print()" style="margin-bottom:14px;padding:8px 12px;font-family:sans-serif">Print / Save PDF</button>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div class="brand">${escapeHtml(companyName)}</div>
      <div class="muted">Purchase Order</div>
    </div>
    <div style="text-align:right">
      <div class="stamp">${escapeHtml(String(po.status ?? ''))}</div>
      <div style="margin-top:8px;font-size:18px;font-weight:700">${escapeHtml(String(po.poNumber ?? ''))}</div>
      <div class="muted">Date: ${po.orderDate ? escapeHtml(formatDate(String(po.orderDate))) : '—'}</div>
      ${po.expectedDate ? `<div class="muted">Expected: ${escapeHtml(formatDate(String(po.expectedDate)))}</div>` : ''}
    </div>
  </div>
  <div class="grid">
    <div class="box">
      <div class="muted" style="margin-bottom:6px">Vendor / Supplier</div>
      <strong>${escapeHtml(String(vendor.name ?? '—'))}</strong>
      ${vendor.gstin ? `<div>GSTIN: ${escapeHtml(String(vendor.gstin))}</div>` : ''}
      ${vendor.phone ? `<div>${escapeHtml(String(vendor.phone))}</div>` : ''}
      ${vendor.email ? `<div>${escapeHtml(String(vendor.email))}</div>` : ''}
      ${addressLine ? `<div class="muted">${escapeHtml(addressLine)}</div>` : ''}
      ${vendor.paymentTerms ? `<div>Terms: ${escapeHtml(String(vendor.paymentTerms))}</div>` : ''}
    </div>
    <div class="box">
      <div class="muted" style="margin-bottom:6px">Ship / Bill details</div>
      ${cf.ship_to ? `<div><strong>Ship to</strong><br/>${escapeHtml(cf.ship_to)}</div>` : '<div class="muted">Default warehouse</div>'}
      ${cf.buyer_ref ? `<div style="margin-top:8px">Buyer ref: ${escapeHtml(cf.buyer_ref)}</div>` : ''}
      ${cf.delivery_terms ? `<div>Delivery: ${escapeHtml(cf.delivery_terms)}</div>` : ''}
      ${cf.payment_terms ? `<div>Payment: ${escapeHtml(cf.payment_terms)}</div>` : ''}
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Tax</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span class="muted">Subtotal</span><span>${formatCurrency(num(po.subtotal))}</span></div>
    <div><span class="muted">Tax</span><span>${formatCurrency(num(po.taxTotal))}</span></div>
    <div class="grand"><span>Grand total</span><span>${formatCurrency(num(po.grandTotal))}</span></div>
  </div>
  ${po.notes ? `<p style="margin-top:24px"><strong>Notes / instructions</strong><br/>${escapeHtml(String(po.notes))}</p>` : ''}
  <div style="margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:40px">
    <div style="border-top:1px solid #94a3b8;padding-top:8px" class="muted">Prepared by</div>
    <div style="border-top:1px solid #94a3b8;padding-top:8px;text-align:right" class="muted">Authorized signatory</div>
  </div>
</body></html>`

  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

export function PurchaseOrdersPage() {
  const tip = DEFAULT_TIPS['erp.purchase_orders'] ?? {
    title: 'Purchase orders',
    body: 'Maintain vendors, raise multi-line POs, print a professional PO, then Receive goods to update inventory.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<'orders' | 'vendors' | 'create'>('orders')
  const [statusFilter, setStatusFilter] = useState('')
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; purchasePrice: number; taxPercent: number }>
  >([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [vendorForm, setVendorForm] = useState({
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
  const [form, setForm] = useState({
    vendorId: '',
    warehouseId: '',
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDate: '',
    notes: '',
    shipTo: '',
    buyerRef: '',
    deliveryTerms: 'Door delivery',
    paymentTerms: 'Net 30',
    status: 'SENT',
  })
  const [lines, setLines] = useState<LineDraft[]>([newLine()])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pos, vendorRows, lookups] = await Promise.all([
        api.purchaseOrders({ limit: 100 }),
        api.vendors(),
        api.lookups(),
      ])
      setItems(pos.items ?? [])
      setVendors(vendorRows as Vendor[])
      setWarehouses(lookups.warehouses)
      setProducts(
        lookups.products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          purchasePrice: num(p.purchasePrice),
          taxPercent: num(p.taxPercent),
        })),
      )
      setForm((f) => ({
        ...f,
        warehouseId: f.warehouseId || lookups.warehouses[0]?.id || '',
        vendorId: f.vendorId || (vendorRows[0] as Vendor | undefined)?.id || '',
      }))
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Failed to load POs' })
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    let subtotal = 0
    let taxTotal = 0
    for (const line of lines) {
      const t = lineTotals(line)
      subtotal += t.base
      taxTotal += t.tax
    }
    return { subtotal, taxTotal, grandTotal: subtotal + taxTotal }
  }, [lines])

  async function saveVendor() {
    if (!vendorForm.name.trim()) {
      addToast({ type: 'error', message: 'Vendor name is required' })
      return
    }
    setSaving(true)
    try {
      const row = (await api.createVendor({
        name: vendorForm.name.trim(),
        phone: vendorForm.phone || null,
        email: vendorForm.email || null,
        gstin: vendorForm.gstin || null,
        paymentTerms: vendorForm.paymentTerms || null,
        address: {
          line1: vendorForm.line1 || null,
          city: vendorForm.city || null,
          state: vendorForm.state || null,
          pincode: vendorForm.pincode || null,
        },
      })) as Vendor
      addToast({ type: 'success', message: 'Vendor saved' })
      setVendorForm({
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
      await load()
      setForm((f) => ({ ...f, vendorId: row.id }))
      setTab('create')
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Vendor failed' })
    } finally {
      setSaving(false)
    }
  }

  async function createPo() {
    if (!form.vendorId) {
      addToast({ type: 'error', message: 'Select a vendor' })
      return
    }
    if (!lines.every((l) => l.productId && Number(l.quantity) > 0 && l.unitPrice !== '')) {
      addToast({ type: 'error', message: 'Each line needs product, qty and rate' })
      return
    }
    setSaving(true)
    try {
      const created = (await api.createPurchaseOrder({
        vendorId: form.vendorId,
        warehouseId: form.warehouseId || null,
        orderDate: form.orderDate,
        expectedDate: form.expectedDate || null,
        notes: form.notes || null,
        status: form.status,
        customFields: {
          ship_to: form.shipTo || null,
          buyer_ref: form.buyerRef || null,
          delivery_terms: form.deliveryTerms || null,
          payment_terms: form.paymentTerms || null,
        },
        lines: lines.map((l) => ({
          productId: l.productId,
          description: l.description || products.find((p) => p.id === l.productId)?.name,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxPercent: Number(l.taxPercent) || 0,
        })),
      })) as Record<string, unknown>
      addToast({ type: 'success', message: 'Purchase order created' })
      setLines([newLine()])
      await load()
      setTab('orders')
      const full = await api.getPurchaseOrder(String(created.id))
      setDetail(full)
      setDetailOpen(true)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'PO failed' })
    } finally {
      setSaving(false)
    }
  }

  async function openPo(id: string) {
    try {
      const po = await api.getPurchaseOrder(id)
      setDetail(po)
      setDetailOpen(true)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Could not open PO' })
    }
  }

  async function receive(poId: string) {
    try {
      const po = await api.getPurchaseOrder(poId)
      const poLines = (po.lines as Array<Record<string, unknown>>) ?? []
      const payload = poLines
        .map((l) => ({
          lineId: String(l.id),
          quantity: Math.max(0, num(l.quantity) - num(l.receivedQty)),
        }))
        .filter((l) => l.quantity > 0)
      if (!payload.length) {
        addToast({ type: 'info', message: 'Nothing left to receive' })
        return
      }
      await api.receivePurchaseOrder(poId, payload)
      addToast({ type: 'success', message: 'Goods received — stock updated' })
      await load()
      if (detailOpen) await openPo(poId)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Receive failed' })
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        count={items.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Purchase orders' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/erp/products">
              <Button variant="outline">
                <Package size={16} /> Products
              </Button>
            </Link>
            <Link to="/erp/inventory">
              <Button variant="outline">
                <Warehouse size={16} /> Inventory
              </Button>
            </Link>
            <Button variant="outline" onClick={() => setTab('vendors')}>
              <Truck size={16} /> Vendors ({vendors.length})
            </Button>
            <Button onClick={() => setTab('create')}>
              <Plus size={16} /> New PO
            </Button>
          </div>
        }
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <PageTabs
        accent="emerald"
        active={tab}
        onChange={(id) => setTab(id as 'orders' | 'vendors' | 'create')}
        tabs={[
          { id: 'orders', label: 'All POs', count: items.length },
          { id: 'vendors', label: 'Vendors', count: vendors.length },
          { id: 'create', label: 'Create PO' },
        ]}
      />

      {tab === 'orders' && (
        <Card padding={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            {[
              { value: '', label: 'All statuses' },
              { value: 'DRAFT', label: 'Draft' },
              { value: 'SENT', label: 'Sent' },
              { value: 'PARTIAL', label: 'Partial' },
              { value: 'RECEIVED', label: 'Received' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ].map((opt) => (
              <button
                key={opt.value || 'all'}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  statusFilter === opt.value
                    ? 'bg-accent-blue text-white'
                    : 'bg-muted text-text-secondary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {items.filter((po) => !statusFilter || String(po.status) === statusFilter).length === 0 ? (
            <EmptyState
              title="No purchase orders"
              subtitle="Add a vendor, then create a multi-line PO."
              actionLabel="Create PO"
              onAction={() => setTab(vendors.length ? 'create' : 'vendors')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['PO #', 'Vendor', 'Date', 'Expected', 'Status', 'Subtotal', 'Tax', 'Total', 'Actions'].map(
                      (h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter((po) => !statusFilter || String(po.status) === statusFilter)
                    .map((po) => {
                    const vendor = po.vendor as { name?: string } | null
                    return (
                      <tr key={String(po.id)} className="border-t border-border hover:bg-surface">
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{String(po.poNumber)}</td>
                        <td className="px-4 py-3">{vendor?.name ?? '—'}</td>
                        <td className="px-4 py-3">{po.orderDate ? formatDate(String(po.orderDate)) : '—'}</td>
                        <td className="px-4 py-3">
                          {po.expectedDate ? formatDate(String(po.expectedDate)) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color="blue">{String(po.status)}</Badge>
                        </td>
                        <td className="px-4 py-3">{formatCurrency(num(po.subtotal))}</td>
                        <td className="px-4 py-3">{formatCurrency(num(po.taxTotal))}</td>
                        <td className="px-4 py-3 font-semibold">{formatCurrency(num(po.grandTotal))}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Button variant="ghost" size="sm" onClick={() => void openPo(String(po.id))}>
                              <Eye size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void openPo(String(po.id)).then(async () => {
                                  const full = await api.getPurchaseOrder(String(po.id))
                                  printPurchaseOrder(full)
                                })
                              }
                            >
                              <Download size={14} />
                            </Button>
                            {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' ? (
                              <Button size="sm" variant="outline" onClick={() => void receive(String(po.id))}>
                                Receive
                              </Button>
                            ) : null}
                            {po.status === 'RECEIVED' ? (
                              <Link to="/erp/inventory">
                                <Button size="sm" variant="outline">
                                  Stock
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
          )}
        </Card>
      )}

      {tab === 'vendors' && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card padding={false}>
            <div className="border-b border-border px-4 py-3 font-semibold">Vendor directory</div>
            {vendors.length === 0 ? (
              <EmptyState title="No vendors yet" subtitle="Add your first supplier on the right." />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Name', 'Phone', 'GSTIN', 'Terms'].map((h) => (
                      <th key={h} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-text-secondary">{v.email || '—'}</div>
                      </td>
                      <td className="px-4 py-3">{v.phone || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{v.gstin || '—'}</td>
                      <td className="px-4 py-3">{v.paymentTerms || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Add vendor</h2>
            <div className="grid gap-3">
              <Input label="Vendor name *" value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} />
              <Input label="Phone" value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} />
              <Input label="Email" value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} />
              <Input label="GSTIN" value={vendorForm.gstin} onChange={(e) => setVendorForm({ ...vendorForm, gstin: e.target.value })} />
              <Input label="Payment terms" value={vendorForm.paymentTerms} onChange={(e) => setVendorForm({ ...vendorForm, paymentTerms: e.target.value })} />
              <Input label="Address" value={vendorForm.line1} onChange={(e) => setVendorForm({ ...vendorForm, line1: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Input label="City" value={vendorForm.city} onChange={(e) => setVendorForm({ ...vendorForm, city: e.target.value })} />
                <Input label="State" value={vendorForm.state} onChange={(e) => setVendorForm({ ...vendorForm, state: e.target.value })} />
                <Input label="PIN" value={vendorForm.pincode} onChange={(e) => setVendorForm({ ...vendorForm, pincode: e.target.value })} />
              </div>
              <Button onClick={() => void saveVendor()} disabled={saving}>
                {saving ? 'Saving…' : 'Save vendor'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'create' && (
        <FormPanel
          open
          accent="emerald"
          eyebrow="Purchasing"
          title="Create purchase order"
          subtitle="Full-page PO with multiple products. After save you can print a professional PO document."
          onClose={() => setTab('orders')}
          footer={
            vendors.length ? (
              <>
                <FormPanelCancel onClick={() => setTab('orders')} />
                <Button onClick={() => void createPo()} disabled={saving}>
                  {saving ? 'Creating…' : 'Create & open PO'}
                </Button>
              </>
            ) : undefined
          }
        >
          {!vendors.length ? (
            <EmptyState
              title="Add a vendor first"
              subtitle="Vendors appear here after you create them."
              actionLabel="Go to vendors"
              onAction={() => setTab('vendors')}
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Select
                  label="Vendor *"
                  value={form.vendorId}
                  onChange={(e) => setForm({ ...form, vendorId: e.target.value })}
                  options={vendors.map((v) => ({ value: v.id, label: v.name }))}
                />
                <Select
                  label="Warehouse"
                  value={form.warehouseId}
                  onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                />
                <Select
                  label="Status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  options={[
                    { value: 'DRAFT', label: 'Draft' },
                    { value: 'SENT', label: 'Sent to vendor' },
                  ]}
                />
                <Input label="Order date" type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} />
                <Input label="Expected delivery" type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
                <Input label="Buyer / our ref #" value={form.buyerRef} onChange={(e) => setForm({ ...form, buyerRef: e.target.value })} />
                <Input label="Ship to address" value={form.shipTo} onChange={(e) => setForm({ ...form, shipTo: e.target.value })} />
                <Input label="Delivery terms" value={form.deliveryTerms} onChange={(e) => setForm({ ...form, deliveryTerms: e.target.value })} />
                <Input label="Payment terms" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
              </div>

              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">Line items</h3>
                  <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, newLine()])}>
                    <Plus size={14} /> Add product
                  </Button>
                </div>
                <div className="space-y-3">
                  {lines.map((line, idx) => (
                    <div key={line.key} className="grid gap-2 rounded-md bg-card p-3 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <Select
                          label={`Product ${idx + 1}`}
                          value={line.productId}
                          onChange={(e) => {
                            const p = products.find((x) => x.id === e.target.value)
                            setLines((prev) =>
                              prev.map((l) =>
                                l.key === line.key
                                  ? {
                                      ...l,
                                      productId: e.target.value,
                                      description: p ? `${p.sku} — ${p.name}` : l.description,
                                      unitPrice: p ? String(p.purchasePrice) : l.unitPrice,
                                      taxPercent: p ? String(p.taxPercent) : l.taxPercent,
                                    }
                                  : l,
                              ),
                            )
                          }}
                          options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <Input
                          label="Description"
                          value={line.description}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) => (l.key === line.key ? { ...l, description: e.target.value } : l)),
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <Input
                          label="Qty"
                          type="number"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)),
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Input
                          label="Rate"
                          type="number"
                          value={line.unitPrice}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) => (l.key === line.key ? { ...l, unitPrice: e.target.value } : l)),
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <Input
                          label="Tax %"
                          type="number"
                          value={line.taxPercent}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) => (l.key === line.key ? { ...l, taxPercent: e.target.value } : l)),
                            )
                          }
                        />
                      </div>
                      <div className="flex items-end justify-between sm:col-span-1">
                        <div className="pb-2 text-xs font-semibold">{formatCurrency(lineTotals(line).total)}</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={lines.length === 1}
                          onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        >
                          ×
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-6 border-t border-emerald-100 pt-3 text-sm">
                  <div>
                    Subtotal: <strong>{formatCurrency(totals.subtotal)}</strong>
                  </div>
                  <div>
                    Tax: <strong>{formatCurrency(totals.taxTotal)}</strong>
                  </div>
                  <div>
                    Total: <strong>{formatCurrency(totals.grandTotal)}</strong>
                  </div>
                </div>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-text-secondary">Notes / special instructions</span>
                <textarea
                  className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
          )}
        </FormPanel>
      )}

      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail ? String(detail.poNumber) : 'Purchase order'}
        subtitle="Professional PO document"
        size="xl"
        footer={
          <>
            {detail && detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' ? (
              <Button variant="outline" onClick={() => void receive(String(detail.id))}>
                Receive goods
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Close
            </Button>
            <Button onClick={() => detail && printPurchaseOrder(detail)}>
              <Download size={16} /> Print / Download
            </Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs text-text-secondary">Vendor</div>
                <div className="font-medium">{(detail.vendor as { name?: string } | null)?.name ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Status</div>
                <Badge color="blue">{String(detail.status)}</Badge>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Date</div>
                <div className="font-medium">
                  {detail.orderDate ? formatDate(String(detail.orderDate)) : '—'}
                </div>
              </div>
            </div>
            <table className="w-full text-left">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['Item', 'Qty', 'Received', 'Rate', 'Tax', 'Amount'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {((detail.lines as Array<Record<string, unknown>>) ?? []).map((l) => (
                  <tr key={String(l.id)} className="border-t border-border">
                    <td className="px-3 py-2">{String(l.description)}</td>
                    <td className="px-3 py-2">{num(l.quantity)}</td>
                    <td className="px-3 py-2">{num(l.receivedQty)}</td>
                    <td className="px-3 py-2">{formatCurrency(num(l.unitPrice))}</td>
                    <td className="px-3 py-2">{num(l.taxPercent)}%</td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(num(l.lineTotal))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end gap-6 font-semibold">
              <span>Total {formatCurrency(num(detail.grandTotal))}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default PurchaseOrdersPage
