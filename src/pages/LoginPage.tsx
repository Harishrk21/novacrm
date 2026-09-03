import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Shield, Wrench, Users } from 'lucide-react'
import { HmsLogo } from '@/components/HmsLogo'
import { APP_NAME, APP_TAGLINE, HMS_COLORS } from '@/lib/branding'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { ApiClientError } from '@/lib/api'

const DEMO = {
  platform: {
    title: 'Platform Super Admin',
    fill: { email: 'admin@novacrm.com', password: 'Admin@Nova2026' },
    lines: ['admin@novacrm.com', 'Admin@Nova2026'],
  },
  client: {
    title: 'Company admin',
    fill: { email: 'demo@precisionscales.in', password: 'Demo@12345' },
    lines: ['demo@precisionscales.in', 'Demo@12345'],
  },
  employee: {
    title: 'Service engineer',
    fill: { email: 'karthik@precisionscales.in', password: 'Demo@12345' },
    lines: ['karthik@precisionscales.in', 'Demo@12345'],
  },
}

function isPlatformEmail(email: string) {
  return email.trim().toLowerCase() === 'admin@novacrm.com'
}

const FEATURES = [
  { icon: Users, label: 'Customers & AMC register' },
  { icon: Wrench, label: 'Service jobs & spare parts' },
  { icon: Shield, label: 'Govt stamping & renewals' },
] as const

export function LoginPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const tenantLogin = useAuthStore((s) => s.tenantLogin)
  const platformLogin = useAuthStore((s) => s.platformLogin)
  const [email, setEmail] = useState('demo@precisionscales.in')
  const [password, setPassword] = useState('Demo@12345')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.title = `${APP_NAME} — Sign in`
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isPlatformEmail(email)) {
        await platformLogin(email.trim(), password)
        localStorage.setItem(
          'novacrm-platform-admin',
          JSON.stringify({ email: email.trim(), name: 'Platform Admin', live: true }),
        )
        addToast({ type: 'success', message: 'Signed in as Platform Admin' })
        navigate('/admin')
      } else {
        await tenantLogin(email.trim(), password)
        if (remember) {
          localStorage.setItem('novacrm-last-email', email.trim().toLowerCase())
        }
        const role = useAuthStore.getState().user?.role
        if (role && role !== 'ADMIN') {
          addToast({
            type: 'success',
            message: 'Signed in — open My Tasks for your assignments',
          })
        } else {
          addToast({ type: 'success', message: `Signed in to ${APP_NAME}` })
        }
        navigate('/')
      }
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
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 font-sans"
      style={{ backgroundColor: HMS_COLORS.black }}
    >
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-32 top-0 h-[420px] w-[420px] rounded-full opacity-30 blur-3xl"
          style={{ background: `radial-gradient(circle, ${HMS_COLORS.redBright} 0%, transparent 70%)` }}
        />
        <div
          className="absolute -right-24 bottom-0 h-[360px] w-[360px] rounded-full opacity-20 blur-3xl"
          style={{ background: `radial-gradient(circle, ${HMS_COLORS.redDark} 0%, transparent 70%)` }}
        />
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{
            background: `linear-gradient(90deg, ${HMS_COLORS.redBright}, ${HMS_COLORS.redMid}, ${HMS_COLORS.redDark})`,
          }}
        />
      </div>

      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#111111] shadow-2xl lg:grid-cols-[1fr_1.05fr]">
        {/* Brand panel */}
        <div
          className="relative hidden flex-col justify-between p-10 lg:flex"
          style={{
            background: `linear-gradient(145deg, ${HMS_COLORS.charcoal} 0%, ${HMS_COLORS.black} 55%, ${HMS_COLORS.redDark}22 100%)`,
          }}
        >
          <div>
            <HmsLogo size="hero" />
            <p className="mt-6 text-lg font-semibold tracking-wide text-white">{APP_NAME}</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-400">{APP_TAGLINE}</p>
          </div>

          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-neutral-300">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${HMS_COLORS.redBright}22`, color: HMS_COLORS.redBright }}
                >
                  <Icon size={16} />
                </span>
                {label}
              </li>
            ))}
          </ul>

          <p className="text-xs text-neutral-500">
            Saidapet, Chennai · Govt. stamping & service since 1997
          </p>
        </div>

        {/* Sign-in panel */}
        <div className="flex flex-col justify-center border-t border-white/5 bg-[#161616] p-8 sm:p-10 lg:border-l lg:border-t-0">
          <div className="mb-8 lg:hidden">
            <HmsLogo size="lg" />
          </div>

          <div className="mb-6">
            <h1 className="text-xl font-semibold text-white">Sign in</h1>
            <p className="mt-1 text-sm text-neutral-400">Access your workspace — sales, service & stamping</p>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-300">Email</label>
              <input
                className="h-11 w-full rounded-lg border border-white/10 bg-[#0f0f0f] px-3 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#E31E24] focus:ring-2 focus:ring-[#E31E24]/30"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="username"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-neutral-300">Password</label>
              </div>
              <div className="relative">
                <input
                  className="h-11 w-full rounded-lg border border-white/10 bg-[#0f0f0f] px-3 pr-10 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#E31E24] focus:ring-2 focus:ring-[#E31E24]/30"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label="Toggle password"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-400">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 accent-[#E31E24]"
              />
              Remember me
            </label>

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-lg text-sm font-semibold text-white shadow-lg transition hover:brightness-110 disabled:opacity-60"
              style={{
                background: `linear-gradient(135deg, ${HMS_COLORS.redBright}, ${HMS_COLORS.redMid})`,
                boxShadow: `0 8px 24px ${HMS_COLORS.redBright}40`,
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-8 space-y-2">
            <p className="text-center text-[11px] font-medium uppercase tracking-wider text-neutral-600">
              Demo access
            </p>
            {([DEMO.client, DEMO.employee, DEMO.platform] as const).map((block) => (
              <button
                key={block.title}
                type="button"
                onClick={() => {
                  setEmail(block.fill.email)
                  setPassword(block.fill.password)
                }}
                className="w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-[#E31E24]/40 hover:bg-white/[0.06]"
              >
                <div className="text-sm font-medium text-neutral-200">{block.title}</div>
                <div className="mt-0.5 font-mono text-[11px] text-neutral-500">{block.lines.join(' · ')}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
