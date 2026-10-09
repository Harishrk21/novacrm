import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import {
  Activity,
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Mail,
  Bot,
  Package,
  Pencil,
  Plus,
  Radio,
  Shield,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { MeisterLogo } from '@/components/MeisterLogo'
import { api, ApiClientError } from '@/lib/api'
import { PLATFORM_NAME, RESERVED_LOGIN_SLUGS } from '@/lib/branding'
import { clientLoginPath, clientLoginUrl } from '@/lib/clientWorkspace'
import { useUIStore } from '@/store/uiStore'
import {
  formatDate,
  statusBadge,
  type PlatformOutletContext,
} from '@/pages/admin/platformTypes'

export function LoginDirectoryPanel() {
  const { clients } = useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return clients
      .filter((c) => {
        if (!needle) return true
        return (
          c.name.toLowerCase().includes(needle) ||
          c.slug.toLowerCase().includes(needle) ||
          c.code.toLowerCase().includes(needle)
        )
      })
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [clients, q])

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      addToast({ type: 'success', message: 'Login URL copied' })
      window.setTimeout(() => setCopied((k) => (k === id ? null : k)), 1600)
    } catch {
      addToast({ type: 'error', message: 'Could not copy' })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Login directory</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every client workspace login URL in one place — copy or open, then jump into detail.
        </p>
      </div>
      <Input placeholder="Filter by name, slug, or code…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card padding={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted text-xs text-text-secondary">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Login path</th>
                <th className="px-4 py-3 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const url = clientLoginUrl(c.slug)
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.name}</div>
                      <div className="font-mono text-xs text-text-secondary">
                        {c.code} · {c.plan}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusBadge(c.status)}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-accent-blue">
                      /login/{c.slug}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => void copy(url, c.id)}>
                          {copied === c.id ? <Check size={12} /> : <Copy size={12} />}
                          {copied === c.id ? 'Copied' : 'Copy'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(clientLoginPath(c.slug), '_blank', 'noopener')}
                        >
                          <ExternalLink size={12} /> Open
                        </Button>
                        <Link to={`/admin/clients/${c.id}`}>
                          <Button size="sm" variant="ghost">
                            Detail
                          </Button>
                        </Link>
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
  )
}

