import type { Dispatch, SetStateAction } from 'react'

export type ClientStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'

export type ClientRow = {
  id: string
  name: string
  code: string
  slug: string
  categoryId: string
  status: ClientStatus
  plan: string
  city: string
  users: number
  maxUsers: number
  createdAt: string
  email?: string
  phone?: string
  addressLine1?: string | null
  addressLine2?: string | null
  postalCode?: string | null
  state?: string | null
  country?: string | null
  website?: string | null
  gstin?: string | null
  logoUrl?: string | null
  trialEndsAt?: string | null
  activatedAt?: string | null
  suspendedAt?: string | null
  subscriptionPack?: string | null
  branding?: {
    palette?: string
    locked?: boolean
    accent?: string
    accentHover?: string
    sidebarBg?: string
    loginTagline?: string
  } | null
  modulesEnabled?: Record<string, boolean> | null
}

export type BusinessCategory = {
  id: string
  code: string
  name: string
  icon: string
  color: string
  description: string
}

export type SubscriptionPack = {
  code: string
  label: string
  description?: string
  defaultMaxUsers?: number
  modules: Record<string, boolean>
}

export type PlanCatalogRow = {
  code: string
  label: string
  maxUsers: number
  modules: Record<string, boolean>
  features: Record<string, boolean>
}

export type PlatformStats = {
  total: number
  active: number
  trial: number
  suspended: number
  categories: number
  users: number
  leads: number
  deals: number
  invoices: number
  products: number
  byPlan: Array<{ plan: string; count: number }>
  byCategory: Array<{ categoryId: string; name: string; color: string; count: number }>
  recentClients: Array<{
    id: string
    name: string
    slug: string
    status: string
    plan: string
    city?: string | null
    maxUsers?: number
    createdAt: string
  }>
}

export type PlatformOutletContext = {
  clients: ClientRow[]
  setClients: Dispatch<SetStateAction<ClientRow[]>>
  categories: BusinessCategory[]
  liveMode: boolean
  subscriptionPacks: SubscriptionPack[]
  plansCatalog: PlanCatalogRow[]
  stats: PlatformStats | null
  /** Open full-page create company */
  onCreate: () => void
  /** Persist a new company (used by /admin/clients/new) */
  createCompany: (row: ClientRow, payload?: Record<string, unknown>) => Promise<void>
  onResetAdmin: (c: ClientRow) => void
  seedStatusFilter: 'ALL' | ClientStatus
  setSeedStatusFilter: (f: 'ALL' | ClientStatus) => void
}

export function statusBadge(status: ClientStatus) {
  if (status === 'ACTIVE') return 'green' as const
  if (status === 'TRIAL') return 'amber' as const
  return 'red' as const
}

export function formatDate(v?: string | null) {
  if (!v) return '—'
  const d = String(v).slice(0, 10)
  return d || '—'
}
