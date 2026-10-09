/** Delivery challan for demo issue or sale dispatch (browser Print → Save as PDF). */

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatInr(n: number | null | undefined) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export type DeliveryChallanLine = {
  productName: string
  productSku?: string | null
  serialNo?: string | null
  hmsUniqId?: string | null
  qty?: number
  stampingDate?: string | null
  weighing?: boolean
  unitPrice?: number | null
  amount?: number | null
}

export type DeliveryChallan = {
  number: string
  date: string
  issuedAt: string
  purpose: 'DEMO' | 'SALE'
  customerName: string
  customerCode?: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  state?: string | null
  addressLine?: string | null
  productName: string
  productSku?: string | null
  serialNo: string
  hmsUniqId?: string | null
  qty: number
  lines?: DeliveryChallanLine[]
  stampingDate?: string | null
  catalogFamily?: string | null
  catalogIndustry?: string | null
  executiveName?: string | null
  leadId?: string | null
  stockUnitId?: string | null
  requisitionId?: string | null
  reqNumber?: string | null
  notes?: string | null
  sellerName?: string | null
  sellerPhone?: string | null
  sellerEmail?: string | null
  sellerGstin?: string | null
  sellerAddress?: string | null
  saleTotal?: number | null
  advanceAmount?: number | null
  balanceDue?: number | null
  currency?: string | null
}

/** @deprecated use DeliveryChallan — kept for existing demo imports */
export type DemoDeliveryChallan = DeliveryChallan

export function parseDeliveryChallan(source: unknown): DeliveryChallan | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const c = source as Record<string, unknown>
  const number = c.number ? String(c.number) : ''
  const purpose = String(c.purpose ?? 'DEMO').toUpperCase() === 'SALE' ? 'SALE' : 'DEMO'
  const linesRaw = Array.isArray(c.lines) ? (c.lines as Array<Record<string, unknown>>) : []
  const lines: DeliveryChallanLine[] = linesRaw
    .map((l) => ({
      productName: String(l.productName ?? l.label ?? 'Product'),
      productSku: l.productSku != null ? String(l.productSku) : null,
      serialNo: l.serialNo != null ? String(l.serialNo) : null,
      hmsUniqId: l.hmsUniqId != null ? String(l.hmsUniqId) : null,
      qty: Number(l.qty ?? 1) || 1,
      stampingDate: l.stampingDate != null ? String(l.stampingDate) : null,
      weighing: Boolean(l.weighing),
      unitPrice:
        l.unitPrice != null && Number.isFinite(Number(l.unitPrice)) ? Number(l.unitPrice) : null,
      amount: l.amount != null && Number.isFinite(Number(l.amount)) ? Number(l.amount) : null,
    }))
    .filter((l) => l.productName)
    .sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }))

  const serialNo = c.serialNo
    ? String(c.serialNo)
    : lines[0]?.serialNo || lines[0]?.hmsUniqId || (c.hmsUniqId ? String(c.hmsUniqId) : '')
  const productName = c.productName
    ? String(c.productName)
    : lines.map((l) => l.productName).join(', ') || ''
  const customerName = c.customerName ? String(c.customerName) : ''
  if (!number || (!serialNo && !lines.length)) return null

  const lineTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const saleTotal =
    c.saleTotal != null && Number.isFinite(Number(c.saleTotal))
      ? Number(c.saleTotal)
      : lineTotal > 0
        ? lineTotal
        : null
  const advanceAmount =
    c.advanceAmount != null && Number.isFinite(Number(c.advanceAmount))
      ? Number(c.advanceAmount)
      : null
  const balanceDue =
    c.balanceDue != null && Number.isFinite(Number(c.balanceDue))
      ? Number(c.balanceDue)
      : saleTotal != null
        ? Math.max(0, saleTotal - (advanceAmount ?? 0))
        : null

  return {
    number,
    date: String(c.date ?? '').slice(0, 10),
    issuedAt: String(c.issuedAt ?? ''),
    purpose,
    customerName: customerName || 'Customer',
    customerCode: c.customerCode != null ? String(c.customerCode) : null,
    company: c.company != null ? String(c.company) : null,
    phone: c.phone != null ? String(c.phone) : null,
    email: c.email != null ? String(c.email) : null,
    city: c.city != null ? String(c.city) : null,
    state: c.state != null ? String(c.state) : null,
    addressLine: c.addressLine != null ? String(c.addressLine) : null,
    productName: productName || 'Product',
    productSku: c.productSku != null ? String(c.productSku) : null,
    serialNo: serialNo || '—',
    hmsUniqId:
      c.hmsUniqId != null
        ? String(c.hmsUniqId)
        : lines[0]?.hmsUniqId != null
          ? String(lines[0].hmsUniqId)
          : null,
    qty: Number(c.qty ?? (lines.reduce((s, l) => s + (l.qty ?? 1), 0) || 1)) || 1,
    lines: lines.length ? lines : undefined,
    stampingDate: c.stampingDate != null ? String(c.stampingDate) : null,
    catalogFamily: c.catalogFamily != null ? String(c.catalogFamily) : null,
    catalogIndustry: c.catalogIndustry != null ? String(c.catalogIndustry) : null,
    executiveName: c.executiveName != null ? String(c.executiveName) : null,
    leadId: c.leadId != null ? String(c.leadId) : null,
    stockUnitId: c.stockUnitId != null ? String(c.stockUnitId) : null,
    requisitionId: c.requisitionId != null ? String(c.requisitionId) : null,
    reqNumber: c.reqNumber != null ? String(c.reqNumber) : null,
    notes: c.notes != null ? String(c.notes) : null,
    sellerName: c.sellerName != null ? String(c.sellerName) : null,
    sellerPhone: c.sellerPhone != null ? String(c.sellerPhone) : null,
    sellerEmail: c.sellerEmail != null ? String(c.sellerEmail) : null,
    sellerGstin: c.sellerGstin != null ? String(c.sellerGstin) : null,
    sellerAddress: c.sellerAddress != null ? String(c.sellerAddress) : null,
    saleTotal,
    advanceAmount,
    balanceDue,
    currency: c.currency != null ? String(c.currency) : 'INR',
  }
}

/** @deprecated use parseDeliveryChallan */
export function parseDemoDeliveryChallan(source: unknown): DeliveryChallan | null {
  return parseDeliveryChallan(source)
}

/** Read demo DC from lead or stock-unit customFields. */
export function challanFromCustomFields(
  cf: Record<string, unknown> | null | undefined,
): DeliveryChallan | null {
  if (!cf) return null
  return (
    parseDeliveryChallan(cf.demoDeliveryChallan) ??
    (cf.demoDcNo
      ? parseDeliveryChallan({
          number: cf.demoDcNo,
          date: cf.demoDcDate,
          issuedAt: cf.demoIssuedAt,
          customerName: cf.demoCustomerName,
          company: cf.demoCompany,
          phone: cf.demoPhone,
          city: cf.demoCity,
          state: cf.demoState,
          productName: cf.demoProductName ?? cf.productName,
          productSku: cf.demoProductSku ?? cf.productSku,
          serialNo: cf.demoSerialNo,
          qty: 1,
          executiveName: cf.demoExecutiveName,
          catalogFamily: cf.demoCatalogFamily ?? cf.catalogFamily,
          catalogIndustry: cf.demoCatalogIndustry ?? cf.catalogIndustry,
          notes: 'Issued for demonstration — not a sale',
          purpose: 'DEMO',
        })
      : null)
  )
}

/** Sale dispatch DC from lead / requisition customFields. */
export function saleChallanFromCustomFields(
  cf: Record<string, unknown> | null | undefined,
): DeliveryChallan | null {
  if (!cf) return null
  const fromRelease =
    cf.inventoryRelease && typeof cf.inventoryRelease === 'object'
      ? (cf.inventoryRelease as Record<string, unknown>).saleDeliveryChallan
      : null
  return (
    parseDeliveryChallan(cf.saleDeliveryChallan) ??
    parseDeliveryChallan(fromRelease) ??
    (cf.saleDcNo
      ? parseDeliveryChallan({
          number: cf.saleDcNo,
          date: cf.saleDcDate,
          issuedAt: cf.saleDcAt,
          purpose: 'SALE',
          customerName: cf.saleDcCustomerName,
          productName: cf.saleDcProductName,
          serialNo: cf.saleDcSerialNo ?? cf.inventorySerialNo,
          hmsUniqId: cf.saleDcHmsUniqId,
          lines: cf.saleDcLines,
          reqNumber: cf.inventoryReqNumber ?? cf.saleDcReqNumber,
          notes: cf.saleDcNotes ?? 'Sale delivery',
          saleTotal: cf.saleDcSaleTotal ?? cf.salePaymentTotal,
          advanceAmount: cf.saleDcAdvance ?? cf.saleAdvanceAmount,
        })
      : null)
  )
}

export function buildDeliveryChallanHtml(
  opts: DeliveryChallan,
  fallbackSellerName = 'HMS Enterprises',
): string {
  const seller = escapeHtml(opts.sellerName || fallbackSellerName)
  const dcNo = escapeHtml(opts.number)
  const place = [opts.city, opts.state].filter(Boolean).join(', ')
  const familyLine = [opts.catalogFamily, opts.catalogIndustry].filter(Boolean).join(' · ')
  const isSale = opts.purpose === 'SALE'
  const lines: DeliveryChallanLine[] =
    opts.lines?.length
      ? [...opts.lines].sort((a, b) =>
          a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }),
        )
      : [
          {
            productName: opts.productName,
            serialNo: opts.serialNo,
            hmsUniqId: opts.hmsUniqId,
            qty: opts.qty,
            stampingDate: opts.stampingDate,
            unitPrice: opts.saleTotal != null && opts.qty ? opts.saleTotal / opts.qty : null,
            amount: opts.saleTotal ?? null,
          },
        ]

  const showMoney =
    isSale &&
    (opts.saleTotal != null ||
      lines.some((l) => l.unitPrice != null || l.amount != null))

  const rowsHtml = lines
    .map((l, i) => {
      const idParts = [
        l.serialNo && !l.weighing ? `S/No ${l.serialNo}` : null,
        l.hmsUniqId ? `HMS ${l.hmsUniqId}` : null,
        l.weighing && !l.hmsUniqId && l.serialNo ? `HMS ${l.serialNo}` : null,
      ].filter(Boolean)
      const idCell = idParts.length ? idParts.join(' · ') : '—'
      const qty = l.qty ?? 1
      const amount =
        l.amount != null
          ? Number(l.amount)
          : l.unitPrice != null
            ? Number(l.unitPrice) * qty
            : null
      const rate = l.unitPrice != null ? Number(l.unitPrice) : amount != null ? amount / qty : null
      return `<tr>
          <td class="num">${i + 1}</td>
          <td>
            <strong>${escapeHtml(l.productName)}</strong>
            ${l.productSku ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">SKU ${escapeHtml(l.productSku)}</div>` : ''}
            ${l.stampingDate ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">Stamping: ${escapeHtml(String(l.stampingDate).slice(0, 10))}</div>` : ''}
            ${l.weighing ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">Weighing · HMS ID</div>` : ''}
          </td>
          <td style="font-family:ui-monospace,monospace;font-weight:700">${escapeHtml(idCell)}</td>
          <td class="num">${qty}</td>
          ${
            showMoney
              ? `<td class="amt">${escapeHtml(formatInr(rate))}</td>
          <td class="amt">${escapeHtml(formatInr(amount))}</td>`
              : ''
          }
        </tr>`
    })
    .join('')

  const goodsQty = lines.reduce((s, l) => s + (l.qty ?? 1), 0)
  const lineSum = lines.reduce((s, l) => {
    if (l.amount != null) return s + Number(l.amount)
    if (l.unitPrice != null) return s + Number(l.unitPrice) * (l.qty ?? 1)
    return s
  }, 0)
  const saleTotal = opts.saleTotal != null ? Number(opts.saleTotal) : lineSum > 0 ? lineSum : null
  const advance = opts.advanceAmount != null ? Number(opts.advanceAmount) : 0
  const balance =
    opts.balanceDue != null
      ? Number(opts.balanceDue)
      : saleTotal != null
        ? Math.max(0, saleTotal - advance)
        : null

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Delivery Challan ${dcNo}</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:${isSale ? '#0369a1' : '#b45309'};--soft:${isSale ? '#f0f9ff' : '#fffbeb'}}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:var(--ink);margin:0;background:#e2e8f0;font-size:13px}
  .sheet{max-width:900px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)}
  .hero{background:linear-gradient(135deg,${isSale ? '#0c4a6e 0%,#0369a1 55%,#0d9488 100%' : '#b45309 0%,#d97706 50%,#0369a1 100%'});color:#fff;padding:26px 30px}
  .hero-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-size:24px;font-weight:800}
  .tag{display:inline-block;margin-top:8px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .meta{text-align:right}.dc-no{font-size:22px;font-weight:800}
  .body{padding:26px 30px 34px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .party{border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-height:110px}
  .party.from{background:linear-gradient(180deg,${isSale ? '#ecfeff' : '#fff7ed'},#fff)}
  .party.to{background:linear-gradient(180deg,#f0f9ff,#fff)}
  .label{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .name{font-size:16px;font-weight:800;margin-bottom:4px}
  .line{color:var(--muted);line-height:1.45}
  .banner{margin-bottom:16px;padding:10px 14px;border-radius:10px;background:var(--soft);border:1px solid ${isSale ? '#7dd3fc' : '#fcd34d'};color:${isSale ? '#0c4a6e' : '#92400e'};font-weight:700;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{background:var(--brand);color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
  .num{width:40px;text-align:center}
  .amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .totals{margin-top:16px;margin-left:auto;width:min(320px,100%);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .totals row,.totals .trow{display:flex;justify-content:space-between;gap:12px;padding:8px 14px;border-bottom:1px solid var(--line)}
  .totals .trow:last-child{border-bottom:0;background:var(--soft);font-weight:800}
  .footer{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:28px;color:var(--muted);font-size:12px}
  .sign{border-top:1px solid #94a3b8;padding-top:8px;margin-top:40px}
  .toolbar{padding:14px 28px;background:#f1f5f9;display:flex;gap:10px;flex-wrap:wrap}
  .toolbar button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
  .btn-print{background:var(--brand);color:#fff}
  .btn-close{background:#e2e8f0;color:#0f172a}
  @media print{.toolbar{display:none}body{background:#fff}.sheet{margin:0;box-shadow:none;border-radius:0}}
</style></head><body>
<div class="toolbar">
  <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
  <button class="btn-close" onclick="window.close()">Close</button>
</div>
<div class="sheet">
  <div class="hero">
    <div class="hero-top">
      <div>
        <div class="brand">${seller}</div>
        <div class="tag">Delivery challan · ${isSale ? 'Sale' : 'Demo'}</div>
        ${opts.sellerGstin ? `<div style="margin-top:8px;opacity:.9;font-size:12px">GSTIN ${escapeHtml(opts.sellerGstin)}</div>` : ''}
        ${opts.sellerAddress ? `<div style="margin-top:4px;opacity:.85;font-size:12px;max-width:360px">${escapeHtml(opts.sellerAddress)}</div>` : ''}
        ${opts.sellerPhone || opts.sellerEmail ? `<div style="margin-top:4px;opacity:.85;font-size:12px">${escapeHtml([opts.sellerPhone, opts.sellerEmail].filter(Boolean).join(' · '))}</div>` : ''}
      </div>
      <div class="meta">
        <div class="dc-no">${dcNo}</div>
        <div style="margin-top:6px;opacity:.95">Date: ${escapeHtml(opts.date || '—')}</div>
        <div style="margin-top:4px;opacity:.9;font-size:12px">Purpose: ${isSale ? 'Sale delivery' : 'Demonstration'}</div>
        ${opts.reqNumber ? `<div style="margin-top:4px;opacity:.9;font-size:12px">Req: ${escapeHtml(opts.reqNumber)}</div>` : ''}
        ${showMoney && saleTotal != null ? `<div style="margin-top:8px;font-size:14px;font-weight:800">Total ${escapeHtml(formatInr(saleTotal))}</div>` : ''}
      </div>
    </div>
  </div>
  <div class="body">
    <div class="banner">${
      isSale
        ? `Sale dispatch challan — products below are ordered for / released to the customer. ${opts.reqNumber ? `Ref ${escapeHtml(opts.reqNumber)}.` : ''} ${goodsQty ? `${goodsQty} unit(s).` : ''}`
        : `This unit is issued for DEMO / TRIAL only — not a sale. Ownership remains with ${seller} until converted.`
    }</div>
    <div class="parties">
      <div class="party from">
        <div class="label">From (consignor)</div>
        <div class="name">${seller}</div>
        <div class="line">${opts.sellerAddress ? escapeHtml(opts.sellerAddress) : 'Warehouse / dispatch'}</div>
        ${opts.executiveName ? `<div class="line" style="margin-top:6px">Prepared by: <strong>${escapeHtml(opts.executiveName)}</strong></div>` : ''}
      </div>
      <div class="party to">
        <div class="label">To (consignee / customer)</div>
        <div class="name">${escapeHtml(opts.customerName)}</div>
        ${opts.customerCode ? `<div class="line">Customer code: ${escapeHtml(opts.customerCode)}</div>` : ''}
        ${opts.company ? `<div class="line">${escapeHtml(opts.company)}</div>` : ''}
        ${opts.phone ? `<div class="line">Phone: ${escapeHtml(opts.phone)}</div>` : ''}
        ${opts.email ? `<div class="line">${escapeHtml(opts.email)}</div>` : ''}
        ${opts.addressLine ? `<div class="line" style="margin-top:4px">${escapeHtml(opts.addressLine)}</div>` : place ? `<div class="line">${escapeHtml(place)}</div>` : ''}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Product / description</th>
          <th>Serial / HMS</th>
          <th class="num">Qty</th>
          ${showMoney ? '<th class="amt">Rate</th><th class="amt">Amount</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        ${
          !opts.lines?.length && familyLine
            ? `<tr><td></td><td colspan="${showMoney ? 5 : 3}" style="color:var(--muted);font-size:12px">${escapeHtml(familyLine)}</td></tr>`
            : ''
        }
      </tbody>
    </table>
    ${
      showMoney && saleTotal != null
        ? `<div class="totals">
      <div class="trow"><span>Goods total</span><span>${escapeHtml(formatInr(saleTotal))}</span></div>
      <div class="trow"><span>Advance received</span><span>${escapeHtml(formatInr(advance))}</span></div>
      <div class="trow"><span>Balance due</span><span>${escapeHtml(formatInr(balance))}</span></div>
    </div>`
        : ''
    }
    ${opts.notes ? `<p style="margin-top:16px;color:var(--muted)">${escapeHtml(opts.notes)}</p>` : ''}
    <div class="footer">
      <div>
        <div class="sign">Prepared / dispatched by</div>
      </div>
      <div>
        <div class="sign">Received by (customer)</div>
      </div>
    </div>
  </div>
</div>
</body></html>`
}

function printViaHiddenIframe(html: string): boolean {
  try {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('title', 'Delivery challan print')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) {
      iframe.remove()
      return false
    }
    doc.open()
    doc.write(html)
    doc.close()
    const win = iframe.contentWindow
    if (!win) {
      iframe.remove()
      return false
    }
    window.setTimeout(() => {
      try {
        win.focus()
        win.print()
      } finally {
        window.setTimeout(() => iframe.remove(), 1500)
      }
    }, 250)
    return true
  } catch {
    return false
  }
}

export function openPrintableDeliveryChallan(
  opts: DeliveryChallan,
  fallbackSellerName = 'HMS Enterprises',
): boolean {
  const html = buildDeliveryChallanHtml(opts, fallbackSellerName)
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (win) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return true
    }
    URL.revokeObjectURL(url)
  } catch {
    /* fall through */
  }
  return printViaHiddenIframe(html)
}
