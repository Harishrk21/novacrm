/**
 * HMS Enterprises product catalog tree.
 * Weighing: Family → Industry → Machine
 * Others: Family → Machine
 */

export type HmsFamilyCode =
  | 'WEIGHING_SCALES'
  | 'BILLING_MACHINE'
  | 'TOUCH_POS'
  | 'BILLING_SOFTWARE'
  | 'OFFICE_AUTOMATION'

export type HmsIndustryCode =
  | 'RETAIL'
  | 'INDUSTRIAL'
  | 'HOSPITAL_ANIMAL'
  | 'JEWELLERY'
  | 'LABORATORY'

export type HmsMachineDef = {
  sku: string
  name: string
  /** Maps to asset / legacy catalogKind for stamping & tickets */
  catalogKind: string
  requiresStamping?: boolean
  trackInventory?: boolean
  productType?: 'GOODS' | 'SERVICE' | 'BUNDLE'
  salePrice?: number
  purchasePrice?: number
}

export type HmsIndustryDef = {
  code: HmsIndustryCode
  name: string
  machines: HmsMachineDef[]
}

export type HmsFamilyDef = {
  code: HmsFamilyCode
  name: string
  /** When true, UI asks for industry before machine */
  hasIndustry: boolean
  industries?: HmsIndustryDef[]
  machines?: HmsMachineDef[]
}

function m(
  sku: string,
  name: string,
  catalogKind: string,
  opts?: Partial<HmsMachineDef>,
): HmsMachineDef {
  const salePrice = opts?.salePrice ?? 0
  const purchasePrice =
    opts?.purchasePrice ?? (salePrice > 0 ? Math.round(salePrice * 0.72) : 0)
  return {
    sku,
    name,
    catalogKind,
    requiresStamping: opts?.requiresStamping ?? catalogKind === 'WEIGHING',
    trackInventory: opts?.trackInventory ?? true,
    productType: opts?.productType ?? 'GOODS',
    salePrice,
    purchasePrice,
  }
}

