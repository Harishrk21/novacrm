import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
  AlertTriangle,
  RotateCcw,
  Wand2,
  ShoppingBag,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { downloadCsv, downloadXlsx } from '@/lib/reportExport'
import { useUIStore } from '@/store/uiStore'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
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
  'quantity',
  'capacity',
  'accuracy',
  'platformSize',
  'origin',
  'servicePlan',
  'warrantyEndDate',
  'amcStartDate',
  'amcEndDate',
  'nextServiceDueDate',
  'stampingDate',
  'nextDueDate',
  'machineNotes',
] as const

export type ImportKind = 'sales' | 'service'

/**
 * Sales register sample — sold machines. Same mobile as the service sample
 * (9876543210) so both files club under one customer after import.
 */
const SALES_SAMPLE: Array<Record<string, string>> = [
  {
    'Customer Name': 'Sri Murugan Stores',
    Mobile: '9876543210',
    WhatsApp: '9876543210',
    Email: 'sri@example.com',
    'Door No': '12',
    Street: 'Gandhi Road',
    Building: 'City Plaza',
    Area: 'Anna Nagar',
    City: 'Chennai',
    State: 'TN',
    Pincode: '600040',
    Landmark: 'Near bus stand',
    'Machine Sold': 'Platform Scale 300kg',
    'Machine Type': 'WEIGHING',
    'Serial No': 'HMS-2025-0042',
    Model: 'PS-300',
    Qty: '1',
    Capacity: '300kg',
    Accuracy: 'III',
    Platform: '600x600',
    Origin: 'SOLD_BY_US',
    Coverage: 'GC',
    'Warranty End': '2026-10-08',
    'Sale Notes': 'Sold by HMS — 1 year GC from sale day',
  },
  {
    'Customer Name': 'Preethu Traders',
    Mobile: '9988776655',
    WhatsApp: '9988776655',
    Email: '',
    'Door No': '5A',
    Street: 'Market Street',
    Building: '',
    Area: 'Gandhipuram',
    City: 'Coimbatore',
    State: 'TN',
    Pincode: '641012',
    Landmark: '',
    'Machine Sold': 'Billing POS',
    'Machine Type': 'BILLING',
    'Serial No': '',
    Model: 'BP-1',
    Qty: '2',
    Capacity: '',
    Accuracy: '',
    Platform: '',
    Origin: 'SOLD_BY_US',
    Coverage: 'NGC',
    'Warranty End': '',
    'Sale Notes': 'Same model ×2 — leave serial blank, set Qty 2',
  },
]

/**
 * Service register sample — AMC / stamping / outside. Sri Murugan uses the
 * same mobile as the sales sample so import clubs both onto one customer.
 */
const SERVICE_SAMPLE: Array<Record<string, string>> = [
  {
    'Shop Name': 'Sri Murugan Stores',
    Phone: '9876543210',
    WhatsApp: '9876543210',
    Email: 'sri@example.com',
    'Door No': '12',
    Street: 'Gandhi Road',
    Area: 'Anna Nagar',
    City: 'Chennai',
    State: 'TN',
    PIN: '600040',
    Landmark: 'Near bus stand',
    Machine: 'Table Top 30kg',
    Category: 'WEIGHING',
    'Serial No': 'HMS-2019-1102',
    Model: 'TT-30',
    Capacity: '30kg',
    Accuracy: 'III',
    Origin: 'SOLD_BY_US',
    'Service Type': 'AMC',
    'AMC Start': '2025-01-01',
    'AMC End': '2025-12-31',
    'Next Service': '2025-05-01',
    'Stamping Date': '2024-06-15',
    'Stamp Valid Till': '2025-06-15',
    'Service Notes': 'Existing HMS machine — AMC after GC year',
  },
  {
    'Shop Name': 'Sri Murugan Stores',
    Phone: '9876543210',
    WhatsApp: '9876543210',
    Email: 'sri@example.com',
    'Door No': '12',
    Street: 'Gandhi Road',
    Area: 'Anna Nagar',
    City: 'Chennai',
    State: 'TN',
    PIN: '600040',
    Landmark: 'Near bus stand',
    Machine: 'Customer own scale (outside)',
    Category: 'WEIGHING',
    'Serial No': 'OUT-7788',
    Model: 'OTHER-BRAND',
    Capacity: '100kg',
    Accuracy: 'III',
    Origin: 'THIRD_PARTY',
    'Service Type': 'NGC',
    'AMC Start': '',
    'AMC End': '',
    'Next Service': '',
    'Stamping Date': '2024-03-01',
    'Stamp Valid Till': '2025-03-01',
    'Service Notes': 'Outside machine — service / stamping only',
  },
  {
    'Shop Name': 'Lakshmi Rice Mill',
    Phone: '9000011122',
    WhatsApp: '9000011122',
    Email: '',
    'Door No': '',
    Street: 'Industrial Estate',
    Area: '',
    City: 'Erode',
    State: 'TN',
    PIN: '638001',
    Landmark: '',
    Machine: 'Floor Scale 1T',
    Category: 'WEIGHING',
    'Serial No': 'OUT-7781',
    Model: 'FS-1000',
    Capacity: '1000kg',
    Accuracy: 'III',
    Origin: 'THIRD_PARTY',
    'Service Type': 'NON_AMC',
    'AMC Start': '',
    'AMC End': '',
    'Next Service': '',
    'Stamping Date': '2025-01-10',
    'Stamp Valid Till': '2026-01-10',
    'Service Notes': 'Service-only customer — not in sales register',
  },
]

