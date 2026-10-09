import { useCallback, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
  CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { downloadXlsx } from '@/lib/reportExport'
import { useUIStore } from '@/store/uiStore'
import {
  resolveInventoryAreas,
  type InventoryAreas,
} from '@/lib/inventoryAreas'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

export type StockImportKind = 'machines' | 'sparesBilling' | 'sparesWeighing'

const KIND_META: Record<
  StockImportKind,
  { label: string; area: keyof InventoryAreas; hint: string }
> = {
  machines: {
    label: 'Machine stock',
    area: 'machines',
    hint: 'HMS Unique ID, brand, model, SNO, supplier, invoice dates, unit amount',
  },
  sparesBilling: {
    label: 'Billing / Touch POS / paper & labels spares',
    area: 'sparesBilling',
    hint: 'Opening, new stock, given, balance, GC/NGC',
  },
  sparesWeighing: {
    label: 'Weighing machine spares',
    area: 'sparesWeighing',
    hint: 'Opening, new stock, given, balance, GC/NGC',
  },
}

const MACHINE_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'hmsUniqId', label: 'HMS Unique ID' },
  { value: 'brand', label: 'Brand (RETSOL / SMART / ISTHA…)' },
  { value: 'model', label: 'Model (must exist in Products)' },
  { value: 'spec', label: 'Spec' },
  { value: 'serialNo', label: 'SNO (serial under invoice)' },
  { value: 'supplierName', label: 'Supplier name' },
  { value: 'invoiceDate', label: 'Date of invoice' },
  { value: 'invoiceNo', label: 'Invoice number' },
  { value: 'receivedDate', label: 'Received date' },
  { value: 'unitAmount', label: 'Per unit amount' },
]

const SPARE_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'spareName', label: 'Spare name' },
  { value: 'opening', label: 'Opening (prev month closing)' },
  { value: 'newStock', label: 'New stock received' },
  { value: 'given', label: 'Given / issued' },
  { value: 'balance', label: 'Balance remaining' },
  { value: 'gc', label: 'GC' },
  { value: 'ngc', label: 'NGC' },
  { value: 'supplierName', label: 'Supplier name' },
  { value: 'invoiceDate', label: 'Invoice / txn date' },
  { value: 'invoiceNo', label: 'Invoice number' },
  { value: 'unit', label: 'Unit (NOS)' },
]

const MACHINE_SAMPLE = [
  {
    'HMS UNIQ ID': '2026-WS-0042',
    BRAND: 'RETSOL',
    MODEL: 'Platform Scale 300kg',
    SPEC: '300kg',
    SNO: 'SN-9001',
    'SUPPLIER NAME': 'Retsol India',
    'DATE OF INVOICE': '2026-03-01',
    'INV NUMBER': 'INV-1001',
    'RECEIVED DATE': '2026-03-02',
    'PER UNIT AMOUNT': '18500',
  },
]

const SPARE_SAMPLE = [
  {
    'SPARE NAME': 'Battery',
    OPENING: '10',
    'NEW STOCK': '15',
    GIVEN: '2',
    BALANCE: '23',
    GC: '5',
    NGC: '18',
    'SUPPLIER NAME': 'Local battery mart',
    'INVOICE DATE': '2026-04-01',
    'INV NUMBER': 'B-221',
    UNIT: 'NOS',
  },
]

function applyMapping(
  rows: Array<Record<string, unknown>>,
  mapping: Record<string, string | null>,
): Array<Record<string, unknown>> {
  return rows.map((raw) => {
    const out: Record<string, unknown> = {}
    for (const [header, field] of Object.entries(mapping)) {
      if (!field) continue
      out[field] = raw[header]
    }
    return out
  })
}

type Props = {
  /** Limit kinds shown (e.g. machines-only on Inventory page) */
  kinds?: StockImportKind[]
  onImported?: () => void
  onClose?: () => void
}

