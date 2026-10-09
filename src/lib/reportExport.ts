import * as XLSX from 'xlsx'

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(v: unknown) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
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

/**
 * Open a print-ready HTML report. Returns false if writing failed.
 * Pass an existing `target` window opened in the same click gesture (avoids blank tabs after async fetch).
 */
export function printReportHtml(
  title: string,
  sections: Array<{ heading: string; html: string }>,
  target?: Window | null,
): boolean {
  const safeTitle = escapeHtml(title)
  const body = sections
    .map((s) => `<h2>${escapeHtml(s.heading)}</h2>${s.html}`)
    .join('')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#0f172a;margin:24px;line-height:1.45;background:#fff}
    h1{font-size:22px;margin:0 0 8px}
    h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}
    th{background:#f8fafc}
    .meta{color:#64748b;font-size:12px;margin-bottom:16px}
    .toolbar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;margin:-24px -24px 16px;padding:12px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
    .toolbar button{font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
    .toolbar button.primary{background:#0f172a;color:#fff;border-color:#0f172a}
    @media print{
      body{margin:12px}
      .toolbar{display:none !important}
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <strong style="flex:1">${safeTitle}</strong>
    <button type="button" class="primary" onclick="window.print()">Print / Save PDF</button>
  </div>
  <h1>${safeTitle}</h1>
  <div class="meta">Generated ${escapeHtml(new Date().toLocaleString('en-IN'))} · HMS Enterprises</div>
  ${body}
  <script>
    function triggerPrint(){ setTimeout(function(){ window.print(); }, 300); }
    if (document.readyState === 'complete') triggerPrint();
    else window.addEventListener('load', triggerPrint);
  </script>
</body>
</html>`

  try {
    if (target && !target.closed) {
      target.document.open()
      target.document.write(html)
      target.document.close()
      target.focus()
      return true
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (!win) {
      URL.revokeObjectURL(url)
      return false
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
    return true
  } catch {
    return false
  }
}

export function tableHtml(headers: string[], rows: Array<Array<string | number>>) {
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}
