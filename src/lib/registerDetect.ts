/**
 * Read HMS's hand-made Excel registers — whatever the year's layout — and turn every sheet into clean
 * sales or service rows.
 *
 * Headers can't be trusted (columns shift, some have no header, some sheets have none at all), so each
 * column is recognised by what is IN it: dates, HMS IDs (26C0874 / B19M1118), phone numbers, GC/NGC/AMC,
 * amounts, payment notes ("C-6/10/2026", "OFFICE GPAY"), service numbers. Staff can still change any
 * column's role before importing.
 */

export type Kind = 'SALES' | 'SERVICE'
export type SalesRole =
  | 'date'
  | 'productId'
  | 'hmsId'
  | 'brand'
  | 'model'
  | 'spec'
  | 'customer'
  | 'address'
  | 'phone'
  | 'executive'
  | 'amount'
  | 'dcNo'
  | 'altPhone'
  | 'area'
  | 'industry'
  | 'deliveredBy'
  | 'stampingDate'
  | 'ignore'
export type ServiceRole =
  | 'productId'
  | 'hmsId'
  | 'work'
  | 'date'
  | 'customer'
  | 'coverage'
  | 'amount'
  | 'received'
  | 'balance'
  | 'paymentNote'
  | 'serviceNo'
  | 'phone'
  | 'area'
  | 'engineer'
  | 'status'
  | 'spares'
  | 'paymentMode'
  | 'machine'
  | 'ignore'
export type Role = SalesRole | ServiceRole

export const SALES_ROLES: Array<{ value: SalesRole; label: string }> = [
  { value: 'date', label: 'Sale date' },
  { value: 'productId', label: 'Product ID' },
  { value: 'hmsId', label: 'HMS ID' },
  { value: 'brand', label: 'Brand' },
  { value: 'model', label: 'Model' },
  { value: 'spec', label: 'Serial / size' },
  { value: 'customer', label: 'Customer name' },
  { value: 'address', label: 'Address' },
  { value: 'phone', label: 'Phone' },
  { value: 'executive', label: 'Sales executive' },
  { value: 'amount', label: 'Amount' },
  { value: 'dcNo', label: 'DC / Invoice no.' },
  { value: 'altPhone', label: 'Alternate phone' },
  { value: 'area', label: 'Area' },
  { value: 'industry', label: 'Industry' },
  { value: 'deliveredBy', label: 'Delivered by' },
  { value: 'stampingDate', label: 'Stamping date' },
  { value: 'ignore', label: '— not used —' },
]
export const SERVICE_ROLES: Array<{ value: ServiceRole; label: string }> = [
  { value: 'work', label: 'Work done' },
  { value: 'date', label: 'Date' },
  { value: 'customer', label: 'Customer name' },
  { value: 'coverage', label: 'GC / NGC / AMC' },
  { value: 'amount', label: 'Amount' },
  { value: 'received', label: 'Received' },
  { value: 'balance', label: 'Balance' },
  { value: 'paymentNote', label: 'Payment note' },
  { value: 'serviceNo', label: 'HMS service no.' },
  { value: 'productId', label: 'Product ID (machine)' },
  { value: 'hmsId', label: 'HMS ID (machine)' },
  { value: 'phone', label: 'Phone' },
  { value: 'area', label: 'Area' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'status', label: 'Status' },
  { value: 'spares', label: 'Spares used' },
  { value: 'paymentMode', label: 'Payment mode' },
  { value: 'machine', label: 'Machine (as written)' },
  { value: 'ignore', label: '— not used —' },
]

export type SheetPlan = {
  name: string
  kind: Kind
  rows: unknown[][]
  dataRows: number[] // indexes of rows that hold a record
  roles: Role[] // one per column
  industry: string
  /** Service sheets without an engineer column: the sheet is one engineer's register */
  engineerFromSheet: boolean
  include: boolean
  /** Kept although a combined sheet has the same records (it has more columns) */
  keepWithCombined?: boolean
  /** Staff changed the column roles — read by columns instead of row by row */
  manualColumns?: boolean
  note?: string
  samples: string[][] // up to 4 values per column, for the mapping table
}