export function StockImportPanel({ kinds, onImported, onClose }: Props) {
  const addToast = useUIStore((s) => s.addToast)
  const user = useAuthStore((s) => s.user)
  const areas = resolveInventoryAreas(user?.inventoryAreas, user?.role)

  const allowedKinds = (kinds ?? (['machines', 'sparesBilling', 'sparesWeighing'] as StockImportKind[])).filter(
    (k) => areas[KIND_META[k].area],
  )

  const [kind, setKind] = useState<StockImportKind | ''>(
    allowedKinds[0] ?? '',
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [mapNote, setMapNote] = useState<string | null>(null)
  const [usedAi, setUsedAi] = useState(false)
  const [mappingBusy, setMappingBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<{
    created: number
    skipped: number
    errors: Array<{ row: number; message: string }>
  } | null>(null)

  const fieldOptions = kind === 'machines' ? MACHINE_FIELDS : SPARE_FIELDS
  const sampleRows = useMemo(
    () => rawRows.slice(0, 3).map((r) => {
      const o: Record<string, unknown> = {}
      for (const h of headers) o[h] = r[h]
      return o
    }),
    [rawRows, headers],
  )

  const runAiMap = useCallback(
    async (k: StockImportKind, cols: string[], rows: Array<Record<string, unknown>>) => {
      setMappingBusy(true)
      try {
        const res = await api.aiMapStockImport({
          kind: k,
          headers: cols,
          sampleRows: rows.slice(0, 3),
        })
        setMapping(res.mapping ?? {})
        setUsedAi(Boolean(res.usedAi))
        setMapNote(res.notes ?? null)
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof ApiClientError ? e.message : 'Mapping failed',
        })
      } finally {
        setMappingBusy(false)
      }
    },
    [addToast],
  )

  function downloadTemplate() {
    if (!kind) return
    if (kind === 'machines') {
      downloadXlsx('hms-machine-stock-import.xlsx', [
        { name: 'Machine stock', rows: MACHINE_SAMPLE },
        {
          name: 'Instructions',
          rows: [
            { tip: 'MODEL must already exist under Products catalog' },
            { tip: 'HMS UNIQ ID or SNO required — duplicates are skipped' },
            { tip: 'BRAND examples: RETSOL, SMART, ISTHA' },
            { tip: 'Dates: YYYY-MM-DD' },
          ],
        },
      ])
      return
    }
    downloadXlsx(
      kind === 'sparesBilling'
        ? 'hms-billing-spares-import.xlsx'
        : 'hms-weighing-spares-import.xlsx',
      [
        { name: 'Spare stock', rows: SPARE_SAMPLE },
        {
          name: 'Instructions',
          rows: [
            { tip: 'OPENING = previous month closing (becomes this month opening)' },
            { tip: 'NEW STOCK = quantity arrived; GIVEN = issued to service' },
            { tip: 'BALANCE is checked after import (warning only if mismatch)' },
            { tip: 'GC / NGC optional flags or counts' },
          ],
        },
      ],
    )
  }

  async function onFile(file: File) {
    if (!kind) {
      addToast({ type: 'error', message: 'Choose which stock type to import first' })
      return
    }
    setSummary(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]!]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
      })
      if (!json.length) {
        addToast({ type: 'error', message: 'File has no data rows' })
        return
      }
      const cols = Object.keys(json[0]!)
      setHeaders(cols)
      setRawRows(json)
      setFileName(file.name)
      await runAiMap(kind, cols, json)
    } catch {
      addToast({ type: 'error', message: 'Could not read Excel/CSV file' })
    }
  }

  async function runImport() {
    if (!kind || !rawRows.length) return
    const mapped = applyMapping(rawRows, mapping)
    setImporting(true)
    try {
      const res = await api.importStock({ kind, rows: mapped })
      setSummary(res)
      addToast({
        type: 'success',
        message: `Imported ${res.created} · skipped ${res.skipped} · errors ${res.errors.length}`,
      })
      onImported?.()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Import failed',
      })
    } finally {
      setImporting(false)
    }
  }

  if (!allowedKinds.length) {
    return (
      <Card className="border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-950">
        You are not assigned any inventory area that can import stock. Ask your admin to enable
        Machines and/or Spare areas under Users → Inventory visibility.
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Import stock from Excel</h3>
          <p className="mt-0.5 text-sm text-text-secondary">
            Choose stock type (by your permission) → upload → review AI field mapping → import.
          </p>
        </div>
        {onClose ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {allowedKinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k)
              setHeaders([])
              setRawRows([])
              setFileName(null)
              setMapping({})
              setSummary(null)
            }}
            className={cn(
              'rounded-xl border p-3 text-left text-sm transition',
              kind === k
                ? 'border-accent-blue bg-sky-50/80'
                : 'border-border bg-card hover:border-accent-blue/50',
            )}
          >
            <div className="font-semibold text-text-primary">{KIND_META[k].label}</div>
            <p className="mt-1 text-xs text-text-secondary">{KIND_META[k].hint}</p>
          </button>
        ))}
      </div>

      {kind ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download size={14} /> Download sample template
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={mappingBusy}
          >
            <Upload size={14} /> Upload Excel / CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = ''
            }}
          />
        </div>
      ) : null}

      {fileName ? (
        <Card className="flex items-center gap-2 p-3 text-sm">
          <FileSpreadsheet size={18} className="text-emerald-600" />
          <span className="font-medium">{fileName}</span>
          <span className="text-text-secondary">· {rawRows.length} rows</span>
          {usedAi ? <Badge color="purple">AI mapped</Badge> : <Badge color="gray">Rule mapped</Badge>}
        </Card>
      ) : null}

      {mappingBusy ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="animate-spin" size={16} /> Mapping columns with AI…
        </p>
      ) : null}

      {mapNote ? <p className="text-sm text-text-secondary">{mapNote}</p> : null}

      {headers.length > 0 ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Field mapping — check samples, fix if wrong</h4>
            <Button
              size="sm"
              variant="outline"
              disabled={mappingBusy || !kind}
              onClick={() => kind && void runAiMap(kind, headers, rawRows)}
            >
              <Sparkles size={14} /> Re-run AI map
            </Button>
          </div>
          <div className="space-y-2">
            {headers.map((h) => (
              <div
                key={h}
                className="grid gap-2 rounded-lg border border-border/70 px-3 py-2 sm:grid-cols-[1fr_1fr_1fr] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{h}</div>
                  <div className="truncate text-xs text-text-secondary">
                    Sample:{' '}
                    {sampleRows
                      .map((r) => String(r[h] ?? ''))
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(' · ') || '—'}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Select
                    value={mapping[h] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [h]: e.target.value || null,
                      }))
                    }
                    options={[
                      { value: '', label: '— Ignore —' },
                      ...fieldOptions.map((f) => ({ value: f.value, label: f.label })),
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => void runImport()} disabled={importing}>
              {importing ? (
                <>
                  <Loader2 className="animate-spin" size={16} /> Importing…
                </>
              ) : (
                <>
                  <Upload size={16} /> Import {rawRows.length} rows
                </>
              )}
            </Button>
          </div>
        </Card>
      ) : null}

      {summary ? (
        <Card className="space-y-2 border-emerald-200 bg-emerald-50/40 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-emerald-900">
            <CheckCircle2 size={18} /> Import finished
          </div>
          <p>
            Created/updated movements: <strong>{summary.created}</strong> · Skipped:{' '}
            <strong>{summary.skipped}</strong> · Messages:{' '}
            <strong>{summary.errors.length}</strong>
          </p>
          {summary.errors.length ? (
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs text-amber-900">
              {summary.errors.slice(0, 40).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
