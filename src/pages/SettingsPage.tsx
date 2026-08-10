import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot,
  ChevronRight,
  Edit3,
  GripVertical,
  Mail,
  Moon,
  Plus,
  Save,
  Sun,
  Trash2,
  UserPlus,
  Webhook,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAskMeisterStore } from '@/store/askMeisterStore'
import { useCrmStore } from '@/store/crmStore'
import { useAuthStore } from '@/store/authStore'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { isCompanyAdmin } from '@/lib/roles'

const adminTabs = [
  'Appearance',
  'Profile',
  'Company',
  'Sales Targets',
  'Pipeline Stages',
  'Lead Sources',
  'Users & Roles',
  'Email Templates',
  'Integrations',
  'Automation',
] as const
const employeeTabs = ['Appearance', 'Profile'] as const
type Tab = (typeof adminTabs)[number]

const STAGE_SWATCHES = [
  { hex: '#3B82F6', className: 'bg-blue-500' },
  { hex: '#8B5CF6', className: 'bg-violet-500' },
  { hex: '#F59E0B', className: 'bg-amber-500' },
  { hex: '#F97316', className: 'bg-orange-500' },
  { hex: '#10B981', className: 'bg-emerald-500' },
  { hex: '#EF4444', className: 'bg-red-500' },
  { hex: '#64748B', className: 'bg-slate-500' },
]

function stageColorClass(hex?: string | null) {
  const found = STAGE_SWATCHES.find((s) => s.hex.toLowerCase() === (hex ?? '').toLowerCase())
  return found?.className ?? 'bg-slate-500'
}

export function SettingsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = isCompanyAdmin(role)
  const tabs = isAdmin ? adminTabs : employeeTabs
  const [active, setActive] = useState<Tab>('Profile')

  useEffect(() => {
    if (!(tabs as readonly string[]).includes(active)) {
      setActive('Profile')
    }
  }, [tabs, active])

  return (
    <div>
      <PageHeader
        title="Settings"
        breadcrumbs={[{ label: isAdmin ? 'Home' : 'My work', to: '/' }, { label: 'Settings' }]}
      />
      <PageTip moduleKey="crm.settings" />
      <div className="grid gap-5 xl:grid-cols-[230px_1fr]">
        <Card className="h-fit p-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActive(tab)}
              className={cn(
                'flex min-h-10 w-full items-center justify-between rounded-[6px] px-3 text-left text-sm font-medium',
                active === tab
                  ? 'bg-accent-blue/10 text-accent-blue'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary',
              )}
            >
              {tab}
              <ChevronRight size={14} />
            </button>
          ))}
        </Card>
        <div>
          {active === 'Appearance' && <Appearance />}
          {active === 'Profile' && <Profile />}
          {isAdmin && active === 'Company' && <Company />}
          {isAdmin && active === 'Sales Targets' && <SalesTargets />}
          {isAdmin && active === 'Pipeline Stages' && <Pipeline />}
          {isAdmin && active === 'Lead Sources' && <Sources />}
          {isAdmin && active === 'Users & Roles' && <UsersSettings />}
          {isAdmin && active === 'Email Templates' && <EmailTemplates />}
          {isAdmin && active === 'Integrations' && <Integrations />}
          {isAdmin && active === 'Automation' && <Automation />}
        </div>
      </div>
    </div>
  )
}