export const HMS_CATALOG: HmsFamilyDef[] = [
  {
    code: 'WEIGHING_SCALES',
    name: 'Weighing Scales',
    hasIndustry: true,
    industries: [
      {
        code: 'RETAIL',
        name: 'Retail Weighing Scale',
        machines: [
          m('HMS-WS-RET-TABLE-TOP', 'Table Top', 'WEIGHING', { salePrice: 9500 }),
          m('HMS-WS-RET-TABLE-TOP-ABS', 'Table Top (ABS)', 'WEIGHING', { salePrice: 11500 }),
          m('HMS-WS-RET-COUNTER-WP', 'Counter Scale (Water Proof)', 'WEIGHING', { salePrice: 18500 }),
          m('HMS-WS-RET-BENCH', 'Bench Scale', 'WEIGHING', { salePrice: 22000 }),
          m('HMS-WS-RET-PLATFORM', 'Platform Scale', 'WEIGHING', { salePrice: 32000 }),
          m('HMS-WS-RET-MOBILE', 'Mobile Scale', 'WEIGHING', { salePrice: 27500 }),
          m('HMS-WS-RET-PRICE-COMP', 'Price Computing Scale', 'WEIGHING', { salePrice: 24500 }),
          m('HMS-WS-RET-WIFI-APP', 'WiFi Scale with Mobile App', 'WEIGHING', { salePrice: 29500 }),
          m('HMS-WS-RET-BARCODE', 'Barcode Label Scale', 'WEIGHING', { salePrice: 38500 }),
          m('HMS-WS-RET-HANGING', 'Hanging Scale', 'WEIGHING', { salePrice: 12500 }),
        ],
      },
      {
        code: 'INDUSTRIAL',
        name: 'Industrial Scale',
        machines: [
          m('HMS-WS-IND-HEAVY-PLATFORM', 'Heavy Duty Platform Scale', 'WEIGHING', { salePrice: 68500 }),
          m('HMS-WS-IND-PC-TABLE', 'Piece Counting Table Top Scale', 'WEIGHING', { salePrice: 28500 }),
          m('HMS-WS-IND-PC-PLATFORM', 'Piece Counting Platform Scale', 'WEIGHING', { salePrice: 45500 }),
          m('HMS-WS-IND-CHECK-PLATFORM', 'Check Weighing Platform Scale', 'WEIGHING', { salePrice: 52500 }),
          m('HMS-WS-IND-CHECK-TABLE', 'Check Weighing Table Top Scale', 'WEIGHING', { salePrice: 34500 }),
          m('HMS-WS-IND-LABEL-PRINT', 'Label Printing Scale', 'WEIGHING', { salePrice: 48500 }),
          m('HMS-WS-IND-PLATFORM-RAMP', 'Platform Scale with Ramp', 'WEIGHING', { salePrice: 78500 }),
          m('HMS-WS-IND-ROLLER', 'Roller Scale', 'WEIGHING', { salePrice: 62500 }),
          m('HMS-WS-IND-TROLLEY', 'Trolley Scale', 'WEIGHING', { salePrice: 55500 }),
          m('HMS-WS-IND-THERMAL', 'Weighing Scale with Thermal Label/Paper Printer', 'WEIGHING', {
            salePrice: 58500,
          }),
          m('HMS-WS-IND-PALLET', 'Pallet Scale', 'WEIGHING', { salePrice: 95000 }),
          m('HMS-WS-IND-CRANE', 'Crane Scale', 'WEIGHING', { salePrice: 72000 }),
          m('HMS-WS-IND-CRANE-WL', 'Crane Scale with Wireless Indicator', 'WEIGHING', { salePrice: 98000 }),
          m('HMS-WS-IND-FLAMEPROOF', 'Flame Proof Indicator', 'WEIGHING', { salePrice: 125000 }),
          m('HMS-WS-IND-WEIGHBRIDGE', 'Weigh Bridge', 'WEIGHING', { salePrice: 485000 }),
        ],
      },
      {
        code: 'HOSPITAL_ANIMAL',
        name: 'Hospital and Animal Weighing Scale',
        machines: [
          m('HMS-WS-HSP-BABY', 'Baby Scale', 'WEIGHING', { salePrice: 14500 }),
          m('HMS-WS-HSP-PERSONAL', 'Personal Scale', 'WEIGHING', { salePrice: 8500 }),
          m('HMS-WS-HSP-ADULT', 'Adult Scale', 'WEIGHING', { salePrice: 16500 }),
          m('HMS-WS-HSP-3IN1', '3 in 1 Weighing Scale', 'WEIGHING', { salePrice: 28500 }),
          m('HMS-WS-HSP-BMI', 'BMI Scale', 'WEIGHING', { salePrice: 35500 }),
          m('HMS-WS-HSP-ANIMAL', 'Animal Scale', 'WEIGHING', { salePrice: 42500 }),
        ],
      },
      {
        code: 'JEWELLERY',
        name: 'Jewellery Scale',
        machines: [
          m('HMS-WS-JWL-HIGH-PREC', 'High Precision Scale', 'WEIGHING', { salePrice: 48500 }),
          m('HMS-WS-JWL-10MG', '10 mg Scale', 'WEIGHING', { salePrice: 38500 }),
          m('HMS-WS-JWL-PREC-HIGH-CAP', 'Precision Balance Higher Capacity', 'WEIGHING', {
            salePrice: 62500,
          }),
          m('HMS-WS-JWL-SILVER', 'Silver Weighing Scale', 'WEIGHING', { salePrice: 28500 }),
        ],
      },
      {
        code: 'LABORATORY',
        name: 'Laboratory Scale',
        machines: [
          m('HMS-WS-LAB-HIGH-PREC', 'High Precision Balance', 'WEIGHING', { salePrice: 72500 }),
          m('HMS-WS-LAB-ANALYTICAL', 'Analytical Balance', 'WEIGHING', { salePrice: 125000 }),
          m('HMS-WS-LAB-MOISTURE', 'Moisture Balance', 'WEIGHING', { salePrice: 98500 }),
        ],
      },
    ],
  },
  {
    code: 'BILLING_MACHINE',
    name: 'Billing Machine',
    hasIndustry: false,
    machines: [
      m('HMS-BM-JUNIOR-STAR', 'HMS Junior Star', 'BILLING', {
        requiresStamping: false,
        salePrice: 14500,
      }),
      m('HMS-BM-2T-SUPERSTAR', 'HMS 2T Superstar', 'BILLING', {
        requiresStamping: false,
        salePrice: 22500,
      }),
      m('HMS-BM-3T-SUPERSTAR', 'HMS 3T Super Star', 'BILLING', {
        requiresStamping: false,
        salePrice: 28500,
      }),
      m('HMS-BM-WEP-2100', 'HMS/WEP 2100', 'BILLING', { requiresStamping: false, salePrice: 19500 }),
      m('HMS-BM-HANDY', 'Handy Billing Machine', 'BILLING', {
        requiresStamping: false,
        salePrice: 12500,
      }),
      m('HMS-BM-WEIGH-BILL', 'Weighing with Billing', 'BILLING', {
        requiresStamping: false,
        salePrice: 38500,
      }),
    ],
  },
  {
    code: 'TOUCH_POS',
    name: 'Touch POS',
    hasIndustry: false,
    machines: [
      m('HMS-POS-IMIN-SWIFT2', 'iMin Swift 2', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 28500,
      }),
      m('HMS-POS-IMIN-M2MAX', 'iMin M2 Max', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 35500,
      }),
      m('HMS-POS-IMIN-D1', 'iMin D1', 'TOUCH_POS', { requiresStamping: false, salePrice: 42500 }),
      m('HMS-POS-IMIN-D2', 'iMin D2', 'TOUCH_POS', { requiresStamping: false, salePrice: 48500 }),
      m('HMS-POS-IMIN-SWAN1', 'iMin Swan 1', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 52500,
      }),
      m('HMS-POS-TVS', 'TVS Touch POS System', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 45500,
      }),
      m('HMS-POS-ACCESSORIES', 'Touch POS Accessories', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 6500,
      }),
      m('HMS-POS-NUKKAD-ASPIRE', 'Nukkad NS Aspire 2 Inch Inbuilt', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 24500,
      }),
      m('HMS-POS-NUKKAD-PRO2', 'Nukkad NS Pro 2', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 32500,
      }),
      m('HMS-POS-NUKKAD-ELITEA', 'Nukkad NS Elite A', 'TOUCH_POS', {
        requiresStamping: false,
        salePrice: 38500,
      }),
    ],
  },
  {
    code: 'BILLING_SOFTWARE',
    name: 'Billing Software',
    hasIndustry: false,
    machines: [
      m('HMS-SW-EASY-BILL', 'HMS Easy Bill Software', 'BILLING_SOFTWARE', {
        requiresStamping: false,
        trackInventory: false,
        productType: 'SERVICE',
        salePrice: 8500,
      }),
      m('HMS-SW-RETAIL-POS', 'Retail POS Software', 'BILLING_SOFTWARE', {
        requiresStamping: false,
        trackInventory: false,
        productType: 'SERVICE',
        salePrice: 18500,
      }),
    ],
  },
  {
    code: 'OFFICE_AUTOMATION',
    name: 'Office Automation',
    hasIndustry: false,
    machines: [
      m('HMS-OA-CASH-COUNT', 'Cash Counting Machine', 'CCM', {
        requiresStamping: false,
        salePrice: 18500,
      }),
      m('HMS-OA-VALUE-MIZ', 'Value Miz Cash Counting Machine', 'CCM', {
        requiresStamping: false,
        salePrice: 28500,
      }),
      m('HMS-OA-TABLE-BUNDLE', 'Table Top Bundle Note Cash Counting', 'CCM', {
        requiresStamping: false,
        salePrice: 45500,
      }),
      m('HMS-OA-FLOOR-BUNDLE', 'Floor Bundle Note Cash Counting', 'CCM', {
        requiresStamping: false,
        salePrice: 68500,
      }),
      m('HMS-OA-CCTV', 'CCTV Camera', 'CCTV', { requiresStamping: false, salePrice: 4500 }),
      m('HMS-OA-FINGER-BIO', 'Finger ID Biometric System', 'BIOMETRIC', {
        requiresStamping: false,
        salePrice: 6500,
      }),
      m('HMS-OA-FACE-FINGER', 'Face & Finger ID Sensor Biometric System', 'BIOMETRIC', {
        requiresStamping: false,
        salePrice: 12500,
      }),
    ],
  },
]

