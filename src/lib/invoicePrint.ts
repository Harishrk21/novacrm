/** Tax invoice printable (browser Print → Save as PDF). Distinct from job-sheet receipt. */

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function money(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n || 0)
}

export type InvoicePrintOpts = {
  invoiceNumber: string
  status: string
  invoiceDate: string
  dueDate?: string | null
  sellerName: string
  sellerPhone?: string
  sellerEmail?: string
  accountName: string
  contactName?: string
  billingAddress?: string
  currency?: string
  notes?: string | null
  ticketRef?: string
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxPercent: number; lineTotal: number }>
  subtotal: number
  taxTotal: number
  discountTotal: number
  grandTotal: number
  amountPaid?: number
}

export function openPrintableInvoice(opts: InvoicePrintOpts): boolean {
  const currency = opts.currency || 'INR'
  const rows = opts.lines
    .map(
      (l, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(l.description)}</td>
        <td style="text-align:right">${l.quantity}</td>
        <td style="text-align:right">${money(l.unitPrice)}</td>
        <td style="text-align:right">${l.taxPercent}%</td>
        <td style="text-align:right">${money(l.lineTotal)}</td>
      </tr>`,
    )
    .join('')
  const balance = Math.max(0, opts.grandTotal - (opts.amountPaid ?? 0))

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(opts.invoiceNumber)}</title>
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#0369a1;--amber:#d97706;--soft:#f0f9ff}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:var(--ink);margin:0;background:#e2e8f0;font-size:13px}
  .sheet{max-width:860px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.12)}
  .hero{background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 55%,#14b8a6 100%);color:#fff;padding:28px 32px}
  .hero-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-size:26px;font-weight:800}
  .tag{display:inline-block;margin-top:8px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  .inv-meta{text-align:right}.inv-no{font-size:22px;font-weight:800}
  .body{padding:28px 32px 36px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px}
  .party{border-radius:12px;padding:16px 18px;border:1px solid var(--line);min-height:110px}
  .party.from{background:linear-gradient(180deg,#ecfeff,#fff)}
  .party.to{background:linear-gradient(180deg,#f0fdf4,#fff)}
  .label{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;color:var(--muted)}
  .name{font-size:17px;font-weight:800;margin-bottom:6px}
  .line{color:var(--muted);line-height:1.45}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
  .fact{background:var(--soft);border:1px solid #bae6fd;border-radius:10px;padding:10px 12px}
  .fact span{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700}
  .fact strong{display:block;margin-top:4px}
  table{width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden}
  thead th{background:linear-gradient(90deg,#0369a1,#0ea5e9);color:#fff;padding:11px 10px;text-align:left;font-size:11px;text-transform:uppercase}
  tbody td{padding:10px;border-bottom:1px solid var(--line)}
  tbody tr:nth-child(even){background:#f8fafc}
  td.num{width:36px;color:var(--muted)}
  .totals-wrap{display:flex;justify-content:flex-end;margin-top:18px}
  .totals{width:300px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .totals div{display:flex;justify-content:space-between;padding:5px 0;color:var(--muted)}
  .totals .grand{margin-top:8px;padding-top:10px;border-top:2px solid var(--brand);color:var(--ink);font-size:16px;font-weight:800}
  .totals .balance{color:var(--amber);font-weight:700}
  .notes{margin-top:22px;padding:14px 16px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa}
  .toolbar{padding:16px 32px;background:#f1f5f9;display:flex;gap:10px}
  .toolbar button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
  .btn-print{background:var(--brand);color:#fff}
  .btn-close{background:#fff;border:1px solid #cbd5e1!important}
  @media print{body{background:#fff}.sheet{margin:0;box-shadow:none;border-radius:0}.toolbar{display:none}}
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
          <div style="opacity:.9;margin-top:4px">${escapeHtml(opts.status)} · ${escapeHtml(currency)}</div>
        </div>
      </div>
    </div>
    <div class="body">
      <div class="parties">
        <div class="party from">
          <div class="label">From (Seller)</div>
          <div class="name">${escapeHtml(opts.sellerName || 'Seller')}</div>
          ${opts.sellerPhone ? `<div class="line">☎ ${escapeHtml(opts.sellerPhone)}</div>` : ''}
          ${opts.sellerEmail ? `<div class="line">${escapeHtml(opts.sellerEmail)}</div>` : ''}
        </div>
        <div class="party to">
          <div class="label">Bill To</div>
          <div class="name">${escapeHtml(opts.accountName || opts.contactName || 'Customer')}</div>
          ${opts.contactName ? `<div class="line">Attn: ${escapeHtml(opts.contactName)}</div>` : ''}
          ${opts.billingAddress ? `<div class="line">${escapeHtml(opts.billingAddress)}</div>` : ''}
        </div>
      </div>
      <div class="facts">
        <div class="fact"><span>Invoice date</span><strong>${escapeHtml(opts.invoiceDate || '—')}</strong></div>
        <div class="fact"><span>Due date</span><strong>${escapeHtml(opts.dueDate || '—')}</strong></div>
        <div class="fact"><span>Job ref</span><strong>${escapeHtml(opts.ticketRef || '—')}</strong></div>
        <div class="fact"><span>Currency</span><strong>${escapeHtml(currency)}</strong></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Tax</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#64748b">No line items</td></tr>`}</tbody>
      </table>
      <div class="totals-wrap">
        <div class="totals">
          <div><span>Subtotal</span><span>${money(opts.subtotal)}</span></div>
          <div><span>Tax</span><span>${money(opts.taxTotal)}</span></div>
          <div><span>Discount</span><span>${money(opts.discountTotal)}</span></div>
          <div class="grand"><span>Grand total</span><span>${money(opts.grandTotal)}</span></div>
          ${opts.amountPaid != null ? `<div><span>Amount paid</span><span>${money(opts.amountPaid)}</span></div>` : ''}
          <div class="balance"><span>Balance due</span><span>${money(balance)}</span></div>
        </div>
      </div>
      ${opts.notes ? `<div class="notes"><strong>Notes</strong><br/>${escapeHtml(opts.notes)}</div>` : ''}
    </div>
  </div>
</body></html>`

  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (!win) {
      URL.revokeObjectURL(url)
      return false
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  } catch {
    return false
  }
}
