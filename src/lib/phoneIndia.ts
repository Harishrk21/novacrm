/** India mobile helpers — UI shows +91; storage uses 91XXXXXXXXXX. */

export type IndianMobileValue = string | null | undefined

/** Last 10 national digits (strips 91 / leading 0). */
export function indianMobileLocal(value?: IndianMobileValue): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length >= 12 && digits.startsWith('91')) return digits.slice(-10)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length > 10) return digits.slice(-10)
  return digits.slice(0, 10)
}

/** Valid Indian mobile: exactly 10 digits, starts with 6–9. */
export function isValidIndianMobile(value?: IndianMobileValue): boolean {
  const local = indianMobileLocal(value)
  return /^[6-9]\d{9}$/.test(local)
}

/** Empty → null; otherwise `91` + 10 digits (even if incomplete — caller should validate). */
export function toStoredIndianMobile(value?: IndianMobileValue): string | null {
  const local = indianMobileLocal(value)
  if (!local) return null
  return `91${local}`
}

/** Optional field: empty OK; if filled must be valid 10-digit mobile. */
export function optionalIndianMobileError(
  value?: IndianMobileValue,
  label = 'Mobile number',
): string | undefined {
  const local = indianMobileLocal(value)
  if (!local) return undefined
  if (local.length !== 10) return `${label} must be 10 digits`
  if (!isValidIndianMobile(local)) return `${label} must start with 6–9`
  return undefined
}

/** Required field: must be valid 10-digit Indian mobile. */
export function requiredIndianMobileError(
  value?: IndianMobileValue,
  label = 'Mobile number',
): string | undefined {
  const local = indianMobileLocal(value)
  if (!local) return `${label} is required`
  if (local.length !== 10) return `${label} must be 10 digits`
  if (!isValidIndianMobile(local)) return `${label} must start with 6–9`
  return undefined
}
