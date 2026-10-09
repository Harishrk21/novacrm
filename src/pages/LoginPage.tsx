import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams, useParams, useLocation } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Building2, Shield, Wrench, Users } from 'lucide-react'
import {
  APP_NAME,
  PRODUCT_NAME,
  PLATFORM_TAGLINE,
  PLATFORM_LOGIN_PATH,
  PLATFORM_LOGO_URL,
  MEISTER_COLORS,
  HMS_COLORS,
  RESERVED_LOGIN_SLUGS,
} from '@/lib/branding'
import { MeisterLogo } from '@/components/MeisterLogo'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { ApiClientError, api } from '@/lib/api'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { SessionSkeleton } from '@/components/ui/Skeleton'
import { assetUrl } from '@/lib/formValidation'

/** HMS Enterprises staff demo logins (generic /login only) */
const DEMO = {
  admin: {
    title: 'HMS Admin',
    fill: { email: 'admin@hmsenterprises.in', password: 'Demo@12345' },
    lines: ['admin@hmsenterprises.in', 'Demo@12345'],
  },
  desk: {
    title: 'Service desk',
    fill: { email: 'desk@hmsenterprises.in', password: 'Demo@12345' },
    lines: ['desk@hmsenterprises.in', 'Demo@12345'],
  },
  engineer: {
    title: 'Service engineer',
    fill: { email: 'engineer@hmsenterprises.in', password: 'Demo@12345' },
    lines: ['engineer@hmsenterprises.in', 'Demo@12345'],
  },
  warehouse: {
    title: 'Warehouse & billing',
    fill: { email: 'warehouse@hmsenterprises.in', password: 'Demo@12345' },
    lines: ['warehouse@hmsenterprises.in', 'Demo@12345'],
  },
  sales: {
    title: 'Sales executive',
    fill: { email: 'sales@hmsenterprises.in', password: 'Demo@12345' },
    lines: ['sales@hmsenterprises.in', 'Demo@12345'],
  },
} as const

const DEMO_BLOCKS = [DEMO.admin, DEMO.sales, DEMO.desk, DEMO.engineer, DEMO.warehouse] as const

const FEATURES = [
  { icon: Users, label: 'Customers & pipeline' },
  { icon: Wrench, label: 'Service & operations' },
  { icon: Shield, label: 'Secure company workspace' },
] as const

type LoginMode = 'workspace' | 'platform'

type WorkspaceBrand = {
  name: string
  slug: string
  logoUrl?: string | null
  branding: {
    palette: string
    accent?: string
    accentHover?: string
    loginTagline?: string
  }
}

