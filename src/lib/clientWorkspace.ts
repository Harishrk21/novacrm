/** Module keys platform admin can toggle per client (drives sidebar).
 *  Settings is always on for every tenant — not shown as a checkbox. */
export const MODULE_TOGGLE_OPTIONS: Array<{ key: string; label: string; group: string }> = [
  { key: 'crm.leads', label: 'My leads', group: 'Sales' },
  { key: 'crm.contacts', label: 'Customers', group: 'Sales' },
  { key: 'crm.accounts', label: 'Accounts', group: 'Sales' },
  { key: 'crm.deals', label: 'Deals', group: 'Sales' },
  { key: 'crm.activities', label: 'Activities', group: 'Sales' },
  { key: 'crm.tickets', label: 'Service tickets', group: 'Service' },
  { key: 'crm.amc', label: 'AMC / Non-AMC', group: 'Service' },
  { key: 'crm.stamping', label: 'Stamping', group: 'Service' },
  { key: 'erp.products', label: 'Products', group: 'Inventory' },
  { key: 'erp.inventory', label: 'Stock / Inventory', group: 'Inventory' },
  { key: 'erp.purchase_orders', label: 'Purchase orders', group: 'Inventory' },
  { key: 'erp.invoices', label: 'Proforma invoices', group: 'Inventory' },
  { key: 'engagement.whatsapp', label: 'WhatsApp', group: 'Engagement' },
  { key: 'engagement.emails', label: 'Emails', group: 'Engagement' },
  { key: 'reports', label: 'Reports', group: 'System' },
]

export function clientLoginPath(slug: string) {
  return `/login/${encodeURIComponent(slug.toLowerCase())}`
}

export function clientLoginUrl(slug: string, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  return `${origin}${clientLoginPath(slug)}`
}
