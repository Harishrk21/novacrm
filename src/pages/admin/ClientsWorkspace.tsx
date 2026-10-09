import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2,
  Check,
  Copy,
  Grid3X3,
  KeyRound,
  LayoutList,
  List,
  Palette,
  Plus,
  Rows3,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { MODULE_TOGGLE_OPTIONS, clientLoginUrl } from '@/lib/clientWorkspace'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import {
  formatDate,
  statusBadge,
  type BusinessCategory,
  type ClientRow,
  type ClientStatus,
  type SubscriptionPack,
} from '@/pages/admin/platformTypes'

export type { ClientRow, ClientStatus, BusinessCategory } from '@/pages/admin/platformTypes'

type ViewFormat = 'cards' | 'table' | 'compact'

function moduleCount(c: ClientRow) {
  return MODULE_TOGGLE_OPTIONS.filter((m) => c.modulesEnabled?.[m.key]).length
}

export function ClientsWorkspace({
  clients,
  onClientsChange,
  categories,
  liveMode,
  onCreate,
  onResetAdmin,
  seedStatusFilter,
}: {
  clients: ClientRow[]
  onClientsChange: (next: ClientRow[] | ((prev: ClientRow[]) => ClientRow[])) => void
  categories: BusinessCategory[]
  liveMode: boolean
  subscriptionPacks?: SubscriptionPack[]
  onCreate: () => void
  onResetAdmin: (c: ClientRow) => void
  seedStatusFilter?: 'ALL' | ClientStatus
}) {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | ClientStatus>('ALL')
  const [view, setView] = useState<ViewFormat>(() => {
    try {
      const v = localStorage.getItem('platform-clients-view')
      if (v === 'cards' || v === 'table' || v === 'compact') return v
    } catch {
      /* ignore */
    }
    return 'cards'
  })
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem('platform-clients-view', view)
    } catch {
      /* ignore */
    }
  }, [view])

  useEffect(() => {
    if (seedStatusFilter) setStatusFilter(seedStatusFilter)
  }, [seedStatusFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.city ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      )
    })
  }, [clients, query, statusFilter])

  const statusCounts = useMemo(() => {
    const base = { ALL: clients.length, ACTIVE: 0, TRIAL: 0, SUSPENDED: 0, CANCELLED: 0 }
    for (const c of clients) base[c.status] += 1
    return base
  }, [clients])

  async function handleCopy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      addToast({ type: 'success', message: 'Copied' })
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800)
    } catch {
      addToast({ type: 'error', message: 'Could not copy' })
    }
  }

  function openDetail(c: ClientRow) {
    navigate(`/admin/clients/${c.id}`)
  }

  async function toggleSuspend(c: ClientRow) {
    if (!liveMode) return
    try {
      if (c.status === 'ACTIVE' || c.status === 'TRIAL') {
        await api.suspendTenant(c.id)
        onClientsChange((rows) =>
          rows.map((row) => (row.id === c.id ? { ...row, status: 'SUSPENDED' } : row)),
        )
        addToast({ type: 'success', message: 'Client suspended' })
      } else {
        await api.reactivateTenant(c.id)
        onClientsChange((rows) =>
          rows.map((row) => (row.id === c.id ? { ...row, status: 'ACTIVE' } : row)),
        )
        addToast({ type: 'success', message: 'Client reactivated' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Update failed' })
    }
  }

  const viewButtons: Array<{ id: ViewFormat; label: string; icon: typeof Grid3X3 }> = [
    { id: 'cards', label: 'Cards', icon: Grid3X3 },
    { id: 'table', label: 'Table', icon: LayoutList },
    { id: 'compact', label: 'Compact', icon: Rows3 },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Every onboarded company workspace. Open a client for a full-page workspace — profile,
            login brand, modules, team, and plan.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus size={16} /> Create company
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['ALL', 'All'],
            ['ACTIVE', 'Active'],
            ['TRIAL', 'Trial'],
            ['SUSPENDED', 'Suspended'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatusFilter(id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium transition',
              statusFilter === id
                ? 'bg-accent-blue text-white'
                : 'bg-muted text-text-secondary hover:text-text-primary',
            )}
          >
            {label}
            <span className="ml-1.5 tabular-nums opacity-80">{statusCounts[id]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border p-1">
          {viewButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              title={b.label}
              onClick={() => setView(b.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                view === b.id ? 'bg-accent-blue text-white' : 'text-text-secondary hover:bg-muted',
              )}
            >
              <b.icon size={14} />
              <span className="hidden sm:inline">{b.label}</span>
            </button>
          ))}
        </div>
      </div>

      <Input
        placeholder="Search name, slug, code, city, email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <Building2 className="mx-auto text-text-secondary" size={28} />
          <p className="mt-3 font-medium">No clients match</p>
          <Button className="mt-4" onClick={onCreate}>
            <Plus size={16} /> Create company
          </Button>
        </Card>
      ) : view === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const cat = categories.find((x) => x.id === c.categoryId)
            const paletteKey = (c.branding?.palette ?? 'violet') as ColorPalette
            const kit = PALETTES[paletteKey] ?? PALETTES.violet
            const modsOn = moduleCount(c)
            return (
              <article
                key={c.id}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:border-accent-blue/40 hover:shadow-md"
              >
                <button
                  type="button"
                  className="block w-full p-4 text-left"
                  onClick={() => openDetail(c)}
                >
                  <div
                    className="mb-3 flex h-16 items-center gap-3 overflow-hidden rounded-xl border border-border px-3"
                    style={{ background: kit.light.wash }}
                  >
                    {c.logoUrl ? (
                      <img
                        src={assetUrl(c.logoUrl)}
                        alt=""
                        className="h-10 w-10 rounded-lg bg-white object-contain p-1"
                      />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
                        style={{ background: c.branding?.accent || kit.accent }}
                      >
                        {c.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        Brand kit
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className="inline-block h-3 w-3 rounded-sm"
                          style={{ background: c.branding?.accent || kit.accent }}
                        />
                        <span className="text-xs font-medium capitalize text-slate-700">
                          {(c.branding?.palette ?? 'violet').replace(/-/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{c.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-text-secondary">
                        {c.code} · {c.plan}
                      </div>
                    </div>
                    <Badge color={statusBadge(c.status)}>{c.status}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-text-secondary">Industry</div>
                      <div className="mt-0.5 font-medium">{cat?.name ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Seats</div>
                      <div className="mt-0.5 font-medium">
                        {c.users}/{c.maxUsers}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Modules on</div>
                      <div className="mt-0.5 font-medium">
                        {modsOn}/{MODULE_TOGGLE_OPTIONS.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-secondary">Created</div>
                      <div className="mt-0.5 font-medium">{formatDate(c.createdAt)}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs font-medium text-accent-blue">
                    Open full client page →
                  </div>
                </button>
                <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopy(clientLoginUrl(c.slug), `url-${c.id}`)}
                  >
                    {copiedKey === `url-${c.id}` ? <Check size={12} /> : <Copy size={12} />}
                    Login
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openDetail(c)}>
                    <Palette size={12} /> Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/admin/clients/${c.id}`)}
                  >
                    <Users size={12} /> Detail
                  </Button>
                  {liveMode ? (
                    <Button size="sm" variant="outline" onClick={() => void toggleSuspend(c)}>
                      {c.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                    </Button>
                  ) : null}
                  {liveMode ? (
                    <Button size="sm" variant="outline" onClick={() => onResetAdmin(c)}>
                      <KeyRound size={12} /> Reset
                    </Button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : view === 'table' ? (
        <Card padding={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['Company', 'Status', 'Plan', 'Seats', 'Modules', 'Login', 'Created', ''].map(
                    (h) => (
                      <th key={h || 'a'} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const cat = categories.find((x) => x.id === c.categoryId)
                  return (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-t border-border hover:bg-muted/40"
                      onClick={() => openDetail(c)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {c.logoUrl ? (
                            <img
                              src={assetUrl(c.logoUrl)}
                              alt=""
                              className="h-8 w-8 rounded-md border border-border object-contain"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-blue/15 text-xs font-bold text-accent-blue">
                              {c.name.slice(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{c.name}</div>
                            <div className="truncate text-xs text-text-secondary">
                              {c.code} · /{c.slug} · {cat?.name ?? '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={statusBadge(c.status)}>{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3">{c.plan}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {c.users}/{c.maxUsers}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {moduleCount(c)}/{MODULE_TOGGLE_OPTIONS.length}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-accent-blue">
                        /login/{c.slug}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(c.createdAt)}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => openDetail(c)}>
                            Open
                          </Button>
                          {liveMode ? (
                            <Button size="sm" variant="ghost" onClick={() => onResetAdmin(c)}>
                              <KeyRound size={12} />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const cat = categories.find((x) => x.id === c.categoryId)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openDetail(c)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-accent-blue/40"
              >
                {c.logoUrl ? (
                  <img
                    src={assetUrl(c.logoUrl)}
                    alt=""
                    className="h-9 w-9 rounded-lg border border-border object-contain"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-xs font-bold">
                    {c.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{c.name}</span>
                    <Badge color={statusBadge(c.status)}>{c.status}</Badge>
                  </div>
                  <div className="truncate text-xs text-text-secondary">
                    /{c.slug} · {c.plan} · {c.users}/{c.maxUsers} seats · {cat?.name ?? '—'}
                  </div>
                </div>
                <List size={14} className="shrink-0 text-text-secondary" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