function paletteAccent(brand: WorkspaceBrand | null, platform: boolean): string {
  if (platform) return MEISTER_COLORS.blue
  if (brand?.branding?.accent) return brand.branding.accent
  const key = brand?.branding?.palette as ColorPalette | undefined
  if (key && PALETTES[key]) return PALETTES[key].accent
  return HMS_COLORS.redBright
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { slug: routeSlugRaw } = useParams<{ slug?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const addToast = useUIStore((s) => s.addToast)
  const tenantLogin = useAuthStore((s) => s.tenantLogin)
  const platformLogin = useAuthStore((s) => s.platformLogin)

  const isAdminPath =
    location.pathname === PLATFORM_LOGIN_PATH || location.pathname === '/login/admin'
  const routeSlug = (routeSlugRaw || '').toLowerCase().trim()
  const reservedSlug = (RESERVED_LOGIN_SLUGS as readonly string[]).includes(routeSlug)

  // Legacy bookmark: /login?mode=platform → /login/admin
  useEffect(() => {
    if (!isAdminPath && !routeSlug && searchParams.get('mode') === 'platform') {
      navigate(PLATFORM_LOGIN_PATH, { replace: true })
    }
  }, [isAdminPath, routeSlug, searchParams, navigate])

  // /login/admin is platform-only; reserved words on :slug are not client workspaces
  const brandedSlug = !isAdminPath && routeSlug && !reservedSlug ? routeSlug : ''
  const mode: LoginMode =
    isAdminPath || (!brandedSlug && searchParams.get('mode') === 'platform')
      ? 'platform'
      : 'workspace'

  const [workspace, setWorkspace] = useState<WorkspaceBrand | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(Boolean(brandedSlug))
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const [email, setEmail] = useState<string>(
    mode === 'platform' ? 'admin@novacrm.com' : brandedSlug ? '' : DEMO.admin.fill.email,
  )
  const [password, setPassword] = useState<string>(
    mode === 'platform' ? '' : brandedSlug ? '' : DEMO.admin.fill.password,
  )
  const [tenantSlug, setTenantSlug] = useState(brandedSlug)
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [gatewayReady, setGatewayReady] = useState(false)

  const accent = useMemo(
    () => paletteAccent(workspace, mode === 'platform'),
    [workspace, mode],
  )
  const accentHover =
    mode === 'platform'
      ? MEISTER_COLORS.blueHover
      : workspace?.branding?.accentHover || accent

  useEffect(() => {
    if (!brandedSlug) {
      setWorkspace(null)
      setWorkspaceLoading(false)
      setWorkspaceError(null)
      setTenantSlug('')
      return
    }
    let cancelled = false
    setWorkspaceLoading(true)
    setWorkspaceError(null)
    setTenantSlug(brandedSlug)
    void (async () => {
      try {
        const row = await api.publicWorkspace(brandedSlug)
        if (cancelled) return
        setWorkspace(row)
        document.title = `${row.name} — Sign in`
      } catch (err) {
        if (cancelled) return
        setWorkspace(null)
        setWorkspaceError(err instanceof ApiClientError ? err.message : 'Workspace not found')
      } finally {
        if (!cancelled) setWorkspaceLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brandedSlug])

  useEffect(() => {
    if (brandedSlug) return
    document.title =
      mode === 'platform'
        ? `${PRODUCT_NAME} — Platform sign in`
        : `${PRODUCT_NAME} — Find your workspace`
  }, [mode, brandedSlug])

  useEffect(() => {
    if (brandedSlug || mode === 'platform') {
      setGatewayReady(false)
      return
    }
    const t = window.setTimeout(() => setGatewayReady(true), 24)
    return () => window.clearTimeout(t)
  }, [brandedSlug, mode])

  useEffect(() => {
    if (mode === 'platform') {
      setEmail('admin@novacrm.com')
      setPassword('')
    }
  }, [mode])

  function setMode(next: LoginMode) {
    if (brandedSlug || isAdminPath) return
    if (next === 'platform') navigate(PLATFORM_LOGIN_PATH)
    else setSearchParams({})
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'platform') {
        await platformLogin(email.trim(), password)
        addToast({ type: 'success', message: 'Signed in to Meister Solutions platform' })
        navigate('/admin', { replace: true })
        return
      }
      const slug = (brandedSlug || tenantSlug).trim() || undefined
      await tenantLogin(email.trim(), password, slug)
      if (remember) {
        localStorage.setItem('hms-last-email', email.trim().toLowerCase())
      }
      const role = useAuthStore.getState().user?.role
      const company = workspace?.name || useAuthStore.getState().user?.tenantName || APP_NAME
      if (role === 'SERVICE_DESK') {
        addToast({
          type: 'success',
          message: 'Signed in — create tickets; collect payment & close when work is done',
        })
      } else if (role === 'SALES_EXECUTIVE' || role === 'AGENT') {
        addToast({
          type: 'success',
          message: 'Signed in to Sales desk — open Enquiries / Workqueue for your calls',
        })
      } else if (role && role !== 'ADMIN') {
        addToast({ type: 'success', message: 'Signed in — open My tickets for your assignments' })
      } else {
        addToast({ type: 'success', message: `Signed in to ${company}` })
      }
      navigate('/')
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Login failed',
      })
    } finally {
      setLoading(false)
    }
  }

  if (reservedSlug && !isAdminPath) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-4 text-center text-white">
        <Building2 size={36} className="text-white/50" />
        <h1 className="text-xl font-semibold">Reserved login path</h1>
        <p className="max-w-md text-sm text-white/60">
          “{routeSlug}” is used by the platform. Client workspaces use paths like /login/hms.
        </p>
        <button
          type="button"
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
          onClick={() => navigate(PLATFORM_LOGIN_PATH)}
        >
          Platform admin login
        </button>
      </div>
    )
  }

  if (brandedSlug && workspaceLoading) {
    return <SessionSkeleton variant="tenant" />
  }

  if (brandedSlug && workspaceError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-4 text-center text-white">
        <Building2 size={36} className="text-white/50" />
        <h1 className="text-xl font-semibold">Workspace not available</h1>
        <p className="max-w-md text-sm text-white/60">{workspaceError}</p>
        <button
          type="button"
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
          onClick={() => navigate('/login')}
        >
          Find your company login
        </button>
      </div>
    )
  }

  // Bare /login — Meister gateway. Clients use /login/{slug}; operators use /login/admin.
  if (!brandedSlug && mode === 'workspace') {
    const slugPreview = tenantSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const reservedPreview =
      slugPreview.length > 0 && (RESERVED_LOGIN_SLUGS as readonly string[]).includes(slugPreview)

    function goToWorkspace(e: React.FormEvent) {
      e.preventDefault()
      const s = tenantSlug.trim().toLowerCase()
      if (!s) {
        addToast({ type: 'error', message: 'Enter your company login slug' })
        return
      }
      if ((RESERVED_LOGIN_SLUGS as readonly string[]).includes(s)) {
        addToast({ type: 'error', message: 'That slug is reserved — try your company slug' })
        return
      }
      navigate(`/login/${encodeURIComponent(s)}`)
    }

    return (
      <div className="platform-login relative min-h-[100svh] overflow-hidden bg-[#060A12] text-white">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(ellipse 70% 55% at 10% 15%, rgba(27,107,255,0.30) 0%, transparent 58%),
                radial-gradient(ellipse 50% 40% at 92% 82%, rgba(245,166,35,0.14) 0%, transparent 52%),
                radial-gradient(ellipse 45% 35% at 55% -5%, rgba(10,31,68,0.95) 0%, transparent 62%),
                linear-gradient(165deg, #05080F 0%, #0A1220 48%, #070B14 100%)
              `,
            }}
          />
          <div
            className={`platform-login-sheen absolute -left-1/4 top-1/4 h-[520px] w-[520px] rounded-full ${
              gatewayReady ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              background: 'radial-gradient(circle, rgba(27,107,255,0.24) 0%, transparent 68%)',
              filter: 'blur(40px)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.2]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
              backgroundSize: '72px 72px',
              maskImage: 'radial-gradient(ellipse 70% 60% at 40% 35%, black 12%, transparent 72%)',
            }}
          />
        </div>

        <div className="relative z-10 mx-auto grid min-h-[100svh] w-full max-w-6xl lg:grid-cols-[1.1fr_0.9fr]">
          <section className="flex flex-col justify-between px-7 py-8 sm:px-10 lg:px-12 lg:py-10">
            <div
              className={`flex items-center justify-between gap-4 transition duration-700 ${
                gatewayReady ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
                Workspace gateway
              </span>
              <button
                type="button"
                onClick={() => navigate(PLATFORM_LOGIN_PATH)}
                className="text-[13px] text-white/40 transition hover:text-white/80"
              >
                Platform admin
              </button>
            </div>

            <div
              className={`my-12 max-w-xl transition duration-1000 ease-out sm:my-16 lg:my-0 ${
                gatewayReady ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
              }`}
            >
              <div className="mb-8 inline-flex rounded-2xl bg-white p-4 sm:p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
                <MeisterLogo size="display" dark={false} />
              </div>

              <h1 className="font-[family-name:var(--font-meister-display)] text-[clamp(1.85rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">
                Open your company
                <span className="block text-[#7EB0FF]">workspace.</span>
              </h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/50">
                Every client has a private login path. Enter your company slug — all staff share the
                same URL.
              </p>

              <ul className="mt-10 hidden space-y-4 sm:block">
                {[
                  { title: 'One URL per company', body: 'Admin and every employee sign in the same way.' },
                  { title: 'Branded for your team', body: 'Logo, palette, and tagline load with the workspace.' },
                  { title: 'CRM + ERP together', body: PLATFORM_TAGLINE },
                ].map((item, i) => (
                  <li
                    key={item.title}
                    className={`flex gap-3.5 transition duration-700 ease-out ${
                      gatewayReady ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0'
                    }`}
                    style={{ transitionDelay: `${220 + i * 80}ms` }}
                  >
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: i === 1 ? MEISTER_COLORS.orange : MEISTER_COLORS.blue }}
                    />
                    <div>
                      <div className="text-[14px] font-semibold text-white/90">{item.title}</div>
                      <div className="mt-0.5 text-[13px] text-white/40">{item.body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <p
              className={`text-[12px] text-white/25 transition duration-700 delay-200 ${
                gatewayReady ? 'opacity-100' : 'opacity-0'
              }`}
            >
              © {new Date().getFullYear()} {PRODUCT_NAME}
            </p>
          </section>

          <section className="flex items-center justify-center px-6 py-10 sm:px-10 lg:px-8 lg:py-10">
            <div
              className={`platform-login-panel w-full max-w-[420px] rounded-2xl p-7 sm:p-8 transition duration-1000 delay-100 ease-out ${
                gatewayReady ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
              }`}
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
                boxShadow: '0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <div
                className="mb-1 h-0.5 w-10 rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${MEISTER_COLORS.blue}, ${MEISTER_COLORS.orange})`,
                }}
              />
              <h2 className="mt-4 font-[family-name:var(--font-meister-display)] text-[1.55rem] font-semibold tracking-[-0.02em] text-white">
                Enter company slug
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/40">
                Use the short name your admin shared — for example{' '}
                <span className="font-mono text-white/70">hms</span>.
              </p>

              <form onSubmit={goToWorkspace} className="mt-8 space-y-4">
                <div>
                  <label
                    htmlFor="workspace-slug"
                    className="mb-1.5 block text-[12px] font-medium text-white/50"
                  >
                    Company login slug
                  </label>
                  <div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/45 focus-within:border-[#1B6BFF]/70 focus-within:ring-2 focus-within:ring-[#1B6BFF]/20">
                    <span className="flex items-center border-r border-white/10 px-3 font-mono text-[13px] text-white/35">
                      /login/
                    </span>
                    <input
                      id="workspace-slug"
                      value={tenantSlug}
                      onChange={(e) => setTenantSlug(e.target.value.toLowerCase())}
                      placeholder="your-company"
                      autoComplete="organization"
                      autoFocus
                      className="h-12 min-w-0 flex-1 bg-transparent px-3.5 font-mono text-[15px] text-white outline-none placeholder:text-white/25"
                    />
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 text-[12px]">
                    <span className="text-white/30">Opens</span>
                    <code
                      className={`rounded-md px-2 py-0.5 font-mono ${
                        reservedPreview
                          ? 'bg-red-500/15 text-red-300'
                          : slugPreview
                            ? 'bg-white/8 text-[#8EC0FF]'
                            : 'bg-white/5 text-white/35'
                      }`}
                    >
                      /login/{slugPreview || '…'}
                    </code>
                  </div>
                  {reservedPreview ? (
                    <p className="mt-2 text-[12px] text-red-300/90">
                      Reserved for the platform — pick your company slug instead.
                    </p>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={reservedPreview}
                  className="group mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                  style={{
                    background: `linear-gradient(135deg, ${MEISTER_COLORS.blue} 0%, #1557D6 100%)`,
                    boxShadow: '0 14px 36px rgba(27, 107, 255, 0.35)',
                  }}
                >
                  Continue to workspace
                  <ArrowRight
                    size={16}
                    className="transition group-hover:translate-x-0.5 group-enabled:opacity-100"
                  />
                </button>
              </form>

              <div className="mt-7 border-t border-white/10 pt-5">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-white/30">
                  Quick paths
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('/login/hms')}
                    className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3.5 py-2.5 text-left transition hover:border-white/15 hover:bg-white/[0.06]"
                  >
                    <span>
                      <span className="block text-[13px] font-medium text-white/85">HMS demo</span>
                      <span className="font-mono text-[11px] text-white/35">/login/hms</span>
                    </span>
                    <ArrowRight size={14} className="text-white/30" />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(PLATFORM_LOGIN_PATH)}
                    className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3.5 py-2.5 text-left transition hover:border-white/15 hover:bg-white/[0.06]"
                  >
                    <span>
                      <span className="block text-[13px] font-medium text-white/85">
                        Platform console
                      </span>
                      <span className="font-mono text-[11px] text-white/35">/login/admin</span>
                    </span>
                    <ArrowRight size={14} className="text-white/30" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  const companyName = workspace?.name || APP_NAME
  const tagline = workspace?.branding?.loginTagline
    ? workspace.branding.loginTagline
    : workspace
      ? `Sign in to ${workspace.name}`
      : PLATFORM_TAGLINE

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 font-sans"
      style={{ backgroundColor: mode === 'platform' ? MEISTER_COLORS.ink : HMS_COLORS.black }}
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-32 top-0 h-[420px] w-[420px] rounded-full opacity-30 blur-3xl"
          style={{ background: `radial-gradient(circle, ${accent} 0%, transparent 70%)` }}
        />
        <div
          className="absolute -right-24 bottom-0 h-[360px] w-[360px] rounded-full opacity-20 blur-3xl"
          style={{ background: `radial-gradient(circle, ${accentHover} 0%, transparent 70%)` }}
        />
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{
            background: `linear-gradient(90deg, ${accent}, ${accentHover}, ${HMS_COLORS.charcoal})`,
          }}
        />
      </div>

      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#111111] shadow-2xl lg:grid-cols-[1fr_1.05fr]">
        <div
          className="relative hidden flex-col justify-between p-10 lg:flex"
          style={{
            background: `linear-gradient(145deg, ${HMS_COLORS.charcoal} 0%, ${
              mode === 'platform' ? MEISTER_COLORS.ink : HMS_COLORS.black
            } 55%, ${accent}22 100%)`,
          }}
        >
          <div>
            {mode === 'platform' ? (
              <div className="mb-8 inline-flex rounded-2xl bg-white p-4 sm:p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
                <img
                  src={PLATFORM_LOGO_URL}
                  alt={PRODUCT_NAME}
                  className="h-28 w-auto object-contain sm:h-36 md:h-44"
                />
              </div>
            ) : workspace?.logoUrl ? (
              <div className="mb-8">
                <div className="inline-flex max-w-full rounded-2xl bg-white p-4 sm:p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
                  <img
                    src={assetUrl(workspace.logoUrl)}
                    alt={companyName}
                    className="h-28 w-auto max-w-[min(100%,320px)] object-contain sm:h-36 md:h-44"
                  />
                </div>
                <div className="mt-4">
                  <div className="text-lg font-semibold tracking-tight text-white">{companyName}</div>
                  <div className="mt-0.5 text-sm text-white/50">/{workspace.slug}</div>
                </div>
              </div>
            ) : workspace ? (
              <div className="mb-8 flex items-center gap-4">
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-3xl font-bold text-white shadow-lg ring-1 ring-white/15"
                  style={{ backgroundColor: accent }}
                >
                  {companyName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="text-xl font-semibold tracking-tight text-white">{companyName}</div>
                  <div className="mt-0.5 text-sm text-white/50">Company workspace · /{workspace.slug}</div>
                </div>
              </div>
            ) : null}
            <p className="text-[clamp(1.35rem,2.4vw,1.75rem)] font-semibold leading-snug tracking-tight text-white">
              {tagline}
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/55">
              {mode === 'platform'
                ? 'Create client workspaces, branded login URLs, modules, and seats — without touching existing company data.'
                : workspace
                  ? `Enter your ${companyName} staff email and password. Admin and all employees of this company use this same login URL.`
                  : 'Create client workspaces, branded login URLs, modules, and seats.'}
            </p>
          </div>
          {mode === 'workspace' && (
            <ul className="space-y-3">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm text-white/80">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${accent}33` }}
                  >
                    <Icon size={16} style={{ color: accent }} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          )}
          {mode === 'platform' && (
            <ul className="space-y-3 text-sm text-white/80">
              <li>• Create &amp; suspend client workspaces</li>
              <li>• Toggle subscribed modules per client</li>
              <li>
                • Branded login URLs — e.g. /login/hms
              </li>
            </ul>
          )}
        </div>

        <div className="flex flex-col justify-center p-8 sm:p-10">
          {/* Mobile brand lockup — desktop shows the large stage logo */}
          {mode === 'platform' ? (
            <div className="mb-6 lg:hidden">
              <div className="inline-flex max-w-full rounded-2xl bg-white p-3.5 shadow-lg ring-1 ring-white/10">
                <img
                  src={PLATFORM_LOGO_URL}
                  alt={PRODUCT_NAME}
                  className="h-16 w-auto max-w-[220px] object-contain sm:h-20"
                />
              </div>
            </div>
          ) : mode === 'workspace' && workspace ? (
            <div className="mb-6 lg:hidden">
              {workspace.logoUrl ? (
                <div className="inline-flex max-w-full rounded-2xl bg-white p-3.5 shadow-lg ring-1 ring-white/10">
                  <img
                    src={assetUrl(workspace.logoUrl)}
                    alt={companyName}
                    className="h-16 w-auto max-w-[220px] object-contain sm:h-20"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold text-white"
                    style={{ backgroundColor: accent }}
                  >
                    {companyName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="text-base font-semibold text-white">{companyName}</div>
                </div>
              )}
            </div>
          ) : null}
          <h1 className="text-xl font-semibold text-white">
            {mode === 'platform'
              ? 'Platform sign in'
              : `Sign in${workspace ? ` · ${companyName}` : ''}`}
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {mode === 'platform'
              ? 'Full access to onboard clients and manage plans'
              : brandedSlug
                ? 'Same URL for every employee in this company — use your own email & password'
                : 'Staff email & password for your company'}
          </p>

          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Email</label>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-10 w-full rounded-lg border border-white/15 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/40"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10 w-full rounded-lg border border-white/15 bg-black/40 px-3 pr-10 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/40"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/50 hover:text-white"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-white/30"
              />
              Remember email on this device
            </label>

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center rounded-lg text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              {loading
                ? 'Signing in…'
                : mode === 'platform'
                  ? 'Open platform console'
                  : 'Sign in'}
            </button>
          </form>

          {mode === 'platform' ? (
            <p className="mt-6 text-center text-[11px] text-white/40">
              Client companies sign in at /login/&#123;slug&#125; — not here.
            </p>
          ) : brandedSlug === 'hms' || brandedSlug === 'precision-scales-india' ? (
            <div className="mt-6 space-y-2 border-t border-white/10 pt-5">
              <p className="text-xs text-white/45">
                Demo roles — same /login/hms URL, different accounts:
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {DEMO_BLOCKS.map((b) => (
                  <button
                    key={b.title}
                    type="button"
                    onClick={() => {
                      setEmail(b.fill.email)
                      setPassword(b.fill.password)
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10"
                  >
                    <div className="font-semibold text-white">{b.title}</div>
                    <div className="mt-0.5 text-white/45">{b.lines[0]}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
