import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api, ApiClientError, type ReportResult } from '@/lib/api'
import { downloadXlsx } from '@/lib/reportExport'
import { cn } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * Monthly opening / closing stock — what HMS staff keep in a register: for every machine model and
 * spare part, stock on the 1st, received, out (sold / demo / issued) and stock at month end.
 */
export function StockRegisterCard({ year, month }: { year: number; month: number }) {
  const [data, setData] = useState<ReportResult | null>(null)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<'all' | 'Machine' | 'Spare'>('all')
  const [moved, setMoved] = useState(false)
  const from = `${year}-${pad(month)}-01`
  const to = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    api
      .stockRegister(from, to)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiClientError ? e.message : 'Could not load the stock register'))
    return () => {
      alive = false
    }
  }, [from, to])

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (r) => (kind === 'all' || r.kind === kind) && (!moved || Number(r.received) || Number(r.out)),
      ),
    [data, kind, moved],
  )
  const tot = (k: string) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0)

  function excel() {
    downloadXlsx(`HMS-stock-register-${MONTHS[month - 1]}-${year}.xlsx`, [
      {
        name: `${MONTHS[month - 1].slice(0, 3)} ${year}`,
        rows: [
          ...rows.map((r) => ({
            Type: r.kind,
            Item: r.item,
            Category: r.group,
            [`Opening (1 ${MONTHS[month - 1].slice(0, 3)})`]: r.opening,
            Received: r.received,
            'Out (sold / issued)': r.out,
            [`Closing (${to.slice(8)} ${MONTHS[month - 1].slice(0, 3)})`]: r.closing,
          })),
          { Type: 'Total', Item: '', Category: '', [`Opening (1 ${MONTHS[month - 1].slice(0, 3)})`]: tot('opening'), Received: tot('received'), 'Out (sold / issued)': tot('out'), [`Closing (${to.slice(8)} ${MONTHS[month - 1].slice(0, 3)})`]: tot('closing') },
        ],
      },
    ])
  }

  return (
    <section className="rounded-xl border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Opening &amp; closing stock — {MONTHS[month - 1]} {year}
          </h3>
          <p className="text-xs text-text-secondary">
            Stock on 1 {MONTHS[month - 1].slice(0, 3)} + received − out (sold, demo, issued to engineers) = closing on {to.slice(8)}{' '}
            {MONTHS[month - 1].slice(0, 3)}. Last month's closing is this month's opening.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-text-primary"
          >
            <option value="all">Machines + spares</option>
            <option value="Machine">Machines only</option>
            <option value="Spare">Spares only</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input type="checkbox" checked={moved} onChange={(e) => setMoved(e.target.checked)} /> Only items that moved
          </label>
          <Button size="sm" variant="outline" disabled={!rows.length} onClick={excel}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>
      {error ? (
        <p className="px-4 py-4 text-sm text-rose-600">{error}</p>
      ) : !data ? (
        <p className="px-4 py-4 text-sm text-text-secondary">Loading…</p>
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-muted text-[11px] font-semibold text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Out</th>
                <th className="px-3 py-2 text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.kind}-${r.item}-${i}`} className="border-t border-border/70">
                  <td className="px-3 py-1.5">
                    <span className="text-text-primary">{r.item}</span>
                    <span className="ml-1.5 text-[10px] uppercase text-text-secondary">{r.kind === 'Spare' ? 'spare' : ''}</span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-text-secondary">{r.group}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.opening}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', Number(r.received) ? 'text-emerald-600' : 'text-text-secondary')}>
                    {Number(r.received) ? `+${r.received}` : '0'}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', Number(r.out) ? 'text-rose-600' : 'text-text-secondary')}>
                    {Number(r.out) ? `−${r.out}` : '0'}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right font-semibold tabular-nums', Number(r.closing) <= 0 ? 'text-rose-600' : 'text-text-primary')}>
                    {r.closing}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-muted text-sm font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>
                  Total ({rows.length} items)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{tot('opening')}</td>
                <td className="px-3 py-2 text-right tabular-nums">+{tot('received')}</td>
                <td className="px-3 py-2 text-right tabular-nums">−{tot('out')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tot('closing')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
