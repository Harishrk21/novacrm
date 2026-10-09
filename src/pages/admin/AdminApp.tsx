import { useEffect, useMemo, useState } from 'react'
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useOutletContext,
} from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Building2,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  HeartPulse,
  LayoutDashboard,
  Link2,
  LogOut,
  Package,
  Palette,
  Plus,
  Puzzle,
  Settings2,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { api, isApiOnline } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { MODULE_TOGGLE_OPTIONS, clientLoginUrl, clientLoginPath } from '@/lib/clientWorkspace'
import { LoginPreview } from '@/components/auth/LoginPreview'
import { MeisterLogo } from '@/components/MeisterLogo'
import { PLATFORM_NAME, RESERVED_LOGIN_SLUGS } from '@/lib/branding'
import { ClientsWorkspace } from '@/pages/admin/ClientsWorkspace'
import { ClientDetailPage } from '@/pages/admin/ClientDetailPage'
import {
  AddonsPanel,
  CategoriesPanel,
  LoginDirectoryPanel,
  PlansModulesPanel,
  PlatformBrandingPanel,
  SystemHealthPanel,
  TipsLibraryPanel,
} from '@/pages/admin/PlatformPanels'
import type {
  BusinessCategory,
  ClientRow,
  ClientStatus,
  PlatformOutletContext,
  PlatformStats,
} from '@/pages/admin/platformTypes'

const CATEGORIES: BusinessCategory[] = [
  {
    id: 'bcat-weigh',
    code: 'WEIGHING_MACHINES',
    name: 'Weighing Machines & Scales',
    icon: 'scale',
    color: '#0EA5E9',
    description: 'Industrial, retail, jewellery & truck scales',
  },
  {
    id: 'bcat-retail',
    code: 'RETAIL_COMMERCE',
    name: 'Retail & Commerce',
    icon: 'store',
    color: '#10B981',
    description: 'Shops and distributors',
  },
  {
    id: 'bcat-mfg',
    code: 'MANUFACTURING',
    name: 'Manufacturing',
    icon: 'factory',
    color: '#F59E0B',
    description: 'Make-to-order manufacturers',
  },
  {
    id: 'bcat-svc',
    code: 'SERVICES',
    name: 'Professional Services',
    icon: 'briefcase',
    color: '#8B5CF6',
    description: 'Agencies, AMC, consultancies',
  },
  {
    id: 'bcat-re',
    code: 'REAL_ESTATE',
    name: 'Real Estate',
    icon: 'building',
    color: '#EF4444',
    description: 'Brokers and builders',
  },
  {
    id: 'bcat-auto',
    code: 'AUTOMOTIVE',
    name: 'Automotive',
    icon: 'car',
    color: '#2563EB',
    description: 'Dealers and spare parts',
  },
]

const DEMO_CLIENTS: ClientRow[] = [
  {
    id: 't1',
    name: 'Precision Scales India',
    code: 'PSI01',
    slug: 'precision-scales',
    categoryId: 'bcat-weigh',
    status: 'ACTIVE',
    plan: 'BUSINESS',
    city: 'Coimbatore',
    users: 12,
    maxUsers: 25,
    createdAt: '2026-01-12',
  },
  {
    id: 't2',
    name: 'Metro Retail Hub',
    code: 'MRH02',
    slug: 'metro-retail',
    categoryId: 'bcat-retail',
    status: 'TRIAL',
    plan: 'STARTER',
    city: 'Chennai',
    users: 5,
    maxUsers: 10,
    createdAt: '2026-03-02',
  },
  {
    id: 't3',
    name: 'ForgeTech Manufacturing',
    code: 'FTM03',
    slug: 'forgetech',
    categoryId: 'bcat-mfg',
    status: 'ACTIVE',
    plan: 'GROWTH',
    city: 'Pune',
    users: 28,
    maxUsers: 50,
    createdAt: '2025-11-20',
  },
]

const ADMIN_KEY = 'novacrm-platform-admin'
const CLIENTS_KEY = 'novacrm-platform-clients'

function loadClients(): ClientRow[] {
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (raw) return JSON.parse(raw) as ClientRow[]
  } catch {
    /* ignore */
  }
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(DEMO_CLIENTS))
  return DEMO_CLIENTS
}

function saveClients(rows: ClientRow[]) {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(rows))
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<Navigate to="/login/admin" replace />} />
      <Route element={<AdminShell />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewRoute />} />
        <Route path="clients" element={<ClientsRoute />} />
        <Route path="clients/new" element={<CreateCompanyPage />} />
        <Route path="clients/:clientId" element={<ClientDetailPage />} />
        <Route path="login-directory" element={<LoginDirectoryPanel />} />
        <Route path="plans" element={<PlansModulesPanel />} />
        <Route path="categories" element={<CategoriesPanel />} />
        <Route path="addons" element={<AddonsPanel />} />
        <Route path="health" element={<SystemHealthPanel />} />
        <Route path="branding" element={<PlatformBrandingPanel />} />
        <Route path="tips" element={<TipsLibraryPanel />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
    </Routes>
  )
}

function useAdminSession() {
  const authKind = useAuthStore((s) => s.kind)
  const authUser = useAuthStore((s) => s.user)
  const raw = localStorage.getItem(ADMIN_KEY)
  if (authKind === 'platform' && authUser) {
    return { email: authUser.email, name: authUser.name, live: true }
  }
  if (!raw) return null
  try {
    return JSON.parse(raw) as { email: string; name: string; live?: boolean }
  } catch {
    return null
  }
}

