/**
 * Company-controlled sidebar: the admin picks, per role, which sections, links and dropdown
 * sub-links are shown. Stored in tenant.settings.sidebar = { [roleKey]: { hidden: string[] } }.
 * Hiding only declutters the menu — page access is still governed by role permissions.
 */
import { create } from 'zustand'
import { api, isTenantSession } from '@/lib/api'
import {
  isCompanyAdmin,
  isSalesExecutive,
  isServiceDesk,
  isServiceEngineer,
  isWarehouse,
} from '@/lib/roles'

export type SidebarRoleKey =
  | 'ADMIN'
  | 'SERVICE_DESK'
  | 'SALES_EXECUTIVE'
  | 'SERVICE_ENGINEER'
  | 'WAREHOUSE'
  | 'OTHER'

export const SIDEBAR_ROLES: Array<{ key: SidebarRoleKey; label: string }> = [
  { key: 'ADMIN', label: 'Admin' },
  { key: 'SERVICE_DESK', label: 'Service desk' },
  { key: 'SERVICE_ENGINEER', label: 'Service engineer' },
  { key: 'SALES_EXECUTIVE', label: 'Sales' },
  { key: 'WAREHOUSE', label: 'Warehouse' },
]

/** Same order as the Sidebar's own role → menu choice. */
export function sidebarRoleKey(role: string | null | undefined): SidebarRoleKey {
  if (isCompanyAdmin(role)) return 'ADMIN'
  if (isServiceDesk(role)) return 'SERVICE_DESK'
  if (isSalesExecutive(role)) return 'SALES_EXECUTIVE'
  if (isServiceEngineer(role)) return 'SERVICE_ENGINEER'
  if (isWarehouse(role)) return 'WAREHOUSE'
  return 'OTHER'
}

export type SidebarConfig = Partial<Record<SidebarRoleKey, { hidden: string[] }>>

/** Serializable menu tree (no icons) — what the Settings editor shows. */
export type CatalogQuick = { key: string; label: string }
export type CatalogItem = { key: string; label: string; locked?: boolean; quick: CatalogQuick[] }
export type CatalogSection = { key: string; label: string; locked?: boolean; items: CatalogItem[] }
export type SidebarCatalog = Partial<Record<SidebarRoleKey, CatalogSection[]>>

type QuickLike = { label: string; to: string }
type ItemLike = { label: string; to: string; quickActions?: QuickLike[] }
type SectionLike = { label: string; items: ItemLike[] }

function normPath(to: string) {
  // Attendance link carries a per-page returnUrl — key on the route only
  if (to.startsWith('/attendance')) return '/attendance'
  return to
}
export const sectionKey = (s: { label: string }) => `s:${s.label}`
export const itemKey = (i: { to: string }) => `i:${normPath(i.to)}`
export const quickKey = (i: { to: string }, q: { to: string }) => `q:${normPath(i.to)}>${q.to}`

/** Admin can never hide their own way back to Settings. */
export function isLockedItem(roleKey: SidebarRoleKey, item: { to: string }) {
  return roleKey === 'ADMIN' && normPath(item.to).startsWith('/settings')
}

export function applySidebarConfig<S extends SectionLike>(
  sections: S[],
  roleKey: SidebarRoleKey,
  config: SidebarConfig | null | undefined,
): S[] {
  const hidden = new Set(config?.[roleKey]?.hidden ?? [])
  if (!hidden.size) return sections
  return sections
    .map((section) => {
      const sectionOff = hidden.has(sectionKey(section))
      const items = section.items
        .filter((item) => isLockedItem(roleKey, item) || (!sectionOff && !hidden.has(itemKey(item))))
        .map((item) =>
          item.quickActions?.length
            ? { ...item, quickActions: item.quickActions.filter((q) => !hidden.has(quickKey(item, q))) }
            : item,
        )
      return items.length ? { ...section, items } : null
    })
    .filter((s): s is S => Boolean(s))
}

export function toCatalog(roleKey: SidebarRoleKey, sections: SectionLike[]): CatalogSection[] {
  return sections.map((s) => {
    const items = s.items.map((i) => ({
      key: itemKey(i),
      label: i.label,
      locked: isLockedItem(roleKey, i),
      quick: (i.quickActions ?? []).map((q) => ({ key: quickKey(i, q), label: q.label })),
    }))
    return { key: sectionKey(s), label: s.label, locked: items.some((i) => i.locked), items }
  })
}

type SidebarConfigState = {
  config: SidebarConfig | null
  catalog: SidebarCatalog
  loaded: boolean
  load: () => Promise<void>
  save: (next: SidebarConfig) => Promise<void>
  setCatalog: (catalog: SidebarCatalog) => void
}

export const useSidebarConfigStore = create<SidebarConfigState>((set, get) => ({
  config: null,
  catalog: {},
  loaded: false,
  load: async () => {
    if (!isTenantSession()) return
    try {
      const t = await api.myTenant()
      const raw = (t.settings as Record<string, unknown> | null | undefined)?.sidebar
      set({ config: raw && typeof raw === 'object' ? (raw as SidebarConfig) : null, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  save: async (next) => {
    await api.updateMyTenant({ settings: { sidebar: next } })
    set({ config: next })
  },
  setCatalog: (catalog) => {
    if (JSON.stringify(catalog) !== JSON.stringify(get().catalog)) set({ catalog })
  },
}))