export type SalesOut = {
  ref: string
  date: string | null
  /** Set when the date was corrected from, or disagrees with, the sheet's month heading */
  dateNote?: string | null
  hmsId: string | null
  /** Product ID written in the sheet (HMS-012) — exact product */
  productCode: string | null
  brand: string | null
  model: string | null
  spec: string | null
  customer: string | null
  address: string | null
  phones: string[]
  executive: string | null
  amount: number | null
  industry: string | null
  dcNo?: string | null
  area?: string | null
  deliveredBy?: string | null
  stampingDate?: string | null
}
export type ServiceOut = {
  ref: string
  date: string | null
  dateNote?: string | null
  work: string | null
  customer: string | null
  coverage: string | null
  amount: number | null
  received: number | null
  balance: number | null
  paymentNote: string | null
  serviceNo: string | null
  /** Machine serviced: Product ID and / or HMS ID when the sheet has them */
  productCode: string | null
  hmsId: string | null
  phones: string[]
  area: string | null
  engineer: string | null
  industry: string | null
  status?: string | null
  spares?: string | null
  paymentMode?: string | null
  /** Machine written loosely in the register ("HMS 2T", "JUNIOR STAR") — matched on the server */
  machine?: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

export function cellText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return parseDate(v) ?? ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return String(v).replace(/\s+/g, ' ').trim()
}

