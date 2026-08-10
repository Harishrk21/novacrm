import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import {
  Building2,
  Factory,
  LayoutDashboard,
  LogOut,
  Plus,
  Scale,
  Settings2,
  Sparkles,
  Store,
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

/** Local admin console state until API is wired — persists in localStorage */
type ClientStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'

interface BusinessCategory {
  id: string
  code: string
  name: string
  icon: string
  color: string
  description: string
}

interface ClientRow {
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
}

const CATEGORIES: BusinessCategory[] = [
  { id: 'bcat-weigh', code: 'WEIGHING_MACHINES', name: 'Weighing Machines & Scales', icon: 'scale', color: '#0EA5E9', description: 'Industrial, retail, jewellery & truck scales' },
  { id: 'bcat-retail', code: 'RETAIL_COMMERCE', name: 'Retail & Commerce', icon: 'store', color: '#10B981', description: 'Shops and distributors' },
  { id: 'bcat-mfg', code: 'MANUFACTURING', name: 'Manufacturing', icon: 'factory', color: '#F59E0B', description: 'Make-to-order manufacturers' },
  { id: 'bcat-svc', code: 'SERVICES', name: 'Professional Services', icon: 'briefcase', color: '#8B5CF6', description: 'Agencies, AMC, consultancies' },
  { id: 'bcat-re', code: 'REAL_ESTATE', name: 'Real Estate', icon: 'building', color: '#EF4444', description: 'Brokers and builders' },
  { id: 'bcat-auto', code: 'AUTOMOTIVE', name: 'Automotive', icon: 'car', color: '#2563EB', description: 'Dealers and spare parts' },
]

const DEMO_CLIENTS: ClientRow[] = [
  { id: 't1', name: 'Precision Scales India', code: 'PSI01', slug: 'precision-scales', categoryId: 'bcat-weigh', status: 'ACTIVE', plan: 'BUSINESS', city: 'Coimbatore', users: 12, maxUsers: 25, createdAt: '2026-01-12' },
  { id: 't2', name: 'Metro Retail Hub', code: 'MRH02', slug: 'metro-retail', categoryId: 'bcat-retail', status: 'TRIAL', plan: 'STARTER', city: 'Chennai', users: 5, maxUsers: 10, createdAt: '2026-03-02' },
  { id: 't3', name: 'ForgeTech Manufacturing', code: 'FTM03', slug: 'forgetech', categoryId: 'bcat-mfg', status: 'ACTIVE', plan: 'GROWTH', city: 'Pune', users: 28, maxUsers: 50, createdAt: '2025-11-20' },
]

const ADMIN_KEY = 'novacrm-platform-admin'
const CLIENTS_KEY = 'novacrm-platform-clients'

function loadClients(): ClientRow[] {
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (raw) return JSON.parse(raw) as ClientRow[]
  } catch { /* ignore */ }
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(DEMO_CLIENTS))
  return DEMO_CLIENTS
}

function saveClients(rows: ClientRow[]) {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(rows))
}

