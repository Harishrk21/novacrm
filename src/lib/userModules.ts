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

export function resolveAllowedModules(
  raw: AllowedModules | null | undefined,
  roleCode: string | null | undefined,
  tenantKeys: string[],
): AllowedModules {
  if (roleCode === 'ADMIN') return defaultAllowedModules(tenantKeys)
  if (!raw || typeof raw !== 'object') return defaultAllowedModules(tenantKeys)
  const out: AllowedModules = {}
  for (const key of tenantKeys) {
    if (key === 'settings') continue
    out[key] = key in raw ? Boolean(raw[key]) : true
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
  if (!allowed || Object.keys(allowed).length === 0) return true
  if (!(key in allowed)) return true
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
    path === '/team-chat'
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
  return null
}
