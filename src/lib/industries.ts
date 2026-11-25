/** Customer industry / segment — HMS's sales registers are split this way (Retail, Industrial, Billing & POS…). */
export const INDUSTRY_OPTIONS = [
  'Retail',
  'Industrial',
  'Billing & POS',
  'Hospital',
  'Jewellery',
  'Hotel & restaurant',
  'Pharmacy',
  'Logistics',
  'Laboratory',
  'Government',
  'Education',
  'Finance',
] as const

export function customerIndustry(custom: Record<string, unknown> | null | undefined) {
  return String(custom?.industry ?? '').trim()
}