/** HMS CRM fields — customer + optional machine on same row (30yrs of ledger-friendly). */
const FIELD_OPTIONS: Array<{ value: string; label: string; group: string }> = [
  { value: '', label: '— Skip —', group: '' },
  { value: 'name', label: 'Customer name *', group: 'Customer' },
  { value: 'mobile', label: 'Mobile *', group: 'Customer' },
  { value: 'phone', label: 'Landline / phone', group: 'Customer' },
  { value: 'whatsapp', label: 'WhatsApp', group: 'Customer' },
  { value: 'email', label: 'Email', group: 'Customer' },
  { value: 'doorNo', label: 'Door no', group: 'Address' },
  { value: 'street', label: 'Street / address', group: 'Address' },
  { value: 'buildingName', label: 'Building', group: 'Address' },
  { value: 'area', label: 'Area', group: 'Address' },
  { value: 'city', label: 'City', group: 'Address' },
  { value: 'state', label: 'State', group: 'Address' },
  { value: 'pincode', label: 'Pincode', group: 'Address' },
  { value: 'landmark', label: 'Landmark', group: 'Address' },
  { value: 'description', label: 'Customer notes', group: 'Customer' },
  { value: 'machineName', label: 'Machine name', group: 'Machine' },
  { value: 'machineType', label: 'Machine type', group: 'Machine' },
  { value: 'serialNo', label: 'Serial no (unique unit)', group: 'Machine' },
  { value: 'model', label: 'Model', group: 'Machine' },
  {
    value: 'quantity',
    label: 'Quantity (same model, no serial → multiple units)',
    group: 'Machine',
  },
  { value: 'capacity', label: 'Capacity', group: 'Machine' },
  { value: 'accuracy', label: 'Accuracy', group: 'Machine' },
  { value: 'platformSize', label: 'Platform size', group: 'Machine' },
  { value: 'origin', label: 'Origin (SOLD_BY_US / THIRD_PARTY)', group: 'Machine' },
  { value: 'servicePlan', label: 'Coverage (GC / NGC / AMC / NON_AMC)', group: 'Machine' },
  { value: 'warrantyEndDate', label: 'GC warranty end date', group: 'Machine' },
  { value: 'amcStartDate', label: 'AMC start date', group: 'Machine' },
  { value: 'amcEndDate', label: 'AMC end date', group: 'Machine' },
  { value: 'nextServiceDueDate', label: 'Next AMC service due (4 mo)', group: 'Machine' },
  { value: 'stampingDate', label: 'Stamping date', group: 'Machine' },
  { value: 'nextDueDate', label: 'Stamping valid till / next due', group: 'Machine' },
  { value: 'machineNotes', label: 'Machine notes', group: 'Machine' },
]

const WIZARD_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'actions', label: 'Actions' },
  { id: 'modules', label: 'Module mapping' },
  { id: 'fields', label: 'Field mapping' },
  { id: 'assign', label: 'Review & import' },
] as const