function Appearance() {
  const themeMode = useUIStore((s) => s.themeMode)
  const palette = useUIStore((s) => s.palette)
  const setThemeMode = useUIStore((s) => s.setThemeMode)
  const setPalette = useUIStore((s) => s.setPalette)
  const addToast = useUIStore((s) => s.addToast)
  const resetDemoData = useCrmStore((s) => s.resetDemoData)

  return (
    <div className="space-y-5">
      <Card>
        <Heading title="Day / Night mode" subtitle="Switch the entire CRM between light and dark surfaces" />
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => setThemeMode('light')}
            className={cn(
              'flex items-center gap-3 rounded-[8px] border p-4 text-left transition-all',
              themeMode === 'light' ? 'border-accent-blue ring-2 ring-accent-blue/20' : 'border-border hover:border-accent-blue/40',
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-accent-amber">
              <Sun size={18} />
            </div>
            <div>
              <div className="font-semibold">Day mode</div>
              <div className="text-xs text-text-secondary">Bright surfaces for daytime work</div>
            </div>
          </button>
          <button
            onClick={() => setThemeMode('dark')}
            className={cn(
              'flex items-center gap-3 rounded-[8px] border p-4 text-left transition-all',
              themeMode === 'dark' ? 'border-accent-blue ring-2 ring-accent-blue/20' : 'border-border hover:border-accent-blue/40',
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-100">
              <Moon size={18} />
            </div>
            <div>
              <div className="font-semibold">Night mode</div>
              <div className="text-xs text-text-secondary">Low-glare dark dashboard</div>
            </div>
          </button>
        </div>
      </Card>

      <Card>
        <Heading title="Dashboard color palette" subtitle="Accent + chart colors used across CRM analytics" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(PALETTES) as ColorPalette[]).map((key) => (
            <button
              key={key}
              onClick={() => {
                setPalette(key)
                addToast({ type: 'success', message: `${PALETTES[key].label} palette applied` })
              }}
              className={cn(
                'rounded-[8px] border p-4 text-left transition-all',
                palette === key ? 'border-accent-blue ring-2 ring-accent-blue/20' : 'border-border hover:border-accent-blue/40',
              )}
            >
              <div className="mb-3 flex gap-1.5">
                {PALETTES[key].chart.map((c) => (
                  <span key={c} className="h-4 flex-1 rounded-full" style={{ background: c }} />
                ))}
              </div>
              <div className="font-semibold">{PALETTES[key].label}</div>
              <div className="mt-1 text-xs text-text-secondary">{PALETTES[key].description}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <Heading title="Demo data" subtitle="Reset local CRM cache used when offline / demo mode" />
        <Button
          variant="outline"
          onClick={() => {
            resetDemoData()
            addToast({ type: 'success', message: 'Demo data restored' })
          }}
        >
          Reset demo data
        </Button>
      </Card>
    </div>
  )
}

function Heading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

function PrefToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-text-secondary">{description}</p>
      </div>
      <button
        type="button"
        aria-label={`Toggle ${label}`}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-accent-blue' : 'bg-slate-300')}
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-1' : '-translate-x-4',
          )}
        />
      </button>
    </div>
  )
}

