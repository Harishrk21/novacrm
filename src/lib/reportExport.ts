import * as XLSX from 'xlsx'

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    downloadBlob(filename, new Blob([''], { type: 'text/csv;charset=utf-8' }))
    return
  }
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const lines = [keys.join(','), ...rows.map((r) => keys.map((k) => escape(r[k])).join(','))]
  downloadBlob(filename, new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
}

export function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
}

export function downloadXlsx(
  filename: string,
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>,
) {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{ note: 'No rows' }])
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

export function printReportHtml(title: string, sections: Array<{ heading: string; html: string }>) {
  const win = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720')
  if (!win) return
  win.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      body{font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a;margin:24px;line-height:1.45}
      h1{font-size:22px;margin:0 0 8px} h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
      th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
      th{background:#f8fafc} .meta{color:#64748b;font-size:12px;margin-bottom:16px}
      @media print{body{margin:12px}}
    </style></head><body>
    <h1>${title}</h1>
    <div class="meta">Generated ${new Date().toLocaleString('en-IN')} · HMS Enterprises</div>
    ${sections.map((s) => `<h2>${s.heading}</h2>${s.html}`).join('')}
    <script>window.onload=()=>{window.print()}</script>
    </body></html>`)
  win.document.close()
}

export function tableHtml(headers: string[], rows: Array<Array<string | number>>) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}
