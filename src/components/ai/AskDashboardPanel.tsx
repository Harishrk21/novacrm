import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileSpreadsheet, Loader2, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api, ApiClientError, type ReportColumn } from '@/lib/api'
import { downloadCsv, downloadXlsx } from '@/lib/reportExport'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

/**
 * Ask HMS — type any question about the business. Data questions ("salespeople with more than 2
 * sales this month") come back as a computed table you can download; anything the reports can't
 * answer falls back to the general dashboard summary.
 */
const SUGGESTIONS = [
  'Salespeople with more than 2 sales this month',
  'Top salesperson this month by amount',
  'Engineers ranked by jobs completed this month',
  'Customers who owe money, biggest first',
  'Machines due for stamping in the next 30 days',
  'Products out of stock',
  'What needs my attention today?',
]

type TableAnswer = Awaited<ReturnType<typeof api.aiDataQuery>>
type TextAnswer = { answer: string; bullets: string[]; links: Array<{ label: string; to: string }>; caution?: string }

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
function cell(v: unknown, type?: ReportColumn['type']) {
  if (v == null || v === '') return '—'
  if (type === 'money') return `₹${inr.format(Number(v) || 0)}`
  if (type === 'number') return inr.format(Number(v) || 0)
  if (type === 'date') {
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return String(v)
}

export function AskDashboardPanel({ range: _range }: { range?: string }) {
  const addToast = useUIStore((s) => s.addToast)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [table, setTable] = useState<TableAnswer | null>(null)
  const [text, setText] = useState<TextAnswer | null>(null)
  const [asked, setAsked] = useState('')

  async function ask(q?: string) {
    const text0 = (q ?? question).trim()
    if (text0.length < 3) {
      addToast({ type: 'error', message: 'Type a question first' })
      return
    }
    setQuestion(text0)
    setBusy(true)
    setTable(null)
    setText(null)
    setAsked(text0)
    try {
      const data = await api.aiDataQuery(text0)
      if (data.kind === 'table') {
        setTable(data)
      } else {
        // Not a report question — general summary from live KPIs instead
        const general = await api.aiDashboardAsk({ question: text0, range: 'month', mode: 'ask' })
        setText(general)
      }
    } catch (e) {
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not answer right now' })
    } finally {
      setBusy(false)
    }
  }

  function download(kind: 'xlsx' | 'csv') {
    if (!table?.columns || !table.rows) return
    const rows = table.rows.map((r) =>
      Object.fromEntries(table.columns!.map((c) => [c.label, r[c.key] ?? ''])),
    )
    const base = `HMS-${(table.title || 'answer').replace(/[^\w]+/g, '-').slice(0, 40)}`
    if (kind === 'csv') downloadCsv(`${base}.csv`, rows)
    else downloadXlsx(`${base}.xlsx`, [{ name: (table.title || 'Answer').slice(0, 31), rows }])
  }

  const reportLink =
    table?.report
      ? `/reports?report=${encodeURIComponent(table.report.key)}${
          table.report.from && table.report.to
            ? `&from=${String(table.report.from).slice(0, 10)}&to=${String(table.report.to).slice(0, 10)}`
            : ''
        }`
      : null

  return (
    <section className="overflow-hidden rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="border-b border-border px-4 py-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-primary">
          <Sparkles size={16} className="text-accent-blue" /> Ask HMS
        </div>
        <p className="mt-0.5 text-xs text-text-secondary">
          Ask anything about sales, service, stock, customers or money — you get the answer and a table you can
          download. Figures are calculated from your records, not guessed.
        </p>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void ask()
              }
            }}
            placeholder="e.g. Top performer who completed more than 2 leads this month"
            className="min-w-0 flex-1 rounded-[8px] border border-border bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            disabled={busy}
          />
          <Button onClick={() => void ask()} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {busy ? 'Working…' : 'Ask'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => void ask(s)}
              className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:border-accent-blue/50 hover:text-text-primary disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {table ? (
          <div className="rounded-[10px] border border-border">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{table.answer}</p>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  “{asked}” · from {table.report?.title}
                  {table.report?.from ? ` · ${cell(table.report.from, 'date')} – ${cell(table.report.to, 'date')}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="outline" disabled={!table.rows?.length} onClick={() => download('xlsx')}>
                  <FileSpreadsheet size={13} /> Excel
                </Button>
                <Button size="sm" variant="outline" disabled={!table.rows?.length} onClick={() => download('csv')}>
                  <Download size={13} /> CSV
                </Button>
                {reportLink ? (
                  <Link to={reportLink}>
                    <Button size="sm" variant="ghost">Open report →</Button>
                  </Link>
                ) : null}
              </div>
            </div>
            {table.rows?.length ? (
              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="sticky top-0 bg-muted text-xs text-text-secondary">
                    <tr>
                      {table.columns!.map((c) => (
                        <th
                          key={c.key}
                          className={cn(
                            'whitespace-nowrap px-3 py-2 font-semibold',
                            c.type === 'money' || c.type === 'number' ? 'text-right' : 'text-left',
                          )}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 200).map((r, i) => (
                      <tr key={i} className="border-t border-border/70">
                        {table.columns!.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              'px-3 py-1.5',
                              c.type === 'money' || c.type === 'number'
                                ? 'whitespace-nowrap text-right tabular-nums'
                                : 'max-w-[240px] truncate',
                            )}
                          >
                            {cell(r[c.key], c.type)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-3 py-4 text-sm text-text-secondary">Nothing matched for this period.</p>
            )}
          </div>
        ) : null}

        {text ? (
          <div className="rounded-[10px] border border-border p-3">
            <p className="whitespace-pre-wrap text-sm text-text-primary">{text.answer}</p>
            {text.bullets?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                {text.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {text.links?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {text.links.map((l) => (
                  <Link
                    key={l.to + l.label}
                    to={l.to}
                    className="rounded-[6px] border border-border px-2.5 py-1 text-xs font-medium text-accent-blue hover:bg-muted"
                  >
                    {l.label} →
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
