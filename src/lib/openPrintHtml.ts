/**
 * Open printable HTML reliably across browsers.
 * Prefer blob URL (no noopener / about:blank write race). Fall back to .html download.
 */

export function downloadHtmlFile(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @returns `'opened'` | `'downloaded'` | `false`
 */
export function openPrintHtml(
  html: string,
  opts?: { filename?: string; revokeMs?: number },
): 'opened' | 'downloaded' | false {
  const filename = opts?.filename ?? 'document.html'
  const revokeMs = opts?.revokeMs ?? 60_000
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    // Do NOT pass noopener — some browsers then return null / blank tab for blob URLs too.
    const win = window.open(url, '_blank')
    if (win) {
      window.setTimeout(() => URL.revokeObjectURL(url), revokeMs)
      return 'opened'
    }
    URL.revokeObjectURL(url)
    downloadHtmlFile(filename, html)
    return 'downloaded'
  } catch {
    try {
      downloadHtmlFile(filename, html)
      return 'downloaded'
    } catch {
      return false
    }
  }
}

/** Convenience: true if opened or downloaded (caller can toast on download). */
export function openOrDownloadPrintHtml(
  html: string,
  opts?: { filename?: string },
): { ok: boolean; downloaded: boolean } {
  const result = openPrintHtml(html, opts)
  if (result === false) return { ok: false, downloaded: false }
  return { ok: true, downloaded: result === 'downloaded' }
}
