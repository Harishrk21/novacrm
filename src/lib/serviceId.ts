/** Professional service / job identifiers for HMS Enterprises. */

export function formatServiceId(ticketNo: number | string | null | undefined): string {
  if (ticketNo == null || ticketNo === '') return 'SVC-—'
  const n = String(ticketNo).replace(/\D/g, '') || String(ticketNo)
  return `SVC-${n.padStart(5, '0')}`
}

/** Sale enquiry / lead reference shown in lists. */
export function formatEnquiryId(lead: {
  id?: unknown
  leadNo?: unknown
  code?: unknown
  createdAt?: unknown
}): string {
  if (lead.leadNo != null && String(lead.leadNo).trim()) {
    return `ENQ-${String(lead.leadNo).replace(/\D/g, '').padStart(5, '0')}`
  }
  if (lead.code != null && String(lead.code).trim()) return String(lead.code)
  const id = String(lead.id ?? '')
  if (id.length >= 8) return `ENQ-${id.slice(0, 8).toUpperCase()}`
  return 'ENQ-—'
}
