import { useCallback, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ListOrdered,
  Loader2,
  Sparkles,
  Upload,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { downloadCsv, downloadXlsx } from '@/lib/reportExport'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const TEMPLATE_HEADERS = [
  'name',
  'mobile',
  'email',
  'doorNo',
  'street',
  'buildingName',
  'area',
  'city',
  'state',
  'pincode',
  'landmark',
  'whatsapp',
  'description',
  'machineName',
  'machineType',
  'serialNo',
  'model',
  'capacity',
  'accuracy',
  'platformSize',
  'origin',
  'servicePlan',
  'stampingDate',
  'nextDueDate',
  'machineNotes',
] as const

const SAMPLE_ROWS: Array<Record<string, string>> = [
  {
    name: 'Sri Murugan Stores',
    mobile: '9876543210',
    email: 'sri@example.com',
    doorNo: '12',
    street: 'Gandhi Road',
    buildingName: 'City Plaza',
    area: 'Anna Nagar',
    city: 'Chennai',
    state: 'TN',
    pincode: '600040',
    landmark: 'Near bus stand',
    whatsapp: '9876543210',
    description: 'Regular weighing customer',
    machineName: 'Platform Scale 300kg',
    machineType: 'WEIGHING',
    serialNo: 'HMS-2018-0042',
    model: 'PS-300',
    capacity: '300kg',
    accuracy: 'III',
    platformSize: '600x600',
    origin: 'SOLD_BY_US',
    servicePlan: 'AMC',
    stampingDate: '2024-06-15',
    nextDueDate: '2025-06-15',
    machineNotes: 'Annual AMC active',
  },
  {
    name: 'Preethu Traders',
    mobile: '9988776655',
    email: '',
    doorNo: '5A',
    street: 'Market Street',
    buildingName: '',
    area: 'Gandhipuram',
    city: 'Coimbatore',
    state: 'TN',
    pincode: '641012',
    landmark: '',
    whatsapp: '9988776655',
    description: '',
    machineName: 'Table Top 30kg',
    machineType: 'WEIGHING',
    serialNo: 'HMS-2019-1102',
    model: 'TT-30',
    capacity: '30kg',
    accuracy: 'III',
    platformSize: '',
    origin: 'SOLD_BY_US',
    servicePlan: 'NON_AMC',
    stampingDate: '2023-01-10',
    nextDueDate: '2024-01-10',
    machineNotes: '',
  },
  {
    name: 'Kumar Electronics',
    mobile: '9123456780',
    email: 'kumar@shop.in',
    doorNo: '',
    street: 'Main Road',
    buildingName: '',
    area: '',
    city: 'Salem',
    state: 'TN',
    pincode: '636001',
    landmark: '',
    whatsapp: '',
    description: 'CCTV site',
    machineName: '4ch DVR Kit',
    machineType: 'CCTV',
    serialNo: 'SN-CCTV-88',
    model: 'DVR-4CH',
    capacity: '',
    accuracy: '',
    platformSize: '',
    origin: 'SOLD_BY_US',
    servicePlan: 'NON_AMC',
    stampingDate: '',
    nextDueDate: '',
    machineNotes: '',
  },
]

const FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '— Skip —' },
  { value: 'name', label: 'Customer name *' },
  { value: 'mobile', label: 'Mobile *' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'doorNo', label: 'Door no' },
  { value: 'street', label: 'Street / address' },
  { value: 'buildingName', label: 'Building' },
  { value: 'area', label: 'Area' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'pincode', label: 'Pincode' },
  { value: 'landmark', label: 'Landmark' },
  { value: 'description', label: 'Customer notes' },
  { value: 'machineName', label: 'Machine name' },
  { value: 'machineType', label: 'Machine type' },
  { value: 'serialNo', label: 'Serial no' },
  { value: 'model', label: 'Model' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'accuracy', label: 'Accuracy' },
  { value: 'platformSize', label: 'Platform size' },
  { value: 'origin', label: 'Origin (SOLD_BY_US / THIRD_PARTY)' },
  { value: 'servicePlan', label: 'Service plan (AMC / NON_AMC)' },
  { value: 'stampingDate', label: 'Stamping date' },
  { value: 'nextDueDate', label: 'Next due date' },
  { value: 'machineNotes', label: 'Machine notes' },
]

