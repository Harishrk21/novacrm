import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MeisterLogo } from '@/components/MeisterLogo'
import { PRODUCT_NAME, PLATFORM_NAME, MEISTER_COLORS } from '@/lib/branding'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { ApiClientError } from '@/lib/api'

function IconEye({ off = false }: { off?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.35" />
      {off ? (
        <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      ) : null}
    </svg>
  )
}

function IconArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h13M14 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconWorkspace() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.35" />
      <path d="M8 14h4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

function IconBrand() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.35" />
      <path d="M12 3.75v2.5M12 17.75v2.5M3.75 12h2.5M17.75 12h2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

function IconAccess() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 19.5 7v5.2c0 4.4-2.9 7.4-7.5 8.8-4.6-1.4-7.5-4.4-7.5-8.8V7L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M9.5 12.2 11.2 14l3.5-3.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const CAPABILITIES: Array<{ icon: () => ReactNode; title: string; body: string }> = [
  {
    icon: IconWorkspace,
    title: 'Client workspaces',
    body: 'Launch branded CRM & ERP shells in minutes.',
  },
  {
    icon: IconBrand,
    title: 'Login & modules',
    body: 'Palette, logo, packs — preview before publish.',
  },
  {
    icon: IconAccess,
    title: 'Seats & credentials',
    body: 'Govern access without touching customer data.',
  },
]

export function PlatformLoginPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const platformLogin = useAuthStore((s) => s.platformLogin)

  const [email, setEmail] = useState('admin@novacrm.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    document.title = `${PLATFORM_NAME} — Platform sign in`
    const t = window.setTimeout(() => setReady(true), 24)
    return () => window.clearTimeout(t)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await platformLogin(email.trim(), password)
      addToast({ type: 'success', message: `Welcome to ${PLATFORM_NAME}` })
      navigate('/admin', { replace: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Login failed',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="platform-login relative min-h-[100svh] overflow-hidden bg-[#060A12] text-white">
      {/* Atmosphere — brand navy / blue / orange, restrained */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 70% 55% at 12% 18%, rgba(27,107,255,0.28) 0%, transparent 58%),
              radial-gradient(ellipse 55% 45% at 88% 78%, rgba(245,166,35,0.12) 0%, transparent 52%),
              radial-gradient(ellipse 40% 35% at 55% 0%, rgba(10,31,68,0.9) 0%, transparent 60%),
              linear-gradient(165deg, #05080F 0%, #0A1220 48%, #070B14 100%)
            `,
          }}
        />
        <div
          className={`platform-login-sheen absolute -left-1/4 top-1/3 h-[520px] w-[520px] rounded-full ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'radial-gradient(circle, rgba(27,107,255,0.22) 0%, transparent 68%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.22]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
            maskImage: 'radial-gradient(ellipse 65% 55% at 35% 40%, black 15%, transparent 72%)',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto grid min-h-[100svh] w-full max-w-6xl lg:grid-cols-[1.12fr_0.88fr]">
        {/* Brand stage */}
        <section className="flex flex-col justify-between px-7 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div
            className={`flex justify-end lg:justify-start transition duration-700 ${
              ready ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="text-[13px] text-white/40 transition hover:text-white/75"
            >
              Client login
            </button>
          </div>

          <div
            className={`my-12 max-w-xl transition duration-1000 ease-out sm:my-16 lg:my-0 ${
              ready ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
            }`}
          >
            <div className="mb-8 inline-flex rounded-2xl bg-white p-4 sm:p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
              <MeisterLogo size="display" dark={false} />
            </div>

            <p className="sr-only">{PRODUCT_NAME}</p>
            <h1 className="font-[family-name:var(--font-meister-display)] text-[clamp(1.9rem,3.8vw,2.85rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
              Command every client
              <span className="block text-[#7EB0FF]">from one console.</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/50">
              Onboard companies, brand their login, and govern modules — Meister operators only.
            </p>

            <ul className="mt-10 hidden space-y-5 sm:block">
              {CAPABILITIES.map((item, i) => (
                <li
                  key={item.title}
                  className={`flex gap-3.5 transition duration-700 ease-out ${
                    ready ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0'
                  }`}
                  style={{ transitionDelay: `${220 + i * 80}ms` }}
                >
                  <span
                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]"
                    style={{ color: i === 1 ? MEISTER_COLORS.orange : '#8EC0FF' }}
                  >
                    <item.icon />
                  </span>
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
              ready ? 'opacity-100' : 'opacity-0'
            }`}
          >
            © {new Date().getFullYear()} {PLATFORM_NAME}
          </p>
        </section>

        {/* Sign-in panel */}
        <section className="flex items-center justify-center px-6 py-10 sm:px-10 lg:px-8 lg:py-10">
          <div
            className={`platform-login-panel w-full max-w-[400px] rounded-2xl p-7 sm:p-8 transition duration-1000 delay-100 ease-out ${
              ready ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
            }`}
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div
              className="mb-1 h-0.5 w-10 rounded-full"
              style={{ background: `linear-gradient(90deg, ${MEISTER_COLORS.blue}, ${MEISTER_COLORS.orange})` }}
            />
            <h2 className="mt-4 font-[family-name:var(--font-meister-display)] text-[1.65rem] font-semibold tracking-[-0.02em] text-white">
              Sign in
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/40">
              Platform operators only. Client staff use /login/&#123;slug&#125;.
            </p>

            <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-4">
              <div>
                <label htmlFor="platform-email" className="mb-1.5 block text-[12px] font-medium text-white/50">
                  Email
                </label>
                <input
                  id="platform-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 w-full rounded-lg border border-white/10 bg-black/40 px-3.5 text-[14px] text-white outline-none transition placeholder:text-white/25 focus:border-[#1B6BFF]/70 focus:ring-2 focus:ring-[#1B6BFF]/20"
                />
              </div>
              <div>
                <label htmlFor="platform-password" className="mb-1.5 block text-[12px] font-medium text-white/50">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="platform-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-11 w-full rounded-lg border border-white/10 bg-black/40 px-3.5 pr-11 text-[14px] text-white outline-none transition placeholder:text-white/25 focus:border-[#1B6BFF]/70 focus:ring-2 focus:ring-[#1B6BFF]/20"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-white/35 transition hover:text-white/80"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <IconEye off={showPassword} />
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-semibold text-white transition enabled:hover:brightness-110 disabled:opacity-55"
                style={{
                  background: `linear-gradient(135deg, ${MEISTER_COLORS.blue} 0%, #1557D6 100%)`,
                  boxShadow: '0 14px 36px rgba(27, 107, 255, 0.35)',
                }}
              >
                {loading ? 'Signing in…' : 'Open console'}
                {!loading ? (
                  <span className="transition group-hover:translate-x-0.5">
                    <IconArrow />
                  </span>
                ) : null}
              </button>
            </form>

            <p className="mt-7 text-center font-mono text-[11px] text-white/25">/login/admin</p>
          </div>
        </section>
      </div>
    </div>
  )
}
