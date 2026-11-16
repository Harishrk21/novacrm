import { useEffect, useMemo, useRef, useState } from 'react'
import { AskDashboardPanel } from '@/components/ai/AskDashboardPanel'
import { useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Package,
  Printer,
  Receipt,
  RefreshCw,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { TableSkeleton } from '@/components/ui/Skeleton'
import {
  ApiClientError,
  api,
  type ReportCatalogItem,
  type ReportColumn,
  type ReportResult,
} from '@/lib/api'
import {
  LETTERHEAD_CSS,
  escapeHtml,
  letterFooterHtml,
  letterheadHtml,
  primePrintCompany,
  printCompany,
} from '@/lib/printLetterhead'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

/* ─── Date presets (India: financial year Apr–Mar) ─── */

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

type PresetId = 'this-month' | 'last-month' | 'this-quarter' | 'this-fy' | 'last-fy' | 'next-30' | 'custom'

function presetRange(id: PresetId): { from: string; to: string } | null {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const fyStart = m >= 3 ? y : y - 1
  switch (id) {
    case 'this-month':
      return { from: ymd(new Date(y, m, 1)), to: ymd(now) }
    case 'last-month':
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
    case 'this-quarter': {
      // Indian FY quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar
      const qStart = Math.floor(((m + 9) % 12) / 3) * 3 // months since April
      const start = new Date(fyStart, 3 + qStart, 1)
      return { from: ymd(start), to: ymd(now) }
    }
    case 'this-fy':
      return { from: ymd(new Date(fyStart, 3, 1)), to: ymd(now) }
    case 'last-fy':
      return { from: ymd(new Date(fyStart - 1, 3, 1)), to: ymd(new Date(fyStart, 2, 31)) }
    case 'next-30': {
      const end = new Date(now)
      end.setDate(end.getDate() + 30)
      return { from: ymd(now), to: ymd(end) }
    }
    default:
      return null
  }
}

const PRESETS: Array<{ value: PresetId; label: string }> = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'this-fy', label: 'This financial year' },
  { value: 'last-fy', label: 'Last financial year' },
  { value: 'next-30', label: 'Next 30 days' },
  { value: 'custom', label: 'Custom dates' },
]

const GROUP_ICON: Record<string, typeof Wrench> = {
  Service: Wrench,
  Sales: TrendingUp,
  Billing: Receipt,
  Stock: Package,
  Customers: Users,
  History: History,
}

/* ─── Formatting ─── */

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-IN')

function fmtCell(v: unknown, type: ReportColumn['type']): string {
  if (v == null || v === '') return type === 'money' || type === 'number' ? '0' : ''
  if (type === 'money') return `₹${inr.format(Number(v) || 0)}`
  if (type === 'number') return int.format(Number(v) || 0)
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
    if (!m) return String(v)
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }
  return String(v)
}
const isNum = (c: ReportColumn) => c.type === 'money' || c.type === 'number'

function periodLabel(r: ReportResult, from: string, to: string) {
  if (!r.dateFilter) return `As on ${fmtCell(ymd(new Date()), 'date')}`
  return `${fmtCell(from, 'date')} – ${fmtCell(to, 'date')}`
}

function fileBase(r: ReportResult, from: string, to: string) {
  const period = r.dateFilter ? `${from}_to_${to}` : `as-on-${ymd(new Date())}`
  return `HMS-${r.key}-${period}`
}

/* ─── Exports ─── */

