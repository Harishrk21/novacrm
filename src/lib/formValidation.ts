export type FieldErrors = Record<string, string>

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function isHttpUrl(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function firstError(errors: FieldErrors) {
  return Object.values(errors)[0]
}

export function validateProductForm(form: {
  sku: string
  name: string
  salePrice: string
  purchasePrice: string
  mrp: string
  taxPercent: string
  reorderLevel: string
  imageUrl: string
}) {
  const errors: FieldErrors = {}
  if (!form.sku.trim()) errors.sku = 'SKU is required'
  else if (form.sku.trim().length > 64) errors.sku = 'SKU is too long'
  if (!form.name.trim()) errors.name = 'Product name is required'
  if (form.salePrice !== '' && Number(form.salePrice) < 0) errors.salePrice = 'Sale price cannot be negative'
  if (form.purchasePrice !== '' && Number(form.purchasePrice) < 0)
    errors.purchasePrice = 'Purchase price cannot be negative'
  if (form.mrp !== '' && Number(form.mrp) < 0) errors.mrp = 'MRP cannot be negative'
  const tax = Number(form.taxPercent)
  if (form.taxPercent === '' || Number.isNaN(tax) || tax < 0 || tax > 100)
    errors.taxPercent = 'Tax % must be between 0 and 100'
  if (form.reorderLevel !== '' && Number(form.reorderLevel) < 0)
    errors.reorderLevel = 'Reorder level cannot be negative'
  if (
    form.imageUrl.trim() &&
    !form.imageUrl.startsWith('/uploads/') &&
    !isHttpUrl(form.imageUrl.trim())
  ) {
    errors.imageUrl = 'Enter a valid image URL or upload a file'
  }
  return errors
}

export function validateLeadForm(form: {
  name: string
  email: string
  phone: string
  website: string
  score: string
  budget: string
}) {
  const errors: FieldErrors = {}
  if (!form.name.trim()) errors.name = 'Full name is required'
  if (form.email.trim() && !isEmail(form.email)) errors.email = 'Enter a valid email'
  if (form.website.trim()) {
    const w = form.website.trim()
    const withProto = /^https?:\/\//i.test(w) ? w : `https://${w}`
    if (!isHttpUrl(withProto)) errors.website = 'Enter a valid website'
  }
  if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 8) {
    errors.phone = 'Enter a valid phone number'
  }
  const score = Number(form.score)
  if (form.score === '' || Number.isNaN(score) || score < 0 || score > 100) {
    errors.score = 'Score must be 0–100'
  }
  if (form.budget !== '' && Number(form.budget) < 0) errors.budget = 'Budget cannot be negative'
  return errors
}

export function validateContactForm(form: {
  name: string
  email: string
  phone: string
  mobile: string
  country: string
  alternateEmail?: string
  pincode?: string
}) {
  const errors: FieldErrors = {}
  if (!form.name.trim()) errors.name = 'Full name is required'
  if (form.email.trim() && !isEmail(form.email)) errors.email = 'Enter a valid email'
  if (form.alternateEmail?.trim() && !isEmail(form.alternateEmail)) {
    errors.alternateEmail = 'Enter a valid alternate email'
  }
  if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 8) {
    errors.phone = 'Enter a valid phone number'
  }
  if (form.mobile.trim() && form.mobile.replace(/\D/g, '').length < 8) {
    errors.mobile = 'Enter a valid mobile number'
  }
  if (form.country.trim() && form.country.trim().length !== 2) {
    errors.country = 'Use 2-letter country code (e.g. IN)'
  }
  if (form.pincode?.trim() && !/^\d{4,10}$/.test(form.pincode.trim())) {
    errors.pincode = 'Enter a valid pincode'
  }
  return errors
}

export function assetUrl(pathOrUrl?: string | null) {
  if (!pathOrUrl) return ''
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl
  const api = import.meta.env.VITE_API_URL as string | undefined
  if (api) {
    const origin = api.replace(/\/api\/?$/, '')
    return `${origin}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`
  }
  return pathOrUrl
}