function AdminShell() {
  const session = useAdminSession()
  const navigate = useNavigate()
  const logoutAuth = useAuthStore((s) => s.logout)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [categories, setCategories] = useState<BusinessCategory[]>(CATEGORIES)
  const [plansCatalog, setPlansCatalog] = useState<
    Array<{
      code: string
      label: string
      maxUsers: number
      modules: Record<string, boolean>
      features: Record<string, boolean>
    }>
  >([])
  const [subscriptionPacks, setSubscriptionPacks] = useState<
    Array<{
      code: string
      label: string
      description: string
      defaultMaxUsers: number
      modules: Record<string, boolean>
    }>
  >([])
  const [resetTarget, setResetTarget] = useState<ClientRow | null>(null)
  const [resetPassword, setResetPassword] = useState('Demo@12345')
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null)
  const [liveMode, setLiveMode] = useState(true)
  const [seedStatusFilter, setSeedStatusFilter] = useState<'ALL' | ClientStatus>('ALL')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [createdCreds, setCreatedCreds] = useState<{
    slug: string
    email: string
    password: string
    name: string
    client: ClientRow
  } | null>(null)
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const addToast = useUIStore((s) => s.addToast)

  useEffect(() => {
    void (async () => {
      const online = await isApiOnline()
      if (!online) {
        setClients(loadClients())
        setLiveMode(false)
        return
      }
      try {
        const [rows, cats, platformStats, plans] = await Promise.all([
          api.listTenants() as Promise<
            Array<{
              id: string
              name: string
              code: string
              slug: string
              businessCategoryId: string
              status: ClientStatus
              plan: string
              city?: string
              email?: string
              phone?: string
              addressLine1?: string
              addressLine2?: string
              postalCode?: string
              state?: string
              website?: string
              gstin?: string
              maxUsers?: number
              userCount?: number
              createdAt: string
              logoUrl?: string | null
              branding?: ClientRow['branding']
              modulesEnabled?: Record<string, boolean> | null
              trialEndsAt?: string | null
              activatedAt?: string | null
              suspendedAt?: string | null
              subscriptionPack?: string | null
              country?: string | null
            }>
          >,
          api.listCategories() as Promise<
            Array<{
              id: string
              code: string
              name: string
              icon?: string
              colorHex?: string
              description?: string
            }>
          >,
          api.platformStats() as Promise<NonNullable<typeof stats>>,
          api.listPlans().catch(() => ({ plans: [], subscriptionPacks: [] })),
        ])
        setPlansCatalog(Array.isArray(plans) ? plans : plans.plans ?? [])
        setSubscriptionPacks(Array.isArray(plans) ? [] : plans.subscriptionPacks ?? [])
        setStats(platformStats)
        setClients(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            code: r.code,
            slug: r.slug,
            categoryId: r.businessCategoryId,
            status: r.status,
            plan: r.plan,
            city: r.city ?? '—',
            users: r.userCount ?? 0,
            maxUsers: r.maxUsers ?? 10,
            createdAt: String(r.createdAt).slice(0, 10),
            email: r.email,
            phone: r.phone,
            addressLine1: r.addressLine1 ?? null,
            addressLine2: r.addressLine2 ?? null,
            postalCode: r.postalCode ?? null,
            state: r.state ?? null,
            website: r.website ?? null,
            gstin: r.gstin ?? null,
            logoUrl: r.logoUrl ?? null,
            branding: r.branding ?? null,
            trialEndsAt: r.trialEndsAt ? String(r.trialEndsAt).slice(0, 10) : null,
            activatedAt: r.activatedAt ? String(r.activatedAt).slice(0, 10) : null,
            suspendedAt: r.suspendedAt ? String(r.suspendedAt).slice(0, 10) : null,
            subscriptionPack: r.subscriptionPack ?? null,
            country: r.country ?? null,
            modulesEnabled:
              r.modulesEnabled && typeof r.modulesEnabled === 'object'
                ? (r.modulesEnabled as Record<string, boolean>)
                : null,
          })),
        )
        if (cats.length) {
          setCategories(
            cats.map((c) => ({
              id: c.id,
              code: c.code,
              name: c.name,
              icon: c.icon ?? 'sparkles',
              color: c.colorHex ?? '#2563EB',
              description: c.description ?? '',
            })),
          )
        }
        setLiveMode(true)
      } catch {
        setClients(loadClients())
        setLiveMode(false)
      }
    })()
  }, [])

  if (!session) return <Navigate to="/login/admin" replace />

  async function createCompany(row: ClientRow, payload?: Record<string, unknown>) {
    if (liveMode && payload) {
      try {
        const created = (await api.createTenant(payload)) as {
          id: string
          name: string
          code: string
          slug: string
          businessCategoryId: string
          status: ClientStatus
          plan: string
          city?: string
          email?: string
          phone?: string
          addressLine1?: string
          addressLine2?: string
          postalCode?: string
          state?: string
          website?: string
          gstin?: string
          createdAt: string
          login?: { tenantSlug: string; email: string; temporaryPassword: string }
        }
        const modulesEnabled = Object.fromEntries(
          MODULE_TOGGLE_OPTIONS.map((m) => [m.key, false]),
        ) as Record<string, boolean>
        modulesEnabled['crm.contacts'] = true
        modulesEnabled.settings = true
        const mapped: ClientRow = {
          id: created.id,
          name: created.name,
          code: created.code,
          slug: created.slug,
          categoryId: created.businessCategoryId,
          status: created.status,
          plan: created.plan ?? 'STARTER',
          city: created.city ?? row.city,
          users: 1,
          maxUsers: 10,
          createdAt: String(created.createdAt).slice(0, 10),
          email: created.email ?? row.email,
          phone: created.phone ?? row.phone,
          addressLine1: created.addressLine1 ?? row.addressLine1,
          addressLine2: created.addressLine2 ?? row.addressLine2,
          postalCode: created.postalCode ?? row.postalCode,
          state: created.state ?? row.state,
          website: created.website ?? row.website,
          gstin: created.gstin ?? row.gstin,
          modulesEnabled,
        }
        setClients((c) => [mapped, ...c])
        if (created.login) {
          setCreatedCreds({
            name: created.name,
            slug: created.login.tenantSlug,
            email: created.login.email,
            password: created.login.temporaryPassword,
            client: mapped,
          })
          navigate('/admin/clients')
        } else {
          navigate(`/admin/clients/${mapped.id}`)
        }
        addToast({
          type: 'success',
          message: `Company ${mapped.name} created — login /login/${mapped.slug}`,
        })
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof Error ? err.message : 'Create failed',
        })
        throw err
      }
      return
    }
    const next = [row, ...clients]
    setClients(next)
    saveClients(next)
    navigate(`/admin/clients/${row.id}`)
    addToast({ type: 'success', message: `Company ${row.name} created (local)` })
  }

  const outletContext: PlatformOutletContext = {
    clients,
    setClients,
    categories,
    liveMode,
    subscriptionPacks,
    plansCatalog,
    stats,
    onCreate: () => navigate('/admin/clients/new'),
    createCompany,
    onResetAdmin: (c) => {
      setResetTarget(c)
      setResetPassword('Demo@12345')
      setResetResult(null)
    },
    seedStatusFilter,
    setSeedStatusFilter,
  }

  const navGroups = [
    {
      label: 'Operations',
      items: [
        { to: '/admin/overview', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/admin/clients', label: 'Clients', icon: Building2, end: false },
        { to: '/admin/login-directory', label: 'Login directory', icon: Link2, end: true },
        { to: '/admin/health', label: 'System health', icon: HeartPulse, end: true },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { to: '/admin/plans', label: 'Plans & modules', icon: CreditCard, end: true },
        { to: '/admin/categories', label: 'Categories', icon: Sparkles, end: true },
        { to: '/admin/addons', label: 'Add-ons', icon: Puzzle, end: true },
      ],
    },
    {
      label: 'Platform',
      items: [
        { to: '/admin/branding', label: 'Branding', icon: Palette, end: true },
        { to: '/admin/tips', label: 'Tips library', icon: BookOpen, end: true },
      ],
    },
  ] as const

  async function handleCopy(value: string, key: string) {
    const ok = await copyText(value)
    if (ok) {
      setCopiedKey(key)
      addToast({ type: 'success', message: 'Copied to clipboard' })
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000)
    } else {
      addToast({ type: 'error', message: 'Could not copy — select the text manually' })
    }
  }

  return (
    <div className="flex h-full bg-surface">
      <aside className="flex w-64 shrink-0 flex-col bg-[#020617] text-slate-300">
        <div className="border-b border-white/10 px-4 py-4">
          <MeisterLogo size="sm" dark className="[&_img]:max-h-10 [&_img]:max-w-[148px]" />
          <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
            Super admin
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm transition',
                        isActive ? 'bg-blue-600 text-white' : 'hover:bg-white/5',
                      )
                    }
                  >
                    <item.icon size={16} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-slate-400">
            <div className="flex items-center justify-between gap-2">
              <span>API</span>
              <span className={liveMode ? 'text-emerald-400' : 'text-amber-400'}>
                {liveMode ? 'Live' : 'Offline'}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>Clients</span>
              <span className="tabular-nums text-slate-200">{clients.length}</span>
            </div>
          </div>
          <div className="mb-2 flex items-center gap-2 px-1">
            <Avatar name={session.name} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{session.name}</div>
              <div className="truncate text-[11px] text-slate-500">{session.email}</div>
            </div>
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-red-300 hover:bg-white/5"
            onClick={() => {
              void logoutAuth()
              localStorage.removeItem(ADMIN_KEY)
              navigate('/login/admin', { replace: true })
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet context={outletContext} />
      </main>

      <Modal
        open={Boolean(createdCreds)}
        onClose={() => setCreatedCreds(null)}
        title="Company created"
        subtitle="Next step: configure subscribed modules and brand colors."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreatedCreds(null)}>
              Later
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const slug = createdCreds?.slug
                setCreatedCreds(null)
                if (slug) navigate(clientLoginPath(slug))
              }}
            >
              Preview login
            </Button>
            <Button
              onClick={() => {
                const client = createdCreds?.client
                setCreatedCreds(null)
                if (client) navigate(`/admin/clients/${client.id}`)
              }}
            >
              Configure now
            </Button>
          </>
        }
      >
        {createdCreds ? (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{createdCreds.name}</strong> company profile is saved. Share admin credentials, then
              configure modules.
            </p>
            {[
              ['Login URL', clientLoginUrl(createdCreds.slug)],
              ['Admin email', createdCreds.email],
              ['Temporary password', createdCreds.password],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</div>
                  <button
                    type="button"
                    className="text-xs text-accent-blue hover:underline"
                    onClick={() => void handleCopy(value, `cred-${label}`)}
                  >
                    {copiedKey === `cred-${label}` ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="break-all font-mono font-semibold">{value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => {
          setResetTarget(null)
          setResetResult(null)
        }}
        title="Reset company admin password"
        subtitle={resetTarget ? `${resetTarget.name} · ${resetTarget.slug}` : undefined}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setResetTarget(null)
                setResetResult(null)
              }}
            >
              Close
            </Button>
            {!resetResult ? (
              <Button
                onClick={() =>
                  void (async () => {
                    if (!resetTarget) return
                    try {
                      const row = await api.resetTenantAdminPassword(resetTarget.id, resetPassword)
                      setResetResult({ email: row.adminEmail, password: row.temporaryPassword })
                      addToast({ type: 'success', message: 'Admin password reset' })
                    } catch (err) {
                      addToast({
                        type: 'error',
                        message: err instanceof Error ? err.message : 'Reset failed',
                      })
                    }
                  })()
                }
              >
                Reset password
              </Button>
            ) : null}
          </>
        }
      >
        {resetResult ? (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono">
              {resetResult.email}
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono font-semibold">
              {resetResult.password}
            </div>
          </div>
        ) : (
          <Input
            label="New temporary password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
          />
        )}
      </Modal>
    </div>
  )
}