const STEPS = [
  {
    title: 'Download the sample',
    body: 'Use our CSV or Excel template so columns match HMS fields (customer + one machine per row).',
  },
  {
    title: 'Fill your data',
    body: 'One row = one customer. Same mobile on multiple rows adds extra machines to that customer. Name + mobile are required.',
  },
  {
    title: 'Upload & map',
    body: 'Upload .csv / .xlsx. AI (or column rules) maps your headers — review the mapping, then preview rows.',
  },
  {
    title: 'Import',
    body: 'Confirm import. Existing mobiles merge machines onto the same customer (no duplicate contact). Up to 500 rows per batch.',
  },
]

type ImportSummary = {
  created: number
  merged: number
  machinesAdded: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

function cell(v: unknown) {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel may store phones as numbers — keep digits
    return String(Math.trunc(v))
  }
  const s = String(v).trim()
  return s || null
}

function rowsToImportPayload(
  rows: Array<Record<string, unknown>>,
  mapping: Record<string, string | null>,
) {
  return rows.map((raw) => {
    const get = (field: string) => {
      const header = Object.entries(mapping).find(([, f]) => f === field)?.[0]
      if (!header) return null
      return cell(raw[header])
    }
    const machineName = get('machineName')
    const machineType = get('machineType')
    const serialNo = get('serialNo')
    const model = get('model')
    const hasMachine = Boolean(machineName || serialNo || model || machineType)
    return {
      name: get('name'),
      phone: get('phone'),
      mobile: get('mobile') || get('phone'),
      whatsapp: get('whatsapp'),
      email: get('email'),
      doorNo: get('doorNo'),
      street: get('street'),
      buildingName: get('buildingName'),
      area: get('area'),
      city: get('city'),
      state: get('state'),
      pincode: get('pincode'),
      landmark: get('landmark'),
      description: get('description'),
      machine: hasMachine
        ? {
            name: machineName || model || serialNo || 'Imported machine',
            machineType,
            serialNo,
            model,
            capacity: get('capacity'),
            accuracy: get('accuracy'),
            platformSize: get('platformSize'),
            origin: get('origin'),
            servicePlan: get('servicePlan'),
            stampingDate: get('stampingDate'),
            nextDueDate: get('nextDueDate'),
            notes: get('machineNotes'),
          }
        : null,
    }
  })
}

type Props = {
  onImported?: () => void
}

