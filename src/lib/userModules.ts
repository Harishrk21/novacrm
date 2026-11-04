import { MODULE_TOGGLE_OPTIONS } from '@/lib/clientWorkspace'

/** Same catalog platform admin uses — company admin assigns a subset to employees. */
export const EMPLOYEE_MODULE_OPTIONS = MODULE_TOGGLE_OPTIONS

export type AllowedModules = Record<string, boolean>

/** Default: every platform-enabled key on. */
export function defaultAllowedModules(tenantKeys: string[]): AllowedModules {
  const out: AllowedModules = {}
  for (const key of tenantKeys) {
    if (key === 'settings') continue
    out[key] = true
  }
  return out
}

/**
 * Role-based defaults for new employees.
 * Admins can still tick/untick any company-enabled module on create/edit.
 * Field engineers do NOT get Inventory unless the company admin enables it.
 */
export function defaultAllowedModulesForRole(
  roleCode: string,
  tenantKeys: string[],
): AllowedModules {
  if (roleCode === 'ADMIN' || roleCode === 'MANAGER') {
    return defaultAllowedModules(tenantKeys)
  }

  const on = new Set<string>()
  switch (roleCode) {
    case 'WAREHOUSE':
      ;[
        'crm.contacts',
        'erp.products',
        'erp.inventory',
        'erp.purchase_orders',
        'erp.invoices',
      ].forEach((k) => on.add(k))
      break
    case 'SALES_EXECUTIVE':
    case 'AGENT':
      ;[
        'crm.leads',
        'crm.contacts',
        'crm.accounts',
        'crm.deals',
        'crm.activities',
        'erp.products',
        'erp.invoices',
        'engagement.whatsapp',
      ].forEach((k) => on.add(k))
      break
    case 'SERVICE_DESK':
      ;[
        'crm.contacts',
        'crm.tickets',
        'crm.amc',
        'crm.stamping',
        'crm.rentals',
        'erp.products',
        'engagement.whatsapp',
      ].forEach((k) => on.add(k))
      break
    case 'SERVICE_ENGINEER':
      ;['crm.contacts', 'crm.tickets', 'hr.attendance', 'engagement.whatsapp'].forEach((k) =>
        on.add(k),
      )
      break
    default:
      ;['crm.contacts', 'crm.tickets'].forEach((k) => on.add(k))
  }

  const out: AllowedModules = {}
  for (const key of tenantKeys) {
    if (key === 'settings') continue
    out[key] = on.has(key)
  }
  return out
}

export function resolveAllowedModules(
  raw: AllowedModules | null | undefined,
  roleCode: string | null | undefined,
  tenantKeys: string[],
): AllowedModules {
  if (roleCode === 'ADMIN') return defaultAllowedModules(tenantKeys)
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return defaultAllowedModulesForRole(roleCode ?? '', tenantKeys)
  }
  const out: AllowedModules = {}
  for (const key of tenantKeys) {
    if (key === 'settings') continue
    // Explicit false/true wins; keys never saved yet stay role-default
    if (key in raw) out[key] = Boolean(raw[key])
    else out[key] = defaultAllowedModulesForRole(roleCode ?? '', [key])[key] ?? false
  }
  return out
}

export function isUserModuleOn(
  allowed: AllowedModules | null | undefined,
  key: string,
  roleCode?: string | null,
): boolean {
  if (key === 'settings') return true
  if (roleCode === 'ADMIN') return true
  if (!allowed || Object.keys(allowed).length === 0) {
    return Boolean(defaultAllowedModulesForRole(roleCode ?? '', [key])[key])
  }
  if (!(key in allowed)) {
    return Boolean(defaultAllowedModulesForRole(roleCode ?? '', [key])[key])
  }
  return Boolean(allowed[key])
}

/** Map a sidebar/route path to a tenant module key (null = always visible). */
export function pathToModuleKey(to: string): string | null {
  const path = to.split('?')[0] || '/'
  if (
    path === '/' ||
    path === '/notifications' ||
    path === '/help' ||
    path === '/my-tasks' ||
    path === '/workqueue' ||
    path === '/settings' ||
    path === '/team-chat' // footer dock via TeamChatOpenPage — not a module gate
  ) {
    return null
  }
  if (path.startsWith('/sale-tracking') || path.startsWith('/leads')) return 'crm.leads'
  if (path.startsWith('/contacts')) return 'crm.contacts'
  if (path.startsWith('/accounts')) return 'crm.accounts'
  if (path.startsWith('/deals')) return 'crm.deals'
  if (path.startsWith('/activities')) return 'crm.activities'
  if (
    path.startsWith('/tickets') ||
    path.startsWith('/spare-parts') ||
    path.startsWith('/service-reports')
  ) {
    return 'crm.tickets'
  }
  if (path.startsWith('/amc')) return 'crm.amc'
  if (path.startsWith('/stamping')) return 'crm.stamping'
  if (path.startsWith('/rentals')) return 'crm.rentals'
  if (path.startsWith('/erp/products') || path.startsWith('/erp/brands')) return 'erp.products'
  if (
    path.startsWith('/erp/stock') ||
    path.startsWith('/erp/inventory') ||
    path.startsWith('/erp/suppliers') ||
    path.startsWith('/erp/releases') ||
    path.startsWith('/erp/delivery-challans') ||
    path.startsWith('/erp/spare-stock')
  ) {
    return 'erp.inventory'
  }
  if (path.startsWith('/erp/purchase')) return 'erp.purchase_orders'
  if (path.startsWith('/erp/invoices')) return 'erp.invoices'
  if (path.startsWith('/whatsapp')) return 'engagement.whatsapp'
  if (path.startsWith('/emails') || path.startsWith('/engagement')) return 'engagement.emails'
  if (path.startsWith('/reports')) return 'reports'
  if (path.startsWith('/attendance')) return 'hr.attendance'
  return null
}