function OverviewRoute() {
  const ctx = useOutletContext<PlatformOutletContext>()
  const navigate = useNavigate()
  return (
    <OverviewDashboard
      clients={ctx.clients}
      categories={ctx.categories}
      stats={ctx.stats}
      liveMode={ctx.liveMode}
      packCount={ctx.subscriptionPacks.length || 3}
      onCreate={ctx.onCreate}
      onOpenClients={(filter) => {
        ctx.setSeedStatusFilter(filter)
        navigate('/admin/clients')
      }}
      onOpenPlans={() => navigate('/admin/plans')}
      onOpenCategories={() => navigate('/admin/categories')}
      onOpenClient={(c) => navigate(`/admin/clients/${c.id}`)}
    />
  )
}

function ClientsRoute() {
  const ctx = useOutletContext<PlatformOutletContext>()
  return (
    <ClientsWorkspace
      clients={ctx.clients}
      onClientsChange={ctx.setClients}
      categories={ctx.categories}
      liveMode={ctx.liveMode}
      subscriptionPacks={ctx.subscriptionPacks}
      onCreate={ctx.onCreate}
      onResetAdmin={ctx.onResetAdmin}
      seedStatusFilter={ctx.seedStatusFilter}
    />
  )
}

type StatsShape = {
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

function OverviewDashboard({
  clients,
  categories,
  stats,
  liveMode,
  packCount,
  onCreate,
  onOpenClients,
  onOpenPlans,
  onOpenCategories,
  onOpenClient,
}: {
  clients: ClientRow[]
  categories: BusinessCategory[]
  stats: StatsShape | null
  liveMode: boolean
  packCount: number
  onCreate: () => void
  onOpenClients: (filter: 'ALL' | ClientStatus) => void
  onOpenPlans: () => void
  onOpenCategories: () => void
  onOpenClient: (c: ClientRow) => void
}) {
  const total = stats?.total ?? clients.length
  const active = stats?.active ?? clients.filter((c) => c.status === 'ACTIVE').length
  const trial = stats?.trial ?? clients.filter((c) => c.status === 'TRIAL').length
  const suspended = stats?.suspended ?? clients.filter((c) => c.status === 'SUSPENDED').length
  const users = stats?.users ?? clients.reduce((n, c) => n + (c.users || 0), 0)
  const seatsCap = clients.reduce((n, c) => n + (c.maxUsers || 0), 0)

  const byPlan =
    stats?.byPlan?.length
      ? stats.byPlan
      : Object.entries(
          clients.reduce<Record<string, number>>((acc, c) => {
            acc[c.plan] = (acc[c.plan] ?? 0) + 1
            return acc
          }, {}),
        ).map(([plan, count]) => ({ plan, count }))

  const byCategory =
    stats?.byCategory?.length
      ? stats.byCategory
      : categories
          .map((cat) => ({
            categoryId: cat.id,
            name: cat.name,
            color: cat.color,
            count: clients.filter((c) => c.categoryId === cat.id).length,
          }))
          .filter((r) => r.count > 0)

  const attention = clients
    .filter((c) => c.status === 'TRIAL' || c.status === 'SUSPENDED')
    .slice(0, 6)

  const recent: ClientRow[] = (stats?.recentClients ?? clients.slice(0, 8)).map((raw) => {
    const found = clients.find((x) => x.id === raw.id)
    if (found) return found
    return {
      id: raw.id,
      name: raw.name,
      slug: raw.slug,
      code: '',
      categoryId: '',
      status: raw.status as ClientStatus,
      plan: raw.plan,
      city: raw.city ?? '—',
      users: 0,
      maxUsers: raw.maxUsers ?? 10,
      createdAt: String(raw.createdAt).slice(0, 10),
    }
  })

  const statusMix = [
    { label: 'Active', count: active, color: '#10B981' },
    { label: 'Trial', count: trial, color: '#F59E0B' },
    { label: 'Suspended', count: suspended, color: '#F43F5E' },
  ]
  const statusTotal = Math.max(total, 1)

  const usage = [
    { label: 'Leads', value: stats?.leads ?? 0, icon: TrendingUp },
    { label: 'Deals', value: stats?.deals ?? 0, icon: Activity },
    { label: 'Invoices', value: stats?.invoices ?? 0, icon: FileText },
    { label: 'Products', value: stats?.products ?? 0, icon: Package },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Overview</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            Tenant health, seats, and follow-ups across every workspace. Create companies here —
            configure modules and branding in each client&apos;s detail panel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={liveMode ? 'green' : 'amber'}>{liveMode ? 'Live API' : 'Local demo'}</Badge>
          <Button onClick={onCreate}>
            <Plus size={16} /> Create company
          </Button>
        </div>
      </div>

      {/* KPI strip — industry standard for platform admin */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            {
              key: 'ALL' as const,
              label: 'Total tenants',
              value: total,
              hint: 'All workspaces',
              icon: Building2,
              tint: 'border-sky-500/30 dark:border-sky-400/25',
              iconBg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
            },
            {
              key: 'ACTIVE' as const,
              label: 'Active',
              value: active,
              hint: total ? `${Math.round((active / statusTotal) * 100)}% of tenants` : 'Paying / live',
              icon: Check,
              tint: 'border-emerald-500/30 dark:border-emerald-400/25',
              iconBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            },
            {
              key: 'TRIAL' as const,
              label: 'Trials',
              value: trial,
              hint: trial ? 'Needs conversion follow-up' : 'No open trials',
              icon: Clock,
              tint: 'border-amber-500/30 dark:border-amber-400/25',
              iconBg: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
            },
            {
              key: 'SUSPENDED' as const,
              label: 'Suspended',
              value: suspended,
              hint: suspended ? 'Access currently blocked' : 'None blocked',
              icon: AlertTriangle,
              tint: 'border-rose-500/30 dark:border-rose-400/25',
              iconBg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
            },
          ]
        ).map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => onOpenClients(tile.key)}
            className={cn(
              'group rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
              'bg-card text-text-primary',
              tile.tint,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className={cn('rounded-lg p-2', tile.iconBg)}>
                <tile.icon size={16} />
              </div>
              <ChevronRight size={16} className="text-text-secondary opacity-0 transition group-hover:opacity-100" />
            </div>
            <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-text-primary">
              {tile.value}
            </div>
            <div className="mt-0.5 text-sm font-medium text-text-primary">{tile.label}</div>
            <div className="mt-1 text-xs text-text-secondary">{tile.hint}</div>
          </button>
        ))}
      </div>

      {/* Secondary platform metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'End users',
            value: users,
            sub: seatsCap ? `${seatsCap} seat capacity` : 'Across all tenants',
            icon: Users,
            onClick: () => onOpenClients('ALL'),
          },
          {
            label: 'Industries',
            value: stats?.categories ?? categories.length,
            sub: 'Business categories',
            icon: Sparkles,
            onClick: onOpenCategories,
          },
          {
            label: 'Subscription packs',
            value: packCount,
            sub: 'Sales / Inv / HMS',
            icon: CreditCard,
            onClick: onOpenPlans,
          },
          {
            label: 'Seat utilization',
            value: seatsCap ? `${Math.min(100, Math.round((users / seatsCap) * 100))}%` : '—',
            sub: seatsCap ? `${users} / ${seatsCap} seats` : 'Create tenants to track',
            icon: Activity,
            onClick: () => onOpenClients('ALL'),
          },
        ].map((m) => (
          <button
            key={m.label}
            type="button"
            onClick={m.onClick}
            className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-accent-blue/40"
          >
            <div className="flex items-center justify-between text-text-secondary">
              <m.icon size={16} />
              <ChevronRight size={14} />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{m.value}</div>
            <div className="text-sm font-medium">{m.label}</div>
            <div className="mt-0.5 text-xs text-text-secondary">{m.sub}</div>
          </button>
        ))}
      </div>

      {total === 0 ? (
        <Card className="border-dashed py-14 text-center">
          <Building2 className="mx-auto text-text-secondary" size={32} />
          <h2 className="mt-3 text-lg font-semibold">No tenants yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
            Start with company details (name, address, admin). Modules and colors come next in client detail.
          </p>
          <Button className="mt-5" onClick={onCreate}>
            <Plus size={16} /> Create first company
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {/* Main column */}
          <div className="space-y-4 xl:col-span-2">
            {/* Needs attention */}
            <Card padding={false} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-600" />
                  <h2 className="font-semibold">Needs attention</h2>
                  <Badge color="amber">{attention.length}</Badge>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-accent-blue hover:underline"
                  onClick={() => onOpenClients('TRIAL')}
                >
                  View trials
                </button>
              </div>
              {attention.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-text-secondary">
                  All tenants look healthy — no trials or suspensions.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {attention.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onOpenClient(c)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{c.name}</div>
                          <div className="truncate text-xs text-text-secondary">
                            /{c.slug} · {c.city} · {c.plan}
                          </div>
                        </div>
                        <Badge color={c.status === 'TRIAL' ? 'amber' : 'red'}>{c.status}</Badge>
                        <ChevronRight size={14} className="text-text-secondary" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Recent tenants table */}
            <Card padding={false} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-semibold">Recent tenants</h2>
                <button
                  type="button"
                  className="text-xs font-medium text-accent-blue hover:underline"
                  onClick={() => onOpenClients('ALL')}
                >
                  All clients
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-text-secondary">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Company</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Plan</th>
                      <th className="px-4 py-2.5 font-medium">Seats</th>
                      <th className="px-4 py-2.5 font-medium">Created</th>
                      <th className="px-4 py-2.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recent.map((c) => {
                      const kit =
                        PALETTES[(c.branding?.palette as ColorPalette) || 'violet'] ?? PALETTES.violet
                      return (
                        <tr
                          key={c.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => onOpenClient(c)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ background: c.branding?.accent || kit.accent }}
                              />
                              <div className="min-w-0">
                                <div className="truncate font-medium">{c.name}</div>
                                <div className="truncate font-mono text-[11px] text-text-secondary">
                                  /{c.slug}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              color={
                                c.status === 'ACTIVE' ? 'green' : c.status === 'TRIAL' ? 'amber' : 'red'
                              }
                            >
                              {c.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-text-secondary">{c.plan}</td>
                          <td className="px-4 py-3 tabular-nums text-text-secondary">
                            {c.users}/{c.maxUsers}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-text-secondary">{c.createdAt}</td>
                          <td className="px-4 py-3 text-right">
                            <ChevronRight size={14} className="inline text-text-secondary" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Cross-tenant usage */}
            <Card>
              <h2 className="mb-3 font-semibold">Platform activity</h2>
              <p className="mb-4 text-xs text-text-secondary">
                Aggregated records across all tenant workspaces
              </p>
              <div className="grid gap-3 sm:grid-cols-4">
                {usage.map((u) => (
                  <div key={u.label} className="rounded-lg border border-border bg-muted/30 p-3">
                    <u.icon size={14} className="text-text-secondary" />
                    <div className="mt-2 text-xl font-bold tabular-nums">{u.value}</div>
                    <div className="text-xs text-text-secondary">{u.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Side column */}
          <div className="space-y-4">
            <Card>
              <h2 className="mb-3 font-semibold">Quick actions</h2>
              <div className="space-y-2">
                {[
                  {
                    label: 'Create company',
                    desc: 'Name, address & first admin',
                    icon: Plus,
                    onClick: onCreate,
                  },
                  {
                    label: 'Browse clients',
                    desc: 'Open client for modules & colors',
                    icon: Building2,
                    onClick: () => onOpenClients('ALL'),
                  },
                  {
                    label: 'Plans & modules',
                    desc: 'Packs and seat limits',
                    icon: CreditCard,
                    onClick: onOpenPlans,
                  },
                  {
                    label: 'Business categories',
                    desc: 'Industry templates',
                    icon: Sparkles,
                    onClick: onOpenCategories,
                  },
                ].map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.onClick}
                    className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-accent-blue/40 hover:bg-muted/40"
                  >
                    <span className="rounded-md bg-muted p-2 text-text-secondary">
                      <a.icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{a.label}</span>
                      <span className="block text-xs text-text-secondary">{a.desc}</span>
                    </span>
                    <ChevronRight size={14} className="text-text-secondary" />
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-1 font-semibold">Status mix</h2>
              <p className="mb-3 text-xs text-text-secondary">{total} tenants</p>
              <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
                {statusMix.map((s) =>
                  s.count > 0 ? (
                    <div
                      key={s.label}
                      title={`${s.label}: ${s.count}`}
                      style={{
                        width: `${(s.count / statusTotal) * 100}%`,
                        background: s.color,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="space-y-2">
                {statusMix.map((s) => (
                  <li key={s.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <span className="tabular-nums font-medium">
                      {s.count}
                      <span className="ml-1 text-xs font-normal text-text-secondary">
                        ({Math.round((s.count / statusTotal) * 100)}%)
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2 className="mb-1 font-semibold">Plan distribution</h2>
              <p className="mb-3 text-xs text-text-secondary">Tenants by commercial plan</p>
              {byPlan.length === 0 ? (
                <p className="text-sm text-text-secondary">No plan data yet.</p>
              ) : (
                <ul className="space-y-3">
                  {byPlan
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((row) => (
                      <li key={row.plan}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium">{row.plan}</span>
                          <span className="tabular-nums text-text-secondary">{row.count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-accent-blue"
                            style={{ width: `${(row.count / statusTotal) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </Card>

            {byCategory.length > 0 && (
              <Card>
                <h2 className="mb-1 font-semibold">By industry</h2>
                <p className="mb-3 text-xs text-text-secondary">Clients per business category</p>
                <ul className="space-y-2">
                  {byCategory
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 6)
                    .map((row) => (
                      <li key={row.categoryId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: row.color }}
                          />
                          <span className="truncate">{row.name}</span>
                        </span>
                        <span className="tabular-nums font-medium">{row.count}</span>
                      </li>
                    ))}
                </ul>
              </Card>
            )}

            <Card className="bg-slate-900 text-slate-100">
              <h2 className="mb-1 font-semibold text-white">Onboarding path</h2>
              <ol className="mt-3 space-y-3 text-sm text-slate-300">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    1
                  </span>
                  <span>
                    <span className="font-medium text-white">Create company</span>
                    <br />
                    Profile + address + first admin only
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    2
                  </span>
                  <span>
                    <span className="font-medium text-white">Open client</span>
                    <br />
                    Packs, module toggles, seats
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    3
                  </span>
                  <span>
                    <span className="font-medium text-white">Brand login</span>
                    <br />
                    Palette, logo, tagline + /login/slug with live preview
                  </span>
                </li>
              </ol>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateCompanyPage() {
  const navigate = useNavigate()
  const { categories, liveMode, createCompany } = useOutletContext<PlatformOutletContext>()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [slug, setSlug] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [website, setWebsite] = useState('')
  const [gstin, setGstin] = useState('')
  const [adminName, setAdminName] = useState('Workspace Admin')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('Demo@12345')
  const [palette, setPalette] = useState<ColorPalette>('ocean')
  const [logoUrl, setLogoUrl] = useState('')
  const [loginTagline, setLoginTagline] = useState('')
  const [accent, setAccent] = useState(PALETTES.ocean.accent)
  const [saving, setSaving] = useState(false)
  const [slugError, setSlugError] = useState<string | null>(null)

  useEffect(() => {
    if (categories[0] && !categoryId) setCategoryId(categories[0].id)
  }, [categories, categoryId])

  useEffect(() => {
    if (!name.trim()) return
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
    if (!slug) setSlug(base)
    if (!code) setCode(base.replace(/-/g, '').slice(0, 8).toUpperCase() || 'CLIENT')
    if (!adminEmail && base) setAdminEmail(`admin@${base.replace(/-/g, '')}.com`)
    if (!email && base) setEmail(`hello@${base.replace(/-/g, '')}.com`)
    if (!loginTagline && name.trim()) setLoginTagline(`Sign in to ${name.trim()}`)
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = slug.trim().toLowerCase()
    if (!s) {
      setSlugError(null)
      return
    }
    if ((RESERVED_LOGIN_SLUGS as readonly string[]).includes(s)) {
      setSlugError(`“${s}” is reserved for ${PLATFORM_NAME} platform login`)
      return
    }
    if (!/^[a-z0-9-]+$/.test(s)) {
      setSlugError('Use lowercase letters, numbers, and hyphens only')
      return
    }
    setSlugError(null)
  }, [slug])

  const preview = useMemo(() => categories.find((c) => c.id === categoryId), [categories, categoryId])
  const resolvedAccent = accent.match(/^#[0-9A-Fa-f]{6}$/) ? accent : PALETTES[palette].accent

  function resetForm() {
    setName('')
    setCode('')
    setSlug('')
    setEmail('')
    setPhone('')
    setAddressLine1('')
    setAddressLine2('')
    setCity('')
    setState('')
    setPostalCode('')
    setWebsite('')
    setGstin('')
    setAdminEmail('')
    setAdminPassword('Demo@12345')
    setAdminName('Workspace Admin')
    setCategoryId(categories[0]?.id ?? '')
    setPalette('ocean')
    setAccent(PALETTES.ocean.accent)
    setLogoUrl('')
    setLoginTagline('')
    setSlugError(null)
  }

  async function submit() {
    if (!name.trim() || !code.trim() || !slug.trim() || !categoryId || slugError) return
    if (liveMode && (!adminEmail.trim() || adminPassword.length < 8)) return
    const row: ClientRow = {
      id: `t-${Date.now()}`,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      slug: slug.trim().toLowerCase(),
      categoryId,
      status: 'TRIAL',
      plan: 'STARTER',
      city: city.trim() || '—',
      users: 1,
      maxUsers: 10,
      createdAt: new Date().toISOString().slice(0, 10),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      addressLine1: addressLine1.trim() || null,
      addressLine2: addressLine2.trim() || null,
      postalCode: postalCode.trim() || null,
      state: state.trim() || null,
      website: website.trim() || null,
      gstin: gstin.trim() || null,
      logoUrl: logoUrl.trim() || null,
      branding: {
        palette,
        locked: true,
        accent: resolvedAccent,
        ...(loginTagline.trim() ? { loginTagline: loginTagline.trim() } : {}),
      },
    }
    const payload = liveMode
      ? {
          name: row.name,
          code: row.code,
          slug: row.slug,
          businessCategoryId: categoryId,
          status: 'TRIAL',
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          addressLine1: addressLine1.trim() || undefined,
          addressLine2: addressLine2.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          website: website.trim() || undefined,
          gstin: gstin.trim() || undefined,
          logoUrl: logoUrl.trim() || null,
          branding: {
            palette,
            locked: true,
            accent: resolvedAccent,
            ...(loginTagline.trim() ? { loginTagline: loginTagline.trim() } : {}),
          },
          adminName: adminName.trim() || 'Workspace Admin',
          adminEmail: adminEmail.trim().toLowerCase(),
          adminPassword,
        }
      : undefined
    setSaving(true)
    try {
      await createCompany(row, payload)
      resetForm()
    } catch {
      /* toast already shown */
    } finally {
      setSaving(false)
    }
  }

  const slugNorm = slug.trim().toLowerCase() || 'slug'

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-text-secondary">
            <Link to="/admin/clients" className="hover:text-accent-blue">
              Clients
            </Link>
            <ChevronRight size={12} />
            <span>Create company</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create company</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Full company profile, branded login URL after <span className="font-mono">/login/</span>,
            first admin, and preview — modules are configured on the client detail page next.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/clients')}>
            Cancel
          </Button>
          <Button
            disabled={saving || !categoryId || Boolean(slugError) || !name.trim() || !slug.trim()}
            onClick={() => void submit()}
          >
            {saving ? 'Creating…' : 'Create company'}
          </Button>
        </div>
      </div>

      <FeatureTip
        title="Branded client login"
        body={`Pick any login name below — staff sign in at /login/{your-slug} (e.g. /login/hms). You stay on /login/admin as ${PLATFORM_NAME}.`}
        tipType="TIP"
      />

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Card className="space-y-4 border-sky-300/50 bg-sky-50/40 p-5 dark:border-sky-800/40 dark:bg-sky-950/20">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Login URL name</h3>
              <p className="mt-0.5 text-xs text-text-secondary">
                This becomes the path after <span className="font-mono">/login/</span>. Letters,
                numbers, and hyphens only. Reserved words like <span className="font-mono">admin</span>{' '}
                cannot be used.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-text-secondary">
                /login/
              </div>
              <div className="min-w-[200px] flex-1">
                <Input
                  label="Login name *"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="hms"
                  error={slugError ?? undefined}
                />
              </div>
            </div>
            <p className="font-mono text-sm font-medium text-accent-blue">
              Full URL path → /login/{slugNorm}
            </p>
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">Company details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Company name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Precision Scales India"
              />
              <Select
                label="Industry / category *"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
              <Input
                label="Client code *"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="PSI01"
              />
              <Input
                label="Company email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Input
                className="sm:col-span-2"
                label="Address line 1"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
              <Input
                className="sm:col-span-2"
                label="Address line 2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
              />
              <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
              <Input
                label="Postal code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
              <Input label="GSTIN" value={gstin} onChange={(e) => setGstin(e.target.value)} />
              <Input
                className="sm:col-span-2"
                label="Website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div>
              <h3 className="text-sm font-semibold">First admin login</h3>
              <p className="mt-0.5 text-xs text-text-secondary">
                They sign in at <span className="font-mono">/login/{slugNorm}</span> with these
                credentials.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Admin name"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
              <Input
                label="Admin email *"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
              <Input
                className="sm:col-span-2"
                label="Admin password *"
                type="text"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div>
              <h3 className="text-sm font-semibold">Login page branding</h3>
              <p className="mt-0.5 text-xs text-text-secondary">
                Shown on <span className="font-mono">/login/{slugNorm}</span> before staff sign in.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(PALETTES) as ColorPalette[]).map((key) => {
                const def = PALETTES[key]
                const selected = palette === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPalette(key)
                      setAccent(def.accent)
                    }}
                    className={cn(
                      'rounded-lg border p-2 text-left transition',
                      selected
                        ? 'border-accent-blue ring-2 ring-accent-blue/25'
                        : 'border-border hover:border-accent-blue/40',
                    )}
                  >
                    <div className="mb-1.5 flex gap-1">
                      {def.chart.slice(0, 4).map((color) => (
                        <span
                          key={color}
                          className="h-2 flex-1 rounded-full"
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                    <div className="text-xs font-semibold">{def.label}</div>
                  </button>
                )
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Accent (#hex)"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder={PALETTES[palette].accent}
              />
              <Input
                label="Logo URL"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://… or upload"
              />
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-text-secondary">
                  Upload logo for login page
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    void (async () => {
                      try {
                        const up = await api.uploadImage(f)
                        setLogoUrl(up.url)
                      } catch {
                        /* ignore */
                      }
                    })()
                    e.currentTarget.value = ''
                  }}
                  className="text-sm"
                />
              </div>
              <Input
                className="sm:col-span-2"
                label="Login tagline"
                value={loginTagline}
                onChange={(e) => setLoginTagline(e.target.value)}
                placeholder="Sign in to your workspace"
              />
            </div>
          </Card>
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Live preview
          </div>
          <LoginPreview
            companyName={name.trim() || 'Client company'}
            slug={slugNorm}
            logoUrl={logoUrl.trim() || null}
            palette={palette}
            accent={resolvedAccent}
            tagline={loginTagline.trim() || undefined}
          />
          <Card className="p-4 text-sm">
            <div className="text-xs font-semibold uppercase text-text-secondary">Share with client</div>
            <p className="mt-1 font-mono text-base font-semibold text-accent-blue">
              /login/{slugNorm}
            </p>
            {preview ? (
              <p className="mt-2 text-xs text-text-secondary">
                Industry: <span className="font-medium text-text-primary">{preview.name}</span>
              </p>
            ) : null}
            {!liveMode ? (
              <p className="mt-2 text-xs text-amber-700">API offline — saves a local demo row only.</p>
            ) : null}
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="flex-1" onClick={() => navigate('/admin/clients')}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={saving || !categoryId || Boolean(slugError) || !name.trim() || !slug.trim()}
              onClick={() => void submit()}
            >
              {saving ? 'Creating…' : 'Create company'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminApp
