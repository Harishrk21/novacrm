/** Delivery challan for demo issue (browser Print → Save as PDF). */

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export type DemoDeliveryChallan = {
  number: string
  date: string
  issuedAt: string
  purpose: 'DEMO'
  customerName: string
  company?: string | null
  phone?: string | null
  city?: string | null
  state?: string | null
  addressLine?: string | null
  productName: string
  productSku?: string | null
  serialNo: string
  qty: number
  stampingDate?: string | null
  catalogFamily?: string | null
  catalogIndustry?: string | null
  executiveName?: string | null
  leadId?: string | null
  stockUnitId?: string | null
  notes?: string | null
  sellerName?: string | null
  sellerPhone?: string | null
  sellerEmail?: string | null
  sellerGstin?: string | null
  sellerAddress?: string | null
}

export function parseDemoDeliveryChallan(source: unknown): DemoDeliveryChallan | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const c = source as Record<string, unknown>
  const number = c.number ? String(c.number) : ''
  const serialNo = c.serialNo ? String(c.serialNo) : ''
  const productName = c.productName ? String(c.productName) : ''
  const customerName = c.customerName ? String(c.customerName) : ''
  if (!number || !serialNo) return null
  return {
    number,
    date: String(c.date ?? '').slice(0, 10),
    issuedAt: String(c.issuedAt ?? ''),
    purpose: 'DEMO',
    customerName: customerName || 'Customer',
    company: c.company != null ? String(c.company) : null,
    phone: c.phone != null ? String(c.phone) : null,
    city: c.city != null ? String(c.city) : null,
    state: c.state != null ? String(c.state) : null,
    addressLine: c.addressLine != null ? String(c.addressLine) : null,
    productName: productName || 'Product',
    productSku: c.productSku != null ? String(c.productSku) : null,
    serialNo,
    qty: Number(c.qty ?? 1) || 1,
    stampingDate: c.stampingDate != null ? String(c.stampingDate) : null,
    catalogFamily: c.catalogFamily != null ? String(c.catalogFamily) : null,
    catalogIndustry: c.catalogIndustry != null ? String(c.catalogIndustry) : null,
    executiveName: c.executiveName != null ? String(c.executiveName) : null,
    leadId: c.leadId != null ? String(c.leadId) : null,
    stockUnitId: c.stockUnitId != null ? String(c.stockUnitId) : null,
    notes: c.notes != null ? String(c.notes) : null,
    sellerName: c.sellerName != null ? String(c.sellerName) : null,
    sellerPhone: c.sellerPhone != null ? String(c.sellerPhone) : null,
    sellerEmail: c.sellerEmail != null ? String(c.sellerEmail) : null,
    sellerGstin: c.sellerGstin != null ? String(c.sellerGstin) : null,
    sellerAddress: c.sellerAddress != null ? String(c.sellerAddress) : null,
  }
}