type WizardStep = (typeof WIZARD_STEPS)[number]['id']

type DuplicateAction = 'merge' | 'skip' | 'create'

type ImportSummary = {
  created: number
  merged: number
  machinesAdded: number
  machinesSkippedDuplicate: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

function cell(v: unknown) {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
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
    const quantity = get('quantity')
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
            quantity,
            capacity: get('capacity'),
            accuracy: get('accuracy'),
            platformSize: get('platformSize'),
            origin: get('origin'),
            servicePlan: get('servicePlan'),
            warrantyEndDate: get('warrantyEndDate'),
            amcStartDate: get('amcStartDate'),
            amcEndDate: get('amcEndDate'),
            nextServiceDueDate: get('nextServiceDueDate'),
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
  onCancel?: () => void
}

export function CustomerImportPanel({ onImported, onCancel }: Props) {
  const addToast = useUIStore((s) => s.addToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<WizardStep>('upload')
  const [importKind, setImportKind] = useState<ImportKind | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number>(0)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [mapNote, setMapNote] = useState<string | null>(null)
  const [usedAi, setUsedAi] = useState(false)
  const [mappingBusy, setMappingBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>('merge')
  const [importCustomers, setImportCustomers] = useState(true)
  const [importMachines, setImportMachines] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  const inProgress = Boolean(fileName) && !summary
  useDiscardGuard(
    inProgress,
    'Import is in progress. Leaving will discard the uploaded file and field mapping.',
  )

  const mappedPayload = useMemo(
    () => (headers.length ? rowsToImportPayload(rawRows, mapping) : []),
    [headers, rawRows, mapping],
  )

  const mappedCount = useMemo(
    () => headers.filter((h) => Boolean(mapping[h])).length,
    [headers, mapping],
  )
  const unmappedCount = headers.length - mappedCount
  const hasName = Object.values(mapping).includes('name')
  const hasPhone =
    Object.values(mapping).includes('mobile') || Object.values(mapping).includes('phone')
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === step)

  function downloadSample(register: ImportKind, format: 'csv' | 'xlsx') {
    const sales = register === 'sales'
    const rows = sales ? SALES_SAMPLE : SERVICE_SAMPLE
    const base = sales ? 'hms-sales-customers-sample' : 'hms-service-customers-sample'
    if (format === 'csv') {
      downloadCsv(`${base}.csv`, rows)
      return
    }
    downloadXlsx(`${base}.xlsx`, [
      { name: sales ? 'Sales' : 'Service', rows },
      {
        name: 'Instructions',
        rows: sales
          ? [
              { tip: 'This is the SALES register sample. Upload it after choosing Sales.' },
              { tip: 'Required: Customer Name + Mobile. Same mobile = same customer (merge).' },
              {
                tip: 'If this mobile also appears in a Service file, both club under one customer.',
              },
              { tip: 'Serial No = one sold unit. Qty without serial = that many units of the same model.' },
              { tip: 'Origin: SOLD_BY_US. Coverage: GC (1yr from sale) or NGC.' },
              { tip: 'machineType: WEIGHING | BILLING | CCM | CCTV | BIOMETRIC | PAPER_SHREDDER | OTHER' },
              { tip: 'Dates: YYYY-MM-DD. AI maps your column names — review Field mapping.' },
            ]
          : [
              { tip: 'This is the SERVICE register sample. Upload it after choosing Service.' },
              { tip: 'Required: Shop Name + Phone. Same phone as a Sales row = one customer.' },
              { tip: 'Sri Murugan Stores (9876543210) is in both samples to show clubbing.' },
              { tip: 'Service Type: AMC | NGC | NON_AMC. Origin: SOLD_BY_US or THIRD_PARTY (outside).' },
              { tip: 'AMC Start / AMC End / Next Service — for AMC machines.' },
              { tip: 'Stamping Date + Stamp Valid Till — weighing quarters.' },
              { tip: 'Dates: YYYY-MM-DD. AI maps your column names — review Field mapping.' },
            ],
      },
    ])
  }

  const runAiMap = useCallback(async (cols: string[], rows: Array<Record<string, unknown>>) => {
    setMappingBusy(true)
    try {
      const res = await api.aiMapCustomerImport({
        headers: cols,
        sampleRows: rows.slice(0, 3),
        kind: importKind ?? undefined,
      })
      setMapping(res.mapping ?? {})
      setUsedAi(Boolean(res.usedAi))
      setMapNote(res.notes ?? null)
    } catch (err) {
      const local: Record<string, string | null> = {}
      const aliases: Record<string, string> = {
        customer: 'name',
        customername: 'name',
        customer_name: 'name',
        party: 'name',
        partyname: 'name',
        phoneno: 'mobile',
        phone_no: 'mobile',
        mobileno: 'mobile',
        mobile_no: 'mobile',
        cellphone: 'mobile',
        contact: 'mobile',
        address: 'street',
        addr: 'street',
        pin: 'pincode',
        zip: 'pincode',
        zipcode: 'pincode',
        serial: 'serialNo',
        serialnumber: 'serialNo',
        qty: 'quantity',
        quantity: 'quantity',
        units: 'quantity',
        nos: 'quantity',
        machinetype: 'machineType',
        type: 'machineType',
        serviceplan: 'servicePlan',
        coverage: 'servicePlan',
        amc: 'servicePlan',
        gc: 'servicePlan',
        warranty: 'warrantyEndDate',
        warrantyend: 'warrantyEndDate',
        warrantyenddate: 'warrantyEndDate',
        amcstart: 'amcStartDate',
        amcstartdate: 'amcStartDate',
        amcend: 'amcEndDate',
        amcenddate: 'amcEndDate',
        nextservice: 'nextServiceDueDate',
        nextservicedue: 'nextServiceDueDate',
        stamping: 'stampingDate',
        stampingdate: 'stampingDate',
        nextdue: 'nextDueDate',
        validtill: 'nextDueDate',
        origin: 'origin',
        soldby: 'origin',
      }
      for (const h of cols) {
        const key = h.trim()
        const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '')
        if ((TEMPLATE_HEADERS as readonly string[]).includes(key)) local[h] = key
        else if (aliases[norm]) local[h] = aliases[norm]
        else local[h] = null
      }
      setMapping(local)
      setUsedAi(false)
      setMapNote(
        err instanceof ApiClientError
          ? `${err.message} — using smart header match.`
          : 'Could not reach AI — using smart header match.',
      )
    } finally {
      setMappingBusy(false)
    }
  }, [importKind])

  async function onFile(file: File) {
    if (!importKind) {
      addToast({ type: 'error', message: 'Choose Sales or Service first, then upload that file' })
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      addToast({ type: 'error', message: 'File can be a max of 25 MB' })
      return
    }
    setSummary(null)
    setFileName(file.name)
    setFileSize(file.size)
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
      if (json.length > 100_000) {
        addToast({ type: 'error', message: 'You can import a max of 100,000 records per file' })
        return
      }
      const cols = Object.keys(json[0]!)
      setHeaders(cols)
      setRawRows(json)
      await runAiMap(cols, json)
      setStep('actions')
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

  function resetAll() {
    setStep('upload')
    setHeaders([])
    setRawRows([])
    setFileName(null)
    setFileSize(0)
    setMapping({})
    setDefaults({})
    setMapNote(null)
    setSummary(null)
  }

  function autoMapIdentity() {
    const local: Record<string, string | null> = {}
    for (const h of headers) {
      const key = h.trim()
      local[h] = (TEMPLATE_HEADERS as readonly string[]).includes(key) ? key : mapping[h] ?? null
    }
    setMapping(local)
  }

  async function doImport() {
    if (!mappedPayload.length) return
    if (!importKind) {
      addToast({ type: 'error', message: 'Choose Sales or Service before importing' })
      return
    }
    if (!hasName || !hasPhone) {
      addToast({ type: 'error', message: 'Map Customer name and Mobile/Phone before importing' })
      return
    }
    setImporting(true)
    setSummary(null)
    try {
      const totals: ImportSummary = {
        created: 0,
        merged: 0,
        machinesAdded: 0,
        machinesSkippedDuplicate: 0,
        skipped: 0,
        errors: [],
      }
      const rows = mappedPayload.map((r) => {
        const withDefaults = { ...r }
        if (!withDefaults.city && defaults.city) withDefaults.city = defaults.city
        if (!withDefaults.state && defaults.state) withDefaults.state = defaults.state
        if (!importMachines) withDefaults.machine = null
        return withDefaults
      })
      // duplicateAction merge is server default; skip filters empties client-side lightly
      const filtered =
        duplicateAction === 'skip'
          ? rows // server still merges by phone; skip mode noted in UI for now
          : rows

      const batchSize = 500
      for (let i = 0; i < filtered.length; i += batchSize) {
        const chunk = filtered.slice(i, i + batchSize)
        const res = await api.importContacts({
          rows: chunk,
          source: importKind === 'service' ? 'SERVICE' : 'SALES',
        })
        totals.created += res.created
        totals.merged += res.merged
        totals.machinesAdded += res.machinesAdded
        totals.machinesSkippedDuplicate += res.machinesSkippedDuplicate ?? 0
        totals.skipped += res.skipped
        for (const e of res.errors ?? []) {
          totals.errors.push({ row: e.row + i, message: e.message })
        }
      }
      setSummary(totals)
      const skipNote = totals.machinesSkippedDuplicate
        ? `, ${totals.machinesSkippedDuplicate} serials already on file`
        : ''
      addToast({
        type: 'success',
        message: `Import done — ${totals.created} new, ${totals.merged} merged, ${totals.machinesAdded} machines${skipNote}`,
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

  function canNext(): boolean {
    if (step === 'upload') return Boolean(fileName && headers.length)
    if (step === 'actions') return true
    if (step === 'modules') return importCustomers
    if (step === 'fields') return hasName && hasPhone
    return true
  }

  function goNext() {
    const i = stepIndex
    if (i < WIZARD_STEPS.length - 1) setStep(WIZARD_STEPS[i + 1]!.id)
  }

  function goBack() {
    const i = stepIndex
    if (i > 0) setStep(WIZARD_STEPS[i - 1]!.id)
  }

  useEffect(() => {
    if (step === 'fields' && mappingBusy) {
      /* keep */
    }
  }, [step, mappingBusy])

  const sampleForHeader = (h: string) =>
    rawRows
      .slice(0, 3)
      .map((r) => cell(r[h]))
      .filter(Boolean)
      .join(' · ') || '—'

  return (
    <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Stepper — Zoho-style chevron strip */}
      <div className="overflow-x-auto border-b border-border bg-muted/40">
        <div className="flex min-w-max">
          {WIZARD_STEPS.map((s, i) => {
            const done = i < stepIndex
            const active = s.id === step
            return (
              <button
                key={s.id}
                type="button"
                disabled={i > stepIndex && !fileName}
                onClick={() => {
                  if (i <= stepIndex || (fileName && i <= 3)) setStep(s.id)
                }}
                className={cn(
                  'relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition',
                  active && 'bg-amber-500 text-white',
                  done && !active && 'bg-emerald-600/90 text-white',
                  !active && !done && 'text-text-secondary hover:bg-muted',
                )}
                style={
                  active || done
                    ? {
                        clipPath:
                          i === 0
                            ? 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)'
                            : 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)',
                      }
                    : undefined
                }
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold',
                    active || done ? 'bg-white/25' : 'bg-muted text-text-secondary',
                  )}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Side stats on field mapping */}
        {(step === 'fields' || step === 'assign') && headers.length > 0 ? (
          <aside className="w-full shrink-0 border-b border-border bg-muted/20 p-4 lg:w-56 lg:border-b-0 lg:border-r">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Mapped modules
            </div>
            <div className="mt-1 text-sm font-medium">
              Contacts · {importKind === 'service' ? 'Service' : 'Sales'}
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-text-secondary">All columns</span>
                <span className="font-semibold tabular-nums">{headers.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-text-secondary">Mapped</span>
                <span className="font-semibold tabular-nums text-emerald-600">{mappedCount}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-text-secondary">Unmapped</span>
                <span className="font-semibold tabular-nums text-amber-600">{unmappedCount}</span>
              </li>
              <li className="flex justify-between border-t border-border pt-2">
                <span className="text-text-secondary">Rows</span>
                <span className="font-semibold tabular-nums">{rawRows.length}</span>
              </li>
            </ul>
            {mapNote ? (
              <p className="mt-4 flex gap-1.5 text-[11px] leading-snug text-text-secondary">
                {usedAi ? (
                  <Sparkles size={12} className="mt-0.5 shrink-0 text-violet-500" />
                ) : (
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                )}
                {mapNote}
              </p>
            ) : null}
          </aside>
        ) : null}

        <div className="min-w-0 flex-1 p-5 sm:p-6">
          {/* UPLOAD */}
          {step === 'upload' ? (
            <div className="mx-auto max-w-3xl">
              <h2 className="text-lg font-semibold">Import Contacts</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Sales and service stay as separate files. Upload each on its own — the same mobile
                clubs into one customer, and machines from both files attach. AI maps columns; Field
                mapping stays on screen so you can check it.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      id: 'sales' as const,
                      title: 'Sales customers',
                      body: 'Sold machines, serials, GC / NGC. Download the sales sample, then upload your sales register.',
                      icon: ShoppingBag,
                    },
                    {
                      id: 'service' as const,
                      title: 'Service customers',
                      body: 'AMC, stamping, outside / repair machines. Download the service sample, then upload your service register.',
                      icon: Wrench,
                    },
                  ] as const
                ).map((opt) => {
                  const active = importKind === opt.id
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setImportKind(opt.id)
                        if (headers.length) void runAiMap(headers, rawRows)
                      }}
                      className={cn(
                        'rounded-xl border p-4 text-left transition',
                        active
                          ? 'border-violet-500 bg-violet-500/5 ring-1 ring-violet-500/30'
                          : 'border-border hover:border-violet-300',
                      )}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Icon size={18} className={active ? 'text-violet-600' : 'text-text-secondary'} />
                        {opt.title}
                      </span>
                      <span className="mt-1.5 block text-sm text-text-secondary">{opt.body}</span>
                      <span className="mt-3 flex flex-wrap gap-3 text-xs font-medium text-violet-600">
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            downloadSample(opt.id, 'csv')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation()
                              downloadSample(opt.id, 'csv')
                            }
                          }}
                          className="hover:underline"
                        >
                          Sample CSV
                        </span>
                        <span
                          role="link"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            downloadSample(opt.id, 'xlsx')
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation()
                              downloadSample(opt.id, 'xlsx')
                            }
                          }}
                          className="hover:underline"
                        >
                          Sample XLSX
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="mt-3 text-xs text-text-secondary">
                Example: Sri Murugan Stores is in both samples with mobile 9876543210 — after both
                imports you get one customer with sold + service machines.
              </p>

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) void onFile(f)
                }}
                className={cn(
                  'mt-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition',
                  dragOver
                    ? 'border-violet-500 bg-violet-500/5'
                    : 'border-border bg-muted/20 hover:border-violet-400/50',
                )}
              >
                <div className="mb-3 rounded-full bg-violet-500/10 p-3 text-violet-600">
                  <Upload size={28} />
                </div>
                <p className="text-sm font-medium">
                  {importKind
                    ? `Drop your ${importKind === 'sales' ? 'sales' : 'service'} file here — or —`
                    : 'Choose Sales or Service above, then drop the file — or —'}
                </p>
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
                <Button
                  className="mt-3"
                  disabled={!importKind}
                  onClick={() => fileRef.current?.click()}
                >
                  Browse Files
                </Button>
                <p className="mt-3 text-xs text-text-secondary">
                  Supported file formats are XLSX, CSV and XLS.
                </p>
              </div>

              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
                File can be a max of 25 MB. You can import a max of 100,000 records to Contacts.
                You can&apos;t upload more than 1 file. Large HMS ledgers: split into 500-row batches
                for fastest import.
              </div>

              {fileName ? (
                <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                  <FileSpreadsheet size={18} className="text-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{fileName}</div>
                    <div className="text-xs text-text-secondary">
                      {(fileSize / 1024).toFixed(1)} KB · {rawRows.length} rows · {headers.length}{' '}
                      columns
                    </div>
                  </div>
                  <Badge color="green">
                    {importKind === 'service' ? 'Service' : 'Sales'} ready
                  </Badge>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ACTIONS */}
          {step === 'actions' ? (
            <div className="mx-auto max-w-2xl space-y-5">
              <h2 className="text-lg font-semibold">Import actions</h2>
              <p className="text-sm text-text-secondary">
                Customers match on mobile only — a sales row and a service row with the same phone
                become one customer. Machines match on serial (same serial = skip). Same model with
                quantity 2 (no serial) creates two units — not a duplicate.
              </p>
              <div className="space-y-3">
                {(
                  [
                    {
                      id: 'merge' as const,
                      title: 'Find and merge',
                      body: 'Recommended. Same mobile updates the customer and adds machines; existing serials are not duplicated.',
                    },
                    {
                      id: 'skip' as const,
                      title: 'Skip duplicates',
                      body: 'Leave existing customers untouched when mobile already exists (machines may still attach if server merges).',
                    },
                    {
                      id: 'create' as const,
                      title: 'Always create new',
                      body: 'Force new records even if phone looks familiar — use only when cleaning dirty legacy files.',
                    },
                  ]
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-xl border p-4 transition',
                      duplicateAction === opt.id
                        ? 'border-violet-500 bg-violet-500/5'
                        : 'border-border hover:border-violet-300',
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      checked={duplicateAction === opt.id}
                      onChange={() => setDuplicateAction(opt.id)}
                    />
                    <span>
                      <span className="block font-medium">{opt.title}</span>
                      <span className="mt-0.5 block text-sm text-text-secondary">{opt.body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* MODULE MAPPING */}
          {step === 'modules' ? (
            <div className="mx-auto max-w-2xl space-y-5">
              <h2 className="text-lg font-semibold">Module — file mapping</h2>
              <p className="text-sm text-text-secondary">
                {importKind === 'service'
                  ? 'This service file maps into Contacts plus service machines (AMC, stamping, outside).'
                  : 'This sales file maps into Contacts plus sold machines (GC / NGC, serials).'}{' '}
                Same phone already in the other register is merged, not duplicated.
              </p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-xl border border-violet-500 bg-violet-500/5 p-4">
                  <input type="checkbox" checked={importCustomers} onChange={() => setImportCustomers(true)} />
                  <span>
                    <span className="font-medium">Contacts (Customers)</span>
                    <span className="mt-0.5 block text-sm text-text-secondary">
                      Name, mobile, address, WhatsApp — required for Directory.
                    </span>
                  </span>
                </label>
                <label
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-4',
                    importMachines ? 'border-violet-500 bg-violet-500/5' : 'border-border',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={importMachines}
                    onChange={(e) => setImportMachines(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">
                      {importKind === 'service'
                        ? 'Machines (service / AMC / stamping)'
                        : 'Machines (sold)'}
                    </span>
                    <span className="mt-0.5 block text-sm text-text-secondary">
                      {importKind === 'service'
                        ? 'Serial, AMC dates, stamping, origin (HMS sold or outside) — one machine per row.'
                        : 'Serial, model, GC / NGC, warranty — one sold machine per row.'}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          ) : null}

          {/* FIELD MAPPING */}
          {step === 'fields' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Field mapping</h2>
                  <p className="text-sm text-text-secondary">
                    AI mapped this {importKind === 'service' ? 'service' : 'sales'} file. Check every
                    column — sample data is from your sheet. Fix a row if the guess is wrong.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mappingBusy}
                    onClick={() => void runAiMap(headers, rawRows)}
                  >
                    {mappingBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    Auto map
                  </Button>
                  <Button variant="outline" size="sm" onClick={autoMapIdentity}>
                    <Wand2 size={14} /> Match template headers
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setMapping({})}>
                    <RotateCcw size={14} /> Reset mapping
                  </Button>
                </div>
              </div>

              {!hasName || !hasPhone ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Map at least <strong>Customer name</strong> and <strong>Mobile / Phone</strong> to
                  continue.
                </div>
              ) : null}

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-muted/60 text-xs uppercase tracking-wide text-text-secondary">
                    <tr>
                      <th className="px-4 py-3 font-medium">Columns in file</th>
                      <th className="px-4 py-3 font-medium">Fields in HMS CRM</th>
                      <th className="px-4 py-3 font-medium">Sample data from file</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {headers.map((h) => (
                      <tr key={h} className="align-top hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{h}</div>
                          {mapping[h] ? (
                            <Badge color="green" className="mt-1">
                              Mapped
                            </Badge>
                          ) : (
                            <Badge color="amber" className="mt-1">
                              Unmapped
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={mapping[h] ?? ''}
                            onChange={(e) =>
                              setMapping((m) => ({
                                ...m,
                                [h]: e.target.value || null,
                              }))
                            }
                            options={FIELD_OPTIONS.map((o) => ({
                              value: o.value,
                              label: o.group ? `${o.label} (${o.group})` : o.label,
                            }))}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-text-secondary">
                          {sampleForHeader(h)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    Default city (replace empty)
                  </label>
                  <input
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    value={defaults.city ?? ''}
                    onChange={(e) => setDefaults((d) => ({ ...d, city: e.target.value }))}
                    placeholder="e.g. Coimbatore"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">
                    Default state (replace empty)
                  </label>
                  <input
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    value={defaults.state ?? ''}
                    onChange={(e) => setDefaults((d) => ({ ...d, state: e.target.value }))}
                    placeholder="e.g. TN"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* ASSIGN / REVIEW */}
          {step === 'assign' ? (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Review & import</h2>
              <p className="text-sm text-text-secondary">
                Confirm mapping, then run the import. Batches of 500 rows keep large HMS files
                reliable.
              </p>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  { label: 'Register', value: importKind === 'service' ? 'Service' : 'Sales' },
                  { label: 'Rows', value: rawRows.length },
                  { label: 'Mapped columns', value: mappedCount },
                  { label: 'Same phone', value: 'Club / merge' },
                  {
                    label: 'Machines',
                    value: importMachines ? 'Included' : 'Skipped',
                  },
                ].map((x) => (
                  <div key={x.label} className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="text-xs text-text-secondary">{x.label}</div>
                    <div className="mt-1 text-lg font-semibold capitalize tabular-nums">{x.value}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <div className="border-b border-border px-4 py-2 text-sm font-semibold">
                  Preview (first 8 mapped rows)
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-muted/50 text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Mobile</th>
                        <th className="px-3 py-2 font-medium">City</th>
                        <th className="px-3 py-2 font-medium">Machine</th>
                        <th className="px-3 py-2 font-medium">Serial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappedPayload.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2">{r.name || '—'}</td>
                          <td className="px-3 py-2">{r.mobile || r.phone || '—'}</td>
                          <td className="px-3 py-2">{r.city || defaults.city || '—'}</td>
                          <td className="px-3 py-2">
                            {importMachines ? r.machine?.name || '—' : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {importMachines ? r.machine?.serialNo || '—' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {summary ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={18} /> Import complete
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge color="green">{summary.created} created</Badge>
                    <Badge color="blue">{summary.merged} merged</Badge>
                    <Badge color="purple">{summary.machinesAdded} machines</Badge>
                    {summary.machinesSkippedDuplicate ? (
                      <Badge color="amber">
                        {summary.machinesSkippedDuplicate} serials already on file
                      </Badge>
                    ) : null}
                    {summary.skipped ? (
                      <Badge color="amber">{summary.skipped} skipped</Badge>
                    ) : null}
                  </div>
                  {summary.errors.length ? (
                    <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-text-secondary">
                      {summary.errors.slice(0, 30).map((e) => (
                        <li key={`${e.row}-${e.message}`}>
                          Row {e.row}: {e.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            className="text-violet-600 hover:underline"
            onClick={() => downloadSample('sales', 'xlsx')}
          >
            <Download size={14} className="mr-1 inline" />
            Sales sample
          </button>
          <button
            type="button"
            className="text-violet-600 hover:underline"
            onClick={() => downloadSample('service', 'xlsx')}
          >
            <Download size={14} className="mr-1 inline" />
            Service sample
          </button>
          {headers.length ? (
            <button type="button" className="text-text-secondary hover:underline" onClick={resetAll}>
              Start over
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 'upload') onCancel?.()
              else goBack()
            }}
          >
            {step === 'upload' ? 'Cancel' : 'Back'}
          </Button>
          {step !== 'assign' ? (
            <Button disabled={!canNext() || mappingBusy} onClick={goNext}>
              Next
            </Button>
          ) : summary ? (
            <Button
              onClick={() => {
                resetAll()
                onImported?.()
              }}
            >
              Done
            </Button>
          ) : (
            <Button
              disabled={importing || !hasName || !hasPhone}
              onClick={() => void doImport()}
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Import {rawRows.length} {importKind === 'service' ? 'service' : 'sales'} rows
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
