/** Resolve in-app destination for a notification row. */
export function notificationHref(n: {
  type?: string | null
  entityType?: string | null
  entityId?: string | null
  href?: string | null
}): string {
  if (n.href) return String(n.href)

  const type = String(n.type ?? '').toUpperCase()
  const entityType = String(n.entityType ?? '').toLowerCase()
  const entityId = n.entityId ? String(n.entityId) : ''

  const isLeadEntity =
    entityType === 'lead' || entityType === 'leads' || entityType === 'enquiry'

  // Sales requisition lifecycle
  if (
    type === 'REQUISITION_PENDING' ||
    type === 'REQUISITION_APPROVED' ||
    type === 'REQUISITION_REJECTED' ||
    entityType === 'sales_requisition'
  ) {
    if (entityId) return `/sale-tracking?queue=requisitions&reqId=${encodeURIComponent(entityId)}`
    return '/sale-tracking?queue=requisitions'
  }

  // Inventory notified warehouse — sales still lands on the sale / requisitions
  if (type === 'REQUISITION_INVENTORY') {
    return isLeadEntity && entityId
      ? `/sale-tracking/${entityId}`
      : '/sale-tracking?queue=requisitions'
  }

  if (
    type === 'REQUISITION_SHIPPED' ||
    type === 'REQUISITION_FULFILLED' ||
    type === 'REQUISITION_SALE_DC' ||
    type.includes('REQUISITION')
  ) {
    if (isLeadEntity && entityId) return `/sale-tracking/${entityId}`
    if (entityId && entityType === 'sales_requisition') {
      return `/sale-tracking?queue=requisitions&reqId=${encodeURIComponent(entityId)}`
    }
    return '/sale-tracking'
  }

  // Follow-ups / day updates / lead status
  if (
    type === 'LEAD_FOLLOWUP' ||
    type === 'LEAD_FOLLOWUP_DUE' ||
    type.includes('FOLLOWUP')
  ) {
    if (entityId) return `/sale-tracking/${entityId}`
    return '/workqueue'
  }

  if (
    isLeadEntity ||
    type.startsWith('LEAD_') ||
    type === 'LEAD_DAY_UPDATE' ||
    type === 'LEAD_STATUS_CHANGE' ||
    type === 'LEAD_DEMO_DAY_UPDATE'
  ) {
    if (entityId) return `/sale-tracking/${entityId}`
    return '/sale-tracking'
  }

  if (entityType === 'invoice_lead' && entityId) {
    return `/erp/invoices?open=1&contactId=${encodeURIComponent(entityId)}`
  }

  if (entityType === 'ticket' || type.includes('TICKET')) {
    if (entityId) return `/tickets/${entityId}`
    return '/tickets'
  }

  if (entityType === 'activity' || type.includes('TASK') || type.includes('CALL')) {
    if (isLeadEntity && entityId) return `/sale-tracking/${entityId}`
    return '/workqueue'
  }

  if (entityType === 'contact' && entityId) return `/contacts/${entityId}`
  if (entityType === 'deal' && entityId) return `/deals/${entityId}`

  if (
    type === 'DEMO_ISSUE' ||
    type === 'DEMO_RETURN' ||
    type.startsWith('DEMO_') ||
    entityType === 'stock_unit'
  ) {
    return '/erp/stock?view=demo'
  }

  // Never leave Open with nowhere to go
  return '/notifications'
}
