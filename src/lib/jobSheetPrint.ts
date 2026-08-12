/** Printable service job sheet (browser Print → Save as PDF). */

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

export type JobSheetPrintOpts = {
  companyName: string
  companyPhone?: string
  companyEmail?: string
  ticketNo: number | string
  subject: string
  status: string
  paymentStatus: string
  createdAt?: string
  completedAt?: string
  paidAt?: string | null
  customerName: string
  customerCode?: string | null
  customerPhone?: string | null
  customerAddress?: string
  machineName?: string
  machineType?: string
  serialNo?: string | null
  capacity?: string | null
  servicePlan?: string | null
  assetOrigin?: string | null
  amcStartDate?: string | null
  amcEndDate?: string | null
  stampingDate?: string | null
  nextDueDate?: string | null
  odAmount: number
  paymentTotal: number
  advanceAmount: number
  balanceDue: number
  receivedBy?: string | null
  deliveredBy?: string | null
  assignee?: string | null
  workNotes?: string
  category?: string
  channel?: string
}

export function openPrintableJobSheet(opts: JobSheetPrintOpts): boolean {
  const ticketLabel = `TKT-${String(opts.ticketNo).padStart(5, '0')}`
  const paidBadge =
    opts.paymentStatus === 'PAID'
      ? '<span class="pill paid">Paid in full</span>'
      : opts.paymentStatus === 'PARTIAL'
        ? '<span class="pill partial">Partial</span>'
        : '<span class="pill unpaid">Unpaid</span>'

  const machineTypeLabel = opts.machineType ? opts.machineType.replaceAll('_', ' ') : ''
  const servicePlanLabel = opts.servicePlan ? opts.servicePlan.replaceAll('_', ' ') : ''
  const originLabel =
    opts.assetOrigin === 'THIRD_PARTY'
      ? 'Outside / repair only'
      : opts.assetOrigin
        ? 'Sold by us'
        : ''
  const amcPeriod =
    opts.amcStartDate || opts.amcEndDate
      ? `${opts.amcStartDate || '—'} → ${opts.amcEndDate || '—'}`
      : ''

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Job sheet ${escapeHtml(ticketLabel)}</title>
<style>
  :root{--ink:#0c1a2a;--muted:#5b6b7c;--line:#d7e0ea;--brand:#0f766e;--brand2:#14b8a6;--amber:#b45309;--soft:#f0fdfa}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:var(--ink);margin:0;background:#dbe4ee;font-size:13px}
  .sheet{max-width:880px;margin:22px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 14px 44px rgba(15,23,42,.14)}
  .hero{background:linear-gradient(135deg,#0f766e 0%,#0d9488 45%,#0369a1 100%);color:#fff;padding:26px 30px}
  .hero-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-size:24px;font-weight:800;letter-spacing:.02em}
  .tag{display:inline-block;margin-top:8px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .meta{text-align:right}
  .job-no{font-size:22px;font-weight:800}
  .body{padding:26px 30px 34px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .box{border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-height:118px}
  .box.customer{background:linear-gradient(180deg,#ecfeff,#fff);border-color:#a5f3fc}
  .box.machine{background:linear-gradient(180deg,#f0fdf4,#fff);border-color:#bbf7d0}
  .label{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
  .name{font-size:16px;font-weight:800;margin-bottom:4px}
  .line{color:var(--muted);line-height:1.45}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .fact{background:var(--soft);border:1px solid #99f6e4;border-radius:10px;padding:10px 12px}
  .fact span{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  .fact strong{display:block;margin-top:4px;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left}
  th{background:#0f766e;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
  tr:nth-child(even) td{background:#f8fafc}
  .money{text-align:right;font-variant-numeric:tabular-nums}
  .totals{width:280px;margin-left:auto;margin-top:14px;background:#f8fafc;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)}
  .totals .grand{margin-top:6px;padding-top:8px;border-top:2px solid var(--brand);color:var(--ink);font-weight:800;font-size:15px}
  .notes{margin-top:18px;padding:12px 14px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa}
  .footer{margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:24px;color:var(--muted);font-size:12px}
  .sign{border-top:1px solid #94a3b8;padding-top:8px;margin-top:36px}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
  .pill.paid{background:#d1fae5;color:#047857}
  .pill.partial{background:#fef3c7;color:#b45309}
  .pill.unpaid{background:#fee2e2;color:#b91c1c}
  .toolbar{padding:14px 28px;background:#f1f5f9;display:flex;gap:10px;flex-wrap:wrap}
  .toolbar button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
  .btn-print{background:var(--brand);color:#fff}
  .btn-close{background:#fff;border:1px solid #cbd5e1!important;color:var(--ink)}
  @media (max-width:720px){.grid2,.facts,.footer{grid-template-columns:1fr}.hero,.body,.toolbar{padding:16px}.meta{text-align:left}}
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
          <div class="brand">${escapeHtml(opts.companyName || 'NovaCRM')}</div>
          <div class="tag">${opts.paymentStatus === 'PAID' ? 'Payment receipt' : 'Service job sheet'}</div>
        </div>
        <div class="meta">
          <div class="job-no">${escapeHtml(ticketLabel)}</div>
          <div style="opacity:.92;margin-top:6px">${escapeHtml(opts.status)} · ${paidBadge}</div>
        </div>
      </div>
    </div>
    <div class="body">
      <div class="grid2">
        <div class="box customer">
          <div class="label">Customer</div>
          <div class="name">${escapeHtml(opts.customerName || '—')}</div>
          ${opts.customerCode ? `<div class="line">ID: ${escapeHtml(opts.customerCode)}</div>` : ''}
          ${opts.customerPhone ? `<div class="line">☎ ${escapeHtml(opts.customerPhone)}</div>` : ''}
          ${opts.customerAddress ? `<div class="line">${escapeHtml(opts.customerAddress)}</div>` : ''}
        </div>
        <div class="box machine">
          <div class="label">Machine</div>
          <div class="name">${escapeHtml(opts.machineName || opts.subject || '—')}</div>
          ${machineTypeLabel ? `<div class="line">${escapeHtml(machineTypeLabel)}</div>` : ''}
          ${opts.serialNo ? `<div class="line">Serial: ${escapeHtml(opts.serialNo)}</div>` : ''}
          ${opts.capacity ? `<div class="line">Capacity: ${escapeHtml(opts.capacity)}</div>` : ''}
          ${originLabel ? `<div class="line">Origin: ${escapeHtml(originLabel)}</div>` : ''}
          ${servicePlanLabel ? `<div class="line">Plan: ${escapeHtml(servicePlanLabel)}${amcPeriod ? ` · ${escapeHtml(amcPeriod)}` : ''}</div>` : ''}
        </div>
      </div>

      <div class="facts">
        <div class="fact"><span>Created</span><strong>${escapeHtml(opts.createdAt || '—')}</strong></div>
        <div class="fact"><span>Stamping</span><strong>${escapeHtml(opts.stampingDate || '—')}</strong></div>
        <div class="fact"><span>Next due</span><strong>${escapeHtml(opts.nextDueDate || '—')}</strong></div>
        <div class="fact"><span>Completed</span><strong>${escapeHtml(opts.completedAt || '—')}</strong></div>
      </div>

      <table>
        <thead><tr><th>Item</th><th class="money">Amount</th></tr></thead>
        <tbody>
          <tr><td>OD / outstation</td><td class="money">${money(opts.odAmount)}</td></tr>
          <tr><td>Job payment total</td><td class="money">${money(opts.paymentTotal)}</td></tr>
          <tr><td>Advance received</td><td class="money">${money(opts.advanceAmount)}</td></tr>
          <tr><td><strong>Balance</strong></td><td class="money"><strong>${money(opts.balanceDue)}</strong></td></tr>
        </tbody>
      </table>

      <div class="totals">
        <div><span>Payment status</span><span>${escapeHtml(opts.paymentStatus)}</span></div>
        ${opts.paidAt ? `<div><span>Paid at</span><span>${escapeHtml(opts.paidAt)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money(opts.paymentTotal)}</span></div>
      </div>

      ${
        opts.workNotes
          ? `<div class="notes"><strong>Work notes</strong><br/>${escapeHtml(opts.workNotes)}</div>`
          : ''
      }

      <div class="footer">
        <div>
          <div>Received by: <strong style="color:var(--ink)">${escapeHtml(opts.receivedBy || '—')}</strong></div>
          <div style="margin-top:6px">Delivered by: <strong style="color:var(--ink)">${escapeHtml(opts.deliveredBy || '—')}</strong></div>
          <div style="margin-top:6px">Assignee: <strong style="color:var(--ink)">${escapeHtml(opts.assignee || '—')}</strong></div>
          ${opts.category || opts.channel ? `<div style="margin-top:6px">${escapeHtml([opts.category, opts.channel].filter(Boolean).join(' · '))}</div>` : ''}
        </div>
        <div class="sign">Customer acknowledgement<br/><strong style="color:var(--ink)">${escapeHtml(opts.customerName || '')}</strong></div>
      </div>
      <p style="margin-top:18px;color:var(--muted);font-size:11px">Generated from NovaCRM · ${escapeHtml(opts.companyName || '')}${opts.companyPhone ? ` · ${escapeHtml(opts.companyPhone)}` : ''}${opts.companyEmail ? ` · ${escapeHtml(opts.companyEmail)}` : ''}</p>
    </div>
  </div>
</body></html>`

  // Build HTML first, then open via blob URL.
  // Do NOT use noopener on about:blank — browsers open a blank tab and return null, so content never writes.
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