export function AdminApp() {
  return (
    <Routes>
      {/* Unified login is /login — keep this path as a redirect for old bookmarks */}
      <Route path="login" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<AdminShell />} />
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
  const [tab, setTab] = useState<'overview' | 'clients' | 'categories' | 'tips'>('overview')
  const [clients, setClients] = useState<ClientRow[]>([])
  const [categories, setCategories] = useState<BusinessCategory[]>(CATEGORIES)
  const [liveMode, setLiveMode] = useState(false)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<{
    slug: string
    email: string
    password: string
    name: string
  } | null>(null)
  const [stats, setStats] = useState<{
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
  } | null>(null)
  const addToast = useUIStore((s) => s.addToast)

  useEffect(() => {
    void (async () => {
      const online = await isApiOnline()
      if (!online) {
        setClients(loadClients())
        return
      }
      try {
        const [rows, cats, platformStats] = await Promise.all([
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
              maxUsers?: number
              userCount?: number
              createdAt: string
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
        ])
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
      }
    })()
  }, [])

  if (!session) return <Navigate to="/login" replace />

  const filtered = clients.filter(
    (c) =>
      !query ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.code.toLowerCase().includes(query.toLowerCase()) ||
      c.slug.toLowerCase().includes(query.toLowerCase()),
  )

  const tip = DEFAULT_TIPS['platform.tenants']
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id.slice(0, 8)

  return (
    <div className="flex h-full bg-surface">
      <aside className="flex w-60 flex-col bg-[#020617] text-slate-300">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="text-lg font-bold text-white">Nova Platform</div>
          <div className="text-xs text-slate-500">Multi-tenant CRM + ERP</div>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'clients', label: 'Clients', icon: Building2 },
            { id: 'categories', label: 'Business Categories', icon: Sparkles },
            { id: 'tips', label: 'Tips Library', icon: Settings2 },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as typeof tab)}
              className={cn(
                'flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm',
                tab === item.id ? 'bg-blue-600 text-white' : 'hover:bg-white/5',
              )}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
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
              navigate('/login', { replace: true })
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
          <Link to="/" className="mt-1 block px-3 py-2 text-xs text-slate-500 hover:text-white">
            ← Back to CRM app
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">Platform Overview</h1>
              <Badge color={liveMode ? 'green' : 'amber'}>{liveMode ? 'Live API' : 'Local demo'}</Badge>
            </div>
            <FeatureTip
              title="Your control center"
              body="Create clients, set max employee seats, watch adoption across CRM/ERP, and suspend workspaces when needed. Client users never see this console."
              tipType="NOTE"
            />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Total clients', stats?.total ?? clients.length, 'All workspaces'],
                ['Active', stats?.active ?? clients.filter((c) => c.status === 'ACTIVE').length, 'Live paying / ongoing'],
                ['Trials', stats?.trial ?? clients.filter((c) => c.status === 'TRIAL').length, 'Need follow-up'],
                ['Suspended', stats?.suspended ?? clients.filter((c) => c.status === 'SUSPENDED').length, 'Access blocked'],
              ].map(([k, v, s]) => (
                <Card key={String(k)}>
                  <div className="text-sm text-text-secondary">{k}</div>
                  <div className="mt-2 text-3xl font-bold">{v}</div>
                  <div className="mt-1 text-xs text-text-secondary">{s}</div>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['End users', stats?.users ?? '—', 'Employee logins across clients'],
                ['Leads captured', stats?.leads ?? '—', 'All tenants'],
                ['Open deals', stats?.deals ?? '—', 'Pipeline records'],
                ['Invoices issued', stats?.invoices ?? '—', 'ERP billing volume'],
              ].map(([k, v, s]) => (
                <Card key={String(k)}>
                  <div className="text-sm text-text-secondary">{k}</div>
                  <div className="mt-2 text-2xl font-bold">{v}</div>
                  <div className="mt-1 text-xs text-text-secondary">{s}</div>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-3 font-semibold">Clients by plan</h2>
                <div className="space-y-2">
                  {(stats?.byPlan ?? []).length === 0 ? (
                    <p className="text-sm text-text-secondary">No plan data yet.</p>
                  ) : (
                    stats!.byPlan.map((row) => (
                      <div key={row.plan} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                        <span className="font-medium">{row.plan}</span>
                        <Badge color="blue">{row.count}</Badge>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4 text-xs text-text-secondary">
                  Categories live: {stats?.categories ?? categories.length} · Products across tenants:{' '}
                  {stats?.products ?? '—'}
                </div>
              </Card>
              <Card>
                <h2 className="mb-3 font-semibold">Clients by industry</h2>
                <div className="space-y-2">
                  {(stats?.byCategory ?? []).length === 0 ? (
                    <p className="text-sm text-text-secondary">No category mix yet.</p>
                  ) : (
                    stats!.byCategory.map((row) => (
                      <div key={row.categoryId} className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                          <span>{row.name}</span>
                        </div>
                        <span className="font-semibold">{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <Card padding={false}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-semibold">Recent clients</h2>
                <Button size="sm" variant="outline" onClick={() => setTab('clients')}>
                  View all
                </Button>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Client', 'Slug', 'Plan', 'Status', 'City', 'Created'].map((h) => (
                      <th key={h} className="px-4 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(stats?.recentClients ?? clients.slice(0, 8)).map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-4 py-2 font-mono text-xs">{c.slug}</td>
                      <td className="px-4 py-2">{c.plan}</td>
                      <td className="px-4 py-2">
                        <Badge color={c.status === 'ACTIVE' ? 'green' : c.status === 'TRIAL' ? 'amber' : 'red'}>
                          {c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">{('city' in c && c.city) || '—'}</td>
                      <td className="px-4 py-2 text-text-secondary">
                        {String(c.createdAt).slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold">How multi-client works</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
                <li>Create a client with industry category, admin email/password, and max employee seats.</li>
                <li>Share the workspace slug + admin credentials with the customer.</li>
                <li>They log in at /login, run CRM/ERP, and create employee logins under Users.</li>
                <li>You monitor usage here and can suspend a client anytime.</li>
              </ol>
              <Button className="mt-4" onClick={() => { setTab('clients'); setCreateOpen(true) }}>
                <Plus size={16} /> Create client
              </Button>
            </Card>
          </div>
        )}

        {tab === 'clients' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-bold">Clients</h1>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> Create client
              </Button>
            </div>
            <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />
            <Input placeholder="Search clients..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <Card padding={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-muted text-xs text-text-secondary">
                    <tr>
                      {['Client', 'Slug', 'Category', 'Plan', 'Status', 'Seats', 'City', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const cat = categories.find((x) => x.id === c.categoryId)
                      return (
                        <tr key={c.id} className="border-t border-border hover:bg-surface">
                          <td className="px-4 py-3">
                            <div className="font-semibold">{c.name}</div>
                            <div className="font-mono text-xs text-text-secondary">{c.code}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{c.slug}</td>
                          <td className="px-4 py-3">
                            <Badge color="blue">{cat?.name ?? '—'}</Badge>
                          </td>
                          <td className="px-4 py-3">{c.plan}</td>
                          <td className="px-4 py-3">
                            <Badge color={c.status === 'ACTIVE' ? 'green' : c.status === 'TRIAL' ? 'amber' : 'red'}>
                              {c.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {c.users}/{c.maxUsers}
                          </td>
                          <td className="px-4 py-3">{c.city}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void (async () => {
                                    try {
                                      if (liveMode) {
                                        if (c.status === 'ACTIVE' || c.status === 'TRIAL') {
                                          await api.suspendTenant(c.id)
                                          setClients((rows) =>
                                            rows.map((row) =>
                                              row.id === c.id ? { ...row, status: 'SUSPENDED' } : row,
                                            ),
                                          )
                                          addToast({ type: 'success', message: 'Client suspended' })
                                        } else {
                                          await api.updateTenant(c.id, { status: 'ACTIVE' })
                                          setClients((rows) =>
                                            rows.map((row) =>
                                              row.id === c.id ? { ...row, status: 'ACTIVE' } : row,
                                            ),
                                          )
                                          addToast({ type: 'success', message: 'Client activated' })
                                        }
                                      } else {
                                        const next: ClientRow[] = clients.map((row) =>
                                          row.id === c.id
                                            ? {
                                                ...row,
                                                status: (row.status === 'ACTIVE'
                                                  ? 'SUSPENDED'
                                                  : 'ACTIVE') as ClientStatus,
                                              }
                                            : row,
                                        )
                                        setClients(next)
                                        saveClients(next)
                                        addToast({ type: 'success', message: 'Client status updated' })
                                      }
                                    } catch (err) {
                                      addToast({
                                        type: 'error',
                                        message: err instanceof Error ? err.message : 'Update failed',
                                      })
                                    }
                                  })()
                                }
                              >
                                {c.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {tab === 'categories' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold">Business Categories</h1>
            <FeatureTip
              title="Industry templates"
              body="Each category ships with default CRM/ERP modules, terminology (Lead→Enquiry), pipeline stages and custom fields. When you create a client, these are copied and can still be edited later."
              tipType="BEST_PRACTICE"
            />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {categories.map((cat) => (
                <Card key={cat.id} hover>
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] text-white" style={{ background: cat.color }}>
                    {cat.code === 'WEIGHING_MACHINES' ? <Scale size={20} /> : cat.code === 'MANUFACTURING' ? <Factory size={20} /> : cat.code === 'RETAIL_COMMERCE' ? <Store size={20} /> : <Users size={20} />}
                  </div>
                  <h3 className="font-semibold">{cat.name}</h3>
                  <p className="mt-1 text-sm text-text-secondary">{cat.description}</p>
                  <Badge className="mt-3" color="gray">{cat.code}</Badge>
                </Card>
              ))}
            </div>
          </div>
        )}

        {tab === 'tips' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold">Tips Library</h1>
            <FeatureTip
              title="Guided UX"
              body="Every major CRM/ERP screen shows a tip. Global tips are managed here; tenants can override copy for their industry language."
              tipType="NOTE"
            />
            <div className="grid gap-3">
              {Object.entries(DEFAULT_TIPS).map(([key, t]) => (
                <FeatureTip key={key} title={`${key} — ${t.title}`} body={t.body} tipType={t.tipType} />
              ))}
            </div>
          </div>
        )}
      </main>

      <CreateClientModal
        open={createOpen}
        categories={categories}
        liveMode={liveMode}
        onClose={() => setCreateOpen(false)}
        onCreate={async (row, payload) => {
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
                createdAt: string
                login?: { tenantSlug: string; email: string; temporaryPassword: string }
              }
              const mapped: ClientRow = {
                id: created.id,
                name: created.name,
                code: created.code,
                slug: created.slug,
                categoryId: created.businessCategoryId,
                status: created.status,
                plan: created.plan,
                city: created.city ?? row.city,
                users: 1,
                maxUsers: row.maxUsers ?? 10,
                createdAt: String(created.createdAt).slice(0, 10),
              }
              setClients((c) => [mapped, ...c])
              setCreateOpen(false)
              if (created.login) {
                setCreatedCreds({
                  name: created.name,
                  slug: created.login.tenantSlug,
                  email: created.login.email,
                  password: created.login.temporaryPassword,
                })
              }
              addToast({ type: 'success', message: `Client ${mapped.name} created` })
              return
            } catch (err) {
              addToast({ type: 'error', message: err instanceof Error ? err.message : 'Create failed' })
              return
            }
          }
          const next = [row, ...clients]
          setClients(next)
          saveClients(next)
          setCreateOpen(false)
          addToast({
            type: 'success',
            message: `Client ${row.name} created with ${categoryName(row.categoryId)} template (local demo)`,
          })
        }}
      />

      <Modal
        open={Boolean(createdCreds)}
        onClose={() => setCreatedCreds(null)}
        title="Client ready"
        subtitle="Share these workspace login details with the client admin."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreatedCreds(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setCreatedCreds(null)
                navigate('/login')
              }}
            >
              Open client login
            </Button>
          </>
        }
      >
        {createdCreds && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{createdCreds.name}</strong> is provisioned with modules, pipeline, warehouse and an admin user.
            </p>
            {[
              ['Workspace slug', createdCreds.slug],
              ['Admin email', createdCreds.email],
              ['Temporary password', createdCreds.password],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</div>
                <div className="font-mono font-semibold">{value}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

function CreateClientModal({
  open,
  onClose,
  onCreate,
  liveMode,
  categories,
}: {
  open: boolean
  onClose: () => void
  liveMode: boolean
  categories: BusinessCategory[]
  onCreate: (row: ClientRow, payload?: Record<string, unknown>) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [slug, setSlug] = useState('')
  const [city, setCity] = useState('Chennai')
  const [categoryId, setCategoryId] = useState('')
  const [plan, setPlan] = useState('STARTER')
  const [adminName, setAdminName] = useState('Workspace Admin')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('Demo@12345')
  const [maxUsers, setMaxUsers] = useState('10')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && categories[0] && !categoryId) setCategoryId(categories[0].id)
  }, [open, categories, categoryId])

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
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => categories.find((c) => c.id === categoryId), [categories, categoryId])

  async function submit() {
    if (!name.trim() || !code.trim() || !slug.trim() || !categoryId) return
    if (liveMode && (!adminEmail.trim() || adminPassword.length < 8)) return
    const row: ClientRow = {
      id: `t-${Date.now()}`,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      slug: slug.trim().toLowerCase(),
      categoryId,
      status: 'TRIAL',
      plan,
      city,
      users: 1,
      maxUsers: Number(maxUsers) || 10,
      createdAt: new Date().toISOString().slice(0, 10),
    }
    const payload = liveMode
      ? {
          name: row.name,
          code: row.code,
          slug: row.slug,
          businessCategoryId: categoryId,
          plan: row.plan,
          status: 'TRIAL',
          city: city || undefined,
          adminName: adminName.trim() || 'Workspace Admin',
          adminEmail: adminEmail.trim().toLowerCase(),
          adminPassword,
          maxUsers: Number(maxUsers) || 10,
        }
      : undefined
    setSaving(true)
    try {
      await onCreate(row, payload)
      setName('')
      setCode('')
      setSlug('')
      setAdminEmail('')
      setAdminPassword('Demo@12345')
      setCategoryId(categories[0]?.id ?? '')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create client"
      subtitle="Pick the industry template, then we provision CRM/ERP modules, pipeline and an admin login."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !categoryId} onClick={() => void submit()}>
            {saving ? 'Creating…' : 'Create & provision'}
          </Button>
        </>
      }
    >
      <FeatureTip
        title="Pick the business type first"
        body="The category decides which modules appear (CRM vs ERP), pipeline stages, and terminology (Enquiry vs Lead)."
        tipType="TIP"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Business name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="Precision Scales India" />
        <Input label="Client code *" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PSI01" />
        <Input label="Login slug *" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="precision-scales" />
        <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
        <Select
          label="Business category *"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label="Plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          options={[
            { value: 'STARTER', label: 'Starter' },
            { value: 'GROWTH', label: 'Growth' },
            { value: 'BUSINESS', label: 'Business' },
            { value: 'ENTERPRISE', label: 'Enterprise' },
          ]}
        />
        <Input label="Admin name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
        <Input label="Admin email *" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
        <Input
          label="Max employee logins"
          type="number"
          value={maxUsers}
          onChange={(e) => setMaxUsers(e.target.value)}
        />
        <Input
          className="sm:col-span-2"
          label="Admin password *"
          type="text"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
        />
      </div>
      {preview && (
        <div className="mt-4 rounded-[8px] border border-border bg-surface p-3 text-sm">
          <div className="font-semibold" style={{ color: preview.color }}>
            {preview.name}
          </div>
          <p className="mt-1 text-text-secondary">{preview.description || 'Industry template from catalog'}</p>
          <p className="mt-2 text-xs text-text-secondary">
            Creates tenant + admin user + pipeline + lead sources + warehouse + invoice/PO sequences.
          </p>
        </div>
      )}
      {!liveMode && (
        <p className="mt-3 text-sm text-amber-700">API offline — this will only save a local demo row.</p>
      )}
    </Modal>
  )
}

export default AdminApp