/** Day-first dates as HMS writes them: 3.1.2020, 30/12/2020, 03-10-20, Excel dates and serials. */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel dates arrive a few seconds before local midnight — round to the nearest day
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    const y = d.getFullYear()
    return y >= 2000 && y <= 2100 ? `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null
  }
  if (typeof v === 'number' && v > 36000 && v < 60000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = cellText(v)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})$/.exec(s)
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!
    return valid(y, +m[2]!, +m[1]!)
  }
  return null
}
function valid(y: number, mo: number, d: number) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

// 2019–2020 tags used letters past L too (B19M1118); 2026 uses A–L
const HMS_ID = /^B?\d{2}[A-Z]\d{3,5}$/i
/** NovaCRM Product ID: brand code + number (HMS-012, IMN-004) */
const PRODUCT_CODE = /^[A-Z]{3}-\d{3,5}$/i
const isProductCode = (s: string) => PRODUCT_CODE.test(s.replace(/\s+/g, ''))
const isHmsId = (s: string) => HMS_ID.test(s.replace(/\s+/g, ''))
/** At least one 10–12 digit number in the cell ("7358514454/9566289616" counts). */
const isPhone = (s: string) =>
  s
    .split(/[/,;&]|\s{2,}/)
    .some((p) => {
      const d = p.replace(/[\s\-+().]/g, '')
      return /^\d{10,12}$/.test(d)
    })
const isCover = (s: string) => /^(N\.?\s?G\.?\s?C|G\.?\s?C|A\.?\s?M\.?\s?C)$/i.test(s)
const isMoney = (s: string) => /^\d{1,7}(\.\d{1,2})?$/.test(s.replace(/,/g, ''))
const isPayNote = (s: string) => /^C[-\s]?\d|G\s?PAY|PHONE\s?PE|PAYTM|\bUPI\b|CHEQUE|CHQ|NEFT|RTGS|\bCASH\b|ONLINE|RECEIVED/i.test(s)
const isServiceNo = (s: string) => /^\d{4,6}$/.test(s)

export function phonesIn(s: string): string[] {
  return s
    .split(/[/,;&]|\s{2,}/)
    .map((p) => p.replace(/[^\d]/g, ''))
    .filter((d) => d.length >= 8)
}

const KNOWN_BRANDS = [
  'HMS', 'PHOENIX', 'ESSAE', 'POINT', 'SHARP', 'NUKKAD', 'NUKKAD SHOPS', 'RETSOL', 'TVS', 'WEP', 'TSC', 'IMIN', 'SENSIBLE',
  'LADA', 'ASK', 'NGX', 'ECS', 'ANCHOR', 'SMART', 'WENSAR', 'MAXSELL', 'SOFTLAND', 'BIOMAX', 'UROVO', 'BBP', 'CITIZEN',
  'EPSON', 'ZEBRA', 'HONEYWELL', 'ATCOM', 'SUNMI', 'POSIFLEX', 'CASIO', 'AVERY', 'METTLER', 'CAS', 'CONTECH', 'SANSUI',
  'WEIGHING MASTER', 'STONE', 'BILLING', 'CAMERA', 'DVR', 'GODREJ', 'SAMSUNG', 'HP', 'DELL', 'LENOVO', 'HIKVISION', 'CP PLUS',
]

/** Guess whether a sheet is a sales register or a service register from what's in it. */
function guessKind(stats: ColStat[]): Kind {
  const cover = Math.max(0, ...stats.map((c) => c.cover))
  const hms = Math.max(0, ...stats.map((c) => c.hms))
  // GC / NGC / AMC is only written in service registers (which may also carry the machine's HMS ID)
  void hms
  return cover > 0.4 ? 'SERVICE' : 'SALES'
}

type ColStat = {
  i: number
  filled: number // share of data rows with a value
  date: number
  hms: number
  code: number
  phone: number
  cover: number
  money: number
  pay: number
  svcNo: number
  brand: number
  distinct: number // distinct values / filled values
  avgLen: number
  numeric: number
}

function statsFor(rows: unknown[][], dataRows: number[], brands: Set<string>): ColStat[] {
  const width = Math.max(0, ...dataRows.map((r) => rows[r]!.length))
  const out: ColStat[] = []
  for (let i = 0; i < width; i++) {
    const vals = dataRows.map((r) => rows[r]![i]).filter((v) => cellText(v) !== '')
    const n = vals.length || 1
    const texts = vals.map(cellText)
    const share = (f: (v: unknown, s: string) => boolean) => vals.filter((v, k) => f(v, texts[k]!)).length / n
    out.push({
      i,
      filled: vals.length / Math.max(1, dataRows.length),
      date: share((v) => parseDate(v) != null),
      hms: share((_, s) => isHmsId(s)),
      code: share((_, s) => isProductCode(s)),
      phone: share((_, s) => isPhone(s)),
      cover: share((_, s) => isCover(s)),
      money: share((_, s) => isMoney(s) && !isPhone(s)),
      pay: share((_, s) => isPayNote(s)),
      svcNo: share((_, s) => isServiceNo(s)),
      brand: share((_, s) => brands.has(s.toUpperCase())),
      distinct: new Set(texts.map((s) => s.toUpperCase())).size / n,
      avgLen: texts.reduce((a, s) => a + s.length, 0) / n,
      numeric: share((v) => typeof v === 'number'),
    })
  }
  return out
}

/** Rows that hold a record: a readable date plus a few other values. Headers / month titles drop out. */
function findDataRows(rows: unknown[][]) {
  const out: number[] = []
  rows.forEach((r, idx) => {
    const cells = r.map(cellText)
    const filled = cells.filter(Boolean).length
    if (filled < 3) return
    if (cells.some((s) => /^(DATE|HMS NO|CUSTOMER NAME|S\.?NO)$/i.test(s))) return // header row
    // a record: a readable date, or (date left blank) an HMS ID in the first columns
    if (r.some((v) => parseDate(v) != null) || (filled >= 4 && cells.slice(0, 3).some(isHmsId))) out.push(idx)
  })
  return out
}

function pick(stats: ColStat[], used: Set<number>, score: (c: ColStat) => number, min: number) {
  let best: ColStat | null = null
  let bestScore = min
  for (const c of stats) {
    if (used.has(c.i)) continue
    const s = score(c)
    if (s > bestScore) [best, bestScore] = [c, s]
  }
  if (best) used.add(best.i)
  return best?.i ?? -1
}

function detectSales(stats: ColStat[]): Role[] {
  const roles: Role[] = stats.map(() => 'ignore')
  const used = new Set<number>()
  const set = (i: number, r: Role) => i >= 0 && (roles[i] = r)
  // a column must be filled in at least a fifth of the rows to count
  const live = (c: ColStat) => c.filled >= 0.2
  const date = pick(stats, used, (c) => (live(c) ? c.date : 0), 0.5)
  set(date, 'date')
  set(pick(stats, used, (c) => (live(c) ? c.code : 0), 0.3), 'productId')
  set(pick(stats, used, (c) => (live(c) ? c.hms : 0), 0.25), 'hmsId')
  const phone = pick(stats, used, (c) => (live(c) ? c.phone : 0), 0.3)
  set(phone, 'phone')
  // amount: right-most mostly-number column
  const money = stats.filter((c) => !used.has(c.i) && live(c) && c.money >= 0.6 && c.i > date).sort((a, b) => b.i - a.i)[0]
  if (money) {
    used.add(money.i)
    set(money.i, 'amount')
  }
  const brand = pick(stats, used, (c) => (live(c) && c.i > date ? c.brand : 0), 0.25)
  set(brand, 'brand')
  const rest = stats.filter((c) => !used.has(c.i) && live(c) && c.i > Math.max(date, brand))
  // model = the column right after the brand
  const model = brand >= 0 ? rest.find((c) => c.i > brand) : rest[0]
  if (model) {
    used.add(model.i)
    set(model.i, 'model')
  }
  // sales executive: few different short names, repeated a lot
  const exe = rest
    .filter((c) => !used.has(c.i) && c.filled >= 0.5 && c.avgLen <= 14 && c.distinct <= 0.3)
    .sort((a, b) => a.distinct - b.distinct)[0]
  if (exe) {
    used.add(exe.i)
    set(exe.i, 'executive')
  }
  const left = rest.filter((c) => !used.has(c.i)).sort((a, b) => a.i - b.i)
  const order: Role[] = left.length >= 3 ? ['spec', 'customer', 'address'] : ['customer', 'address']
  left.slice(0, order.length).forEach((c, k) => set(c.i, order[k]!))
  return roles
}

function detectService(stats: ColStat[]): Role[] {
  const roles: Role[] = stats.map(() => 'ignore')
  const used = new Set<number>()
  const set = (i: number, r: Role) => i >= 0 && (roles[i] = r)
  const live = (c: ColStat) => c.filled >= 0.15
  const date = pick(stats, used, (c) => (live(c) ? c.date : 0), 0.5)
  set(date, 'date')
  const cover = pick(stats, used, (c) => (live(c) ? c.cover : 0), 0.4)
  set(cover, 'coverage')
  const phone = pick(stats, used, (c) => (live(c) ? c.phone : 0), 0.3)
  set(phone, 'phone')
  set(pick(stats, used, (c) => (c.filled >= 0.1 ? c.code : 0), 0.3), 'productId')
  set(pick(stats, used, (c) => (c.filled >= 0.1 ? c.hms : 0), 0.3), 'hmsId')
  const svc = pick(stats, used, (c) => (c.filled >= 0.5 && c.distinct >= 0.8 ? c.svcNo : 0), 0.6)
  set(svc, 'serviceNo')
  const pay = pick(stats, used, (c) => (live(c) ? c.pay : 0), 0.3)
  set(pay, 'paymentNote')
  // money columns between the cover and the payment note / service no: amount, received, balance
  const stop = [pay, svc, phone].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 999
  const moneyCols = stats.filter((c) => !used.has(c.i) && c.i > Math.max(cover, date) && c.i < stop && c.money >= 0.6)
  ;(['amount', 'received', 'balance'] as Role[]).forEach((r, k) => {
    const c = moneyCols[k]
    if (c) {
      used.add(c.i)
      set(c.i, r)
    }
  })
  // work done = text before the date
  stats.filter((c) => c.i < date && !used.has(c.i) && c.filled > 0).forEach((c) => {
    used.add(c.i)
    set(c.i, 'work')
  })
  // customer = first text column after the date
  const cust = stats.find((c) => c.i > date && !used.has(c.i) && c.filled >= 0.3)
  if (cust) {
    used.add(cust.i)
    set(cust.i, 'customer')
  }
  // area = text column right after the phone
  const area = stats.find((c) => c.i > phone && phone >= 0 && !used.has(c.i) && c.filled >= 0.3 && c.money < 0.5)
  if (area) {
    used.add(area.i)
    set(area.i, 'area')
  }
  // engineer = a short name column with few different values (combined sheets add one at the end)
  const eng = stats
    .filter((c) => !used.has(c.i) && c.filled >= 0.5 && c.avgLen <= 14 && c.distinct <= 0.2 && c.money < 0.5)
    .sort((a, b) => a.distinct - b.distinct)[0]
  if (eng) set(eng.i, 'engineer')
  return roles
}

export function industryFromSheet(name: string) {
  const n = name.toUpperCase()
  if (/RETAIL/.test(n)) return 'Retail'
  if (/INDUSTR/.test(n)) return 'Industrial'
  if (/BILLING|\bPOS\b/.test(n)) return 'Billing & POS'
  if (/HOSPITAL|MEDICAL|CLINIC/.test(n)) return 'Hospital'
  if (/JEWEL/.test(n)) return 'Jewellery'
  if (/HOTEL|RESTAURANT/.test(n)) return 'Hotel & restaurant'
  return ''
}

/**
 * Header words help only where the content said nothing (a column left "not used") — headers in
 * HMS's sheets are often shifted, so they never override what the values themselves show.
 */
const HEADER_WORDS: Array<[RegExp, Role, Kind | null]> = [
  [/^PRODUCT\s*ID$|^PRODUCT\s*CODE$/i, 'productId', null],
  [/^HMS\s*(NO|ID|UNIQ)/i, 'hmsId', null],
  [/ENGINEER|TECHNICIAN|ATTENDED/i, 'engineer', 'SERVICE'],
  [/^AREA$|^PLACE$|^LOCATION$/i, 'area', 'SERVICE'],
  [/EXE|EXECUTIVE|SALES\s*PERSON/i, 'executive', 'SALES'],
  [/^ADD?RESS$/i, 'address', 'SALES'],
  [/WORK|COMPLAINT|PROBLEM/i, 'work', 'SERVICE'],
  [/SERVICE\s*NO|JOB\s*NO/i, 'serviceNo', 'SERVICE'],
  [/^BRAND$/i, 'brand', 'SALES'],
  [/^BRAND$|^MACHINE$/i, 'machine', 'SERVICE'],
  [/^SPARE/i, 'spares', 'SERVICE'],
  [/^MODEL$/i, 'model', 'SALES'],
  [/SERIAL|S\.?\s*NO\.?$/i, 'spec', 'SALES'],
]
function headerHints(rows: unknown[][], firstData: number, roles: Role[], kind: Kind, dataRows: number[] = []) {
  const filled = (c: number) =>
    dataRows.length ? dataRows.filter((r) => cellText(rows[r]![c]) !== "").length / dataRows.length : 0
  for (let r = firstData - 1; r >= Math.max(0, firstData - 3); r--) {
    const cells = (rows[r] ?? []).map(cellText)
    if (cells.filter(Boolean).length < 3) continue
    cells.forEach((h, i) => {
      // a "SPARE…" heading wins over "work done" (old sheets: column B = spares used)
      const spareOverWork = roles[i] === 'work' && /^SPARE/i.test(h) && kind === 'SERVICE'
      if (!h || (roles[i] && roles[i] !== 'ignore' && !spareOverWork)) return
      const hit = HEADER_WORDS.find(([re, , k]) => re.test(h) && (!k || k === kind))
      if (!hit || (roles.includes(hit[1]) && !spareOverWork)) return
      // heading one column left of its data (BRAND over an empty column, values in the next one)
      const target = filled(i) < 0.15 && (roles[i + 1] ?? "ignore") === "ignore" && !cells[i + 1] && filled(i + 1) >= 0.3 ? i + 1 : i
      roles[target] = hit[1]
    })
    return
  }
}

/** The agreed HMS formats (Sales / Service template) — when a sheet has these headings, they are used as-is */
const TEMPLATE: Record<Kind, Record<string, Role>> = {
  SALES: {
    DATE: 'date', 'DC / INVOICE NO': 'dcNo', 'DC NO': 'dcNo', 'INVOICE NO': 'dcNo', 'HMS ID': 'hmsId', 'HMS NO': 'hmsId',
    'PRODUCT ID': 'productId', 'SERIAL NO': 'spec', 'CUSTOMER NAME': 'customer', PHONE: 'phone', 'PHONE NO': 'phone',
    'MOBILE NO': 'phone', 'ALTERNATE PHONE': 'altPhone', ADDRESS: 'address', AREA: 'area', PLACE: 'area', INDUSTRY: 'industry',
    'SALES EXECUTIVE': 'executive', 'EXE NAME': 'executive', AMOUNT: 'amount', 'DELIVERED BY': 'deliveredBy',
    'DELIVERD BY': 'deliveredBy', 'STAMPING DATE': 'stampingDate', BRAND: 'brand', MODEL: 'model',
  },
  SERVICE: {
    DATE: 'date', 'REPORT NO': 'serviceNo', 'REPORT NUMBER': 'serviceNo', 'CUSTOMER NAME': 'customer', PHONE: 'phone',
    'PH.NUMBER': 'phone', AREA: 'area', 'HMS ID': 'hmsId', 'PRODUCT ID': 'productId', STATUS: 'status', 'WORK DONE': 'work',
    'SPARES USED': 'spares', 'SPARE DETAILS': 'spares', 'GC / NGC / AMC': 'coverage', 'GC/ NGC': 'coverage', 'GC/NGC': 'coverage',
    AMOUNT: 'amount', PAYMENT: 'amount', RECEIVED: 'received', COLLECTION: 'received', BALANCE: 'balance', PENDING: 'balance',
    'PAYMENT MODE': 'paymentMode', 'PAYMENT NOTE': 'paymentNote', 'CASH DETAILS': 'paymentNote', ENGINEER: 'engineer',
    BRAND: 'machine', MACHINE: 'machine',
  },
}
const headKey = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()

/** A heading row that is (mostly) the agreed template → roles straight from the headings. */
function templateRoles(rows: unknown[][], firstData: number, kind: Kind): Role[] | null {
  for (let r = firstData - 1; r >= Math.max(0, firstData - 3); r--) {
    const cells = (rows[r] ?? []).map((v) => headKey(cellText(v)))
    const roles = cells.map((h) => TEMPLATE[kind][h] ?? ('ignore' as Role))
    const known = roles.filter((x) => x !== 'ignore').length
    // the agreed format: at least 8 of its headings, in place — old sheets with shifted headings don't qualify
    if (known >= 8 && cells.includes('PRODUCT ID')) return roles
  }
  return null
}

/** Plan every sheet of a workbook. `rowsBySheet` = sheet_to_json(header:1, cellDates:true) output. */
export function planWorkbook(rowsBySheet: Array<{ name: string; rows: unknown[][] }>, catalogBrands: string[] = [], force?: Kind) {
  const brands = new Set([...KNOWN_BRANDS, ...catalogBrands.map((b) => b.toUpperCase())])
  const plans: SheetPlan[] = rowsBySheet.map(({ name, rows }) => {
    const dataRows = findDataRows(rows)
    const stats = statsFor(rows, dataRows, brands)
    const kind = force ?? guessKind(stats)
    const fromTemplate = dataRows.length ? templateRoles(rows, dataRows[0]!, kind) : null
    const roles = fromTemplate
      ? stats.map((_, i) => fromTemplate[i] ?? ('ignore' as Role))
      : dataRows.length < 1
        ? stats.map(() => 'ignore' as Role)
        : kind === 'SALES'
          ? detectSales(stats)
          : detectService(stats)
    if (dataRows.length && !fromTemplate) headerHints(rows, dataRows[0]!, roles, kind, dataRows)
    const samples = stats.map((c) =>
      dataRows
        .map((r) => cellText(rows[r]![c.i]))
        .filter(Boolean)
        .slice(0, 4),
    )
    return {
      name,
      kind,
      rows,
      dataRows,
      roles,
      industry: kind === 'SALES' ? industryFromSheet(name) : '',
      engineerFromSheet: kind === 'SERVICE' && !roles.includes('engineer'),
      include: dataRows.length >= 1,
      manualColumns: !!fromTemplate,
      note: fromTemplate ? 'HMS template — read by its headings' : undefined,
      samples,
    }
  })
  markCopies(plans)
  return plans
}

/** A sheet whose records all appear in a bigger sheet (e.g. OTHERS = every engineer's sheet) is left out by default. */
function markCopies(plans: SheetPlan[]) {
  const keysOf = (p: SheetPlan) => {
    const role: Role = p.kind === 'SALES' ? 'hmsId' : 'serviceNo'
    const col = p.roles.indexOf(role)
    if (col < 0) return new Set<string>()
    return new Set(p.dataRows.map((r) => cellText(p.rows[r]![col]).toUpperCase()).filter(Boolean))
  }
  const keys = plans.map(keysOf)

  // A combined sheet (OTHERS = every engineer's sheet) that has FEWER columns than the separate sheets
  // (e.g. no machine column) → use the separate sheets, leave the combined one out.
  const extraRoles: Role[] = ['machine', 'spares', 'productId', 'hmsId', 'status']
  for (let j = 0; j < plans.length; j++) {
    const big = plans[j]!
    if (!big.include || keys[j]!.size < 4) continue
    const parts = plans
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== j && p.include && keys[i]!.size >= 1 && keys[i]!.size < keys[j]!.size)
      .filter(({ i }) => [...keys[i]!].filter((k) => keys[j]!.has(k)).length / keys[i]!.size >= 0.9)
    if (parts.length < 2) continue
    const covered = new Set(parts.flatMap(({ i }) => [...keys[i]!]))
    const coverage = [...keys[j]!].filter((k) => covered.has(k)).length / keys[j]!.size
    // a column counts only when it is actually filled in (OTHERS has a BRAND heading but no values)
    const hasData = (p: SheetPlan, r: Role) => {
      const c = p.roles.indexOf(r)
      if (c < 0 || !p.dataRows.length) return false
      return p.dataRows.filter((ri) => cellText(p.rows[ri]![c]) !== "").length / p.dataRows.length >= 0.3
    }
    const richer = parts.some(({ p }) => extraRoles.some((r) => hasData(p, r) && !hasData(big, r)))
    if (coverage >= 0.9 && richer) {
      big.include = false
      big.note = `Same records as the ${parts.length} separate sheets, which also have the machine column — those are used instead`
      for (const { p } of parts) p.keepWithCombined = true
    }
  }

  plans.forEach((p, i) => {
    if (!p.include || keys[i]!.size < 2 || p.keepWithCombined) return
    for (let j = 0; j < plans.length; j++) {
      if (j === i || !plans[j]!.include || keys[j]!.size <= keys[i]!.size) continue
      const inside = [...keys[i]!].filter((k) => keys[j]!.has(k)).length / keys[i]!.size
      if (inside >= 0.9) {
        p.include = false
        p.note = `Same records as sheet “${plans[j]!.name}” — left out to avoid doubles`
        return
      }
    }
  })
}

const num = (v: unknown): number | null => {
  const s = cellText(v).replace(/,/g, '')
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

const isTextCell = (s: string) => !!s && !isMoney(s) && !isPhone(s)
const isShortName = (s: string) => isTextCell(s) && s.length <= 18 && s.split(/\s+/).length <= 3 && !/\d{3,}/.test(s)
const looksSpec = (s: string) =>
  /\d+\s*[X*×]\s*\d+/i.test(s) || (/\d/.test(s) && !/\s/.test(s) && s.length <= 16) || /^(WITH|PPS|SS|MS)\b/i.test(s)

/**
 * Sales sheets whose columns shift from row to row (2020 registers): read each row on its own,
 * anchored on the date + HMS ID at the left and the amount at the right.
 *   date | HMS ID | brand | model | [serial/size] | customer | [address…] | phone ⇄ executive | amount
 */
function salesRowSmart(rowIn: unknown[], ref: string, industry: string, lastDate: string | null): SalesOut | null {
  // A Product ID column can sit anywhere — take it out so the rest reads as usual
  const codeAt = rowIn.findIndex((v) => isProductCode(cellText(v)))
  const productCode = codeAt >= 0 ? cellText(rowIn[codeAt]).replace(/\s+/g, '').toUpperCase() : null
  const row = codeAt >= 0 ? rowIn.filter((_, i) => i !== codeAt) : rowIn
  const cells = row.map(cellText)
  let d = row.findIndex((v) => parseDate(v) != null)
  const hmsAt = cells.findIndex((s, i) => i > d && isHmsId(s))
  if (d < 0 && hmsAt < 0) return null
  // No date written (left blank under the previous row) — the HMS ID is the left anchor
  if (d < 0) d = hmsAt - 1
  const date = d >= 0 ? parseDate(row[d]) : lastDate
  const hmsRaw = cells[d + 1] ?? ''
  const hmsId = isHmsId(hmsRaw) ? hmsRaw.replace(/\s+/g, '').toUpperCase() : null
  const brand = cells[d + 2] || null
  const model = cells[d + 3] || null
  // amount = last numeric value
  let end = cells.length - 1
  while (end > d + 3 && !cells[end]) end--
  let amount: number | null = null
  if (end > d + 3 && isMoney(cells[end]!) && !isPhone(cells[end]!)) {
    amount = num(cells[end])
    end--
  }
  // phone = right-most phone-like value with some text (the customer) between it and the model
  let phoneAt = -1
  for (let i = end; i > d + 3; i--) {
    if (isPhone(cells[i]!) && cells.slice(d + 4, i).some(isTextCell)) {
      phoneAt = i
      break
    }
  }
  // A number with a digit missing (984080020) where the phone belongs — keep it as a (bad) phone, not address
  if (phoneAt < 0) {
    for (let i = end; i >= d + 6; i--) {
      if (/^\d{8,9}$/.test(cells[i]!) && cells.slice(d + 4, i).some(isTextCell)) {
        phoneAt = i
        break
      }
    }
  }
  let exeAt = -1
  if (phoneAt >= 0) {
    const after = cells.slice(phoneAt + 1, end + 1).filter(Boolean)
    if (after.length === 1 && isShortName(after[0]!)) exeAt = cells.indexOf(after[0]!, phoneAt + 1)
    else if (isShortName(cells[phoneAt - 1] ?? '') && cells.slice(d + 4, phoneAt - 1).filter(isTextCell).length >= 2) exeAt = phoneAt - 1
  } else if (isShortName(cells[end] ?? '') && cells.slice(d + 4, end).filter(Boolean).length >= 2) {
    exeAt = end
  }
  const stop = [phoneAt, exeAt].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? end + 1
  const middle = cells.slice(d + 4, stop).filter(Boolean)
  let spec: string | null = null
  let customer: string | null = null
  let address: string | null = null
  if (middle.length >= 3) [spec, customer, address] = [middle[0]!, middle[1]!, middle.slice(2).join(', ')]
  else if (middle.length === 2) {
    if (looksSpec(middle[0]!)) [spec, customer] = [middle[0]!, middle[1]!]
    else [customer, address] = [middle[0]!, middle[1]!]
  } else if (middle.length === 1) customer = middle[0]!
  const phones = phoneAt >= 0 ? phonesIn(cells[phoneAt]!) : []
  return {
    ref,
    date,
    hmsId,
    productCode,
    brand,
    model,
    spec,
    customer,
    address,
    phones,
    executive: exeAt >= 0 ? cells[exeAt]! : null,
    amount,
    industry: industry || null,
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** "JANUARY 2020", "FEBRAVARY 2020" headings → which month each row sits under. */
function monthSections(rows: unknown[][]) {
  const marks: Array<{ at: number; month: number; year: number | null }> = []
  rows.forEach((r, i) => {
    const text = r.map(cellText).filter(Boolean).join(' ').toUpperCase()
    if (!text || text.length > 40 || r.some((v) => parseDate(v) != null)) return
    const m = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b(?:\s*[-,]?\s*(20\d\d))?/.exec(text)
    if (m) marks.push({ at: i, month: MONTHS.indexOf(m[1]!) + 1, year: m[2] ? Number(m[2]) : null })
  })
  return (row: number) => {
    let cur: (typeof marks)[number] | null = null
    for (const mk of marks) if (mk.at < row) cur = mk
    return cur
  }
}

/** A date that disagrees with its month heading: swap day/month when that fits, otherwise flag it. */
function checkAgainstSection(date: string | null, sec: { month: number; year: number | null } | null) {
  if (!date || !sec) return { date, note: null }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  if (m === sec.month && (!sec.year || sec.year === y)) return { date, note: null }
  if (d === sec.month && m <= 12 && (!sec.year || sec.year === y)) {
    const swapped = `${y}-${pad(d)}-${pad(m)}`
    return { date: swapped, note: `Date read as ${d}/${m}/${y} (written ${m}.${d}) to match the ${MONTHS[sec.month - 1]} section` }
  }
  if (sec.year && sec.year !== y && m === sec.month) {
    return { date: `${sec.year}-${pad(m)}-${pad(d)}`, note: `Year corrected to ${sec.year} (sheet section)` }
  }
  // Later months often have no heading of their own — only a date BEFORE its section is suspicious
  const before = (sec.year && y < sec.year) || ((!sec.year || sec.year === y) && m < sec.month)
  return { date, note: before ? `Date is before the ${MONTHS[sec.month - 1]}${sec.year ? ` ${sec.year}` : ''} section — check it` : null }
}

/** Sales sheets are read row by row unless staff changed the column roles by hand. */
export function rowsOfSheet(p: SheetPlan): Array<SalesOut | ServiceOut> {
  if (p.kind === 'SALES' && !p.manualColumns) {
    let lastDate: string | null = null
    const out: SalesOut[] = []
    const sections = monthSections(p.rows)
    for (const ri of p.dataRows) {
      const r = salesRowSmart(p.rows[ri]!, `${p.name}!${ri + 1}`, p.industry, lastDate)
      if (r) {
        const fixed = checkAgainstSection(r.date, sections(ri))
        r.date = fixed.date
        r.dateNote = fixed.note
        if (r.date) lastDate = r.date
        out.push(r)
      }
    }
    return out
  }
  const col = (r: Role) => p.roles.map((x, i) => (x === r ? i : -1)).filter((i) => i >= 0)
  const one = (row: unknown[], r: Role) => col(r).map((i) => cellText(row[i])).filter(Boolean).join(' ') || null
  return p.dataRows.map((ri) => {
    const row = p.rows[ri]!
    const ref = `${p.name}!${ri + 1}`
    const dateCol = col('date')[0]
    const date = dateCol != null ? parseDate(row[dateCol]) : null
    const phones = col('phone').flatMap((i) => phonesIn(cellText(row[i])))
    if (p.kind === 'SALES') {
      const amt = col('amount')[0]
      return {
        ref,
        date,
        hmsId: one(row, 'hmsId'),
        productCode: one(row, 'productId')?.replace(/\s+/g, '').toUpperCase() ?? null,
        brand: one(row, 'brand'),
        model: one(row, 'model'),
        spec: one(row, 'spec'),
        customer: one(row, 'customer'),
        address: one(row, 'address'),
        executive: one(row, 'executive'),
        amount: amt != null ? num(row[amt]) : null,
        industry: one(row, 'industry') ?? (p.industry || null),
        dcNo: one(row, 'dcNo'),
        area: one(row, 'area'),
        deliveredBy: one(row, 'deliveredBy'),
        stampingDate: (() => {
          const i = col('stampingDate')[0]
          return i != null ? parseDate(row[i]) : null
        })(),
        phones: [...phones, ...col('altPhone').flatMap((i) => phonesIn(cellText(row[i])))],
      } satisfies SalesOut
    }
    const n1 = (r: Role) => {
      const i = col(r)[0]
      return i != null ? num(row[i]) : null
    }
    return {
      ref,
      date,
      work: one(row, 'work'),
      customer: one(row, 'customer'),
      coverage: one(row, 'coverage')?.replace(/[.\s]/g, '').toUpperCase() ?? null,
      amount: n1('amount'),
      received: n1('received'),
      balance: n1('balance'),
      paymentNote: one(row, 'paymentNote'),
      serviceNo: one(row, 'serviceNo'),
      productCode: one(row, 'productId')?.replace(/\s+/g, '').toUpperCase() ?? null,
      hmsId: one(row, 'hmsId')?.replace(/\s+/g, '').toUpperCase() ?? null,
      phones,
      area: one(row, 'area'),
      engineer: one(row, 'engineer') ?? (p.engineerFromSheet ? p.name : null),
      industry: p.industry || null,
      status: one(row, 'status'),
      spares: one(row, 'spares'),
      paymentMode: one(row, 'paymentMode'),
      machine: one(row, 'machine'),
    } satisfies ServiceOut
  })
}