export function CustomerImportPanel({ onImported }: Props) {
  const addToast = useUIStore((s) => s.addToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [mapNote, setMapNote] = useState<string | null>(null)
  const [usedAi, setUsedAi] = useState(false)
  const [mappingBusy, setMappingBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const mappedPayload = useMemo(
    () => (headers.length ? rowsToImportPayload(rawRows, mapping) : []),
    [headers, rawRows, mapping],
  )

  const preview = mappedPayload.slice(0, 8)
  const hasName = Object.values(mapping).includes('name')
  const hasPhone =
    Object.values(mapping).includes('mobile') || Object.values(mapping).includes('phone')

  function downloadSample(kind: 'csv' | 'xlsx') {
    if (kind === 'csv') {
      downloadCsv('hms-customers-import-template.csv', SAMPLE_ROWS)
      return
    }
    downloadXlsx('hms-customers-import-template.xlsx', [
      { name: 'Customers', rows: SAMPLE_ROWS },
      {
        name: 'Instructions',
        rows: [
          { tip: 'Required: name + mobile (or phone)' },
          { tip: 'One machine per row — repeat customer mobile for extra machines' },
          {
            tip: 'machineType: WEIGHING | BILLING | CCM | CCTV | BIOMETRIC | PAPER_SHREDDER | PAPER_ROLL | OTHER',
          },
          { tip: 'origin: SOLD_BY_US or THIRD_PARTY' },
          { tip: 'servicePlan: AMC or NON_AMC' },
          { tip: 'Dates: YYYY-MM-DD' },
        ],
      },
    ])
  }

  const runAiMap = useCallback(
    async (cols: string[], rows: Array<Record<string, unknown>>) => {
      setMappingBusy(true)
      try {
        const res = await api.aiMapCustomerImport({
          headers: cols,
          sampleRows: rows.slice(0, 3),
        })
        setMapping(res.mapping ?? {})
        setUsedAi(Boolean(res.usedAi))
        setMapNote(res.notes ?? null)
      } catch (err) {
        // Local fallback: identity map when headers match template
        const local: Record<string, string | null> = {}
        for (const h of cols) {
          const key = h.trim()
          local[h] = (TEMPLATE_HEADERS as readonly string[]).includes(key) ? key : null
        }
        setMapping(local)
        setUsedAi(false)
        setMapNote(
          err instanceof ApiClientError
            ? `${err.message} — using template header match.`
            : 'Could not reach AI — using template header match.',
        )
      } finally {
        setMappingBusy(false)
      }
    },
    [],
  )

  async function onFile(file: File) {
    setSummary(null)
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]!]
      if (!sheet) throw new Error('Empty workbook')
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
      })
      if (!json.length) {
        addToast({ type: 'error', message: 'No data rows found in the file' })
        return
      }
      const cols = Object.keys(json[0]!)
      setHeaders(cols)
      setRawRows(json)
      await runAiMap(cols, json)
      addToast({
        type: 'success',
        message: `Loaded ${json.length} row${json.length === 1 ? '' : 's'} from ${file.name}`,
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Could not read file',
      })
    }
  }

  async function doImport() {
    if (!mappedPayload.length) return
    if (!hasName || !hasPhone) {
      addToast({
        type: 'error',
        message: 'Map Customer name and Mobile/Phone before importing',
      })
      return
    }
    setImporting(true)
    setSummary(null)
    try {
      const totals: ImportSummary = {
        created: 0,
        merged: 0,
        machinesAdded: 0,
        skipped: 0,
        errors: [],
      }
      const batchSize = 500
      for (let i = 0; i < mappedPayload.length; i += batchSize) {
        const chunk = mappedPayload.slice(i, i + batchSize)
        const res = await api.importContacts({ rows: chunk })
        totals.created += res.created
        totals.merged += res.merged
        totals.machinesAdded += res.machinesAdded
        totals.skipped += res.skipped
        for (const e of res.errors ?? []) {
          totals.errors.push({ row: e.row + i, message: e.message })
        }
      }
      setSummary(totals)
      addToast({
        type: 'success',
        message: `Import done — ${totals.created} new, ${totals.merged} merged, ${totals.machinesAdded} machines`,
      })
      onImported?.()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Import failed',
      })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-sky-500/20 bg-gradient-to-br from-sky-500/[0.07] to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Sparkles size={16} className="text-sky-600 dark:text-sky-400" />
              Bulk import customers & machines
            </div>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              For long-running businesses like HMS (thousands of customers since ~2017), upload
              Excel/CSV once — AI maps columns, then we create Directory entries and machine records
              automatically.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadSample('csv')}>
              <Download size={14} /> Sample CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadSample('xlsx')}>
              <FileSpreadsheet size={14} /> Sample Excel
            </Button>
            <a
              href="/samples/hms-customers-import-template.csv"
              download
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface"
            >
              <Download size={14} /> Static CSV link
            </a>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <ListOrdered size={16} /> How it works
          </div>
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-xs font-bold text-sky-700 dark:text-sky-300">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium text-text-primary">{s.title}</div>
                  <p className="mt-0.5 text-text-secondary">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-text-secondary">
            <li>• Machine types: WEIGHING, BILLING, CCM, CCTV, BIOMETRIC, PAPER_SHREDDER, PAPER_ROLL, OTHER</li>
            <li>• Origin: SOLD_BY_US (bought from HMS) or THIRD_PARTY (outside / repair only)</li>
            <li>• Dates as YYYY-MM-DD. Keep phone as text so leading zeros are not lost.</li>
            <li>• Max 500 rows per upload batch — split larger files and import again.</li>
          </ul>
        </Card>

        <Card>
          <div className="mb-3 text-sm font-semibold text-text-primary">Upload file</div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onFile(f)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border bg-surface px-4 py-10 text-center transition-colors hover:border-sky-500/40 hover:bg-sky-500/[0.04]',
            )}
          >
            <Upload size={22} className="text-sky-600 dark:text-sky-400" />
            <div className="text-sm font-medium text-text-primary">
              Drop or choose CSV / Excel
            </div>
            <div className="text-xs text-text-secondary">
              {fileName ? fileName : '.csv, .xlsx, .xls'}
            </div>
          </button>
          {mappingBusy ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 size={14} className="animate-spin" /> Mapping columns with AI…
            </p>
          ) : null}
          {mapNote ? (
            <p className="mt-3 flex items-start gap-2 text-xs text-text-secondary">
              {usedAi ? (
                <Sparkles size={14} className="mt-0.5 shrink-0 text-sky-600" />
              ) : (
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-amber" />
              )}
              {mapNote}
            </p>
          ) : null}
        </Card>
      </div>

      {headers.length ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-text-primary">
              Column mapping ({rawRows.length} rows)
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={mappingBusy}
                onClick={() => void runAiMap(headers, rawRows)}
              >
                <Sparkles size={14} /> Remap with AI
              </Button>
              <Button
                size="sm"
                disabled={importing || mappingBusy || !hasName || !hasPhone}
                onClick={() => void doImport()}
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Import {rawRows.length} rows
              </Button>
            </div>
          </div>
          {!hasName || !hasPhone ? (
            <p className="mb-3 text-xs text-accent-amber">
              Map at least <strong>Customer name</strong> and <strong>Mobile/Phone</strong> to continue.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {headers.map((h) => (
              <Select
                key={h}
                label={h}
                value={mapping[h] ?? ''}
                onChange={(e) =>
                  setMapping((m) => ({
                    ...m,
                    [h]: e.target.value || null,
                  }))
                }
                options={FIELD_OPTIONS}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {preview.length ? (
        <Card padding={false} className="overflow-hidden">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold text-text-primary">
            Preview (first {preview.length})
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-surface text-text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Mobile</th>
                  <th className="px-3 py-2 font-medium">City</th>
                  <th className="px-3 py-2 font-medium">Machine</th>
                  <th className="px-3 py-2 font-medium">Serial</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 text-text-primary">{r.name || '—'}</td>
                    <td className="px-3 py-2">{r.mobile || r.phone || '—'}</td>
                    <td className="px-3 py-2">{r.city || '—'}</td>
                    <td className="px-3 py-2">{r.machine?.name || '—'}</td>
                    <td className="px-3 py-2">{r.machine?.serialNo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {summary ? (
        <Card>
          <div className="mb-2 text-sm font-semibold text-text-primary">Import result</div>
          <div className="flex flex-wrap gap-2">
            <Badge color="green">{summary.created} created</Badge>
            <Badge color="blue">{summary.merged} merged (same phone)</Badge>
            <Badge color="purple">{summary.machinesAdded} machines</Badge>
            {summary.skipped ? <Badge color="amber">{summary.skipped} skipped</Badge> : null}
          </div>
          {summary.errors.length ? (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-text-secondary">
              {summary.errors.slice(0, 40).map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  Row {e.row}: {e.message}
                </li>
              ))}
              {summary.errors.length > 40 ? (
                <li>…and {summary.errors.length - 40} more</li>
              ) : null}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
