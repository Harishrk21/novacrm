/** Printable service report (browser Print → Save as PDF). */
import { openPrintHtml } from '@/lib/openPrintHtml'

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

function labelize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export type ServiceReportSpareLine = {
  partName: string
  partCode?: string | null
  changeType?: string | null
  quantity?: number | null
  oldSerialNo?: string | null
  newSerialNo?: string | null
  chargeAmount?: number | null
  underWarranty?: boolean
  notes?: string | null
}

export type ServiceReportPrintOpts = {
  companyName: string
  companyPhone?: string | null
  companyEmail?: string | null
  ticketNo?: number | string | null
  subject?: string | null
  status?: string | null
  category?: string | null
  workType?: string | null
  channel?: string | null
  priority?: string | null
  createdAt?: string | null
  resolvedAt?: string | null
  closedAt?: string | null
  customerName: string
  customerCode?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerArea?: string | null
  machineName?: string | null
  machineSerial?: string | null
  machineType?: string | null
  machineModel?: string | null
  machineCapacity?: string | null
  servicePlan?: string | null
  stampingDate?: string | null
  nextDueDate?: string | null
  issues?: string | null
  workDone?: string | null
  description?: string | null
  dayNotesSummary?: string | null
  spareParts?: ServiceReportSpareLine[] | null
  sparePartsCount?: number | null
  savedAt?: string | null
  savedBy?: string | null
  paymentTotal?: number | null
  advanceAmount?: number | null
  balanceDue?: number | null
  paymentStatus?: string | null
  paymentMethod?: string | null
  paidAt?: string | null
  engineerName?: string | null
  receivedBy?: string | null
  deliveredBy?: string | null
}

