/**
 * Resolve in-app paths for list rows (workqueue, tasks, activities).
 * Prefer explicit foreign keys / customFields over guessing from titles.
 */

type Row = Record<string, unknown>

function cf(row: Row): Record<string, unknown> {
  return (row.customFields as Record<string, unknown> | null) ?? {}
}

/** Best destination for an activity / task / call / meeting row. */
export function activityHref(row: Row): string | null {
  const fields = cf(row)
  const ticketId =
    fields.ticketId != null
      ? String(fields.ticketId)
      : fields.ticket_id != null
        ? String(fields.ticket_id)
        : ''
  if (ticketId) return `/tickets/${ticketId}`

  if (row.leadId) return `/sale-tracking/${String(row.leadId)}`
  if (row.dealId) return `/deals/${String(row.dealId)}`

  const deal = row.deal as { id?: string } | null
  if (deal?.id) return `/deals/${deal.id}`

  if (row.contactId) return `/contacts/${String(row.contactId)}`
  const contact = row.contact as { id?: string } | null
  if (contact?.id) return `/contacts/${contact.id}`

  if (row.accountId) return `/accounts/${String(row.accountId)}`
  return null
}

export function contactHref(row: Row): string | null {
  const contact = row.contact as { id?: string } | null
  if (contact?.id) return `/contacts/${contact.id}`
  if (row.contactId) return `/contacts/${String(row.contactId)}`
  return null
}

export function dealHref(row: Row): string | null {
  const deal = row.deal as { id?: string } | null
  if (deal?.id) return `/deals/${deal.id}`
  if (row.dealId) return `/deals/${String(row.dealId)}`
  return null
}

export function leadHref(row: Row): string | null {
  if (row.leadId) return `/sale-tracking/${String(row.leadId)}`
  return null
}

/** Primary open target for any workqueue row given the active nav. */
export function workqueueRowHref(nav: string, row: Row): string | null {
  if (nav === 'tickets' || nav === 'claimable') {
    return row.id ? `/tickets/${String(row.id)}` : null
  }
  if (nav === 'leads' || nav === 'touched-leads' || nav === 'followups') {
    return row.id ? `/sale-tracking/${String(row.id)}` : null
  }
  if (nav === 'contacts') {
    return row.id ? `/contacts/${String(row.id)}` : null
  }
  // tasks / meetings / calls — orphan rows still open Activities
  return activityHref(row) ?? '/activities'
}

export function activitySubjectLabel(row: Row): string {
  return String(row.title ?? row.subject ?? 'Activity')
}