export const HMS_FAMILY_OPTIONS = HMS_CATALOG.map((f) => ({ value: f.code, label: f.name }))

export function familyByCode(code: string) {
  return HMS_CATALOG.find((f) => f.code === code) ?? null
}

export function industryOptions(familyCode: string) {
  const f = familyByCode(familyCode)
  if (!f?.hasIndustry || !f.industries) return []
  return f.industries.map((i) => ({ value: i.code, label: i.name }))
}

export function machineOptions(familyCode: string, industryCode?: string) {
  const f = familyByCode(familyCode)
  if (!f) return []
  if (f.hasIndustry) {
    const ind = f.industries?.find((i) => i.code === industryCode)
    return (ind?.machines ?? []).map((m) => ({ value: m.sku, label: m.name, machine: m }))
  }
  return (f.machines ?? []).map((m) => ({ value: m.sku, label: m.name, machine: m }))
}

export function flattenHmsMachines() {
  const rows: Array<{
    familyCode: HmsFamilyCode
    familyName: string
    industryCode: HmsIndustryCode | null
    industryName: string | null
    machine: HmsMachineDef
  }> = []
  for (const f of HMS_CATALOG) {
    if (f.hasIndustry && f.industries) {
      for (const ind of f.industries) {
        for (const machine of ind.machines) {
          rows.push({
            familyCode: f.code,
            familyName: f.name,
            industryCode: ind.code,
            industryName: ind.name,
            machine,
          })
        }
      }
    } else {
      for (const machine of f.machines ?? []) {
        rows.push({
          familyCode: f.code,
          familyName: f.name,
          industryCode: null,
          industryName: null,
          machine,
        })
      }
    }
  }
  return rows
}

export function productCatalogMeta(attrs: Record<string, unknown> | null | undefined) {
  const a = attrs ?? {}
  return {
    familyCode: String(a.catalogFamily ?? ''),
    familyName: String(a.catalogFamilyName ?? ''),
    industryCode: a.catalogIndustry ? String(a.catalogIndustry) : '',
    industryName: a.catalogIndustryName ? String(a.catalogIndustryName) : '',
    catalogKind: String(a.catalogKind ?? ''),
    model: String(a.model ?? ''),
  }
}

export function buildHmsAttributes(opts: {
  familyCode: string
  familyName: string
  industryCode?: string | null
  industryName?: string | null
  machineName: string
  catalogKind: string
  requiresStamping: boolean
}) {
  return {
    catalogFamily: opts.familyCode,
    catalogFamilyName: opts.familyName,
    catalogIndustry: opts.industryCode || null,
    catalogIndustryName: opts.industryName || null,
    catalogKind: opts.catalogKind,
    model: opts.machineName,
    brand: 'HMS',
    requiresStamping: opts.requiresStamping,
  }
}
