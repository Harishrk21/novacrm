import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageTabs } from '@/components/ui/PageTabs'
import { Select } from '@/components/ui/Select'
import { LoginPreview } from '@/components/auth/LoginPreview'
import { api } from '@/lib/api'
import { assetUrl } from '@/lib/formValidation'
import { MODULE_TOGGLE_OPTIONS, clientLoginPath, clientLoginUrl } from '@/lib/clientWorkspace'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import {
  formatDate,
  statusBadge,
  type ClientRow,
  type PlatformOutletContext,
} from '@/pages/admin/platformTypes'

type DetailTab = 'overview' | 'login' | 'modules' | 'team' | 'plan'

type InventoryAreas = {
  machines: boolean
  sparesBilling: boolean
  sparesWeighing: boolean
}

type TeamUser = {
  id: string
  name: string
  email: string
  phone?: string | null
  roleCode: string
  roleName: string
  status: string
  temporaryPassword?: string | null
  lastLoginAt?: string | null
  inventoryAreas?: InventoryAreas
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{children}</p>
}

function SectionLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p> : null}
    </div>
  )
}

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const {
    clients,
    setClients,
    categories,
    liveMode,
    subscriptionPacks,
    onResetAdmin,
  } = useOutletContext<PlatformOutletContext>()
  const addToast = useUIStore((s) => s.addToast)

  const client = clients.find((c) => c.id === clientId)

  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [saving, setSaving] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editCity, setEditCity] = useState('')
  const [editState, setEditState] = useState('')
  const [editPostal, setEditPostal] = useState('')
  const [editAddress1, setEditAddress1] = useState('')
  const [editAddress2, setEditAddress2] = useState('')
  const [editWebsite, setEditWebsite] = useState('')
  const [editGstin, setEditGstin] = useState('')

  const [editPalette, setEditPalette] = useState<ColorPalette>('violet')
  const [editLocked, setEditLocked] = useState(true)
  const [editAccent, setEditAccent] = useState('')
  const [editLogoUrl, setEditLogoUrl] = useState('')
  const [editLoginTagline, setEditLoginTagline] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)

  const [editModules, setEditModules] = useState<Record<string, boolean>>({})
  const [editPlan, setEditPlan] = useState('STARTER')
  const [editMaxUsers, setEditMaxUsers] = useState('10')
  const [editPack, setEditPack] = useState('')

  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [pwdBusyId, setPwdBusyId] = useState<string | null>(null)
  const [areasBusyId, setAreasBusyId] = useState<string | null>(null)

  function hydrate(c: ClientRow) {
    setEditName(c.name)
    setEditEmail(c.email ?? '')
    setEditPhone(c.phone ?? '')
    setEditCity(c.city === '—' ? '' : c.city)
    setEditState(c.state ?? '')
    setEditPostal(c.postalCode ?? '')
    setEditAddress1(c.addressLine1 ?? '')
    setEditAddress2(c.addressLine2 ?? '')
    setEditWebsite(c.website ?? '')
    setEditGstin(c.gstin ?? '')
    const p = (c.branding?.palette ?? 'violet') as ColorPalette
    setEditPalette(PALETTES[p] ? p : 'violet')
    setEditLocked(c.branding?.locked !== false)
    setEditAccent(c.branding?.accent ?? PALETTES[p]?.accent ?? '')
    setEditLogoUrl(c.logoUrl ?? '')
    setEditLoginTagline(c.branding?.loginTagline ?? '')
    setEditPlan(c.plan || 'STARTER')
    setEditMaxUsers(String(c.maxUsers || 10))
    setEditPack(c.subscriptionPack ?? '')
    const base: Record<string, boolean> = {}
    for (const m of MODULE_TOGGLE_OPTIONS) base[m.key] = c.modulesEnabled?.[m.key] ?? false
    setEditModules(base)
  }

  useEffect(() => {
    if (!client) return
    hydrate(client)
    setTeamUsers([])
    if (liveMode) void loadTeam(client.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id])

  async function loadTeam(tenantId: string) {
    setTeamLoading(true)
    try {
      const res = await api.listTenantUsers(tenantId)
      setTeamUsers(res.users ?? [])
    } catch {
      setTeamUsers([])
    } finally {
      setTeamLoading(false)
    }
  }

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

  async function uploadLogo(file: File) {
    setLogoUploading(true)
    try {
      const up = await api.uploadImage(file)
      setEditLogoUrl(up.url)
      addToast({ type: 'success', message: 'Logo uploaded — save to apply' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setLogoUploading(false)
    }
  }

  function applyPack(code: string, modules: Record<string, boolean>) {
    setEditPack(code)
    const next: Record<string, boolean> = {}
    for (const m of MODULE_TOGGLE_OPTIONS) next[m.key] = Boolean(modules[m.key])
    setEditModules(next)
    addToast({ type: 'success', message: `Applied ${code} pack — save to persist` })
  }

  function patchClient(next: ClientRow) {
    setClients((rows) => rows.map((r) => (r.id === next.id ? next : r)))
  }

  async function toggleSuspend(c: ClientRow) {
    if (!liveMode) return
    try {
      if (c.status === 'ACTIVE' || c.status === 'TRIAL') {
        await api.suspendTenant(c.id)
        const next = { ...c, status: 'SUSPENDED' as const }
        patchClient(next)
        addToast({ type: 'success', message: 'Client suspended' })
      } else {
        await api.reactivateTenant(c.id)
        const next = { ...c, status: 'ACTIVE' as const }
        patchClient(next)
        addToast({ type: 'success', message: 'Client reactivated' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Update failed' })
    }
  }

  async function saveDetail() {
    if (!client) return
    setSaving(true)
    try {
      const branding = {
        palette: editPalette,
        locked: editLocked,
        accent: editAccent.match(/^#[0-9A-Fa-f]{6}$/)
          ? editAccent
          : PALETTES[editPalette].accent,
        ...(editLoginTagline.trim()
          ? { loginTagline: editLoginTagline.trim() }
          : {}),
      }
      const logoUrl = editLogoUrl.trim() || null
      const patch = {
        name: editName.trim() || client.name,
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
        city: editCity.trim() || undefined,
        state: editState.trim() || undefined,
        addressLine1: editAddress1.trim() || undefined,
        addressLine2: editAddress2.trim() || undefined,
        postalCode: editPostal.trim() || undefined,
        website: editWebsite.trim() || undefined,
        gstin: editGstin.trim() || undefined,
        plan: editPlan,
        maxUsers: Number(editMaxUsers) || 10,
        branding,
        logoUrl,
        ...(editPack ? { subscriptionPack: editPack } : {}),
      }
      if (liveMode) {
        await api.updateTenant(client.id, patch)
        await api.setTenantModules(client.id, editModules)
      }
      const nextRow: ClientRow = {
        ...client,
        name: patch.name,
        email: editEmail.trim() || undefined,
        phone: editPhone.trim() || undefined,
        city: editCity.trim() || '—',
        state: editState.trim() || null,
        addressLine1: editAddress1.trim() || null,
        addressLine2: editAddress2.trim() || null,
        postalCode: editPostal.trim() || null,
        website: editWebsite.trim() || null,
        gstin: editGstin.trim() || null,
        plan: editPlan,
        maxUsers: Number(editMaxUsers) || 10,
        branding,
        logoUrl,
        subscriptionPack: editPack || client.subscriptionPack,
        modulesEnabled: { ...editModules, settings: true },
      }
      patchClient(nextRow)
      addToast({ type: 'success', message: 'Client configuration saved' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function setUserPassword(userId: string, email: string) {
    if (!client) return
    const next = window.prompt(`New password for ${email}`, 'Demo@12345')
    if (!next || next.length < 8) return
    setPwdBusyId(userId)
    try {
      const row = await api.setTenantUserPassword(client.id, userId, next)
      setTeamUsers((list) =>
        list.map((u) => (u.id === userId ? { ...u, temporaryPassword: row.temporaryPassword } : u)),
      )
      addToast({ type: 'success', message: `Password set for ${email}` })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setPwdBusyId(null)
    }
  }

  function patchLocalAreas(userId: string, key: keyof InventoryAreas, value: boolean) {
    setTeamUsers((list) =>
      list.map((u) => {
        if (u.id !== userId) return u
        const current: InventoryAreas = u.inventoryAreas ?? {
          machines: true,
          sparesBilling: true,
          sparesWeighing: true,
        }
        return { ...u, inventoryAreas: { ...current, [key]: value } }
      }),
    )
  }

  async function saveUserInventoryAreas(u: TeamUser) {
    if (!client) return
    const inventoryAreas = u.inventoryAreas ?? {
      machines: true,
      sparesBilling: true,
      sparesWeighing: true,
    }
    setAreasBusyId(u.id)
    try {
      const row = await api.setTenantUserInventoryAreas(client.id, u.id, inventoryAreas)
      setTeamUsers((list) =>
        list.map((x) =>
          x.id === u.id ? { ...x, inventoryAreas: row.inventoryAreas } : x,
        ),
      )
      addToast({ type: 'success', message: `Inventory access saved for ${u.name}` })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setAreasBusyId(null)
    }
  }

  if (!clientId) return <Navigate to="/admin/clients" replace />
  if (!client) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => navigate('/admin/clients')}>
          <ArrowLeft size={16} /> Back to clients
        </Button>
        <p className="text-sm text-text-secondary">Client not found in the current list.</p>
      </div>
    )
  }

  const packs =
    subscriptionPacks.length > 0
      ? subscriptionPacks
      : [
          { code: 'SALES', label: 'Sales', modules: {} as Record<string, boolean> },
          { code: 'SALES_INVENTORY', label: 'Sales + Inv', modules: {} as Record<string, boolean> },
          { code: 'HMS_FULL', label: 'HMS Full', modules: {} as Record<string, boolean> },
        ]

  const live = clients.find((c) => c.id === client.id) ?? client

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Link
            to="/admin/clients"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent-blue"
          >
            <ArrowLeft size={14} /> Clients
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{editName.trim() || live.name}</h1>
            <Badge color={statusBadge(live.status)}>{live.status}</Badge>
          </div>
          <p className="font-mono text-sm text-text-secondary">
            {live.code} · /login/{live.slug} · {live.plan} · {live.users}/{editMaxUsers} seats
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(clientLoginPath(live.slug), '_blank', 'noopener')}
          >
            <ExternalLink size={14} /> Preview login
          </Button>
          {liveMode && live.status !== 'ACTIVE' ? (
            <Button
              variant="outline"
              onClick={() =>
                void (async () => {
                  try {
                    await api.reactivateTenant(live.id)
                    patchClient({ ...live, status: 'ACTIVE' })
                    addToast({ type: 'success', message: 'Marked ACTIVE' })
                  } catch (err) {
                    addToast({
                      type: 'error',
                      message: err instanceof Error ? err.message : 'Activate failed',
                    })
                  }
                })()
              }
            >
              Mark Active
            </Button>
          ) : null}
          {liveMode ? (
            <Button variant="outline" onClick={() => onResetAdmin(live)}>
              <KeyRound size={14} /> Reset admin pwd
            </Button>
          ) : null}
          <Button disabled={saving} onClick={() => void saveDetail()}>
            {saving ? 'Saving…' : 'Save all changes'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="text-text-secondary">Industry</span>
        <span className="font-medium">
          {categories.find((x) => x.id === live.categoryId)?.name ?? '—'}
        </span>
        <span className="text-text-secondary">·</span>
        <span className="text-text-secondary">Created</span>
        <span className="font-medium">{formatDate(live.createdAt)}</span>
        {live.trialEndsAt ? (
          <>
            <span className="text-text-secondary">·</span>
            <span className="text-amber-700 dark:text-amber-400">
              Trial ends {formatDate(live.trialEndsAt)}
            </span>
          </>
        ) : null}
        <button
          type="button"
          className="ml-auto font-medium text-accent-blue hover:underline"
          onClick={() => void handleCopy(clientLoginUrl(live.slug), 'hdr-url')}
        >
          {copiedKey === 'hdr-url' ? 'URL copied' : 'Copy login URL'}
        </button>
      </div>

      <PageTabs
        accent="sky"
        active={detailTab}
        onChange={(id) => setDetailTab(id as DetailTab)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'login', label: 'Login & brand' },
          {
            id: 'modules',
            label: 'Modules',
            count: Object.values(editModules).filter(Boolean).length,
          },
          { id: 'team', label: 'Team', count: teamUsers.length || undefined },
          { id: 'plan', label: 'Plan & seats' },
        ]}
      />

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        {detailTab === 'overview' ? (
          <div className="space-y-5">
            <SectionLabel
              title="Company profile"
              subtitle="Legal / contact details for this workspace. Code and login slug are fixed after create."
            />
            <div className="grid gap-3 rounded-xl border border-border bg-surface/50 p-4 sm:grid-cols-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-text-secondary">
                  Client code
                </div>
                <div className="mt-0.5 font-mono text-sm font-semibold">{live.code}</div>
                <FieldHint>Internal short ID — cannot change</FieldHint>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-text-secondary">
                  Login slug
                </div>
                <div className="mt-0.5 font-mono text-sm font-semibold">/{live.slug}</div>
                <FieldHint>Staff URL: /login/{live.slug}</FieldHint>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-text-secondary">
                  Timeline
                </div>
                <div className="mt-0.5 space-y-0.5 text-sm">
                  <div>Created {formatDate(live.createdAt)}</div>
                  {live.trialEndsAt ? (
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      Trial ends {formatDate(live.trialEndsAt)}
                    </div>
                  ) : null}
                  {live.activatedAt ? (
                    <div className="text-xs text-text-secondary">
                      Activated {formatDate(live.activatedAt)}
                    </div>
                  ) : null}
                  {live.suspendedAt ? (
                    <div className="text-xs text-red-600">
                      Suspended {formatDate(live.suspendedAt)}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Company name *" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <Input
                label="Company email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
              <Input label="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
              <Input label="Website" value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} />
              <div className="sm:col-span-2">
                <Input
                  label="Address line 1"
                  value={editAddress1}
                  onChange={(e) => setEditAddress1(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Address line 2"
                  value={editAddress2}
                  onChange={(e) => setEditAddress2(e.target.value)}
                />
              </div>
              <Input label="City" value={editCity} onChange={(e) => setEditCity(e.target.value)} />
              <Input label="State" value={editState} onChange={(e) => setEditState(e.target.value)} />
              <Input label="Postal code" value={editPostal} onChange={(e) => setEditPostal(e.target.value)} />
              <Input label="GSTIN" value={editGstin} onChange={(e) => setEditGstin(e.target.value)} />
            </div>
          </div>
        ) : null}

        {detailTab === 'login' ? (
          <div className="space-y-5">
            <SectionLabel
              title="Branded client login"
              subtitle="What staff see at /login/{slug}. Same URL for admin + every employee."
            />
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ExternalLink size={16} /> Live login URL
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  readOnly
                  value={clientLoginUrl(live.slug)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 font-mono text-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => void handleCopy(clientLoginUrl(live.slug), 'detail-url')}
                >
                  {copiedKey === 'detail-url' ? <Check size={14} /> : <Copy size={14} />}
                  Copy
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open(clientLoginPath(live.slug), '_blank', 'noopener')}
                >
                  Open
                </Button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div>
                <SectionLabel title="Color kit" subtitle="Accent drives login CTA + CRM chrome." />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(Object.keys(PALETTES) as ColorPalette[]).map((key) => {
                    const def = PALETTES[key]
                    const selected = editPalette === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setEditPalette(key)
                          setEditAccent(def.accent)
                        }}
                        className={cn(
                          'rounded-xl border p-2.5 text-left transition',
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
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Accent (#hex)"
                    value={editAccent}
                    onChange={(e) => setEditAccent(e.target.value)}
                  />
                  <Input
                    label="Logo URL"
                    value={editLogoUrl}
                    onChange={(e) => setEditLogoUrl(e.target.value)}
                  />
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-text-secondary">
                      Upload logo
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={logoUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void uploadLogo(f)
                        e.currentTarget.value = ''
                      }}
                      className="text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label="Login tagline"
                      value={editLoginTagline}
                      onChange={(e) => setEditLoginTagline(e.target.value)}
                      placeholder={`Sign in to ${live.name}`}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={editLocked}
                      onChange={(e) => setEditLocked(e.target.checked)}
                    />
                    Lock palette so client users cannot change it
                  </label>
                </div>
              </div>
              <div>
                <SectionLabel title="Live preview" subtitle="Updates as you edit — save to publish." />
                <LoginPreview
                  companyName={editName.trim() || live.name}
                  slug={live.slug}
                  logoUrl={assetUrl(editLogoUrl.trim()) || null}
                  palette={editPalette}
                  accent={
                    editAccent.match(/^#[0-9A-Fa-f]{6}$/)
                      ? editAccent
                      : PALETTES[editPalette].accent
                  }
                  tagline={editLoginTagline.trim() || undefined}
                />
              </div>
            </div>
          </div>
        ) : null}

        {detailTab === 'modules' ? (
          <div className="space-y-4">
            <SectionLabel
              title="Subscribed modules"
              subtitle="What appears in this client’s sidebar. Apply a pack, then fine-tune checkboxes."
            />
            <div className="flex flex-wrap gap-1">
              {packs.map((pack) => (
                <Button
                  key={pack.code}
                  size="sm"
                  variant={editPack === pack.code ? undefined : 'outline'}
                  onClick={() => applyPack(pack.code, pack.modules)}
                >
                  {pack.label}
                </Button>
              ))}
            </div>
            <FieldHint>
              Active pack hint: <span className="font-mono">{editPack || 'custom'}</span>. Save to
              persist toggles{editPack ? ' + pack' : ''}.
            </FieldHint>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MODULE_TOGGLE_OPTIONS.map((m) => (
                <label
                  key={m.key}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm',
                    editModules[m.key]
                      ? 'border-accent-blue/40 bg-accent-blue/5'
                      : 'border-border',
                  )}
                >
                  <span>
                    <span className="font-medium">{m.label}</span>
                    <span className="ml-2 text-xs text-text-secondary">{m.group}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={Boolean(editModules[m.key])}
                    onChange={(e) =>
                      setEditModules((prev) => ({ ...prev, [m.key]: e.target.checked }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {detailTab === 'team' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <SectionLabel
                title="Team logins"
                subtitle={`Everyone signs in at /login/${live.slug}. Assign inventory visibility so machines, billing spares, and weighing spares can be split across staff.`}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!liveMode || teamLoading}
                onClick={() => void loadTeam(live.id)}
              >
                Refresh
              </Button>
            </div>
            {teamLoading ? (
              <p className="text-sm text-text-secondary">Loading team…</p>
            ) : teamUsers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-text-secondary">
                No users yet. Company admin is created at onboard; they add employees from Users.
              </p>
            ) : (
              <div className="space-y-3">
                {teamUsers.map((u) => {
                  const areas = u.inventoryAreas ?? {
                    machines: true,
                    sparesBilling: true,
                    sparesWeighing: true,
                  }
                  return (
                    <div
                      key={u.id}
                      className="rounded-xl border border-border bg-card p-3 sm:p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-text-primary">{u.name}</div>
                          <div className="font-mono text-xs text-text-secondary">{u.email}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <Badge color="blue">{u.roleCode}</Badge>
                            <span className="text-xs text-text-secondary">{u.status}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!liveMode || pwdBusyId === u.id}
                            onClick={() => void setUserPassword(u.id, u.email)}
                          >
                            Set password
                          </Button>
                          <Button
                            size="sm"
                            disabled={!liveMode || areasBusyId === u.id}
                            onClick={() => void saveUserInventoryAreas(u)}
                          >
                            {areasBusyId === u.id ? 'Saving…' : 'Save inventory access'}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {(
                          [
                            {
                              key: 'machines' as const,
                              label: 'Machines & products',
                            },
                            {
                              key: 'sparesBilling' as const,
                              label: 'Billing / POS spares',
                            },
                            {
                              key: 'sparesWeighing' as const,
                              label: 'Weighing spares',
                            },
                          ] as const
                        ).map((opt) => (
                          <label
                            key={opt.key}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={areas[opt.key]}
                              disabled={!liveMode}
                              onChange={(e) =>
                                patchLocalAreas(u.id, opt.key, e.target.checked)
                              }
                            />
                            <span className="font-medium text-text-primary">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        {detailTab === 'plan' ? (
          <div className="space-y-4">
            <SectionLabel
              title="Commercial plan & seats"
              subtitle="Controls billing tier label and how many employees the company admin may create."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Commercial plan"
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value)}
                options={[
                  { value: 'STARTER', label: 'Starter' },
                  { value: 'GROWTH', label: 'Growth' },
                  { value: 'BUSINESS', label: 'Business' },
                  { value: 'ENTERPRISE', label: 'Enterprise' },
                ]}
              />
              <Input
                label="Max employees (incl. admin)"
                type="number"
                value={editMaxUsers}
                onChange={(e) => setEditMaxUsers(e.target.value)}
              />
            </div>
            <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
              <div>
                <div className="text-[11px] uppercase text-text-secondary">Current seats used</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{live.users}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-text-secondary">Seat cap</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{editMaxUsers || '—'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-text-secondary">Workspace status</div>
                <div className="mt-2">
                  <Badge color={statusBadge(live.status)}>{live.status}</Badge>
                </div>
                {liveMode ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => void toggleSuspend(live)}
                  >
                    {live.status === 'SUSPENDED' ? 'Reactivate workspace' : 'Suspend workspace'}
                  </Button>
                ) : null}
              </div>
            </div>
            <FieldHint>
              Suspend blocks client logins. Reactivate restores ACTIVE. Use Mark Active in the header
              for trial → active without suspending first.
            </FieldHint>
          </div>
        ) : null}
      </div>
    </div>
  )
}