export function openPrintableServiceReport(opts: ServiceReportPrintOpts): boolean {
  const ticketLabel =
    opts.ticketNo != null && String(opts.ticketNo).trim()
      ? `SVC-${String(opts.ticketNo).padStart(5, '0')}`
      : 'Service report'

  const spares = Array.isArray(opts.spareParts) ? opts.spareParts : []
  const spareRows =
    spares.length > 0
      ? spares
          .map(
            (p, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <strong>${escapeHtml(p.partName || '—')}</strong>
          ${p.partCode ? `<div class="sub">${escapeHtml(p.partCode)}</div>` : ''}
          ${p.notes ? `<div class="sub">${escapeHtml(p.notes)}</div>` : ''}
        </td>
        <td>${escapeHtml(p.changeType ? labelize(String(p.changeType)) : '—')}</td>
        <td class="money">${Number(p.quantity || 1)}</td>
        <td>${escapeHtml([p.oldSerialNo, p.newSerialNo].filter(Boolean).join(' → ') || '—')}</td>
        <td class="money">${
          p.underWarranty ? 'Warranty' : money(Number(p.chargeAmount || 0))
        }</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="6" class="empty">No spare part changes logged on this report</td></tr>`

  const payStatus = String(opts.paymentStatus || 'UNPAID')
  const paidBadge =
    payStatus === 'PAID'
      ? '<span class="pill paid">Paid in full</span>'
      : payStatus === 'PARTIAL'
        ? '<span class="pill partial">Partial</span>'
        : Number(opts.paymentTotal || 0) <= 0
          ? '<span class="pill free">Free job</span>'
          : '<span class="pill unpaid">Unpaid</span>'

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Service report ${escapeHtml(ticketLabel)}</title>
<style>
  :root{--ink:#0c1a2a;--muted:#5b6b7c;--line:#d7e0ea;--brand:#0369a1;--brand2:#0ea5e9;--soft:#f0f9ff;--amber:#b45309}
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif;color:var(--ink);margin:0;background:#e2e8f0;font-size:12.5px}
  .sheet{max-width:900px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 14px 44px rgba(15,23,42,.14)}
  .toolbar{padding:12px 28px;background:#f1f5f9;display:flex;gap:10px;flex-wrap:wrap}
  .toolbar button{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
  .btn-print{background:var(--brand);color:#fff}
  .btn-close{background:#fff;border:1px solid #cbd5e1!important;color:var(--ink)}
  .hero{background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 55%,#0f766e 100%);color:#fff;padding:22px 28px}
  .hero-top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-size:22px;font-weight:800;letter-spacing:.01em}
  .tag{display:inline-block;margin-top:8px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);padding:4px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .meta{text-align:right}
  .job-no{font-size:20px;font-weight:800}
  .body{padding:22px 28px 30px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
  .box{border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-height:108px}
  .box.customer{background:linear-gradient(180deg,#ecfeff,#fff);border-color:#a5f3fc}
  .box.machine{background:linear-gradient(180deg,#f0fdf4,#fff);border-color:#bbf7d0}
  .label{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  .name{font-size:15px;font-weight:800;margin-bottom:4px}
  .line{color:var(--muted);line-height:1.45}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
  .fact{background:var(--soft);border:1px solid #bae6fd;border-radius:8px;padding:8px 10px}
  .fact span{display:block;font-size:9px;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:.04em}
  .fact strong{display:block;margin-top:3px;font-size:12px}
  .section{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px}
  .section h3{margin:0 0 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--brand)}
  .section .text{color:var(--ink);line-height:1.5;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;margin-top:4px;border-radius:8px;overflow:hidden}
  thead th{background:linear-gradient(90deg,#0369a1,#0ea5e9);color:#fff;padding:9px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  tbody td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
  tbody tr:nth-child(even){background:#f8fafc}
  td.num{width:28px;color:var(--muted)}
  td.money{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.empty{text-align:center;color:var(--muted);padding:14px}
  .sub{font-size:11px;color:var(--muted);margin-top:2px}
  .pay-grid{display:grid;grid-template-columns:1fr 280px;gap:14px;align-items:start}
  .totals{background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0;color:var(--muted)}
  .totals .grand{margin-top:6px;padding-top:8px;border-top:2px solid var(--brand);color:var(--ink);font-weight:800;font-size:14px}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
  .pill.paid{background:#d1fae5;color:#047857}
  .pill.partial{background:#fef3c7;color:#b45309}
  .pill.unpaid{background:#fee2e2;color:#b91c1c}
  .pill.free{background:#e0e7ff;color:#3730a3}
  .footer{margin-top:22px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;color:var(--muted);font-size:11px}
  .sign{border-top:1px solid #94a3b8;padding-top:8px;margin-top:40px}
  .foot{margin-top:16px;font-size:10px;color:var(--muted)}
  @media (max-width:720px){.grid2,.facts,.pay-grid,.footer{grid-template-columns:1fr}.hero,.body,.toolbar{padding:14px}.meta{text-align:left}}
  @media print{body{background:#fff}.sheet{margin:0;box-shadow:none;border-radius:0}.toolbar{display:none!important}}
</style></head><body>
<div class="sheet">
  <div class="toolbar">
    <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>
  <div class="hero">
    <div class="hero-top">
      <div>
        <div class="brand">${escapeHtml(opts.companyName || 'HMS Enterprises')}</div>
        <div class="tag">Official service report</div>
        ${
          opts.companyPhone || opts.companyEmail
            ? `<div style="margin-top:8px;font-size:11px;opacity:.92">${escapeHtml(
                [opts.companyPhone, opts.companyEmail].filter(Boolean).join(' · '),
              )}</div>`
            : ''
        }
      </div>
      <div class="meta">
        <div class="job-no">${escapeHtml(ticketLabel)}</div>
        <div style="opacity:.95;margin-top:6px">${escapeHtml(opts.status ? labelize(String(opts.status)) : 'Closed')} · ${paidBadge}</div>
        ${opts.subject ? `<div style="opacity:.9;margin-top:4px;max-width:280px">${escapeHtml(String(opts.subject))}</div>` : ''}
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
        ${opts.customerArea ? `<div class="line">${escapeHtml(opts.customerArea)}</div>` : ''}
        ${opts.customerAddress ? `<div class="line">${escapeHtml(opts.customerAddress)}</div>` : ''}
      </div>
      <div class="box machine">
        <div class="label">Machine / equipment</div>
        <div class="name">${escapeHtml(opts.machineName || '—')}</div>
        ${opts.machineType ? `<div class="line">${escapeHtml(labelize(String(opts.machineType)))}</div>` : ''}
        ${opts.machineModel ? `<div class="line">Model: ${escapeHtml(opts.machineModel)}</div>` : ''}
        ${opts.machineSerial ? `<div class="line">Serial: ${escapeHtml(opts.machineSerial)}</div>` : ''}
        ${opts.machineCapacity ? `<div class="line">Capacity: ${escapeHtml(opts.machineCapacity)}</div>` : ''}
        ${opts.servicePlan ? `<div class="line">Plan: ${escapeHtml(labelize(String(opts.servicePlan)))}</div>` : ''}
        ${opts.engineerName ? `<div class="line">Engineer: ${escapeHtml(opts.engineerName)}</div>` : ''}
      </div>
    </div>

    <div class="facts">
      <div class="fact"><span>Opened</span><strong>${escapeHtml(opts.createdAt || '—')}</strong></div>
      <div class="fact"><span>Completed</span><strong>${escapeHtml(opts.resolvedAt || opts.closedAt || '—')}</strong></div>
      <div class="fact"><span>Category</span><strong>${escapeHtml(
        [opts.category, opts.workType].filter(Boolean).join(' · ') || '—',
      )}</strong></div>
      <div class="fact"><span>Priority / channel</span><strong>${escapeHtml(
        [opts.priority ? labelize(String(opts.priority)) : '', opts.channel]
          .filter(Boolean)
          .join(' · ') || '—',
      )}</strong></div>
      ${
        opts.stampingDate || opts.nextDueDate
          ? `<div class="fact"><span>Stamping date</span><strong>${escapeHtml(opts.stampingDate || '—')}</strong></div>
             <div class="fact"><span>Valid till / next due</span><strong>${escapeHtml(opts.nextDueDate || '—')}</strong></div>
             <div class="fact"><span>Paid at</span><strong>${escapeHtml(opts.paidAt || '—')}</strong></div>
             <div class="fact"><span>Report by</span><strong>${escapeHtml(opts.savedBy || '—')}</strong></div>`
          : `<div class="fact"><span>Paid at</span><strong>${escapeHtml(opts.paidAt || '—')}</strong></div>
             <div class="fact"><span>Report saved</span><strong>${escapeHtml(
               opts.savedAt ? String(opts.savedAt).slice(0, 16).replace('T', ' ') : '—',
             )}</strong></div>
             <div class="fact"><span>Prepared by</span><strong>${escapeHtml(opts.savedBy || '—')}</strong></div>
             <div class="fact"><span>Engineer</span><strong>${escapeHtml(opts.engineerName || '—')}</strong></div>`
      }
    </div>

    ${
      opts.description
        ? `<div class="section"><h3>Job description</h3><div class="text">${escapeHtml(opts.description)}</div></div>`
        : ''
    }
    <div class="section">
      <h3>Issues / complaint reported</h3>
      <div class="text">${escapeHtml(opts.issues || '—')}</div>
    </div>
    <div class="section">
      <h3>Work done / remarks</h3>
      <div class="text">${escapeHtml(opts.workDone || '—')}</div>
    </div>
    ${
      opts.dayNotesSummary
        ? `<div class="section"><h3>Daily tracking notes</h3><div class="text">${escapeHtml(opts.dayNotesSummary)}</div></div>`
        : ''
    }

    <div class="section">
      <h3>Spare parts &amp; changes${
        spares.length || opts.sparePartsCount
          ? ` (${spares.length || opts.sparePartsCount})`
          : ''
      }</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Part</th>
            <th>Change</th>
            <th style="text-align:right">Qty</th>
            <th>Serial (old → new)</th>
            <th style="text-align:right">Charge</th>
          </tr>
        </thead>
        <tbody>${spareRows}</tbody>
      </table>
    </div>

    <div class="pay-grid">
      <div class="section" style="margin:0">
        <h3>Service team</h3>
        <div class="line">Engineer: <strong style="color:var(--ink)">${escapeHtml(opts.engineerName || '—')}</strong></div>
        <div class="line" style="margin-top:4px">Received by: <strong style="color:var(--ink)">${escapeHtml(opts.receivedBy || '—')}</strong></div>
        <div class="line" style="margin-top:4px">Delivered by: <strong style="color:var(--ink)">${escapeHtml(opts.deliveredBy || '—')}</strong></div>
        <div class="line" style="margin-top:4px">Report prepared by: <strong style="color:var(--ink)">${escapeHtml(opts.savedBy || '—')}</strong></div>
      </div>
      <div class="totals">
        <div><span>Payment status</span><span>${paidBadge}</span></div>
        <div><span>Method</span><span>${escapeHtml(
          opts.paymentMethod ? labelize(String(opts.paymentMethod)) : '—',
        )}</span></div>
        <div><span>Advance</span><span>${money(Number(opts.advanceAmount || 0))}</span></div>
        <div><span>Balance</span><span>${money(Number(opts.balanceDue || 0))}</span></div>
        <div class="grand"><span>Job total</span><span>${money(Number(opts.paymentTotal || 0))}</span></div>
      </div>
    </div>

    <div class="footer">
      <div class="sign">Engineer signature<br/><strong style="color:var(--ink)">${escapeHtml(opts.engineerName || '')}</strong></div>
      <div class="sign">Authorised by<br/><strong style="color:var(--ink)">${escapeHtml(opts.savedBy || '')}</strong></div>
      <div class="sign">Customer acknowledgement<br/><strong style="color:var(--ink)">${escapeHtml(opts.customerName || '')}</strong></div>
    </div>
    <p class="foot">
      Generated from ${escapeHtml(opts.companyName || 'HMS Enterprises')} · ${escapeHtml(ticketLabel)}
      · Print / Save as PDF from the browser
    </p>
  </div>
</div>
<script>
  function triggerPrint(){ setTimeout(function(){ window.print(); }, 350); }
  if (document.readyState === 'complete') triggerPrint();
  else window.addEventListener('load', triggerPrint);
</script>
</body></html>`

  const ticketSlug =
    opts.ticketNo != null ? `SVC-${String(opts.ticketNo).padStart(5, '0')}` : 'service-report'
  return openPrintHtml(html, { filename: `${ticketSlug}-service-report.html` }) !== false
}

function formatDayNotes(cf: Record<string, unknown>): string | null {
  const notes = cf.dayNotes
  if (!Array.isArray(notes) || notes.length === 0) return null
  return notes
    .map((n) => {
      if (!n || typeof n !== 'object') return null
      const row = n as Record<string, unknown>
      const date = row.date ? String(row.date).slice(0, 10) : ''
      const text = row.note || row.text || row.message || ''
      const by = row.byName || row.author || row.by || ''
      const line = [date, text ? String(text) : '', by ? `(${String(by)})` : '']
        .filter(Boolean)
        .join(' ')
      return line.trim() || null
    })
    .filter(Boolean)
    .join('\n')
}

/** Build print opts from a ticket list/detail row that has customFields.serviceReport */
export function serviceReportOptsFromTicket(
  ticket: Record<string, unknown>,
  companyName: string,
): ServiceReportPrintOpts | null {
  const cf =
    ticket.customFields && typeof ticket.customFields === 'object'
      ? (ticket.customFields as Record<string, unknown>)
      : {}
  const sr = cf.serviceReport
  if (!sr || typeof sr !== 'object') return null
  const report = sr as Record<string, unknown>
  const contact = ticket.contact as
    | {
        name?: string
        customerCode?: string | null
        phone?: string | null
        mobile?: string | null
        street?: string | null
        doorNo?: string | null
        area?: string | null
        city?: string | null
        pincode?: string | null
        location?: string | null
      }
    | null
    | undefined
  const asset = ticket.asset as
    | {
        name?: string
        serialNo?: string | null
        machineType?: string | null
        model?: string | null
        capacity?: string | null
        servicePlan?: string | null
      }
    | null
    | undefined

  const address = [
    contact?.doorNo,
    contact?.street,
    contact?.area,
    contact?.city || contact?.location,
    contact?.pincode,
  ]
    .filter(Boolean)
    .join(', ')

  const spareFromReport = Array.isArray(report.spareParts)
    ? (report.spareParts as ServiceReportSpareLine[])
    : []

  const engineerName =
    report.engineerName
      ? String(report.engineerName)
      : ticket.assignedToName
        ? String(ticket.assignedToName)
        : ticket.assignee &&
            typeof ticket.assignee === 'object' &&
            'name' in (ticket.assignee as object)
          ? String((ticket.assignee as { name: string }).name)
          : null

  return {
    companyName,
    ticketNo: ticket.ticketNo != null ? String(ticket.ticketNo) : null,
    subject: ticket.subject != null ? String(ticket.subject) : null,
    status: ticket.status != null ? String(ticket.status) : null,
    category: report.category
      ? String(report.category)
      : cf.category
        ? String(cf.category)
        : null,
    workType: report.workType
      ? String(report.workType)
      : cf.workType
        ? String(cf.workType)
        : null,
    channel: cf.channel ? String(cf.channel) : null,
    priority: ticket.priority != null ? String(ticket.priority) : null,
    createdAt: ticket.createdAt
      ? String(ticket.createdAt).slice(0, 10)
      : null,
    resolvedAt: ticket.resolvedAt
      ? String(ticket.resolvedAt).slice(0, 10)
      : null,
    closedAt: ticket.closedAt ? String(ticket.closedAt).slice(0, 10) : null,
    customerName: String(report.customerName || contact?.name || '—'),
    customerCode: contact?.customerCode ? String(contact.customerCode) : null,
    customerPhone: contact?.phone || contact?.mobile
      ? String(contact.phone || contact.mobile)
      : null,
    customerAddress: address || null,
    customerArea: contact?.area ? String(contact.area) : null,
    machineName: String(report.machineName || asset?.name || '—'),
    machineSerial: report.machineSerial
      ? String(report.machineSerial)
      : asset?.serialNo
        ? String(asset.serialNo)
        : null,
    machineType: report.machineType
      ? String(report.machineType)
      : asset?.machineType
        ? String(asset.machineType)
        : null,
    machineModel: report.machineModel
      ? String(report.machineModel)
      : asset?.model
        ? String(asset.model)
        : null,
    machineCapacity: asset?.capacity ? String(asset.capacity) : null,
    servicePlan: asset?.servicePlan ? String(asset.servicePlan) : null,
    stampingDate: ticket.stampingDate
      ? String(ticket.stampingDate).slice(0, 10)
      : null,
    nextDueDate: ticket.nextDueDate ? String(ticket.nextDueDate).slice(0, 10) : null,
    issues: report.issues ? String(report.issues) : null,
    workDone: report.workDone ? String(report.workDone) : null,
    description: ticket.description ? String(ticket.description) : null,
    dayNotesSummary: formatDayNotes(cf),
    spareParts: spareFromReport,
    sparePartsCount: Number(report.sparePartsCount || spareFromReport.length || 0),
    savedAt: report.savedAt ? String(report.savedAt) : null,
    savedBy: report.savedBy ? String(report.savedBy) : null,
    paymentTotal:
      report.paymentTotal != null
        ? Number(report.paymentTotal)
        : ticket.paymentTotal != null
          ? Number(ticket.paymentTotal)
          : null,
    advanceAmount:
      report.advanceAmount != null
        ? Number(report.advanceAmount)
        : ticket.advanceAmount != null
          ? Number(ticket.advanceAmount)
          : null,
    balanceDue:
      report.balanceDue != null
        ? Number(report.balanceDue)
        : ticket.balanceDue != null
          ? Number(ticket.balanceDue)
          : null,
    paymentStatus:
      report.paymentStatus != null
        ? String(report.paymentStatus)
        : ticket.paymentStatus != null
          ? String(ticket.paymentStatus)
          : null,
    paymentMethod:
      report.paymentMethod != null
        ? String(report.paymentMethod)
        : ticket.paymentMethod != null
          ? String(ticket.paymentMethod)
          : null,
    paidAt: ticket.paidAt ? String(ticket.paidAt).slice(0, 16).replace('T', ' ') : null,
    engineerName,
    receivedBy:
      ticket.receivedBy &&
      typeof ticket.receivedBy === 'object' &&
      'name' in (ticket.receivedBy as object)
        ? String((ticket.receivedBy as { name: string }).name)
        : null,
    deliveredBy:
      ticket.deliveredBy &&
      typeof ticket.deliveredBy === 'object' &&
      'name' in (ticket.deliveredBy as object)
        ? String((ticket.deliveredBy as { name: string }).name)
        : null,
  }
}