export function SystemHealthPanel() {
  const { clients, liveMode, stats } = useOutletContext<PlatformOutletContext>()
  const attention = clients.filter((c) => c.status === 'TRIAL' || c.status === 'SUSPENDED')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System health</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Platform API reachability and tenants that need attention.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            {liveMode ? <Wifi size={16} className="text-emerald-500" /> : <WifiOff size={16} className="text-amber-500" />}
            API mode
          </div>
          <div className="mt-2 text-xl font-bold">{liveMode ? 'Live' : 'Offline / demo'}</div>
          <p className="mt-1 text-xs text-text-secondary">
            {liveMode ? 'Writes hit the backend.' : 'Using local demo clients until API is online.'}
          </p>
        </Card>
        <Card>
          <div className="text-sm text-text-secondary">Total clients</div>
          <div className="mt-2 text-xl font-bold tabular-nums">{stats?.total ?? clients.length}</div>
        </Card>
        <Card>
          <div className="text-sm text-text-secondary">Seat usage</div>
          <div className="mt-2 text-xl font-bold tabular-nums">
            {stats?.users ?? clients.reduce((n, c) => n + c.users, 0)}
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Activity size={16} /> Needs attention
          </div>
          <div className="mt-2 text-xl font-bold tabular-nums">{attention.length}</div>
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold">Trials & suspended</h2>
        {attention.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">All clear — no trial or suspended workspaces.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {attention.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-text-secondary">
                    /{c.slug}
                    {c.trialEndsAt ? ` · trial ends ${formatDate(c.trialEndsAt)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={statusBadge(c.status)}>{c.status}</Badge>
                  <Link to={`/admin/clients/${c.id}`}>
                    <Button size="sm" variant="outline">
                      Open
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

const ADDONS = [
  {
    id: 'whatsapp',
    title: 'WhatsApp Cloud',
    icon: MessageCircle,
    module: 'engagement.whatsapp',
    blurb: 'Meta Cloud API inbox, templates, and ticket handoff per tenant.',
  },
  {
    id: 'email',
    title: 'Email engagement',
    icon: Mail,
    module: 'engagement.emails',
    blurb: 'Outbound sequences and activity logging for sales follow-ups.',
  },
  {
    id: 'automation',
    title: 'Automation rules',
    icon: Bot,
    module: 'reports',
    blurb: 'Notify desk / lead routing hooks — enable with full HMS packs.',
  },
  {
    id: 'rentals',
    title: 'Rentals & stamping',
    icon: Package,
    module: 'crm.rentals',
    blurb: 'Weighing-ops add-ons: rental contracts and legal metrology stamping.',
  },
  {
    id: 'teamchat',
    title: 'Team chat',
    icon: Radio,
    module: 'settings',
    blurb: 'Internal channels for client staff — always available with Settings.',
  },
  {
    id: 'hms',
    title: 'HMS coverage pack',
    icon: Shield,
    module: 'crm.tickets',
    blurb: 'Service desk, AMC, tickets, inventory — apply HMS_FULL subscription pack.',
  },
] as const

export function AddonsPanel() {
  const { clients, setSeedStatusFilter, liveMode, setClients } =
    useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)
  const navigate = useNavigate()
  const [clientId, setClientId] = useState('')
  const [addonId, setAddonId] = useState(ADDONS[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  function clientsWithModule(key: string) {
    return clients.filter((c) => c.modulesEnabled?.[key]).length
  }

  async function enableAddon() {
    const addon = ADDONS.find((a) => a.id === addonId)
    const client = clients.find((c) => c.id === clientId)
    if (!addon || !client) {
      addToast({ type: 'error', message: 'Pick client and add-on' })
      return
    }
    setBusy(true)
    try {
      const nextMods = { ...(client.modulesEnabled ?? {}), [addon.module]: true }
      if (liveMode) {
        await api.setTenantModules(client.id, nextMods)
      }
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, modulesEnabled: nextMods } : c)),
      )
      addToast({ type: 'success', message: `${addon.title} enabled on ${client.name}` })
      navigate(`/admin/clients/${client.id}`)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Enable failed',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add-ons catalog</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Optional capabilities. Enable on a client here, or apply a full pack under Plans.
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Enable add-on on client</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Client *"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: 'Select…' },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="Add-on *"
            value={addonId}
            onChange={(e) => setAddonId(e.target.value)}
            options={ADDONS.map((a) => ({ value: a.id, label: a.title }))}
          />
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={busy || !clientId || !addonId || !liveMode}
              onClick={() => void enableAddon()}
            >
              {busy ? 'Saving…' : liveMode ? 'Enable' : 'API offline'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ADDONS.map((a) => {
          const Icon = a.icon
          const enabled = clientsWithModule(a.module)
          return (
            <Card key={a.id}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue">
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="mt-1 text-sm text-text-secondary">{a.blurb}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <Badge color="blue">{enabled} enabled</Badge>
                    <span className="font-mono text-text-secondary">{a.module}</span>
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAddonId(a.id)
                      addToast({ type: 'success', message: `${a.title} selected — pick a client above` })
                    }}
                  >
                    Use this add-on
                  </Button>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Fine-tune modules</div>
          <p className="text-sm text-text-secondary">Open a client → Modules tab for full checklist.</p>
        </div>
        <Link to="/admin/clients" onClick={() => setSeedStatusFilter('ALL')}>
          <Button>Go to clients</Button>
        </Link>
      </Card>
    </div>
  )
}

export function PlatformBrandingPanel() {
  const { clients, liveMode, setClients } = useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)
  const [clientId, setClientId] = useState(clients[0]?.id ?? '')
  const client = clients.find((c) => c.id === clientId) ?? null
  const [tagline, setTagline] = useState(client?.branding?.loginTagline ?? '')
  const [palette, setPalette] = useState(client?.branding?.palette ?? 'violet')
  const [locked, setLocked] = useState(client?.branding?.locked !== false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTagline(client?.branding?.loginTagline ?? '')
    setPalette(client?.branding?.palette ?? 'violet')
    setLocked(client?.branding?.locked !== false)
  }, [client?.id, client?.branding?.loginTagline, client?.branding?.palette, client?.branding?.locked])

  async function saveClientBrand() {
    if (!client) return
    setSaving(true)
    try {
      if (liveMode) {
        await api.updateTenant(client.id, {
          branding: { palette, locked, loginTagline: tagline.trim() || null },
        })
      }
      setClients((prev) =>
        prev.map((c) =>
          c.id === client.id
            ? {
                ...c,
                branding: {
                  ...(c.branding ?? {}),
                  palette,
                  locked,
                  loginTagline: tagline.trim() || undefined,
                },
              }
            : c,
        ),
      )
      addToast({ type: 'success', message: `Branding saved for ${client.name}` })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not save branding',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform branding</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {PLATFORM_NAME} console chrome stays separate. Edit each client&apos;s login kit here (or on
          the client page).
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <MeisterLogo size="md" />
          <p className="mt-4 text-sm text-text-secondary">
            Super-admin and <span className="font-mono">/login/admin</span> use {PLATFORM_NAME}{' '}
            assets from <span className="font-mono">public/</span>.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => window.open('/login/admin', '_blank', 'noopener')}
          >
            <ExternalLink size={14} /> Open platform login
          </Button>
        </Card>
        <Card>
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles size={16} /> Reserved login slugs
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            These paths cannot be claimed by a tenant slug.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[...RESERVED_LOGIN_SLUGS].map((s) => (
              <li
                key={s}
                className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs"
              >
                /login/{s}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Edit client login branding</h2>
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            { value: '', label: clients.length ? 'Select client…' : 'No clients yet' },
            ...clients.map((c) => ({ value: c.id, label: `${c.name} · /login/${c.slug}` })),
          ]}
        />
        {client ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Palette"
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
              options={['ocean', 'emerald', 'violet', 'amber', 'rose', 'slate'].map((p) => ({
                value: p,
                label: p,
              }))}
            />
            <Input
              label="Login tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Sign in to your workspace"
            />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
              Lock palette for company users (Appearance cannot change it)
            </label>
            <div className="sm:col-span-2">
              <Button disabled={saving || !liveMode} onClick={() => void saveClientBrand()}>
                {saving ? 'Saving…' : liveMode ? 'Save client branding' : 'Connect API to save'}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  )
}

export function PlansModulesPanel() {
  const { clients, subscriptionPacks, plansCatalog, liveMode, setClients } =
    useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)
  const navigate = useNavigate()
  const packs = subscriptionPacks.length
    ? subscriptionPacks
    : [
        {
          code: 'SALES',
          label: 'Sales only',
          description: 'CRM sales modules',
          defaultMaxUsers: 5,
          modules: {},
        },
        {
          code: 'SALES_INVENTORY',
          label: 'Sales + Inventory',
          description: 'CRM + stock',
          defaultMaxUsers: 15,
          modules: {},
        },
        {
          code: 'HMS_FULL',
          label: 'HMS Full',
          description: 'Sales + service + ERP',
          defaultMaxUsers: 25,
          modules: {},
        },
      ]
  const [clientId, setClientId] = useState('')
  const [pack, setPack] = useState<'SALES' | 'SALES_INVENTORY' | 'HMS_FULL'>('HMS_FULL')
  const [busy, setBusy] = useState(false)

  async function applyPack() {
    if (!clientId) {
      addToast({ type: 'error', message: 'Select a client' })
      return
    }
    setBusy(true)
    try {
      if (liveMode) {
        await api.applyTenantPack(clientId, pack)
      }
      const packDef = packs.find((p) => p.code === pack)
      setClients((prev) =>
        prev.map((c) =>
          c.id === clientId
            ? {
                ...c,
                subscriptionPack: pack,
                modulesEnabled: packDef?.modules ?? c.modulesEnabled,
              }
            : c,
        ),
      )
      addToast({ type: 'success', message: `${pack} applied` })
      navigate(`/admin/clients/${clientId}`)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Apply failed',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plans & modules</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Packs define which sidebar modules a client gets. Apply a pack to a live client below.
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Apply subscription pack</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Client *"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: 'Select…' },
              ...clients.map((c) => ({
                value: c.id,
                label: `${c.name}${c.subscriptionPack ? ` · ${c.subscriptionPack}` : ''}`,
              })),
            ]}
          />
          <Select
            label="Pack *"
            value={pack}
            onChange={(e) => setPack(e.target.value as typeof pack)}
            options={packs.map((p) => ({ value: p.code, label: p.label }))}
          />
          <div className="flex items-end">
            <Button className="w-full" disabled={busy || !clientId || !liveMode} onClick={() => void applyPack()}>
              {busy ? 'Applying…' : liveMode ? 'Apply pack' : 'API offline'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {packs.map((p) => {
          const mods = Object.entries(p.modules ?? {}).filter(([, on]) => on)
          return (
            <Card key={p.code}>
              <h3 className="text-lg font-semibold">{p.label}</h3>
              <p className="mt-2 text-sm text-text-secondary">{p.description}</p>
              <p className="mt-2 text-xs text-text-secondary">
                Suggested seats: {p.defaultMaxUsers ?? '—'}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {mods.slice(0, 8).map(([k]) => (
                  <Badge key={k} color="blue">
                    {k.replace(/^(crm|erp|engagement)\./, '')}
                  </Badge>
                ))}
                {mods.length > 8 ? <Badge color="gray">+{mods.length - 8}</Badge> : null}
              </div>
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                onClick={() => {
                  setPack(p.code as typeof pack)
                  addToast({ type: 'success', message: `${p.label} selected — pick a client above` })
                }}
              >
                Use this pack
              </Button>
            </Card>
          )
        })}
      </div>

      <h2 className="pt-2 text-lg font-semibold">Commercial seat plans</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(plansCatalog.length
          ? plansCatalog
          : [
              { code: 'STARTER', label: 'Starter', maxUsers: 5, modules: {}, features: {} },
              { code: 'GROWTH', label: 'Growth', maxUsers: 15, modules: {}, features: {} },
              { code: 'BUSINESS', label: 'Business', maxUsers: 50, modules: {}, features: {} },
              { code: 'ENTERPRISE', label: 'Enterprise', maxUsers: 500, modules: {}, features: {} },
            ]
        ).map((p) => (
          <Card key={p.code}>
            <h3 className="font-semibold">{p.label}</h3>
            <p className="mt-2 text-sm text-text-secondary">Up to {p.maxUsers} users</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function CategoriesPanel() {
  const { categories, liveMode } = useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)
  const [rows, setRows] = useState(categories)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    colorHex: '#2563EB',
    icon: 'scale',
  })

  useEffect(() => {
    setRows(categories)
  }, [categories])

  function openCreate() {
    setEditId(null)
    setForm({ code: '', name: '', description: '', colorHex: '#2563EB', icon: 'scale' })
    setOpen(true)
  }

  function openEdit(c: (typeof rows)[0]) {
    setEditId(c.id)
    setForm({
      code: c.code,
      name: c.name,
      description: c.description ?? '',
      colorHex: c.color || '#2563EB',
      icon: c.icon || 'scale',
    })
    setOpen(true)
  }

  async function save() {
    if (!form.name.trim() || !form.code.trim()) {
      addToast({ type: 'error', message: 'Code and name required' })
      return
    }
    setBusy(true)
    try {
      if (!liveMode) throw new Error('Platform API offline')
      if (editId) {
        const updated = (await api.updateCategory(editId, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          colorHex: form.colorHex,
          icon: form.icon,
        })) as { id: string; name: string; code: string; description?: string; colorHex?: string; icon?: string }
        setRows((prev) =>
          prev.map((r) =>
            r.id === editId
              ? {
                  ...r,
                  name: updated.name ?? form.name,
                  description: updated.description ?? form.description,
                  color: updated.colorHex ?? form.colorHex,
                  icon: updated.icon ?? form.icon,
                }
              : r,
          ),
        )
        addToast({ type: 'success', message: 'Category updated' })
      } else {
        const created = (await api.createCategory({
          code: form.code.trim().toUpperCase().replace(/\s+/g, '_'),
          name: form.name.trim(),
          description: form.description.trim() || null,
          colorHex: form.colorHex,
          icon: form.icon,
        })) as { id: string; name: string; code: string; description?: string; colorHex?: string; icon?: string }
        setRows((prev) => [
          ...prev,
          {
            id: created.id,
            code: created.code,
            name: created.name,
            description: created.description ?? '',
            color: created.colorHex ?? form.colorHex,
            icon: created.icon ?? form.icon,
          },
        ])
        addToast({ type: 'success', message: 'Category created' })
      }
      setOpen(false)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Save failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function archive(id: string) {
    if (!confirm('Archive this category?')) return
    try {
      if (!liveMode) throw new Error('Platform API offline')
      await api.deleteCategory(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      addToast({ type: 'success', message: 'Category archived' })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Archive failed',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business categories</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Industry templates used when onboarding a client.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!liveMode}>
          <Plus size={16} /> New category
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <h3 className="font-semibold">{c.name}</h3>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                  <Pencil size={14} />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void archive(c.id)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            <p className="mt-2 text-sm text-text-secondary">{c.description || '—'}</p>
            <div className="mt-2 font-mono text-xs text-text-secondary">{c.code}</div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={editId ? 'Edit category' : 'New category'}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Code *"
            value={form.code}
            disabled={Boolean(editId)}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="WEIGHING_MACHINES"
          />
          <Input
            label="Name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Color"
            type="color"
            value={form.colorHex}
            onChange={(e) => setForm((f) => ({ ...f, colorHex: e.target.value }))}
          />
          <Input
            label="Icon key"
            value={form.icon}
            onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
          />
          <Input
            className="sm:col-span-2"
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
      </Modal>
    </div>
  )
}

export function TipsLibraryPanel() {
  const { liveMode } = useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)
  const [tips, setTips] = useState<
    Array<{
      id: string
      moduleKey: string
      sectionKey: string
      title: string
      body: string
      tipType: string
      sortOrder: number
      isActive: boolean
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    moduleKey: 'crm.tickets',
    sectionKey: 'overview',
    title: '',
    body: '',
    tipType: 'TIP',
    isActive: true,
  })

  const load = useCallback(async () => {
    if (!liveMode) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const rows = await api.listPlatformTips(true)
      setTips(rows)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load tips',
      })
    } finally {
      setLoading(false)
    }
  }, [liveMode, addToast])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditId(null)
    setForm({
      moduleKey: 'crm.tickets',
      sectionKey: 'overview',
      title: '',
      body: '',
      tipType: 'TIP',
      isActive: true,
    })
    setOpen(true)
  }

  function openEdit(t: (typeof tips)[0]) {
    setEditId(t.id)
    setForm({
      moduleKey: t.moduleKey,
      sectionKey: t.sectionKey,
      title: t.title,
      body: t.body,
      tipType: t.tipType || 'TIP',
      isActive: t.isActive !== false,
    })
    setOpen(true)
  }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) {
      addToast({ type: 'error', message: 'Title and body required' })
      return
    }
    setBusy(true)
    try {
      if (editId) {
        await api.updatePlatformTip(editId, form)
        addToast({ type: 'success', message: 'Tip updated' })
      } else {
        await api.createPlatformTip(form)
        addToast({ type: 'success', message: 'Tip created' })
      }
      setOpen(false)
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Save failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this tip?')) return
    try {
      await api.deletePlatformTip(id)
      addToast({ type: 'success', message: 'Tip deleted' })
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Delete failed',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tips library</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Global coaching cards shown inside client apps (tenantId null).
          </p>
        </div>
        <Button onClick={openCreate} disabled={!liveMode}>
          <Plus size={16} /> New tip
        </Button>
      </div>
      {loading ? (
        <Card>Loading…</Card>
      ) : tips.length === 0 ? (
        <Card className="text-sm text-text-secondary">
          {liveMode ? 'No tips yet — create the first one.' : 'Connect platform API to manage tips.'}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {tips.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[11px] text-text-secondary">
                    {t.moduleKey} · {t.sectionKey}
                  </div>
                  <div className="mt-1 font-semibold">{t.title}</div>
                </div>
                <div className="flex gap-1">
                  <Badge color={t.isActive ? 'green' : 'gray'}>{t.tipType}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(t.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-sm text-text-secondary">{t.body}</p>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={editId ? 'Edit tip' : 'New tip'}
        size="lg"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Module key *"
            value={form.moduleKey}
            onChange={(e) => setForm((f) => ({ ...f, moduleKey: e.target.value }))}
            placeholder="crm.tickets"
          />
          <Input
            label="Section key *"
            value={form.sectionKey}
            onChange={(e) => setForm((f) => ({ ...f, sectionKey: e.target.value }))}
            placeholder="overview"
          />
          <Input
            className="sm:col-span-2"
            label="Title *"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <Select
            label="Type"
            value={form.tipType}
            onChange={(e) => setForm((f) => ({ ...f, tipType: e.target.value }))}
            options={[
              { value: 'TIP', label: 'Tip' },
              { value: 'NOTE', label: 'Note' },
              { value: 'WARNING', label: 'Warning' },
              { value: 'BEST_PRACTICE', label: 'Best practice' },
            ]}
          />
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active
          </label>
          <textarea
            className="min-h-[120px] w-full rounded-[10px] border border-border bg-card p-3 text-sm sm:col-span-2"
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="Tip body…"
          />
        </div>
      </Modal>
    </div>
  )
}