/** Read DC from lead or stock-unit customFields. */
export function challanFromCustomFields(
  cf: Record<string, unknown> | null | undefined,
): DemoDeliveryChallan | null {
  if (!cf) return null
  return (
    parseDemoDeliveryChallan(cf.demoDeliveryChallan) ??
    (cf.demoDcNo
      ? parseDemoDeliveryChallan({
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

export function buildDeliveryChallanHtml(
  opts: DemoDeliveryChallan,
  fallbackSellerName = 'HMS Enterprises',
): string {
  const seller = escapeHtml(opts.sellerName || fallbackSellerName)
  const dcNo = escapeHtml(opts.number)
  const place = [opts.city, opts.state].filter(Boolean).join(', ')
  const familyLine = [opts.catalogFamily, opts.catalogIndustry].filter(Boolean).join(' · ')

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Delivery Challan ${dcNo}</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#b45309;--soft:#fffbeb}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:var(--ink);margin:0;background:#e2e8f0;font-size:13px}
  .sheet{max-width:860px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)}
  .hero{background:linear-gradient(135deg,#b45309 0%,#d97706 50%,#0369a1 100%);color:#fff;padding:26px 30px}
  .hero-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-size:24px;font-weight:800}
  .tag{display:inline-block;margin-top:8px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .meta{text-align:right}.dc-no{font-size:22px;font-weight:800}
  .body{padding:26px 30px 34px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .party{border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-height:110px}
  .party.from{background:linear-gradient(180deg,#fff7ed,#fff)}
  .party.to{background:linear-gradient(180deg,#f0f9ff,#fff)}
  .label{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .name{font-size:16px;font-weight:800;margin-bottom:4px}
  .line{color:var(--muted);line-height:1.45}
  .banner{margin-bottom:16px;padding:10px 14px;border-radius:10px;background:var(--soft);border:1px solid #fcd34d;color:#92400e;font-weight:700;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left}
  th{background:#b45309;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
  .num{width:40px;text-align:center}
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
        <div class="tag">Delivery challan · Demo</div>
        ${opts.sellerGstin ? `<div style="margin-top:8px;opacity:.9;font-size:12px">GSTIN ${escapeHtml(opts.sellerGstin)}</div>` : ''}
        ${opts.sellerAddress ? `<div style="margin-top:4px;opacity:.85;font-size:12px;max-width:360px">${escapeHtml(opts.sellerAddress)}</div>` : ''}
        ${opts.sellerPhone || opts.sellerEmail ? `<div style="margin-top:4px;opacity:.85;font-size:12px">${escapeHtml([opts.sellerPhone, opts.sellerEmail].filter(Boolean).join(' · '))}</div>` : ''}
      </div>
      <div class="meta">
        <div class="dc-no">${dcNo}</div>
        <div style="margin-top:6px;opacity:.95">Date: ${escapeHtml(opts.date || '—')}</div>
        <div style="margin-top:4px;opacity:.9;font-size:12px">Purpose: Demonstration</div>
      </div>
    </div>
  </div>
  <div class="body">
    <div class="banner">This unit is issued for DEMO / TRIAL only — not a sale. Ownership remains with ${seller} until converted.</div>
    <div class="parties">
      <div class="party from">
        <div class="label">From (consignor)</div>
        <div class="name">${seller}</div>
        <div class="line">${opts.sellerAddress ? escapeHtml(opts.sellerAddress) : 'Warehouse / executive stock'}</div>
        ${opts.executiveName ? `<div class="line" style="margin-top:6px">Issued by: <strong>${escapeHtml(opts.executiveName)}</strong></div>` : ''}
      </div>
      <div class="party to">
        <div class="label">To (consignee / prospect)</div>
        <div class="name">${escapeHtml(opts.customerName)}</div>
        ${opts.company ? `<div class="line">${escapeHtml(opts.company)}</div>` : ''}
        ${opts.phone ? `<div class="line">${escapeHtml(opts.phone)}</div>` : ''}
        ${place ? `<div class="line">${escapeHtml(place)}</div>` : ''}
        ${opts.addressLine ? `<div class="line">${escapeHtml(opts.addressLine)}</div>` : ''}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Description</th>
          <th>Serial no.</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">1</td>
          <td>
            <strong>${escapeHtml(opts.productName)}</strong>
            ${opts.productSku ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">${escapeHtml(opts.productSku)}</div>` : ''}
            ${familyLine ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">${escapeHtml(familyLine)}</div>` : ''}
            ${opts.stampingDate ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">Stamping: ${escapeHtml(String(opts.stampingDate).slice(0, 10))}</div>` : ''}
          </td>
          <td style="font-family:ui-monospace,monospace;font-weight:700">${escapeHtml(opts.serialNo)}</td>
          <td>${opts.qty}</td>
        </tr>
      </tbody>
    </table>
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
  opts: DemoDeliveryChallan,
  fallbackSellerName = 'HMS Enterprises',
): boolean {
  const html = buildDeliveryChallanHtml(opts, fallbackSellerName)
  // Prefer blob tab (same pattern as job sheet). Do NOT use noopener — it returns null
  // and leaves a blank tab. If the browser blocks the tab, fall back to iframe print.
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