function exportExcel(r: ReportResult, from: string, to: string, companyName: string) {
  const header = r.columns.map((c) => c.label)
  const body = r.rows.map((row) =>
    r.columns.map((c) => {
      const v = row[c.key]
      if (isNum(c)) return Number(v ?? 0) || 0
      if (c.type === 'date') return v ? fmtCell(v, 'date') : ''
      return v ?? ''
    }),
  )
  const totalsRow = r.totals
    ? r.columns.map((c, i) => (i === 0 ? 'Total' : r.totals && c.key in r.totals ? r.totals[c.key] : ''))
    : null
  const aoa: unknown[][] = [
    [companyName],
    [r.title],
    [periodLabel(r, from, to)],
    [],
    header,
    ...body,
    ...(totalsRow ? [totalsRow] : []),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Money columns as ₹ numbers so Excel can sum them
  const firstData = 5
  r.columns.forEach((c, ci) => {
    if (!isNum(c)) return
    for (let ri = firstData; ri < aoa.length; ri++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci })
      const cell = ws[ref]
      if (cell && typeof cell.v === 'number') cell.z = c.type === 'money' ? '#,##0.00' : '#,##0'
    }
  })
  ws['!cols'] = r.columns.map((c) => ({
    wch: Math.min(
      40,
      Math.max(c.label.length, ...r.rows.slice(0, 200).map((row) => fmtCell(row[c.key], c.type).length)) + 2,
    ),
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, r.title.slice(0, 31))
  XLSX.writeFile(wb, `${fileBase(r, from, to)}.xlsx`)
}

function exportCsv(r: ReportResult, from: string, to: string) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const lines = [
    r.columns.map((c) => esc(c.label)).join(','),
    ...r.rows.map((row) => r.columns.map((c) => esc(isNum(c) ? Number(row[c.key] ?? 0) : row[c.key])).join(',')),
  ]
  if (r.totals) {
    lines.push(r.columns.map((c, i) => (i === 0 ? 'Total' : r.totals && c.key in r.totals ? r.totals[c.key] : '')).join(','))
  }
  // BOM so Excel opens ₹ / Tamil names correctly
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileBase(r, from, to)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function reportPrintHtml(r: ReportResult, from: string, to: string) {
  const company = printCompany()
  const wide = r.columns.length > 7
  const head = r.columns
    .map((c) => `<th class="${isNum(c) ? 'num' : ''}">${escapeHtml(c.label)}</th>`)
    .join('')
  const body = r.rows
    .map(
      (row, i) =>
        `<tr><td class="sn">${i + 1}</td>${r.columns
          .map((c) => `<td class="${isNum(c) ? 'num' : ''}">${escapeHtml(fmtCell(row[c.key], c.type))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  const totals = r.totals
    ? `<tr class="tot"><td></td>${r.columns
        .map((c, i) =>
          i === 0
            ? '<td>Total</td>'
            : `<td class="${isNum(c) ? 'num' : ''}">${
                r.totals && c.key in r.totals ? escapeHtml(fmtCell(r.totals[c.key], c.type)) : ''
              }</td>`,
        )
        .join('')}</tr>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>${escapeHtml(fileBase(r, from, to))}</title>
<style>
${LETTERHEAD_CSS}
@page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm; }
body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;margin:0;padding:16px}
.toolbar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px}
.toolbar button{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
.toolbar button.primary{background:#0f172a;color:#fff;border-color:#0f172a}
table.rep{width:100%;border-collapse:collapse;font-size:${wide ? '10px' : '11px'};margin-top:10px}
table.rep th{background:#f1f5f9;text-align:left;font-weight:600;border-bottom:1.5px solid #334155;padding:5px 6px}
table.rep td{border-bottom:1px solid #e2e8f0;padding:4px 6px;vertical-align:top}
table.rep .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
table.rep .sn{color:#64748b;width:22px}
table.rep tr.tot td{font-weight:700;border-top:1.5px solid #334155;border-bottom:none;background:#f8fafc}
table.rep thead{display:table-header-group}
table.rep tr{page-break-inside:avoid}
.empty{padding:28px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:8px;margin-top:12px}
@media print{.toolbar{display:none}body{padding:0}}
</style></head><body>
<div class="toolbar"><button onclick="window.close()">Close</button><button class="primary" onclick="window.print()">Print / Save as PDF</button></div>
${letterheadHtml({
  company,
  title: r.title,
  subtitle: periodLabel(r, from, to),
  number: `RPT-${ymd(new Date()).replaceAll('-', '')}-${pad(new Date().getHours())}${pad(new Date().getMinutes())}`,
  meta: [
    ['Printed', fmtCell(ymd(new Date()), 'date')],
    ['Rows', String(r.rows.length)],
  ],
})}
${
  r.rows.length
    ? `<table class="rep"><thead><tr><th class="sn">#</th>${head}</tr></thead><tbody>${body}${totals}</tbody></table>`
    : '<div class="empty">No records for this period.</div>'
}
${letterFooterHtml(company, r.subtitle)}
</body></html>`
}

/* ─── Page ─── */

const PREVIEW_ROWS = 500

export function ReportsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [params, setParams] = useSearchParams()
  const [catalog, setCatalog] = useState<ReportCatalogItem[] | null>(null)
  const [selected, setSelected] = useState<string>(params.get('report') ?? '')
  const [preset, setPreset] = useState<PresetId>('this-month')
  const [from, setFrom] = useState(() => presetRange('this-month')!.from)
  const [to, setTo] = useState(() => presetRange('this-month')!.to)
  const [personId, setPersonId] = useState('')
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Links like /reports?report=sales&from=2026-11-01&to=2026-11-30 (Ask HMS "Open report →", Setup)
  // must switch the report even when this page is already open.
  const urlReport = params.get('report')
  const urlFrom = params.get('from')
  const urlTo = params.get('to')
  /** Period carried by the link — applied once when that report opens, then dropped from the URL. */
  const linkRange = useRef<{ from: string; to: string } | null>(null)
  /** Report whose default filters were last applied — filters reset only when the report really changes. */
  const appliedKey = useRef('')
  useEffect(() => {
    if (urlReport) setSelected(urlReport)
    if (urlFrom && urlTo && /^\d{4}-\d{2}-\d{2}$/.test(urlFrom) && /^\d{4}-\d{2}-\d{2}$/.test(urlTo)) {
      // Same report already open → no report change will consume the period; apply it here only
      linkRange.current = urlReport && urlReport === appliedKey.current ? null : { from: urlFrom, to: urlTo }
      setPreset('custom')
      setFrom(urlFrom)
      setTo(urlTo)
    }
  }, [urlReport, urlFrom, urlTo])

  useEffect(() => {
    void primePrintCompany()
    api
      .reportCatalog()
      .then((list) => {
        setCatalog(list)
        setSelected((cur) => (cur && list.some((r) => r.key === cur) ? cur : list[0]?.key ?? ''))
      })
      .catch((e) => {
        setCatalog([])
        addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not load reports' })
      })
  }, [addToast])

  const def = useMemo(() => catalog?.find((r) => r.key === selected) ?? null, [catalog, selected])
  const groups = useMemo(() => {
    const m = new Map<string, ReportCatalogItem[]>()
    for (const r of catalog ?? []) m.set(r.group, [...(m.get(r.group) ?? []), r])
    return [...m.entries()]
  }, [catalog])

  // New report ⇒ clear filters that belonged to the previous one; "machines due" defaults to next 30 days
  useEffect(() => {
    if (!def) return
    const link = linkRange.current
    linkRange.current = null
    if (def.key === appliedKey.current) return
    appliedKey.current = def.key
    setPersonId('')
    setStatus('')
    if (link) {
      // Opened from a link that carries its own period (Ask HMS) — keep it
      setPreset('custom')
      setFrom(link.from)
      setTo(link.to)
    } else {
      const next: PresetId = def.key === 'machines-due' ? 'next-30' : 'this-month'
      setPreset(next)
      const r = presetRange(next)!
      setFrom(r.from)
      setTo(r.to)
    }
    setParams((p) => {
      const n = new URLSearchParams(p)
      n.set('report', def.key)
      n.delete('range')
      n.delete('from')
      n.delete('to')
      return n
    }, { replace: true })
  }, [def, setParams])

  useEffect(() => {
    if (!def) return
    let cancelled = false
    setLoading(true)
    api
      .reportRun(def.key, {
        ...(def.dateFilter ? { from, to } : {}),
        ...(personId ? { personId } : {}),
        ...(status ? { status } : {}),
      })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch((e) => {
        if (cancelled) return
        setResult(null)
        addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not run report' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [def, from, to, personId, status, reloadKey, addToast])

  function choosePreset(id: PresetId) {
    setPreset(id)
    const r = presetRange(id)
    if (r) {
      setFrom(r.from)
      setTo(r.to)
    }
  }

  function printPdf() {
    if (!result) return
    const w = window.open('', '_blank')
    if (!w) {
      addToast({ type: 'error', message: 'Allow pop-ups for this site to print the report' })
      return
    }
    w.document.open()
    w.document.write(reportPrintHtml(result, from, to))
    w.document.close()
  }

  const ready = !!result && !loading && result.key === def?.key
  const shown = result?.rows.slice(0, PREVIEW_ROWS) ?? []

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Reports" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Reports' }]} />

      {/* Ask any question — answered as a downloadable table from the same reports */}
      <AskDashboardPanel />

      {catalog === null ? (
        <TableSkeleton rows={6} />
      ) : catalog.length === 0 ? (
        <Card className="py-14 text-center text-sm text-text-secondary">No reports are available for your role.</Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Catalogue — a dropdown on phones, a grouped list on wider screens */}
          <div className="lg:hidden">
            <Select
              label="Report"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              options={catalog.map((r) => ({ value: r.key, label: `${r.group} · ${r.title}` }))}
            />
          </div>
          <nav className="hidden space-y-4 lg:block" aria-label="Reports">
            {groups.map(([group, items]) => {
              const Icon = GROUP_ICON[group] ?? ClipboardList
              return (
                <div key={group}>
                  <div className="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-semibold text-text-secondary">
                    <Icon size={13} /> {group}
                  </div>
                  <ul className="space-y-0.5">
                    {items.map((r) => (
                      <li key={r.key}>
                        <button
                          type="button"
                          onClick={() => setSelected(r.key)}
                          className={cn(
                            'w-full rounded-[8px] px-2.5 py-2 text-left text-sm transition',
                            r.key === selected
                              ? 'bg-accent-blue/10 font-semibold text-accent-blue'
                              : 'text-text-primary hover:bg-muted',
                          )}
                        >
                          {r.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </nav>

          {def ? (
            <div className="min-w-0 space-y-4">
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-text-primary">{def.title}</h2>
                    <p className="mt-0.5 max-w-2xl text-sm text-text-secondary">{def.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!ready} onClick={() => result && exportExcel(result, from, to, printCompany().name)}>
                      <FileSpreadsheet size={14} /> Excel
                    </Button>
                    <Button size="sm" variant="outline" disabled={!ready} onClick={() => result && exportCsv(result, from, to)}>
                      <Download size={14} /> CSV
                    </Button>
                    <Button size="sm" variant="outline" disabled={!ready} onClick={printPdf}>
                      <Printer size={14} /> PDF
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  {def.dateFilter ? (
                    <>
                      <Select
                        label="Period"
                        className="w-48"
                        value={preset}
                        onChange={(e) => choosePreset(e.target.value as PresetId)}
                        options={PRESETS}
                      />
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-text-secondary">From</span>
                        <input
                          type="date"
                          value={from}
                          max={to}
                          onChange={(e) => {
                            setPreset('custom')
                            setFrom(e.target.value)
                          }}
                          className="h-9 rounded-[8px] border border-border bg-card px-2 text-sm text-text-primary"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-medium text-text-secondary">To</span>
                        <input
                          type="date"
                          value={to}
                          min={from}
                          onChange={(e) => {
                            setPreset('custom')
                            setTo(e.target.value)
                          }}
                          className="h-9 rounded-[8px] border border-border bg-card px-2 text-sm text-text-primary"
                        />
                      </label>
                    </>
                  ) : (
                    <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-text-secondary">
                      Live list — as on today
                    </span>
                  )}
                  {def.people.length ? (
                    <Select
                      label={def.key === 'history' ? 'Done by' : def.key.includes('enquir') || def.key === 'sales' ? 'Salesperson' : 'Engineer'}
                      className="w-48"
                      value={personId}
                      onChange={(e) => setPersonId(e.target.value)}
                      options={[{ value: '', label: 'Everyone' }, ...def.people.map((p) => ({ value: p.id, label: p.name }))]}
                    />
                  ) : null}
                  {def.statuses.length ? (
                    <Select
                      label={def.key === 'history' ? 'Area' : 'Status'}
                      className="w-44"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      options={[{ value: '', label: 'All' }, ...def.statuses]}
                    />
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
                    <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
                  </Button>
                </div>
              </Card>

              {/* Totals */}
              {ready && result ? (
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-[8px] border border-border bg-card px-3 py-2 text-sm">
                    <span className="text-text-secondary">Rows </span>
                    <b className="tabular-nums">{int.format(result.rows.length)}</b>
                  </span>
                  {result.columns
                    .filter((c) => result.totals && c.key in result.totals)
                    .map((c) => (
                      <span key={c.key} className="rounded-[8px] border border-border bg-card px-3 py-2 text-sm">
                        <span className="text-text-secondary">{c.label} </span>
                        <b className="tabular-nums">{fmtCell(result.totals![c.key], c.type)}</b>
                      </span>
                    ))}
                </div>
              ) : null}

              <Card padding={false} className="overflow-hidden">
                {!ready ? (
                  <div className="p-4">
                    <TableSkeleton rows={8} />
                  </div>
                ) : result!.rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-text-secondary">
                    <FileText size={22} />
                    No records for {def.dateFilter ? 'this period' : 'this report'}.
                  </div>
                ) : (
                  <div className="max-h-[65vh] overflow-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="sticky top-0 z-[1] bg-muted text-xs text-text-secondary">
                        <tr>
                          {result!.columns.map((c) => (
                            <th
                              key={c.key}
                              className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', isNum(c) ? 'text-right' : 'text-left')}
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((row, i) => (
                          <tr key={i} className="border-t border-border/70 hover:bg-surface">
                            {result!.columns.map((c) => (
                              <td
                                key={c.key}
                                className={cn(
                                  'px-3 py-2',
                                  isNum(c) ? 'whitespace-nowrap text-right tabular-nums' : 'max-w-[260px] truncate',
                                )}
                                title={isNum(c) ? undefined : String(row[c.key] ?? '')}
                              >
                                {fmtCell(row[c.key], c.type)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {result!.totals ? (
                        <tfoot className="sticky bottom-0 bg-muted font-semibold">
                          <tr className="border-t-2 border-border">
                            {result!.columns.map((c, i) => (
                              <td key={c.key} className={cn('px-3 py-2.5', isNum(c) ? 'text-right tabular-nums' : '')}>
                                {i === 0 ? 'Total' : c.key in result!.totals! ? fmtCell(result!.totals![c.key], c.type) : ''}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      ) : null}
                    </table>
                    {result!.rows.length > PREVIEW_ROWS ? (
                      <p className="border-t border-border px-3 py-2 text-xs text-text-secondary">
                        Showing the first {PREVIEW_ROWS} of {int.format(result!.rows.length)} rows — downloads include all rows.
                      </p>
                    ) : null}
                  </div>
                )}
              </Card>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
