import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ClipboardCheck, ScanLine, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, type MachineCountCheck, type SpareCountRow, type StockCountLog } from '@/lib/api'
import { can } from '@/lib/permissions'
import { cn, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

const REASONS = ['Damaged', 'Missing / lost', 'Issued without entry', 'Received without entry', 'Wrong entry earlier', 'Other']
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const errText = (e: unknown) => (e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Something went wrong')

type Tab = 'spares' | 'machines'

/**
 * Month-end stock count: staff count the godown, NovaCRM shows the difference.
 * Spares — enter the counted quantity; differences are booked with a reason so closing = counted.
 * Machines — scan / type the HMS IDs found; see what is missing or not expected.
 */
export function StockCountPage() {
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = can(role, 'inventory:write')
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<Tab>('spares')
  const [date, setDate] = useState(today())
  const [history, setHistory] = useState<StockCountLog[]>([])

  const loadHistory = () =>
    void api
      .stockCountHistory()
      .then(setHistory)
      .catch(() => undefined)
  useEffect(loadHistory, [])

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Stock count"
        breadcrumbs={[{ label: 'Stock', to: '/erp/stock' }, { label: 'Stock count' }]}
        actions={
          <Link to="/erp/stock">
            <Button variant="outline">
              <ArrowLeft size={14} /> Back to stock
            </Button>
          </Link>
        }
      />
      <p className="-mt-3 mb-4 max-w-3xl text-sm text-text-secondary">
        Count the godown at month end and enter what you find. NovaCRM compares it with what it expects; differences are
        recorded with a reason, so the month's closing stock matches the count and becomes next month's opening.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1.5" role="tablist" aria-label="What to count">
          {(
            [
              ['spares', 'Spares', Wrench],
              ['machines', 'Machines', ScanLine],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                tab === id ? 'bg-accent-blue text-white' : 'bg-muted/60 text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <div className="w-[170px]">
          <Input label="Count date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
        </div>
      </div>

      {tab === 'spares' ? (
        <SpareCount date={date} canWrite={canWrite} onSaved={loadHistory} toast={addToast} />
      ) : (
        <MachineCount date={date} canWrite={canWrite} onSaved={loadHistory} toast={addToast} />
      )}

      {history.length ? (
        <Card className="mt-4 p-4">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Past counts</h2>
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.countId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Badge color={h.kind === 'SPARES' ? 'purple' : 'blue'}>{h.kind === 'SPARES' ? 'Spares' : 'Machines'}</Badge>
                <span className="font-medium text-text-primary">{formatDate(h.date)}</span>
                <span className="text-text-secondary">
                  {h.kind === 'SPARES'
                    ? `${h.counted} counted · ${h.matched} matched · ${h.differences?.length ?? 0} with a difference`
                    : `${h.found} of ${h.expected} found · ${h.missing?.length ?? 0} not found · ${h.notExpected?.length ?? 0} not expected`}
                </span>
                <span className="ml-auto text-xs text-text-secondary">{h.by}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

/* ───────────── spares ───────────── */

function SpareCount({
  date,
  canWrite,
  onSaved,
  toast,
}: {
  date: string
  canWrite: boolean
  onSaved: () => void
  toast: ReturnType<typeof useUIStore.getState>['addToast']
}) {
  const [rows, setRows] = useState<SpareCountRow[] | null>(null)
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows(null)
    void api
      .stockCountSpares(date)
      .then((r) => setRows(r.rows))
      .catch((e) => toast({ type: 'error', message: errText(e) }))
  }, [date, toast])

  const entered = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => counted[r.id] !== undefined && counted[r.id] !== '')
        .map((r) => ({ r, n: Number(counted[r.id]), diff: Number(counted[r.id]) - r.system })),
    [rows, counted],
  )
  const diffs = entered.filter((x) => x.diff !== 0)
  const shown = (rows ?? []).filter((r) => {
    if (q && !`${r.spareId} ${r.name} ${r.group}`.toLowerCase().includes(q.toLowerCase())) return false
    if (onlyDiff) {
      const v = counted[r.id]
      return v !== undefined && v !== '' && Number(v) !== r.system
    }
    return true
  })

  async function save() {
    setSaving(true)
    try {
      const res = await api.saveStockCountSpares({
        date,
        items: entered.map(({ r, n }) => ({ sparePartId: r.id, counted: n, reason: reason[r.id] || null })),
      })
      toast({
        type: 'success',
        message: res.differences.length
          ? `Count saved — ${res.differences.length} spare${res.differences.length === 1 ? '' : 's'} corrected, ${res.matched} matched`
          : `Count saved — all ${res.matched} matched`,
      })
      setCounted({})
      setReason({})
      setConfirm(false)
      setRows((await api.stockCountSpares(date)).rows)
      onSaved()
    } catch (e) {
      toast({ type: 'error', message: errText(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search Spare ID or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only differences
        </label>
        <span className="ml-auto text-xs text-text-secondary">
          {entered.length} counted · <b className={diffs.length ? 'text-amber-600' : ''}>{diffs.length} different</b>
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        “In NovaCRM” = stock at the end of {formatDate(date)}. Type the number you counted; leave blank what you did not
        count.
      </p>
      <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 z-[1] bg-muted text-left text-[11px] uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-3 py-2">Spare ID</th>
              <th className="px-3 py-2">Spare</th>
              <th className="px-3 py-2 text-right">In NovaCRM</th>
              <th className="px-3 py-2 text-right">Counted</th>
              <th className="px-3 py-2 text-right">Difference</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-secondary">
                  Loading…
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const v = counted[r.id]
                const has = v !== undefined && v !== ''
                const diff = has ? Number(v) - r.system : 0
                return (
                  <tr key={r.id} className="border-t border-border/70">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs font-semibold">{r.spareId || '—'}</td>
                    <td className="px-3 py-1.5">
                      <div className="text-text-primary">{r.name}</div>
                      <div className="text-[11px] text-text-secondary">{r.group || (r.family === 'BILLING' ? 'Billing' : 'Weighing')}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.system}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        inputMode="numeric"
                        aria-label={`Counted ${r.name}`}
                        className="h-8 w-20 rounded-md border border-border bg-card px-2 text-right tabular-nums"
                        value={v ?? ''}
                        disabled={!canWrite}
                        onChange={(e) => setCounted((c) => ({ ...c, [r.id]: e.target.value.replace(/[^\d.]/g, '').slice(0, 7) }))}
                      />
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 text-right font-semibold tabular-nums',
                        !has ? 'text-text-secondary' : diff === 0 ? 'text-emerald-600' : diff > 0 ? 'text-sky-600' : 'text-rose-600',
                      )}
                    >
                      {!has ? '' : diff === 0 ? 'OK' : diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`}
                    </td>
                    <td className="px-3 py-1.5">
                      {has && diff !== 0 ? (
                        <select
                          aria-label={`Reason for ${r.name}`}
                          className="h-8 rounded-md border border-border bg-card px-2 text-xs"
                          value={reason[r.id] ?? ''}
                          onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.target.value }))}
                        >
                          <option value="">Reason…</option>
                          {REASONS.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <Button onClick={() => setConfirm(true)} disabled={!entered.length || saving}>
            <ClipboardCheck size={15} /> Save count ({entered.length})
          </Button>
          {diffs.some(({ r }) => !reason[r.id]) ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">Pick a reason for each difference (optional but helps later).</span>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Save this stock count?"
        subtitle={`${formatDate(date)} · ${entered.length} spares counted`}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Check again
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save count'}
            </Button>
          </>
        }
      >
        {diffs.length ? (
          <div className="space-y-2 text-sm">
            <p className="text-text-secondary">These will be corrected so the stock matches your count:</p>
            <ul className="max-h-64 space-y-1 overflow-auto">
              {diffs.map(({ r, n, diff }) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span>
                    <span className="font-mono text-xs">{r.spareId}</span> {r.name}
                  </span>
                  <span className="tabular-nums">
                    {r.system} → <b>{n}</b>{' '}
                    <span className={diff > 0 ? 'text-sky-600' : 'text-rose-600'}>({diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 size={16} /> Everything you counted matches NovaCRM.
          </p>
        )}
      </Modal>
    </Card>
  )
}

/* ───────────── machines ───────────── */

function MachineCount({
  date,
  canWrite,
  onSaved,
  toast,
}: {
  date: string
  canWrite: boolean
  onSaved: () => void
  toast: ReturnType<typeof useUIStore.getState>['addToast']
}) {
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [scan, setScan] = useState('')
  const [paste, setPaste] = useState('')
  const [check, setCheck] = useState<MachineCountCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api
      .inventoryWorkspace()
      .then((w) => setWarehouses((w.warehouses ?? []).map((x) => ({ id: String(x.id), name: String(x.name) }))))
      .catch(() => undefined)
  }, [])

  const add = (list: string[]) => {
    const clean = list.map((s) => s.toUpperCase().replace(/\s+/g, '')).filter(Boolean)
    setIds((prev) => [...new Set([...prev, ...clean])])
    setCheck(null)
  }

  async function runCheck() {
    setBusy(true)
    try {
      setCheck(await api.stockCountMachinesCheck({ warehouseId: warehouseId || null, ids }))
    } catch (e) {
      toast({ type: 'error', message: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    setBusy(true)
    try {
      const r = await api.saveStockCountMachines({ date, warehouseId: warehouseId || null, ids })
      toast({ type: 'success', message: `Count saved — ${r.found} of ${r.expected} found, ${r.missing.length} not found` })
      setIds([])
      setCheck(null)
      onSaved()
    } catch (e) {
      toast({ type: 'error', message: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Select
          label="Godown"
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value)
            setCheck(null)
          }}
          options={[{ value: '', label: 'All godowns' }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
        />
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="scan-hms">
            Scan or type an HMS ID (or serial no.) and press Enter
          </label>
          <input
            id="scan-hms"
            ref={scanRef}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 font-mono text-sm"
            placeholder="26K0001"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (scan.trim()) add([scan])
                setScan('')
              }
            }}
          />
        </div>
      </div>
      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-text-secondary">Paste many at once (from Excel — one per line)</summary>
        <textarea
          className="mt-2 h-28 w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'26K0001\n26K0002\n…'}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            add(paste.split(/[\s,;]+/))
            setPaste('')
          }}
          disabled={!paste.trim()}
        >
          Add to count
        </Button>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-secondary">{ids.length} machines entered</span>
        {ids.slice(-12).map((x) => (
          <span key={x} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs">
            {x}
          </span>
        ))}
        {ids.length > 12 ? <span className="text-xs text-text-secondary">…</span> : null}
        {ids.length ? (
          <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => (setIds([]), setCheck(null))}>
            Clear
          </button>
        ) : null}
        <Button className="ml-auto" onClick={() => void runCheck()} disabled={busy}>
          {busy && !check ? 'Checking…' : 'Compare with NovaCRM'}
        </Button>
      </div>

      {check ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Found', `${check.found.length} / ${check.expected}`, 'text-emerald-600'],
              ['Not found', String(check.missing.length), check.missing.length ? 'text-rose-600' : 'text-text-secondary'],
              ['Not expected', String(check.notExpected.length), check.notExpected.length ? 'text-amber-600' : 'text-text-secondary'],
            ].map(([l, v, c]) => (
              <div key={l} className="rounded-lg border border-border p-3">
                <div className={cn('text-2xl font-semibold tabular-nums', c)}>{v}</div>
                <div className="text-xs text-text-secondary">{l}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Product ID</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">In NovaCRM</th>
                  <th className="px-3 py-2 text-right">Found</th>
                </tr>
              </thead>
              <tbody>
                {check.products.map((p) => (
                  <tr key={p.productId + p.product} className="border-t border-border/70">
                    <td className="px-3 py-1.5 font-mono text-xs">{p.productId}</td>
                    <td className="px-3 py-1.5">{p.product}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.expected}</td>
                    <td className={cn('px-3 py-1.5 text-right font-semibold tabular-nums', p.found === p.expected ? 'text-emerald-600' : 'text-rose-600')}>
                      {p.found}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {check.missing.length ? (
            <details open className="rounded-lg border border-rose-300/60 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-rose-700">Not found ({check.missing.length}) — in stock in NovaCRM, not seen</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {check.missing.map((m) => (
                  <li key={m.unitId} className="text-xs">
                    <span className="font-mono">{m.hmsId ?? m.serialNo}</span> · {m.productId} {m.product}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {check.notExpected.length ? (
            <details open className="rounded-lg border border-amber-300/60 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-amber-700">Not expected ({check.notExpected.length}) — seen, but NovaCRM says otherwise</summary>
              <ul className="mt-2 space-y-1">
                {check.notExpected.map((m) => (
                  <li key={m.written} className="text-xs">
                    <span className="font-mono">{m.written}</span> — {m.status}
                    {m.product ? ` · ${m.product}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <Button onClick={() => void save()} disabled={busy}>
                <ClipboardCheck size={15} /> Save count result
              </Button>
              <span className="text-xs text-text-secondary">
                Each machine is marked with this count’s date and result. Not-found machines stay in stock until you sort
                them out (sold without entry, on demo, moved…).
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
