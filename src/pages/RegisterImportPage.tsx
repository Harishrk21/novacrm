import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Select } from '@/components/ui/Select'
import {
  api,
  ApiClientError,
  type RegisterBatch,
  type RegisterCommitResult,
  type RegisterPreview,
  type RegisterPreviewRow,
} from '@/lib/api'
import { productAttrs } from '@/lib/productCatalog'
import {
  planWorkbook,
  rowsOfSheet,
  SALES_ROLES,
  SERVICE_ROLES,
  type Kind,
  type Role,
  type SheetPlan,
} from '@/lib/registerDetect'
import { cn, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const PAGE = 50
// Whole file in one go — "same record" checks count across the whole file
const CHUNK = 4000
const colName = (i: number) => XLSX.utils.encode_col(i)

type Filter = 'all' | 'look' | 'new' | 'dup'

const CONF: Record<string, { label: string; color: 'green' | 'teal' | 'amber' | 'gray' }> = {
  exact: { label: 'Matched', color: 'green' },
  likely: { label: 'Likely', color: 'teal' },
  check: { label: 'Check', color: 'amber' },
  none: { label: 'As written', color: 'gray' },
}

function errText(e: unknown) {
  return e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Something went wrong'
}

/**
 * Bring HMS's own Excel registers (sales / service, any year's layout) into NovaCRM.
 * 1. pick the file → every sheet is read and its columns recognised
 * 2. check the rows → customer by phone, machine matched to the product list, duplicates found
 * 3. import → in parts, with one undo for the whole import
 */
export function RegisterImportPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [fileName, setFileName] = useState('')
  const [force, setForce] = useState<'' | Kind>('')
  const [sheets, setSheets] = useState<Array<{ name: string; rows: unknown[][] }>>([])
  const [plans, setPlans] = useState<SheetPlan[]>([])
  const [openSheet, setOpenSheet] = useState<string | null>(null)
  const [brands, setBrands] = useState<string[]>([])
  const [products, setProducts] = useState<Array<{ value: string; label: string; sublabel?: string }>>([])
  const [reading, setReading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState<RegisterPreview | null>(null)
  const [sentRows, setSentRows] = useState<Array<Record<string, unknown>>>([])
  const [overrides, setOverrides] = useState<Record<string, string | null>>({})
  const [unpaidAs, setUnpaidAs] = useState<'DUE' | 'PAID'>('DUE')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<RegisterCommitResult | null>(null)
  const [batches, setBatches] = useState<RegisterBatch[]>([])
  const [undoing, setUndoing] = useState<RegisterBatch | null>(null)

  useEffect(() => {
    void api
      .products({ limit: 500 })
      .then((pg) => {
        const items = pg.items ?? []
        setBrands([...new Set(items.map((p) => String(productAttrs(p).brand ?? '')).filter(Boolean))])
        setProducts(
          items
            .map((p) => ({
              value: String(p.id),
              label: `${String(p.sku ?? '')} · ${String(p.name)}`,
              sublabel: String(productAttrs(p).machineType ?? ''),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
        )
      })
      .catch(() => undefined)
    void loadBatches()
  }, [])

  async function loadBatches() {
    try {
      setBatches(await api.registerBatches())
    } catch {
      /* list is optional */
    }
  }

  const kind: Kind | null = useMemo(() => {
    const on = plans.filter((p) => p.include)
    return on.length ? on[0]!.kind : null
  }, [plans])

  async function readFile(f: File) {
    setReading(true)
    setPreview(null)
    setResult(null)
    setOverrides({})
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true })
      const read = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: null, blankrows: false }),
      }))
      setFileName(f.name)
      setSheets(read)
      setPlans(planWorkbook(read, brands, force || undefined))
    } catch (e) {
      addToast({ type: 'error', message: `Could not read the file — ${errText(e)}` })
    } finally {
      setReading(false)
    }
  }

  function replan(k: '' | Kind) {
    setForce(k)
    setPreview(null)
    if (sheets.length) setPlans(planWorkbook(sheets, brands, k || undefined))
  }

  function updatePlan(name: string, patch: Partial<SheetPlan>) {
    setPreview(null)
    setPlans((prev) => prev.map((p) => (p.name === name ? { ...p, ...patch } : p)))
  }

  function setRole(name: string, col: number, role: Role) {
    setPreview(null)
    setPlans((prev) =>
      prev.map((p) =>
        p.name === name
          ? { ...p, manualColumns: true, roles: p.roles.map((r, i) => (i === col ? role : r)), engineerFromSheet: p.kind === 'SERVICE' && !p.roles.some((r, i) => (i === col ? role === 'engineer' : r === 'engineer')) }
          : p,
      ),
    )
  }

  /** Rows of the ticked sheets — sheets with an industry first, so a copy in "ALL" is the one skipped */
  function collectRows() {
    const on = plans.filter((p) => p.include && p.kind === kind)
    on.sort((a, b) => Number(!a.industry) - Number(!b.industry))
    return on.flatMap((p) => rowsOfSheet(p)) as unknown as Array<Record<string, unknown>>
  }

  /** AI fills Product IDs / Spare IDs for what the rules could not match; rows are re-checked after */
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  async function aiFix() {
    if (!kind || !preview) return
    const looksSerial = (s: string) => /^[A-Z0-9\-/]{5,}$/i.test(s) && s.replace(/\D/g, '').length >= 6
    const rows = sentRows.map((r) => ({ ...r }))
    const productText = new Map<number, string>()
    const spareTexts = new Set<string>()
    preview.rows.forEach((pr, i) => {
      if (pr.skip) return
      const src = rows[i]!
      if (kind === 'SALES') {
        if (pr.product && !pr.product.productId && !(pr.ref in overrides)) {
          const spec = String(src.spec ?? '')
          const t = [src.brand, src.model, looksSerial(spec) ? '' : spec].filter(Boolean).join(' ').trim()
          if (t) productText.set(i, t)
        }
      } else {
        if (!src.productCode && src.machine && pr.warnings.some((w) => w.startsWith('Machine "'))) productText.set(i, String(src.machine))
        for (const s of pr.spares ?? []) if (!s.spareId) spareTexts.add(s.name)
      }
    })
    if (!productText.size && !spareTexts.size) {
      addToast({ type: 'info', message: 'Nothing left for AI to match' })
      return
    }
    try {
      const productCode = new Map<string, string>()
      const texts = [...new Set(productText.values())]
      for (let k = 0; k < texts.length; k += 60) {
        setAiBusy(`AI matching machines… ${Math.min(texts.length, k + 60)} / ${texts.length}`)
        for (const m of await api.registerAiMatch({ kind: 'PRODUCT', texts: texts.slice(k, k + 60) })) if (m.code && m.sure !== 'low') productCode.set(m.text, m.code)
      }
      const spareCode = new Map<string, string>()
      const st = [...spareTexts]
      for (let k = 0; k < st.length; k += 60) {
        setAiBusy(`AI matching spares… ${Math.min(st.length, k + 60)} / ${st.length}`)
        for (const m of await api.registerAiMatch({ kind: 'SPARE', texts: st.slice(k, k + 60) })) if (m.code && m.sure !== 'low') spareCode.set(m.text, m.code)
      }
      let filled = 0
      productText.forEach((text, i) => {
        const code = productCode.get(text.trim())
        if (code) {
          rows[i]!.productCode = code
          rows[i]!.aiProduct = true
          filled++
        }
      })
      if (kind === 'SERVICE' && spareCode.size) {
        preview.rows.forEach((pr, i) => {
          if (!pr.spares?.some((s) => !s.spareId && spareCode.has(s.name))) return
          rows[i]!.spares = pr.spares
            .map((s) => `${s.spareId ?? spareCode.get(s.name) ?? s.name} x${s.qty}`)
            .join(', ')
          rows[i]!.aiSpares = true
          filled++
        })
      }
      setAiBusy('Checking again…')
      const res = await api.registerPreview({ kind, rows, unpaidAs })
      setSentRows(rows)
      setPreview(res)
      addToast({
        type: 'success',
        message: filled
          ? `AI filled ${filled} row${filled === 1 ? '' : 's'} — they are marked "AI"; change any that look wrong`
          : 'AI found nothing it was sure about — those rows are saved as written',
      })
    } catch (e) {
      addToast({ type: 'error', message: errText(e) })
    } finally {
      setAiBusy(null)
    }
  }

  async function check() {
    if (!kind) return
    const rows = collectRows()
    if (!rows.length) {
      addToast({ type: 'error', message: 'No rows found in the ticked sheets' })
      return
    }
    setChecking(true)
    setResult(null)
    try {
      const res = await api.registerPreview({ kind, rows, unpaidAs })
      setSentRows(rows)
      setPreview(res)
      setOverrides({})
      setFilter('all')
      setPage(1)
    } catch (e) {
      addToast({ type: 'error', message: errText(e) })
    } finally {
      setChecking(false)
    }
  }

  async function runImport() {
    if (!kind || !preview) return
    const batchId = crypto.randomUUID()
    const rows = sentRows.map((r) => (r.ref as string) in overrides ? { ...r, productId: overrides[r.ref as string] } : r)
    const total = rows.length
    setImporting({ done: 0, total })
    const sum: RegisterCommitResult = {
      batchId,
      customersCreated: 0,
      customersUpdated: 0,
      machinesAdded: 0,
      serviceJobsAdded: 0,
      duplicatesSkipped: 0,
      rowsSkipped: 0,
    }
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = await api.registerCommit({ kind, rows: rows.slice(i, i + CHUNK), batchId, fileName, unpaidAs })
        for (const k of Object.keys(sum) as Array<keyof RegisterCommitResult>) {
          if (k !== 'batchId') (sum[k] as number) += Number(part[k] ?? 0)
        }
        setImporting({ done: Math.min(total, i + CHUNK), total })
      }
      setResult(sum)
      setPreview(null)
      addToast({ type: 'success', message: 'Register imported' })
    } catch (e) {
      setResult(sum.customersCreated || sum.machinesAdded || sum.serviceJobsAdded ? sum : null)
      addToast({ type: 'error', message: `Import stopped — ${errText(e)}. Parts already saved can be undone below.` })
    } finally {
      setImporting(null)
      void loadBatches()
    }
  }

  async function undo(b: RegisterBatch) {
    try {
      const r = await api.registerUndo(b.batchId)
      addToast({
        type: 'success',
        message: `Removed ${r.machinesRemoved} machines, ${r.serviceJobsRemoved} service jobs and ${r.customersRemoved} customers`,
      })
      if (result?.batchId === b.batchId) setResult(null)
      void loadBatches()
    } catch (e) {
      addToast({ type: 'error', message: errText(e) })
    } finally {
      setUndoing(null)
    }
  }

  const rowsView = useMemo(() => {
    if (!preview) return []
    const list = preview.rows.map((r, i) => ({ r, src: sentRows[i] ?? {} }))
    return list.filter(({ r }) =>
      filter === 'all'
        ? true
        : filter === 'dup'
          ? r.duplicate
          : filter === 'new'
            ? r.contact !== 'existing' && !r.skip
            : // a note, or a product match worth a second look (not plain "as written" rows)
              !r.skip &&
              (r.warnings.length > 0 ||
                (!!r.product && ['check', 'likely'].includes(r.product.confidence) && !(r.ref in overrides))),
    )
  }, [preview, sentRows, filter, overrides])
  const pageRows = rowsView.slice((page - 1) * PAGE, page * PAGE)

  const included = plans.filter((p) => p.include)
  const mixedKinds = new Set(included.map((p) => p.kind)).size > 1

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Import HMS registers"
        breadcrumbs={[{ label: 'Customers', to: '/contacts' }, { label: 'Import registers' }]}
      />
      <p className="-mt-3 mb-5 max-w-3xl text-sm text-text-secondary">
        Bring in HMS’s own Excel registers — <b>sales</b> (who bought which machine) or <b>service</b> (which job was done
        for whom), whatever the year’s layout. Customers are joined by phone number, machines are matched to the product
        list, and nothing already imported comes in twice. Every import can be undone.
      </p>

      {/* 1. file */}
      <Card className="mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-accent-blue/60 bg-accent-blue/5 px-4 py-2.5 text-sm font-medium text-accent-blue hover:bg-accent-blue/10',
              reading && 'pointer-events-none opacity-60',
            )}
          >
            <Upload size={16} />
            {reading ? 'Reading…' : fileName ? 'Choose another file' : 'Choose Excel file'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void readFile(f)
                e.target.value = ''
              }}
            />
          </label>
          <div className="w-[220px]">
            <Select
              label="Register type"
              value={force}
              onChange={(e) => replan(e.target.value as '' | Kind)}
              options={[
                { value: '', label: 'Find out from the file' },
                { value: 'SALES', label: 'Sales register' },
                { value: 'SERVICE', label: 'Service register' },
              ]}
            />
          </div>
          {fileName ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary">
              <FileSpreadsheet size={15} /> {fileName}
            </span>
          ) : null}
        </div>

        {plans.length ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Use</th>
                  <th className="px-3 py-2">Sheet</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Records</th>
                  <th className="px-3 py-2">Industry / engineer</th>
                  <th className="px-3 py-2">Columns</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.name} className="border-t border-border/70 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={p.include}
                        disabled={p.dataRows.length < 1}
                        aria-label={`Use sheet ${p.name}`}
                        onChange={(e) => updatePlan(p.name, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-text-primary">{p.name}</div>
                      {p.note ? <div className="text-xs text-amber-700 dark:text-amber-400">{p.note}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge color={p.kind === 'SALES' ? 'blue' : 'purple'}>{p.kind === 'SALES' ? 'Sales' : 'Service'}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{p.dataRows.length}</td>
                    <td className="px-3 py-2">
                      {p.kind === 'SALES' ? (
                        <Input
                          aria-label={`Industry for sheet ${p.name}`}
                          className="h-8 max-w-[180px]"
                          value={p.industry}
                          placeholder="e.g. Retail"
                          onChange={(e) => updatePlan(p.name, { industry: e.target.value })}
                        />
                      ) : p.engineerFromSheet ? (
                        <span className="text-xs text-text-secondary">Engineer = “{p.name}”</span>
                      ) : (
                        <span className="text-xs text-text-secondary">From the engineer column</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" onClick={() => setOpenSheet(openSheet === p.name ? null : p.name)}>
                        {openSheet === p.name ? 'Hide' : 'Check columns'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {openSheet
          ? (() => {
              const p = plans.find((x) => x.name === openSheet)!
              const roles = p.kind === 'SALES' ? SALES_ROLES : SERVICE_ROLES
              return (
                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-xs text-text-secondary">
                    {p.kind === 'SALES' && !p.manualColumns
                      ? 'Sales rows are read one by one (columns move around in these sheets) — the roles below are only used if you change one.'
                      : 'What each column holds. Change a role if it was guessed wrong.'}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {p.samples.map((s, i) =>
                      s.length ? (
                        <div key={i} className="rounded-md border border-border/70 bg-muted/20 p-2">
                          <Select
                            label={`Column ${colName(i)}`}
                            value={p.roles[i] ?? 'ignore'}
                            onChange={(e) => setRole(p.name, i, e.target.value as Role)}
                            options={roles.map((r) => ({ value: r.value, label: r.label }))}
                          />
                          <div className="mt-1 truncate text-[11px] text-text-secondary" title={s.join(' · ')}>
                            {s.join(' · ')}
                          </div>
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
              )
            })()
          : null}

        {plans.length ? (
          <div className="flex flex-wrap items-center gap-3">
            {kind === 'SERVICE' ? (
              <div className="w-[300px]">
                <Select
                  label="Jobs with an amount but no payment written"
                  value={unpaidAs}
                  onChange={(e) => {
                    setUnpaidAs(e.target.value as 'DUE' | 'PAID')
                    setPreview(null)
                  }}
                  options={[
                    { value: 'DUE', label: 'Still due — show in dues' },
                    { value: 'PAID', label: 'Already paid' },
                  ]}
                />
              </div>
            ) : null}
            <Button onClick={() => void check()} disabled={checking || !included.length || mixedKinds}>
              {checking ? 'Checking…' : 'Check rows'}
            </Button>
            {mixedKinds ? (
              <span className="text-sm text-rose-600">Tick only sales sheets or only service sheets in one import.</span>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* 2. preview */}
      {preview ? (
        <Card className="mb-4 space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Will import', value: preview.summary.toImport, tone: 'text-emerald-600' },
              { label: 'New customers', value: preview.summary.newCustomers },
              { label: 'Existing customers', value: preview.summary.existingCustomers },
              ...(kind === 'SALES'
                ? [
                    { label: 'Matched to products', value: preview.summary.matched },
                    { label: 'Saved as written', value: preview.summary.notMatched },
                  ]
                : [{ label: 'Rows with a note', value: preview.summary.withWarnings }]),
              { label: 'Already imported', value: preview.summary.duplicates, tone: 'text-text-secondary' },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border border-border bg-surface p-3">
                <div className={cn('text-2xl font-semibold tabular-nums', t.tone ?? 'text-text-primary')}>{t.value}</div>
                <div className="text-xs text-text-secondary">{t.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', 'All'],
                ['look', 'Needs a look'],
                ['new', 'New customers'],
                ['dup', 'Already imported'],
              ] as Array<[Filter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => {
                  setFilter(id)
                  setPage(1)
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  filter === id ? 'border-accent-blue bg-accent-blue text-white' : 'border-border text-text-secondary hover:text-text-primary',
                )}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-xs text-text-secondary">{rowsView.length} rows</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">{kind === 'SALES' ? 'Written in the sheet' : 'Work done'}</th>
                  <th className="px-3 py-2">{kind === 'SALES' ? 'Product' : 'Machine'}</th>
                  <th className="px-3 py-2">{kind === 'SALES' ? 'HMS ID' : 'Service no.'}</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ r, src }) => (
                  <PreviewLine
                    key={r.ref}
                    r={r}
                    src={src}
                    kind={kind!}
                    products={products}
                    override={r.ref in overrides ? overrides[r.ref]! : undefined}
                    onOverride={(v) => setOverrides((o) => ({ ...o, [r.ref]: v }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar page={page} total={rowsView.length} pageSize={PAGE} onPageChange={setPage} label="Rows" />

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <Button variant="outline" onClick={() => void aiFix()} disabled={!!aiBusy || !!importing}>
              <Sparkles size={14} /> {aiBusy ?? 'AI: fix unmatched'}
            </Button>
            <Button onClick={() => void runImport()} disabled={!!importing || !!aiBusy || !preview.summary.toImport}>
              {importing ? `Importing… ${importing.done} / ${importing.total}` : `Import ${preview.summary.toImport} rows`}
            </Button>
            <span className="text-xs text-text-secondary">
              Rows marked “Already imported” and rows without a customer are left out. You can undo the whole import afterwards.
            </span>
          </div>
        </Card>
      ) : null}

      {/* 3. result */}
      {result ? (
        <Card className="mb-4 flex flex-wrap items-center gap-4 border-emerald-500/40 bg-emerald-500/5 p-4">
          <CheckCircle2 className="text-emerald-600" size={22} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-text-primary">Imported</div>
            <div className="text-text-secondary">
              {result.customersCreated} new customers · {result.customersUpdated} existing customers updated ·{' '}
              {result.machinesAdded ? `${result.machinesAdded} machines` : `${result.serviceJobsAdded} service jobs`} ·{' '}
              {result.duplicatesSkipped} already there
            </div>
          </div>
          <Link to="/contacts">
            <Button variant="outline" size="sm">
              Open customers
            </Button>
          </Link>
        </Card>
      ) : null}

      {/* recent imports */}
      {batches.length ? (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Recent imports</h2>
          <ul className="divide-y divide-border">
            {batches.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                <Badge color={b.kind === 'SALES' ? 'blue' : 'purple'}>{b.kind === 'SALES' ? 'Sales' : 'Service'}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{b.fileName || 'Register'}</span>
                <span className="text-xs text-text-secondary">{formatDate(b.at)}</span>
                <span className="text-xs text-text-secondary">
                  {b.customersCreated} new customers · {b.kind === 'SALES' ? `${b.machinesAdded} machines` : `${b.serviceJobsAdded} jobs`}
                </span>
                {b.undone ? (
                  <Badge color="gray">Undone</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setUndoing(b)}>
                    <RotateCcw size={13} /> Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Modal
        open={!!undoing}
        onClose={() => setUndoing(null)}
        title="Undo this import?"
        subtitle={undoing ? `${undoing.fileName || 'Register'} · ${formatDate(undoing.at)}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setUndoing(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => undoing && void undo(undoing)}>
              Undo import
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          The machines and service jobs from this import are removed, and so are the customers it created — unless
          something else has been added for them since.
        </p>
      </Modal>
    </div>
  )
}

function PreviewLine({
  r,
  src,
  kind,
  products,
  override,
  onOverride,
}: {
  r: RegisterPreviewRow
  src: Record<string, unknown>
  kind: Kind
  products: Array<{ value: string; label: string; sublabel?: string }>
  override: string | null | undefined
  onOverride: (v: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const s = (k: string) => (src[k] == null ? '' : String(src[k]))
  const conf = r.product ? CONF[r.product.confidence] : null
  const chosen = override !== undefined ? (override ? products.find((p) => p.value === override)?.label ?? '—' : null) : undefined
  return (
    <tr className={cn('border-t border-border/70 align-top', r.skip && 'opacity-55')}>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-secondary">{r.ref}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{s('date') ? formatDate(s('date')) : '—'}</td>
      <td className="px-3 py-2">
        <div className="font-medium text-text-primary">{r.contactName || r.customer || '—'}</div>
        <div className="text-[11px] text-text-secondary">
          {r.contact === 'existing' ? 'Existing customer' : r.contact === 'same-file' ? 'Earlier in this file' : 'New customer'}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.phone ?? '—'}</td>
      <td className="max-w-[240px] px-3 py-2 text-text-secondary">
        {kind === 'SALES' ? [s('brand'), s('model'), s('spec')].filter(Boolean).join(' · ') || '—' : s('work') || '—'}
        {kind === 'SERVICE' && s('coverage') ? <Badge color="slate" className="ml-1.5">{s('coverage')}</Badge> : null}
      </td>
      <td className="min-w-[220px] px-3 py-2">
        {kind === 'SALES' ? (
          editing ? (
            <div className="space-y-1">
              <SearchableSelect
                value={override ?? r.product?.productId ?? ''}
                options={products}
                placeholder="Pick the product…"
                onChange={(v) => {
                  onOverride(v || null)
                  setEditing(false)
                }}
              />
              <button type="button" className="text-[11px] text-accent-blue hover:underline" onClick={() => (onOverride(null), setEditing(false))}>
                Save as written instead
              </button>
            </div>
          ) : (
            <button type="button" className="text-left" onClick={() => !r.skip && setEditing(true)} title="Click to change">
              {chosen !== undefined ? (
                <>
                  <div className="font-medium text-text-primary">{chosen ?? r.machine}</div>
                  <Badge color={chosen ? 'green' : 'gray'}>{chosen ? 'Picked' : 'As written'}</Badge>
                </>
              ) : (
                <>
                  <div className="font-medium text-text-primary">
                    {r.product?.productCode ? <span className="mr-1 font-mono text-xs">{r.product.productCode}</span> : null}
                    {r.product?.productName ?? r.machine}
                  </div>
                  {conf ? <Badge color={conf.color}>{conf.label}</Badge> : null}
                  {r.ai ? (
                    <Badge color="purple" className="ml-1">
                      AI
                    </Badge>
                  ) : null}
                </>
              )}
            </button>
          )
        ) : (
          <span className="text-text-secondary">{r.machine}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{kind === 'SALES' ? s('hmsId') || '—' : s('serviceNo') || '—'}</td>
      <td className="px-3 py-2 text-xs">
        {r.duplicate ? <Badge color="gray">Already imported</Badge> : null}
        {r.warnings
          .filter((w) => !/already imported/i.test(w))
          .map((w) => (
            <div key={w} className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
      </td>
    </tr>
  )
}
