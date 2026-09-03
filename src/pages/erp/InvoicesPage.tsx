import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Eye, Plus, Trash2 } from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
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

type InvoiceDetail = Record<string, unknown> & {
  lines?: Array<Record<string, unknown>>
}

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: '',
    description: '',
    quantity: '1',
    unitPrice: '',
    taxPercent: '18',
  }
}

function lineAmount(line: LineDraft) {
  const base = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
  const tax = (base * (Number(line.taxPercent) || 0)) / 100
  return { base, tax, total: base + tax }
}

function openPrintableInvoice(opts: {
  invoiceNumber: string
  status: string
  invoiceDate: string
  dueDate?: string | null
  sellerName: string
  sellerEmail?: string
  sellerPhone?: string
  sellerAddress?: string
  sellerGstin?: string
  accountName: string
  contactName?: string
  currency: string
  notes?: string | null
  billingAddress?: string
  placeOfSupply?: string
  paymentTerms?: string
  poNumber?: string
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxPercent: number; lineTotal: number }>
  subtotal: number
  taxTotal: number
  discountTotal: number
  grandTotal: number
  amountPaid?: number
}): boolean {
  const rows = opts.lines
    .map(
      (l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(l.description)}</td>
        <td style="text-align:right">${l.quantity}</td>
        <td style="text-align:right">${formatCurrency(l.unitPrice)}</td>
        <td style="text-align:right">${l.taxPercent}%</td>
        <td style="text-align:right">${formatCurrency(l.lineTotal)}</td>
      </tr>`,
    )
    .join('')

  const balance = Math.max(0, opts.grandTotal - (opts.amountPaid ?? 0))

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(opts.invoiceNumber)}</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#0369a1;--brand2:#0ea5e9;--mint:#059669;--amber:#d97706;--soft:#f0f9ff}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:var(--ink);margin:0;background:#e2e8f0;font-size:13px}
  .sheet{max-width:860px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)}
  .hero{background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 55%,#14b8a6 100%);color:#fff;padding:28px 32px}
  .hero-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start}
  .brand{font-size:26px;font-weight:800;letter-spacing:.02em}
  .tag{display:inline-block;margin-top:8px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .inv-meta{text-align:right}
  .inv-no{font-size:22px;font-weight:800}
  .body{padding:28px 32px 36px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 22px}
  .party{border-radius:12px;padding:16px 18px;border:1px solid var(--line);min-height:120px}
  .party.from{background:linear-gradient(180deg,#ecfeff,#fff);border-color:#a5f3fc}
  .party.to{background:linear-gradient(180deg,#f0fdf4,#fff);border-color:#bbf7d0}
  .party .label{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}
  .party.from .label{color:#0891b2}
  .party.to .label{color:#059669}
  .party .name{font-size:17px;font-weight:800;margin-bottom:6px}
  .party .line{color:var(--muted);line-height:1.45}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
  .fact{background:var(--soft);border:1px solid #bae6fd;border-radius:10px;padding:10px 12px}
  .fact span{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  .fact strong{display:block;margin-top:4px;font-size:13px}
  table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:10px}
  thead th{background:linear-gradient(90deg,#0369a1,#0ea5e9);color:#fff;padding:11px 10px;text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
  tbody td{padding:10px;border-bottom:1px solid var(--line)}
  tbody tr:nth-child(even){background:#f8fafc}
  td.num{width:36px;color:var(--muted);font-weight:600}
  .totals-wrap{display:flex;justify-content:flex-end;margin-top:18px}
  .totals{width:300px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .totals div{display:flex;justify-content:space-between;padding:5px 0;color:var(--muted)}
  .totals .grand{margin-top:8px;padding-top:10px;border-top:2px solid var(--brand);color:var(--ink);font-size:16px;font-weight:800}
  .totals .balance{color:var(--amber);font-weight:700}
  .notes{margin-top:22px;padding:14px 16px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa}
  .notes strong{color:var(--amber)}
  .footer{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:24px;color:var(--muted);font-size:12px}
  .sign{border-top:1px solid #94a3b8;padding-top:8px;margin-top:40px}
  .toolbar{padding:16px 32px;background:#f1f5f9;display:flex;gap:10px;flex-wrap:wrap}
  .toolbar button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
  .btn-print{background:var(--brand);color:#fff}
  .btn-close{background:#fff;border:1px solid #cbd5e1!important;color:var(--ink)}
  @media (max-width:720px){
    .parties,.facts,.footer{grid-template-columns:1fr}
    .hero,.body,.toolbar{padding:18px}
    .inv-meta{text-align:left}
  }
  @media print{
    body{background:#fff}
    .sheet{margin:0;box-shadow:none;border-radius:0}
    .toolbar{display:none}
  }
</style></head><body>
  <div class="sheet">
    <div class="toolbar">
      <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
      <button class="btn-close" onclick="window.close()">Close</button>
    </div>
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="brand">${escapeHtml(opts.sellerName || 'NovaCRM')}</div>
          <div class="tag">Tax Invoice</div>
        </div>
        <div class="inv-meta">
          <div class="inv-no">${escapeHtml(opts.invoiceNumber)}</div>
          <div style="opacity:.9;margin-top:4px">${escapeHtml(opts.status)} · ${escapeHtml(opts.currency)}</div>
        </div>
      </div>
    </div>
    <div class="body">
      <div class="parties">
        <div class="party from">
          <div class="label">From (Seller)</div>
          <div class="name">${escapeHtml(opts.sellerName || 'Seller')}</div>
          ${opts.sellerAddress ? `<div class="line">${escapeHtml(opts.sellerAddress)}</div>` : ''}
          ${opts.sellerPhone ? `<div class="line">☎ ${escapeHtml(opts.sellerPhone)}</div>` : ''}
          ${opts.sellerEmail ? `<div class="line">${escapeHtml(opts.sellerEmail)}</div>` : ''}
          ${opts.sellerGstin ? `<div class="line">GSTIN: ${escapeHtml(opts.sellerGstin)}</div>` : ''}
        </div>
        <div class="party to">
          <div class="label">Bill To (Customer)</div>
          <div class="name">${escapeHtml(opts.accountName)}</div>
          ${opts.contactName ? `<div class="line">Attn: ${escapeHtml(opts.contactName)}</div>` : ''}
          ${opts.billingAddress ? `<div class="line">${escapeHtml(opts.billingAddress)}</div>` : ''}
          ${opts.placeOfSupply ? `<div class="line">Place of supply: ${escapeHtml(opts.placeOfSupply)}</div>` : ''}
        </div>
      </div>
      <div class="facts">
        <div class="fact"><span>Invoice date</span><strong>${escapeHtml(opts.invoiceDate || '—')}</strong></div>
        <div class="fact"><span>Due date</span><strong>${escapeHtml(opts.dueDate || '—')}</strong></div>
        <div class="fact"><span>Payment terms</span><strong>${escapeHtml(opts.paymentTerms || '—')}</strong></div>
        <div class="fact"><span>PO / Ref</span><strong>${escapeHtml(opts.poNumber || '—')}</strong></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Tax</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#64748b">No line items</td></tr>`}</tbody>
      </table>
      <div class="totals-wrap">
        <div class="totals">
          <div><span>Subtotal</span><span>${formatCurrency(opts.subtotal)}</span></div>
          <div><span>Tax</span><span>${formatCurrency(opts.taxTotal)}</span></div>
          <div><span>Discount</span><span>${formatCurrency(opts.discountTotal)}</span></div>
          <div class="grand"><span>Grand total</span><span>${formatCurrency(opts.grandTotal)}</span></div>
          ${opts.amountPaid != null ? `<div><span>Amount paid</span><span>${formatCurrency(opts.amountPaid)}</span></div>` : ''}
          <div class="balance"><span>Balance due</span><span>${formatCurrency(balance)}</span></div>
        </div>
      </div>
      ${opts.notes ? `<div class="notes"><strong>Notes</strong><br/>${escapeHtml(opts.notes)}</div>` : ''}
      <div class="footer">
        <div>Thank you for your business.<br/>This is a computer-generated invoice from NovaCRM.</div>
        <div class="sign">Authorized signatory<br/><strong style="color:#0f172a">${escapeHtml(opts.sellerName || '')}</strong></div>
      </div>
    </div>
  </div>
</body></html>`

  const win = window.open('', '_blank', 'width=920,height=1100')
  if (!win) {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${opts.invoiceNumber || 'invoice'}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return false
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  try {
    win.focus()
  } catch {
    /* ignore */
  }
  return true
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function invoiceStatusColor(status: string): 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple' {
  switch (status) {
    case 'PAID':
      return 'green'
    case 'SENT':
      return 'blue'
    case 'PARTIAL':
      return 'amber'
    case 'OVERDUE':
      return 'red'
    case 'VOID':
      return 'gray'
    default:
      return 'purple'
  }
}

export function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const t = DEFAULT_TIPS['erp.invoices'] ?? {
    title: 'Invoicing',
    body: 'Add multiple products per invoice, preview totals, then download a printable PDF-ready document. Creating an invoice deducts stock for tracked products. Mark as Sent when you share it; Mark as Paid when payment clears.',
    tipType: 'TIP' as const,
  }
  const addToast = useUIStore((s) => s.addToast)
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [accounts, setAccounts] = useState<
    Array<{ id: string; name: string; city?: string; state?: string; phone?: string; email?: string; gstin?: string }>
  >([])
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; accountId?: string }>>([])
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; sku: string; salePrice: number; taxPercent: number }>
  >([])
  const [seller, setSeller] = useState({
    name: 'Precision Scales India',
    email: '',
    phone: '',
    address: '',
    gstin: '',
  })
  const [statusFilter, setStatusFilter] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [tab, setTab] = useState<'list' | 'create' | 'upload'>('list')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploadForm, setUploadForm] = useState({
    contactId: '',
    accountId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    amount: '',
    notes: '',
  })
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(null)
  const [uploadPicked, setUploadPicked] = useState<ContactPick | null>(null)
  const [form, setForm] = useState({
    accountId: '',
    contactId: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    currency: 'INR',
    notes: '',
    discountTotal: '0',
    placeOfSupply: '',
    paymentTerms: 'Net 15',
    poNumber: '',
    billingAddress: '',
  })
  const [lines, setLines] = useState<LineDraft[]>([newLine()])

  async function ensureAccountForContact(contact: ContactPick): Promise<string> {
    if (contact.accountId) return contact.accountId
    const acc = await api.createAccount({
      name: contact.name,
      phone: contact.phone || contact.mobile || null,
      email: contact.email || null,
      customFields: { autoFromContact: contact.id },
    })
    const accountId = String(acc.id)
    await api.updateContact(contact.id, { accountId })
    return accountId
  }

  async function onPickInvoiceContact(c: ContactPick | null) {
    setPickedContact(c)
    if (!c) {
      setForm((f) => ({ ...f, contactId: '', accountId: '' }))
      return
    }
    try {
      const accountId = await ensureAccountForContact(c)
      const acc = accounts.find((a) => a.id === accountId)
      setForm((f) => ({
        ...f,
        contactId: c.id,
        accountId,
        placeOfSupply: acc
          ? [acc.city, acc.state].filter(Boolean).join(', ') || f.placeOfSupply
          : f.placeOfSupply,
      }))
      if (!contacts.some((x) => x.id === c.id)) {
        setContacts((prev) => [...prev, { id: c.id, name: c.name, accountId }])
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not link customer account',
      })
    }
  }

  async function onPickUploadContact(c: ContactPick | null) {
    setUploadPicked(c)
    if (!c) {
      setUploadForm((f) => ({ ...f, contactId: '', accountId: '' }))
      return
    }
    try {
      const accountId = await ensureAccountForContact(c)
      setUploadForm((f) => ({ ...f, contactId: c.id, accountId }))
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not link customer account',
      })
    }
  }

  const load = useCallback(async () => {
    try {
      const [inv, lookups, accountsRes, tenant] = await Promise.all([
        api.invoices({ limit: 50, status: statusFilter || undefined }),
        api.lookups(),
        api.accounts({ limit: 100 }),
        api.myTenant(),
      ])
      setItems(inv.items ?? [])
      setAccounts(
        ((accountsRes.items ?? []) as Array<Record<string, unknown>>).map((a) => ({
          id: String(a.id),
          name: String(a.name),
          city: a.city ? String(a.city) : undefined,
          state: a.state ? String(a.state) : undefined,
          phone: a.phone ? String(a.phone) : undefined,
          email: a.email ? String(a.email) : undefined,
          gstin: a.gstin ? String(a.gstin) : undefined,
        })),
      )
      setContacts(lookups.contacts)
      setProducts(
        lookups.products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          salePrice: num(p.salePrice),
          taxPercent: num(p.taxPercent),
        })),
      )
      const tRow = tenant as Record<string, unknown>
      setSeller({
        name: String(tRow.name ?? 'Precision Scales India'),
        email: tRow.email ? String(tRow.email) : '',
        phone: tRow.phone ? String(tRow.phone) : '',
        address: [tRow.addressLine1, tRow.city, tRow.state, tRow.postalCode, tRow.country]
          .filter(Boolean)
          .join(', '),
        gstin: tRow.gstin ? String(tRow.gstin) : '',
      })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Failed to load invoices' })
    }
  }, [addToast, statusFilter])

  function sellerFields() {
    return {
      sellerName: seller.name,
      sellerEmail: seller.email || undefined,
      sellerPhone: seller.phone || undefined,
      sellerAddress: seller.address || undefined,
      sellerGstin: seller.gstin || undefined,
    }
  }

  function buyerAddress(accountId?: string | null) {
    const acc = accounts.find((a) => a.id === accountId)
    if (!acc) return undefined
    return [acc.city, acc.state, acc.phone, acc.gstin ? `GSTIN ${acc.gstin}` : null].filter(Boolean).join(' · ')
  }

  async function setInvoiceStatus(id: string, status: string, amountPaid?: number) {
    setStatusBusy(true)
    try {
      const updated = (await api.updateInvoiceStatus(id, { status, amountPaid })) as InvoiceDetail
      addToast({
        type: 'success',
        message:
          status === 'PAID'
            ? 'Invoice marked as paid'
            : status === 'SENT'
              ? 'Invoice marked as sent'
              : status === 'PARTIAL'
                ? 'Partial payment recorded'
                : `Invoice set to ${status}`,
      })
      setDetail(updated)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update invoice status',
      })
    } finally {
      setStatusBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const accountId = searchParams.get('accountId') || ''
    const contactId = searchParams.get('contactId') || ''
    const productId = searchParams.get('productId') || ''
    const serialNo = searchParams.get('serialNo') || ''
    const unitPrice = searchParams.get('unitPrice') || ''
    const taxPercent = searchParams.get('taxPercent') || ''
    const open = searchParams.get('open')
    if (!open && !accountId && !contactId && !productId) return

    if (open === 'upload') {
      setTab('upload')
      if (contactId) {
        void api.getContact(contactId).then((row) => {
          const pick: ContactPick = {
            id: String(row.id),
            name: String(row.name),
            customerCode: row.customerCode ? String(row.customerCode) : null,
            phone: row.phone ? String(row.phone) : null,
            mobile: row.mobile ? String(row.mobile) : null,
            accountId: row.accountId ? String(row.accountId) : accountId || null,
            email: row.email ? String(row.email) : null,
          }
          void onPickUploadContact(pick)
        }).catch(() => undefined)
      }
      setSearchParams({}, { replace: true })
      return
    }

    const shouldOpen = open === '1'
    setForm((f) => ({
      ...f,
      accountId: accountId || f.accountId,
      contactId: contactId || f.contactId,
    }))
    if (contactId) {
      void api.getContact(contactId).then((row) => {
        const pick: ContactPick = {
          id: String(row.id),
          name: String(row.name),
          customerCode: row.customerCode ? String(row.customerCode) : null,
          phone: row.phone ? String(row.phone) : null,
          mobile: row.mobile ? String(row.mobile) : null,
          accountId: row.accountId ? String(row.accountId) : accountId || null,
          email: row.email ? String(row.email) : null,
        }
        void onPickInvoiceContact(pick)
      }).catch(() => undefined)
    }
    if (productId && products.length) {
      const p = products.find((x) => x.id === productId)
      const line = newLine()
      line.productId = productId
      line.description = serialNo
        ? `${p?.sku ?? ''} — ${p?.name ?? 'Product'} · S/N ${serialNo}`.trim()
        : p
          ? `${p.sku} — ${p.name}`
          : ''
      line.unitPrice = unitPrice || (p ? String(p.salePrice) : '')
      line.taxPercent = taxPercent || (p ? String(p.taxPercent) : '18')
      setLines([line])
    }
    if (shouldOpen || accountId || contactId || productId) setTab('create')
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams, products])

  const accountName = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts],
  )
  const contactName = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c.name])),
    [contacts],
  )

  const totals = useMemo(() => {
    let subtotal = 0
    let taxTotal = 0
    for (const line of lines) {
      const a = lineAmount(line)
      subtotal += a.base
      taxTotal += a.tax
    }
    const discount = Number(form.discountTotal) || 0
    return {
      subtotal,
      taxTotal,
      discount,
      grandTotal: Math.max(0, subtotal + taxTotal - discount),
    }
  }, [lines, form.discountTotal])

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId)
    updateLine(key, {
      productId,
      description: p ? `${p.sku} — ${p.name}` : '',
      unitPrice: p ? String(p.salePrice) : '',
      taxPercent: p ? String(p.taxPercent) : '18',
    })
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!form.accountId) next.accountId = 'Select a customer (search by name or phone)'
    if (!form.invoiceDate) next.invoiceDate = 'Invoice date is required'
    if (!lines.length) next.lines = 'Add at least one product line'
    lines.forEach((line, idx) => {
      if (!line.description.trim()) next[`line-${idx}-desc`] = `Line ${idx + 1}: description required`
      if (!(Number(line.quantity) > 0)) next[`line-${idx}-qty`] = `Line ${idx + 1}: quantity must be > 0`
      if (Number(line.unitPrice) < 0 || line.unitPrice === '')
        next[`line-${idx}-price`] = `Line ${idx + 1}: unit price required`
      const tax = Number(line.taxPercent)
      if (Number.isNaN(tax) || tax < 0 || tax > 100) next[`line-${idx}-tax`] = `Line ${idx + 1}: tax 0–100`
    })
    setErrors(next)
    return next
  }

  async function uploadExternalInvoice() {
    if (!uploadFile) {
      addToast({ type: 'error', message: 'Choose an invoice file (PDF or image)' })
      return
    }
    if (!uploadForm.accountId && !uploadForm.contactId) {
      addToast({ type: 'error', message: 'Select a customer or account' })
      return
    }
    setUploading(true)
    try {
      let accountId = uploadForm.accountId
      if (!accountId && uploadForm.contactId) {
        const contact = contacts.find((c) => c.id === uploadForm.contactId)
        if (contact?.accountId) {
          accountId = contact.accountId
        } else {
          const name =
            contacts.find((c) => c.id === uploadForm.contactId)?.name ||
            'Customer'
          const acc = await api.createAccount({
            name: String(name),
            customFields: { autoFromContact: uploadForm.contactId },
          })
          accountId = String(acc.id)
          if (uploadForm.contactId) {
            await api.updateContact(uploadForm.contactId, { accountId })
          }
        }
      }
      const uploaded = await api.uploadFile(uploadFile)
      const amount = Number(uploadForm.amount) || 0
      const invNo =
        uploadForm.invoiceNumber.trim() ||
        `EXT-${Date.now().toString().slice(-8)}`
      await api.createInvoice({
        accountId,
        contactId: uploadForm.contactId || null,
        invoiceDate: uploadForm.invoiceDate,
        dueDate: null,
        currency: 'INR',
        notes: uploadForm.notes || 'External client invoice (uploaded)',
        discountTotal: 0,
        customFields: {
          source: 'EXTERNAL_UPLOAD',
          fileUrl: uploaded.url,
          originalFileName: uploaded.originalName || uploadFile.name,
          mimeType: uploaded.mimeType || uploadFile.type,
        },
        lines: [
          {
            productId: null,
            description: `External invoice${uploadForm.invoiceNumber ? ` ${uploadForm.invoiceNumber}` : ''}`,
            quantity: 1,
            unitPrice: amount,
            taxPercent: 0,
          },
        ],
      })
      // Prefer custom invoice number if create generated one differently — status stays DRAFT
      addToast({ type: 'success', message: `Uploaded external invoice ${invNo}` })
      setUploadFile(null)
      setUploadForm({
        contactId: '',
        accountId: '',
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().slice(0, 10),
        amount: '',
        notes: '',
      })
      setTab('list')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Upload failed',
      })
    } finally {
      setUploading(false)
    }
  }

  async function createInvoice() {
    const next = validate()
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }
    setSaving(true)
    try {
      const customFields = {
        place_of_supply: form.placeOfSupply || null,
        payment_terms: form.paymentTerms || null,
        po_number: form.poNumber || null,
        billing_address: form.billingAddress || null,
      }
      const created = (await api.createInvoice({
        accountId: form.accountId,
        contactId: form.contactId || null,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate || null,
        currency: form.currency || 'INR',
        notes: form.notes || null,
        discountTotal: Number(form.discountTotal) || 0,
        customFields,
        lines: lines.map((l) => ({
          productId: l.productId || null,
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxPercent: Number(l.taxPercent) || 0,
        })),
      })) as InvoiceDetail
      setTab('list')
      setLines([newLine()])
      setForm((f) => ({
        ...f,
        accountId: '',
        contactId: '',
        notes: '',
        discountTotal: '0',
        dueDate: '',
        poNumber: '',
        billingAddress: '',
      }))
      setErrors({})
      addToast({
        type: 'success',
        message: 'Invoice created — stock deducted for tracked products',
      })
      await load()
      setDetail(created)
      setPreviewOpen(true)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Invoice failed' })
    } finally {
      setSaving(false)
    }
  }

  async function openDetail(id: string) {
    try {
      const inv = (await api.getInvoice(id)) as InvoiceDetail
      setDetail(inv)
      setPreviewOpen(true)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Could not load invoice' })
    }
  }

  function downloadDetail() {
    if (!detail) return
    const cf = (detail.customFields as Record<string, string> | null) ?? {}
    const invLines = ((detail.lines as Array<Record<string, unknown>>) ?? []).map((l) => ({
      description: String(l.description ?? ''),
      quantity: num(l.quantity),
      unitPrice: num(l.unitPrice),
      taxPercent: num(l.taxPercent),
      lineTotal: num(l.lineTotal),
    }))
    const ok = openPrintableInvoice({
      invoiceNumber: String(detail.invoiceNumber ?? ''),
      status: String(detail.status ?? ''),
      invoiceDate: detail.invoiceDate ? formatDate(String(detail.invoiceDate)) : '',
      dueDate: detail.dueDate ? formatDate(String(detail.dueDate)) : null,
      accountName: accountName[String(detail.accountId)] ?? 'Customer',
      contactName: detail.contactId ? contactName[String(detail.contactId)] : undefined,
      currency: String(detail.currency ?? 'INR'),
      notes: detail.notes ? String(detail.notes) : null,
      billingAddress: cf.billing_address || buyerAddress(detail.accountId ? String(detail.accountId) : null),
      placeOfSupply: cf.place_of_supply,
      paymentTerms: cf.payment_terms,
      poNumber: cf.po_number,
      lines: invLines,
      subtotal: num(detail.subtotal),
      taxTotal: num(detail.taxTotal),
      discountTotal: num(detail.discountTotal),
      grandTotal: num(detail.grandTotal),
      amountPaid: num(detail.amountPaid),
      ...sellerFields(),
    })
    if (!ok) {
      addToast({
        type: 'info',
        message: 'Popup blocked — invoice HTML downloaded. Open it and use Print → Save as PDF.',
      })
    }
  }

  function previewDraft() {
    const next = validate()
    if (Object.keys(next).length) {
      addToast({ type: 'error', message: Object.values(next)[0] })
      return
    }
    openPrintableInvoice({
      invoiceNumber: 'DRAFT',
      status: 'DRAFT',
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate || null,
      accountName: accountName[form.accountId] ?? 'Customer',
      contactName: form.contactId ? contactName[form.contactId] : undefined,
      currency: form.currency,
      notes: form.notes || null,
      billingAddress: form.billingAddress || buyerAddress(form.accountId),
      placeOfSupply: form.placeOfSupply,
      paymentTerms: form.paymentTerms,
      poNumber: form.poNumber,
      ...sellerFields(),
      lines: lines.map((l) => {
        const a = lineAmount(l)
        return {
          description: l.description,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
          taxPercent: Number(l.taxPercent) || 0,
          lineTotal: a.total,
        }
      }),
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      discountTotal: totals.discount,
      grandTotal: totals.grandTotal,
    })
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        count={items.length}
        breadcrumbs={[{ label: 'ERP' }, { label: 'Invoices' }]}
      />
      <FeatureTip title={t.title} body={t.body} tipType={t.tipType} />

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create' | 'upload')
          if (id === 'create') {
            setErrors({})
            setLines([newLine()])
          }
        }}
        tabs={[
          { id: 'list', label: 'All invoices', count: items.length },
          { id: 'create', label: 'New invoice' },
          { id: 'upload', label: 'Upload invoice' },
        ]}
      />

      {tab === 'list' ? (
        <>
          <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-44"
              options={[
                { value: '', label: 'All statuses' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'SENT', label: 'Sent' },
                { value: 'PARTIAL', label: 'Partial' },
                { value: 'PAID', label: 'Paid' },
                { value: 'OVERDUE', label: 'Overdue' },
                { value: 'VOID', label: 'Void' },
              ]}
            />
            <p className="text-sm text-text-secondary">
              New invoices start as <strong>DRAFT</strong>. Open one → <strong>Mark sent</strong> when shared,{' '}
              <strong>Mark paid</strong> / Record payment when money arrives.
            </p>
          </Card>

          {previewOpen && detail ? (
            <FormPanel
              open
              accent="sky"
              eyebrow="Invoice"
              title={String(detail.invoiceNumber)}
              subtitle="Full invoice with line items — mark sent, record payment, or download."
              onClose={() => setPreviewOpen(false)}
              footer={
                <>
                  <FormPanelCancel onClick={() => setPreviewOpen(false)} />
                  {String(detail.status) === 'DRAFT' && (
                    <Button
                      variant="outline"
                      disabled={statusBusy}
                      onClick={() => void setInvoiceStatus(String(detail.id), 'SENT')}
                    >
                      Mark sent
                    </Button>
                  )}
                  {['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(detail.status)) && (
                    <Button
                      variant="outline"
                      disabled={statusBusy}
                      onClick={() => {
                        const total = num(detail.grandTotal)
                        const paid = num(detail.amountPaid)
                        const remaining = Math.max(0, total - paid)
                        if (remaining <= 0) {
                          void setInvoiceStatus(String(detail.id), 'PAID')
                          return
                        }
                        const raw = window.prompt(
                          `Amount received (balance due ${formatCurrency(remaining)}). Leave blank to mark fully paid.`,
                          String(remaining),
                        )
                        if (raw === null) return
                        const amt = raw.trim() === '' ? remaining : Number(raw)
                        if (!Number.isFinite(amt) || amt <= 0) {
                          addToast({ type: 'error', message: 'Enter a valid payment amount' })
                          return
                        }
                        if (amt >= remaining) {
                          void setInvoiceStatus(String(detail.id), 'PAID')
                        } else {
                          void setInvoiceStatus(String(detail.id), 'PARTIAL', paid + amt)
                        }
                      }}
                    >
                      Record payment
                    </Button>
                  )}
                  {['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(detail.status)) && (
                    <Button disabled={statusBusy} onClick={() => void setInvoiceStatus(String(detail.id), 'PAID')}>
                      Mark paid
                    </Button>
                  )}
                  <Button onClick={downloadDetail}>
                    <Download size={16} /> Download / Print
                  </Button>
                </>
              }
            >
              <div className="space-y-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs text-text-secondary">Customer</div>
                    <div className="font-medium">{accountName[String(detail.accountId)] ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary">Date</div>
                    <div className="font-medium">
                      {detail.invoiceDate ? formatDate(String(detail.invoiceDate)) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary">Status</div>
                    <Badge color={invoiceStatusColor(String(detail.status))}>{String(detail.status)}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary">Paid / Balance</div>
                    <div className="font-medium">
                      {formatCurrency(num(detail.amountPaid))} /{' '}
                      {formatCurrency(num(detail.balanceDue ?? num(detail.grandTotal) - num(detail.amountPaid)))}
                    </div>
                  </div>
                </div>
                <table className="w-full text-left">
                  <thead className="bg-muted text-xs text-text-secondary">
                    <tr>
                      {['Description', 'Qty', 'Rate', 'Tax %', 'Amount'].map((h) => (
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
                        <td className="px-3 py-2">{formatCurrency(num(l.unitPrice))}</td>
                        <td className="px-3 py-2">{num(l.taxPercent)}%</td>
                        <td className="px-3 py-2 font-medium">{formatCurrency(num(l.lineTotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap justify-end gap-6">
                  <div>Subtotal: {formatCurrency(num(detail.subtotal))}</div>
                  <div>Tax: {formatCurrency(num(detail.taxTotal))}</div>
                  <div>Discount: {formatCurrency(num(detail.discountTotal))}</div>
                  <div className="font-semibold">Total: {formatCurrency(num(detail.grandTotal))}</div>
                </div>
              </div>
            </FormPanel>
          ) : null}

          <Card padding={false}>
            {items.length === 0 ? (
              <EmptyState
                title="No invoices"
                subtitle="Create an invoice for a customer with one or more products."
                actionLabel="New invoice"
                onAction={() => setTab('create')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="bg-muted text-xs text-text-secondary">
                    <tr>
                      {['Invoice #', 'Customer', 'Date', 'Due', 'Status', 'Subtotal', 'Tax', 'Total', 'Balance', ''].map(
                        (h) => (
                          <th key={h || 'actions'} className="px-4 py-3 font-medium">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((inv) => (
                      <tr
                        key={String(inv.id)}
                        className="cursor-pointer border-t border-border hover:bg-surface"
                        onClick={() => void openDetail(String(inv.id))}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-accent-blue">
                          {String(inv.invoiceNumber)}
                        </td>
                        <td className="px-4 py-3">{accountName[String(inv.accountId)] ?? '—'}</td>
                        <td className="px-4 py-3">{inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : '—'}</td>
                        <td className="px-4 py-3">{inv.dueDate ? formatDate(String(inv.dueDate)) : '—'}</td>
                        <td className="px-4 py-3">
                          <Badge color={invoiceStatusColor(String(inv.status))}>{String(inv.status)}</Badge>
                        </td>
                        <td className="px-4 py-3">{formatCurrency(num(inv.subtotal))}</td>
                        <td className="px-4 py-3">{formatCurrency(num(inv.taxTotal))}</td>
                        <td className="px-4 py-3 font-semibold">{formatCurrency(num(inv.grandTotal))}</td>
                        <td className="px-4 py-3">{formatCurrency(num(inv.balanceDue ?? inv.grandTotal))}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap gap-1">
                            <Button variant="outline" size="sm" onClick={() => void openDetail(String(inv.id))}>
                              <Eye size={14} /> View
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                void (async () => {
                                  try {
                                    const full = (await api.getInvoice(String(inv.id))) as InvoiceDetail
                                    setDetail(full)
                                    const cf = (full.customFields as Record<string, string> | null) ?? {}
                                    const invLines = ((full.lines as Array<Record<string, unknown>>) ?? []).map(
                                      (l) => ({
                                        description: String(l.description ?? ''),
                                        quantity: num(l.quantity),
                                        unitPrice: num(l.unitPrice),
                                        taxPercent: num(l.taxPercent),
                                        lineTotal: num(l.lineTotal),
                                      }),
                                    )
                                    const ok = openPrintableInvoice({
                                      invoiceNumber: String(full.invoiceNumber ?? ''),
                                      status: String(full.status ?? ''),
                                      invoiceDate: full.invoiceDate ? formatDate(String(full.invoiceDate)) : '',
                                      dueDate: full.dueDate ? formatDate(String(full.dueDate)) : null,
                                      accountName: accountName[String(full.accountId)] ?? 'Customer',
                                      contactName: full.contactId
                                        ? contactName[String(full.contactId)]
                                        : undefined,
                                      currency: String(full.currency ?? 'INR'),
                                      notes: full.notes ? String(full.notes) : null,
                                      billingAddress:
                                        cf.billing_address ||
                                        buyerAddress(full.accountId ? String(full.accountId) : null),
                                      placeOfSupply: cf.place_of_supply,
                                      paymentTerms: cf.payment_terms,
                                      poNumber: cf.po_number,
                                      lines: invLines,
                                      subtotal: num(full.subtotal),
                                      taxTotal: num(full.taxTotal),
                                      discountTotal: num(full.discountTotal),
                                      grandTotal: num(full.grandTotal),
                                      amountPaid: num(full.amountPaid),
                                      ...sellerFields(),
                                    })
                                    if (!ok) {
                                      addToast({
                                        type: 'info',
                                        message:
                                          'Popup blocked — invoice downloaded. Open the file → Print → Save as PDF.',
                                      })
                                    }
                                  } catch (err) {
                                    addToast({
                                      type: 'error',
                                      message: err instanceof ApiClientError ? err.message : 'Download failed',
                                    })
                                  }
                                })()
                              }
                            >
                              <Download size={14} /> Download
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
        </>
      ) : tab === 'upload' ? (
        <FormPanel
          open
          accent="sky"
          eyebrow="Billing"
          title="Upload external invoice"
          subtitle="Store a client’s own invoice (PDF/image) against their account — not generated by NovaCRM."
          onClose={() => setTab('list')}
          footer={
            <>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button disabled={uploading} onClick={() => void uploadExternalInvoice()}>
                {uploading ? 'Uploading…' : 'Save uploaded invoice'}
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ContactPicker
                label="Customer / shop *"
                valueId={uploadForm.contactId}
                selected={uploadPicked}
                onSelect={(c) => void onPickUploadContact(c)}
                returnTo="/erp/invoices?open=upload"
              />
              <p className="mt-1 text-xs text-text-secondary">
                Search by name or phone. If not found, choose Add new customer.
              </p>
            </div>
            <Input
              label="Their invoice number"
              value={uploadForm.invoiceNumber}
              onChange={(e) => setUploadForm({ ...uploadForm, invoiceNumber: e.target.value })}
              placeholder="Optional — as printed on paper"
            />
            <Input
              label="Invoice date"
              type="date"
              value={uploadForm.invoiceDate}
              onChange={(e) => setUploadForm({ ...uploadForm, invoiceDate: e.target.value })}
            />
            <Input
              label="Amount ₹ (optional)"
              type="number"
              value={uploadForm.amount}
              onChange={(e) => setUploadForm({ ...uploadForm, amount: e.target.value })}
            />
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-text-secondary">File (PDF or image) *</span>
              <input
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="block w-full text-sm"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              {uploadFile ? (
                <span className="mt-1 block text-xs text-text-secondary">{uploadFile.name}</span>
              ) : null}
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-text-secondary">Notes</span>
              <textarea
                className="min-h-20 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
                value={uploadForm.notes}
                onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                placeholder="e.g. Client brought paper invoice from other vendor"
              />
            </label>
          </div>
        </FormPanel>
      ) : (
        <FormPanel
          open
          accent="sky"
          eyebrow="Billing"
          title="New invoice"
          subtitle="Select a customer, add multiple products, then preview or save."
          onClose={() => setTab('list')}
          footer={
            <>
              <Button variant="outline" onClick={() => previewDraft()}>
                <Eye size={16} /> Preview
              </Button>
              <FormPanelCancel onClick={() => setTab('list')} />
              <Button onClick={() => void createInvoice()} disabled={saving}>
                {saving ? 'Creating…' : 'Create invoice'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ContactPicker
                label="Customer / shop *"
                valueId={form.contactId}
                selected={pickedContact}
                onSelect={(c) => void onPickInvoiceContact(c)}
                returnTo="/erp/invoices?open=1"
                error={errors.accountId || errors.contactId}
              />
              {form.accountId ? (
                <p className="mt-1 text-xs text-text-secondary">
                  Billing account: {accountName[form.accountId] ?? form.accountId}
                </p>
              ) : null}
            </div>
            <Input
              label="Invoice date *"
              type="date"
              value={form.invoiceDate}
              error={errors.invoiceDate}
              onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
            />
            <Input
              label="Due date"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
            <Input
              label="Currency"
              placeholder="INR"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })}
            />
            <Input
              label="Place of supply"
              placeholder="Tamil Nadu"
              value={form.placeOfSupply}
              onChange={(e) => setForm({ ...form, placeOfSupply: e.target.value })}
            />
            <div>
              <Input
                label="Payment terms"
                placeholder="Net 15"
                value={form.paymentTerms}
                onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              />
              <p className="mt-1 text-xs text-text-secondary">
                When the customer must pay. Examples: <strong>Due on receipt</strong>, <strong>Net 15</strong>{' '}
                (15 days after invoice), <strong>Net 30</strong>, <strong>50% advance</strong>.
              </p>
            </div>
            <Input
              label="Customer PO / Ref #"
              placeholder="PO-2026-001"
              value={form.poNumber}
              onChange={(e) => setForm({ ...form, poNumber: e.target.value })}
            />
            <Input
              label="Billing address"
              placeholder="Plot 12, Industrial Estate, Chennai"
              value={form.billingAddress}
              onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
            />
            <Input
              label="Discount ₹"
              type="number"
              placeholder="0"
              value={form.discountTotal}
              onChange={(e) => setForm({ ...form, discountTotal: e.target.value })}
            />

            <div className="sm:col-span-2 space-y-3 rounded-lg border border-sky-100 bg-sky-50/30 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Product lines</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
                  <Plus size={14} /> Add product
                </Button>
              </div>
              {lines.map((line, idx) => (
                <div key={line.key} className="grid gap-2 rounded-md bg-card p-3 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <Select
                      label={`Product ${idx + 1}`}
                      value={line.productId}
                      onChange={(e) => pickProduct(line.key, e.target.value)}
                      options={[
                        { value: '', label: 'Custom / no product' },
                        ...products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
                      ]}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Input
                      label="Description *"
                      value={line.description}
                      error={errors[`line-${idx}-desc`]}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Input
                      label="Qty"
                      type="number"
                      value={line.quantity}
                      error={errors[`line-${idx}-qty`]}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label="Rate"
                      type="number"
                      value={line.unitPrice}
                      error={errors[`line-${idx}-price`]}
                      onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Input
                      label="Tax %"
                      type="number"
                      value={line.taxPercent}
                      error={errors[`line-${idx}-tax`]}
                      onChange={(e) => updateLine(line.key, { taxPercent: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end justify-between gap-2 sm:col-span-1">
                    <div className="pb-2 text-xs font-medium">{formatCurrency(lineAmount(line).total)}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap justify-end gap-6 border-t border-sky-100 pt-3 text-sm">
                <div>
                  Subtotal: <strong>{formatCurrency(totals.subtotal)}</strong>
                </div>
                <div>
                  Tax: <strong>{formatCurrency(totals.taxTotal)}</strong>
                </div>
                <div>
                  Discount: <strong>{formatCurrency(totals.discount)}</strong>
                </div>
                <div>
                  Grand total: <strong>{formatCurrency(totals.grandTotal)}</strong>
                </div>
              </div>
            </div>

            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-text-secondary">Notes</span>
              <textarea
                className="min-h-20 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
        </FormPanel>
      )}
    </div>
  )
}
