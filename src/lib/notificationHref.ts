/** Resolve in-app destination for a notification row. */
export function notificationHref(
  n: {
    type?: string | null
    entityType?: string | null
    entityId?: string | null
    href?: string | null
  },
  opts?: { role?: string | null },
): string {
  const rawHref = n.href ? String(n.href).trim() : ''
  // API used to stub unknown types as /notifications — ignore that and resolve from type
  const hrefIsStub = !rawHref || rawHref === '/notifications' || rawHref === '#'

  const type = String(n.type ?? '').toUpperCase()
  const entityType = String(n.entityType ?? '').toLowerCase()
  const entityId = n.entityId ? String(n.entityId) : ''
  const role = String(opts?.role ?? '').toUpperCase()
  const warehouseish =
    role === 'WAREHOUSE' || role === 'ADMIN' || role === 'MANAGER'

  // Prefer type/entity resolution for requisitions even if a bad href was stored
  const isRequisition =
    type === 'REQUISITION_PENDING' ||
    type === 'REQUISITION_APPROVED' ||
    type === 'REQUISITION_REJECTED' ||
    type === 'REQUISITION_INVENTORY' ||
    type === 'REQUISITION_SHIPPED' ||
    type === 'REQUISITION_FULFILLED' ||
    type === 'REQUISITION_SALE_DC' ||
    type.includes('REQUISITION') ||
    entityType === 'sales_requisition'

  if (!hrefIsStub && !isRequisition) return rawHref

  const isLeadEntity =
    entityType === 'lead' || entityType === 'leads' || entityType === 'enquiry'

  // Sales requisition — approval / reject stay on sale-tracking
  if (type === 'REQUISITION_PENDING' || type === 'REQUISITION_REJECTED') {
    if (entityId) return `/sale-tracking?queue=requisitions&reqId=${encodeURIComponent(entityId)}`
    return '/sale-tracking?queue=requisitions'
  }

  // Approved / inventory / fulfill — warehouse → releases; sales → requisitions / sale
  if (
    type === 'REQUISITION_APPROVED' ||
    type === 'REQUISITION_INVENTORY' ||
    type === 'REQUISITION_SHIPPED' ||
    type === 'REQUISITION_FULFILLED' ||
    type === 'REQUISITION_SALE_DC' ||
    type.includes('REQUISITION') ||
    entityType === 'sales_requisition'
  ) {
    if (warehouseish) return '/erp/releases'
    if (isLeadEntity && entityId) return `/sale-tracking/${entityId}`
    if (entityId) {
      return `/sale-tracking?queue=requisitions&reqId=${encodeURIComponent(entityId)}`
    }
    return '/sale-tracking?queue=requisitions'
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

  // Unknown type — land on workqueue rather than reloading Notifications
  return '/workqueue'
}