function Profile() {
  const addToast = useUIStore((s) => s.addToast)
  const patchUser = useAuthStore((s) => s.patchUser)
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [emailNotifs, setEmailNotifs] = useState(true)
  const [activityReminders, setActivityReminders] = useState(true)
  const [weeklySummary, setWeeklySummary] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = (await api.me()) as {
          name?: string
          email?: string
          phone?: string | null
          avatarUrl?: string | null
          timezone?: string | null
          preferences?: Record<string, unknown> | null
        }
        if (cancelled) return
        setName(me.name ?? '')
        setEmail(me.email ?? '')
        setPhone(me.phone ?? '')
        setAvatarUrl(me.avatarUrl ?? null)
        setTimezone(me.timezone || 'Asia/Kolkata')
        const prefs = me.preferences ?? {}
        if (typeof prefs.emailNotifications === 'boolean') setEmailNotifs(prefs.emailNotifications)
        if (typeof prefs.activityReminders === 'boolean') setActivityReminders(prefs.activityReminders)
        if (typeof prefs.weeklySummary === 'boolean') setWeeklySummary(prefs.weeklySummary)
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Failed to load profile',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addToast])

  async function onPhotoChange(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      addToast({ type: 'error', message: 'Choose a JPG or PNG image' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      addToast({ type: 'error', message: 'Image must be under 2 MB' })
      return
    }
    setUploading(true)
    try {
      const uploaded = await api.uploadImage(file)
      const updated = (await api.updateProfile({ avatarUrl: uploaded.url })) as {
        name?: string
        avatarUrl?: string | null
      }
      setAvatarUrl(updated.avatarUrl ?? uploaded.url)
      patchUser({ avatarUrl: updated.avatarUrl ?? uploaded.url, name: updated.name ?? name })
      addToast({ type: 'success', message: 'Profile photo updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Photo upload failed',
      })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) {
      addToast({ type: 'error', message: 'Name must be at least 2 characters' })
      return
    }
    setSaving(true)
    try {
      const updated = (await api.updateProfile({
        name: name.trim(),
        phone: phone.trim() || null,
        timezone,
        preferences: {
          emailNotifications: emailNotifs,
          activityReminders,
          weeklySummary,
        },
      })) as { name?: string; phone?: string | null; avatarUrl?: string | null }
      patchUser({
        name: updated.name ?? name.trim(),
        phone: updated.phone ?? (phone.trim() || null),
        avatarUrl: updated.avatarUrl ?? avatarUrl,
      })
      addToast({ type: 'success', message: 'Profile updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    if (currentPassword.length < 8 || newPassword.length < 8) {
      addToast({ type: 'error', message: 'Passwords must be at least 8 characters' })
      return
    }
    setPwdSaving(true)
    try {
      await api.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      addToast({ type: 'success', message: 'Password updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Password update failed',
      })
    } finally {
      setPwdSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-text-secondary">Loading profile…</p>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card>
        <Heading title="Profile" subtitle="Manage your personal information" />
        <form className="space-y-5" onSubmit={(e) => void saveProfile(e)}>
          <div className="flex items-center gap-4">
            <Avatar name={name || 'User'} src={avatarUrl} size="xl" />
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void onPhotoChange(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Uploading…' : 'Change photo'}
              </Button>
              <p className="mt-1 text-xs text-text-secondary">JPG, PNG or WebP, up to 2 MB</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input label="Email" type="email" value={email} disabled />
            <Input
              label="Phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 …"
            />
            <Select
              label="Timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              options={[
                { value: 'Asia/Kolkata', label: 'India Standard Time (UTC+5:30)' },
                { value: 'UTC', label: 'UTC' },
                { value: 'Asia/Dubai', label: 'Gulf Standard Time (UTC+4)' },
              ]}
            />
          </div>
          <Button type="submit" disabled={saving}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </form>
      </Card>

      <Card>
        <Heading title="Password" subtitle="Use a strong, unique password" />
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void savePassword(e)}>
          <Input
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" disabled={pwdSaving}>
              {pwdSaving ? 'Updating…' : 'Update Password'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <Heading title="Notifications" subtitle="Saved with your profile preferences" />
        <PrefToggle
          label="Email notifications"
          description="Ticket, deal, and assignment updates"
          checked={emailNotifs}
          onChange={setEmailNotifs}
        />
        <PrefToggle
          label="Activity reminders"
          description="Upcoming calls, tasks, and meetings"
          checked={activityReminders}
          onChange={setActivityReminders}
        />
        <PrefToggle
          label="Weekly summary"
          description="A weekly performance report"
          checked={weeklySummary}
          onChange={setWeeklySummary}
        />
        <p className="mt-2 text-xs text-text-secondary">Click Save Changes on Profile to persist notification prefs.</p>
      </Card>
    </div>
  )
}

function Company() {
  const addToast = useUIStore((s) => s.addToast)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [gstin, setGstin] = useState('')
  const [website, setWebsite] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await api.myTenant()
        if (cancelled) return
        setName(t.name ?? '')
        setEmail(t.email ?? '')
        setPhone(t.phone ?? '')
        setGstin(t.gstin ?? '')
        setWebsite(t.website ?? '')
        setAddressLine1(t.addressLine1 ?? '')
        setCity(t.city ?? '')
        setState(t.state ?? '')
        setPostalCode(t.postalCode ?? '')
        setCurrency(t.currency ?? 'INR')
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Failed to load company',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addToast])

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updateMyTenant({
        email: email.trim() || null,
        phone: phone.trim() || null,
        gstin: gstin.trim() || null,
        website: website.trim() || null,
        addressLine1: addressLine1.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        postalCode: postalCode.trim() || null,
      })
      addToast({ type: 'success', message: 'Company settings saved' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <Heading title="Company" subtitle="Organization profile for invoices and workspace branding" />
      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void save(e)}>
          <Input label="Company name" value={name} disabled />
          <Input label="Currency" value={currency} disabled />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="GSTIN" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="22AAAAA0000A1Z5" />
          <Input label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          <div className="sm:col-span-2">
            <Input label="Address" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
          </div>
          <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
          <Input label="Postal code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

function SalesTargets() {
  const addToast = useUIStore((s) => s.addToast)
  const [revenueTarget, setRevenueTarget] = useState('500000')
  const [targetPeriod, setTargetPeriod] = useState('month')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await api.myTenant()
        if (cancelled) return
        const settings = (t.settings ?? {}) as Record<string, unknown>
        if (settings.revenueTarget != null) setRevenueTarget(String(settings.revenueTarget))
        if (settings.targetPeriod) setTargetPeriod(String(settings.targetPeriod))
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Failed to load targets',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addToast])

  async function save(e: FormEvent) {
    e.preventDefault()
    const amount = Number(revenueTarget)
    if (!Number.isFinite(amount) || amount < 0) {
      addToast({ type: 'error', message: 'Enter a valid revenue target amount' })
      return
    }
    setSaving(true)
    try {
      await api.updateMyTenant({
        settings: {
          revenueTarget: amount,
          targetPeriod,
          currency: 'INR',
        },
      })
      addToast({ type: 'success', message: 'Sales target saved — dashboard gauge uses this value' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <Heading
        title="Sales Targets"
        subtitle="Set the revenue goal used by the home dashboard gauge and progress %. Stored in tenant settings."
      />
      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (
        <form className="grid max-w-xl gap-4 sm:grid-cols-2" onSubmit={(e) => void save(e)}>
          <Input
            label="Revenue target (₹)"
            type="number"
            min={0}
            step={1000}
            value={revenueTarget}
            onChange={(e) => setRevenueTarget(e.target.value)}
          />
          <Select
            label="Period"
            value={targetPeriod}
            onChange={(e) => setTargetPeriod(e.target.value)}
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'quarter', label: 'Quarterly' },
              { value: 'year', label: 'Yearly' },
            ]}
          />
          <div className="sm:col-span-2 rounded-[8px] border border-border bg-surface p-3 text-sm text-text-secondary">
            Achieved revenue on the dashboard = sum of <strong>Won deals</strong> amounts. Progress % = Won ÷ this
            target.
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving…' : 'Save target'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

type StageRow = {
  id: string
  name: string
  probability: number
  colorHex?: string | null
  sortOrder?: number
}

function Pipeline() {
  const addToast = useUIStore((s) => s.addToast)
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = !role || role === 'ADMIN'
  const [items, setItems] = useState<StageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<StageRow | null>(null)
  const [name, setName] = useState('')
  const [probability, setProbability] = useState('20')
  const [colorHex, setColorHex] = useState('#3B82F6')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.lookups()
      setItems(
        [...data.stages].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      )
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load stages',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    setEditing(null)
    setName('')
    setProbability('20')
    setColorHex('#3B82F6')
    setOpen(true)
  }

  function openEdit(row: StageRow) {
    setEditing(row)
    setName(row.name)
    setProbability(String(row.probability))
    setColorHex(row.colorHex || '#3B82F6')
    setOpen(true)
  }

  async function save() {
    if (!name.trim()) return
    const prob = Number(probability)
    if (!Number.isFinite(prob) || prob < 0 || prob > 100) {
      addToast({ type: 'error', message: 'Probability must be 0–100' })
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateStage(editing.id, { name: name.trim(), probability: prob, colorHex })
        addToast({ type: 'success', message: 'Stage updated' })
      } else {
        await api.createStage({ name: name.trim(), probability: prob, colorHex })
        addToast({ type: 'success', message: 'Stage created' })
      }
      setOpen(false)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  async function deactivate(row: StageRow) {
    if (!confirm(`Deactivate stage “${row.name}”?`)) return
    try {
      await api.updateStage(row.id, { isActive: false })
      addToast({ type: 'success', message: 'Stage deactivated' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to deactivate',
      })
    }
  }

  return (
    <>
      <Card>
        <Heading
          title="Pipeline Stages"
          subtitle="Stages used on deals and the pipeline board"
          action={
            isAdmin ? (
              <Button onClick={openCreate}>
                <Plus size={16} />
                Add Stage
              </Button>
            ) : undefined
          }
        />
        {loading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary">No stages yet.</p>
        ) : (
          <div className="space-y-2">
            {items.map((stage) => (
              <div key={stage.id} className="flex min-h-14 items-center gap-3 rounded-[6px] border border-border px-3">
                <GripVertical size={17} className="text-text-secondary" />
                <span className={cn('h-3 w-3 rounded-full', stageColorClass(stage.colorHex))} />
                <span className="flex-1 font-medium">{stage.name}</span>
                <span className="text-sm text-text-secondary">{stage.probability}% probability</span>
                {isAdmin && (
                  <>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${stage.name}`} onClick={() => openEdit(stage)}>
                      <Edit3 size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-accent-red"
                      aria-label={`Deactivate ${stage.name}`}
                      onClick={() => void deactivate(stage)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {!isAdmin && (
          <p className="mt-3 text-xs text-text-secondary">Only company admins can add or edit stages.</p>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit stage' : 'New stage'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Win probability %"
            type="number"
            min={0}
            max={100}
            value={probability}
            onChange={(e) => setProbability(e.target.value)}
          />
          <div>
            <p className="mb-2 text-sm font-medium text-text-secondary">Color</p>
            <div className="flex flex-wrap gap-2">
              {STAGE_SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  onClick={() => setColorHex(s.hex)}
                  className={cn(
                    'h-8 w-8 rounded-full border-2',
                    s.className,
                    colorHex === s.hex ? 'border-text-primary' : 'border-transparent',
                  )}
                  aria-label={s.hex}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

type SourceRow = { id: string; name: string; colorHex?: string | null }

function Sources() {
  const addToast = useUIStore((s) => s.addToast)
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = !role || role === 'ADMIN'
  const [items, setItems] = useState<SourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SourceRow | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.lookups()
      setItems(data.sources)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load sources',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    setEditing(null)
    setName('')
    setOpen(true)
  }

  function openEdit(row: SourceRow) {
    setEditing(row)
    setName(row.name)
    setOpen(true)
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await api.updateSource(editing.id, { name: name.trim() })
        addToast({ type: 'success', message: 'Source updated' })
      } else {
        await api.createSource({ name: name.trim() })
        addToast({ type: 'success', message: 'Source created' })
      }
      setOpen(false)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: SourceRow) {
    if (!confirm(`Deactivate source “${row.name}”?`)) return
    try {
      await api.deleteSource(row.id)
      addToast({ type: 'success', message: 'Source deactivated' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Delete failed',
      })
    }
  }

  return (
    <>
      <Card>
        <Heading
          title="Lead Sources"
          subtitle="Where your leads originate — used in lead forms and reports"
          action={
            isAdmin ? (
              <Button onClick={openCreate}>
                <Plus size={16} />
                Add Source
              </Button>
            ) : undefined
          }
        />
        {loading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary">No sources yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((source) => (
              <div key={source.id} className="flex min-h-14 items-center gap-2">
                <span className="flex-1 font-medium">{source.name}</span>
                {isAdmin && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(source)}>
                      <Edit3 size={15} />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-accent-red"
                      aria-label={`Delete ${source.name}`}
                      onClick={() => void remove(source)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit source' : 'New source'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !name.trim()} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Input label="Source name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website" />
      </Modal>
    </>
  )
}

export function UsersSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const [items, setItems] = useState<
    Array<{
      id: string
      name: string
      email: string
      status: string
      lastLoginAt?: string | null
      role?: { code: string; name: string } | null
      avatarUrl?: string | null
    }>
  >([])
  const [meta, setMeta] = useState({ maxUsers: 0, used: 0, remaining: 0 })
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('Demo@12345')
  const [phone, setPhone] = useState('')
  const [roleCode, setRoleCode] = useState('AGENT')

  async function load() {
    setLoading(true)
    try {
      const res = await api.listUsers()
      setItems(res.items)
      setMeta({ maxUsers: res.maxUsers, used: res.used, remaining: res.remaining })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load users',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function invite() {
    if (!name.trim() || !email.trim() || password.length < 8) {
      addToast({ type: 'error', message: 'Name, email, and password (8+) are required' })
      return
    }
    setSaving(true)
    try {
      await api.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim() || null,
        roleCode,
      })
      addToast({ type: 'success', message: 'User created' })
      setOpen(false)
      setName('')
      setEmail('')
      setPhone('')
      setPassword('Demo@12345')
      setRoleCode('AGENT')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Invite failed',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card padding={false}>
        <div className="p-5">
          <Heading
            title="Users & Roles"
            subtitle={
              meta.maxUsers
                ? `${meta.used} of ${meta.maxUsers} seats used (${meta.remaining} remaining)`
                : 'Manage access across your workspace'
            }
            action={
              <div className="flex flex-wrap gap-2">
                <Link to="/users">
                  <Button variant="outline">Full users page</Button>
                </Link>
                <Button onClick={() => setOpen(true)} disabled={meta.remaining === 0 && meta.maxUsers > 0}>
                  <UserPlus size={16} />
                  Invite User
                </Button>
              </div>
            }
          />
        </div>
        {loading ? (
          <p className="px-5 pb-5 text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface text-xs text-text-secondary">
                <tr>
                  {['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2 font-medium">
                        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                        {user.name}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{user.email}</td>
                    <td className="px-5 py-4">
                      <Badge color="purple">{(user.role?.code ?? '—').replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        color={user.status === 'ACTIVE' ? 'green' : user.status === 'INVITED' ? 'amber' : 'gray'}
                      >
                        {user.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <Link to="/users">
                        <Button variant="ghost" size="sm">
                          <Edit3 size={15} />
                          Edit
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite user"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void invite()}>
              {saving ? 'Creating…' : 'Create user'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input
            label="Temporary password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Select
            label="Role"
            value={roleCode}
            onChange={(e) => setRoleCode(e.target.value)}
            options={[
              { value: 'AGENT', label: 'Sales Agent' },
              { value: 'MANAGER', label: 'Manager' },
              { value: 'ADMIN', label: 'Company Admin' },
              { value: 'READ_ONLY', label: 'Read only' },
            ]}
          />
        </div>
      </Modal>
    </>
  )
}

type EmailTemplate = { id: string; name: string; subject: string; body: string }

function EmailTemplates() {
  const addToast = useUIStore((s) => s.addToast)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const t = await api.myTenant()
      const settings = (t.settings ?? {}) as Record<string, unknown>
      const list = Array.isArray(settings.emailTemplates)
        ? (settings.emailTemplates as EmailTemplate[])
        : [
            { id: '1', name: 'Lead follow-up', subject: 'Following up on your enquiry', body: '' },
            { id: '2', name: 'Meeting confirmation', subject: 'Meeting confirmed', body: '' },
            { id: '3', name: 'Proposal sent', subject: 'Your proposal is ready', body: '' },
            { id: '4', name: 'Ticket resolved', subject: 'Your ticket has been resolved', body: '' },
          ]
      setTemplates(list)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load templates',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function startCreate() {
    setEditing(null)
    setName('')
    setSubject('')
    setBody('')
    setCreating(true)
  }

  function startEdit(t: EmailTemplate) {
    setEditing(t)
    setName(t.name)
    setSubject(t.subject)
    setBody(t.body)
    setCreating(true)
  }

  async function saveTemplate() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const next = editing
        ? templates.map((t) =>
            t.id === editing.id ? { ...t, name: name.trim(), subject: subject.trim(), body } : t,
          )
        : [
            ...templates,
            {
              id: crypto.randomUUID(),
              name: name.trim(),
              subject: subject.trim(),
              body,
            },
          ]
      await api.updateMyTenant({ settings: { emailTemplates: next } })
      setTemplates(next)
      setCreating(false)
      addToast({ type: 'success', message: editing ? 'Template updated' : 'Template created' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <Heading
          title="Email Templates"
          subtitle="Reusable messages stored in your company settings"
          action={
            <Button onClick={startCreate}>
              <Plus size={16} />
              Create Template
            </Button>
          }
        />
        {loading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : (
          <div className="divide-y divide-border">
            {templates.map((t) => (
              <div key={t.id} className="flex min-h-14 items-center">
                <Mail size={17} className="mr-3 text-accent-blue" />
                <span className="flex-1 font-medium">{t.name}</span>
                <Button variant="ghost" size="sm" onClick={() => startEdit(t)}>
                  <Edit3 size={15} />
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {creating && (
        <Card>
          <Heading title={editing ? 'Edit Template' : 'New Template'} subtitle="Create a message your team can reuse" />
          <div className="space-y-4">
            <Input label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <label className="block text-sm font-medium text-text-secondary">
              Message
              <textarea
                className="mt-1 min-h-36 w-full rounded-[6px] border border-border bg-card p-3 text-text-primary"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button disabled={saving || !name.trim()} onClick={() => void saveTemplate()}>
                <Save size={16} />
                {saving ? 'Saving…' : 'Save template'}
              </Button>
              <Button variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

function Integrations() {
  const addToast = useUIStore((s) => s.addToast)
  const askConnected = useAskMeisterStore((s) => s.connected)
  const askName = useAskMeisterStore((s) => s.workspaceName)
  const [flags, setFlags] = useState<Record<string, boolean>>({
    exotel: true,
    twilio: false,
    gmail: true,
    outlook: false,
    googleCalendar: true,
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await api.myTenant()
        if (cancelled) return
        const settings = (t.settings ?? {}) as Record<string, unknown>
        const integ = (settings.integrations ?? {}) as Record<string, boolean>
        setFlags((prev) => ({ ...prev, ...integ }))
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(key: string) {
    const next = { ...flags, [key]: !flags[key] }
    setFlags(next)
    try {
      await api.updateMyTenant({ settings: { integrations: next } })
      addToast({ type: 'success', message: `${key} ${next[key] ? 'enabled' : 'disabled'}` })
    } catch (err) {
      setFlags(flags)
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update integration',
      })
    }
  }

  const cards = [
    {
      name: 'AskMeister WhatsApp',
      description: 'Official WhatsApp inbox for NovaCRM — connect your AskMeister dashboard',
      state: askConnected ? 'on' : 'off',
      href: '/whatsapp',
      badge: askConnected ? askName || 'Connected' : undefined,
    },
    { name: 'Exotel', description: 'Cloud telephony and call tracking for India', key: 'exotel' },
    { name: 'Twilio', description: 'Voice and messaging platform', key: 'twilio' },
    { name: 'Gmail', description: 'Sync email conversations per user', key: 'gmail' },
    { name: 'Outlook', description: 'Connect Microsoft email', key: 'outlook' },
    { name: 'Google Calendar', description: 'Sync meetings and reminders', key: 'googleCalendar' },
    { name: 'Tally / Zoho Books', description: 'Accounting and invoicing sync', state: 'soon' as const },
  ] as const

  return (
    <div>
      <Heading title="Integrations" subtitle="Connect NovaCRM with telephony, email, WhatsApp, and books" />
      {!loaded ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((item) => {
            const state =
              'state' in item
                ? item.state
                : flags[item.key]
                  ? 'on'
                  : 'off'
            return (
              <Card key={item.name}>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-accent-blue/10 text-accent-blue">
                    <Webhook size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{item.name}</h3>
                      {state === 'soon' && <Badge color="amber">Coming Soon</Badge>}
                      {state === 'on' && (
                        <Badge color="green">
                          {'badge' in item && item.badge ? item.badge : 'Connected'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">{item.description}</p>
                  </div>
                </div>
                {state !== 'soon' &&
                  ('href' in item && item.href ? (
                    <Link to={item.href}>
                      <Button className="mt-4 w-full" variant={state === 'on' ? 'outline' : 'primary'}>
                        {state === 'on' ? 'Manage connection' : 'Connect AskMeister'}
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      className="mt-4 w-full"
                      variant={state === 'on' ? 'outline' : 'primary'}
                      onClick={() => 'key' in item && void toggle(item.key)}
                    >
                      {state === 'on' ? 'Disconnect' : 'Connect'}
                    </Button>
                  ))}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

type AutoRule = { id: string; name: string; description: string; enabled: boolean }

function Automation() {
  const addToast = useUIStore((s) => s.addToast)
  const [rules, setRules] = useState<AutoRule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await api.myTenant()
        if (cancelled) return
        const settings = (t.settings ?? {}) as Record<string, unknown>
        const list = Array.isArray(settings.automationRules)
          ? (settings.automationRules as AutoRule[])
          : [
              {
                id: '1',
                name: 'Assign website leads',
                description: 'Round-robin new website leads across active agents',
                enabled: true,
              },
              {
                id: '2',
                name: 'High-value deal alert',
                description: 'Notify managers when a deal exceeds ₹5L',
                enabled: true,
              },
              {
                id: '3',
                name: 'Overdue task reminder',
                description: 'Notify owners when tasks become overdue',
                enabled: false,
              },
            ]
        setRules(list)
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof ApiClientError ? err.message : 'Failed to load automation',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [addToast])

  async function toggle(id: string) {
    const next = rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    setRules(next)
    try {
      await api.updateMyTenant({ settings: { automationRules: next } })
      addToast({ type: 'success', message: 'Automation updated' })
    } catch (err) {
      setRules(rules)
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Save failed',
      })
    }
  }

  async function addRule() {
    const next: AutoRule[] = [
      ...rules,
      {
        id: crypto.randomUUID(),
        name: 'New automation rule',
        description: 'Describe what this rule should do',
        enabled: true,
      },
    ]
    setRules(next)
    try {
      await api.updateMyTenant({ settings: { automationRules: next } })
      addToast({ type: 'success', message: 'Rule added — edit description in company settings JSON later if needed' })
    } catch (err) {
      setRules(rules)
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not add rule',
      })
    }
  }

  return (
    <Card>
      <Heading
        title="Automation"
        subtitle="Toggle routine CRM rules (stored in company settings)"
        action={
          <Button onClick={() => void addRule()}>
            <Plus size={16} />
            Add Rule
          </Button>
        }
      />
      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (
        <div className="divide-y divide-border">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-4 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-violet-50 text-accent-purple">
                <Bot size={18} />
              </div>
              <div className="flex-1">
                <p className="font-medium">{rule.name}</p>
                <p className="text-sm text-text-secondary">{rule.description}</p>
              </div>
              <button
                type="button"
                aria-label={`Toggle ${rule.name}`}
                aria-pressed={rule.enabled}
                onClick={() => void toggle(rule.id)}
                className={cn('relative h-6 w-11 rounded-full', rule.enabled ? 'bg-accent-green' : 'bg-slate-300')}
              >
                <span
                  className={cn(
                    'absolute top-1 h-4 w-4 rounded-full bg-white transition-transform',
                    rule.enabled ? 'translate-x-1' : '-translate-x-4',
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default SettingsPage
