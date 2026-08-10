import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
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
    title: 'Client admin (company dashboard)',
    fill: { email: 'demo@precisionscales.in', password: 'Demo@12345' },
    lines: ['demo@precisionscales.in', 'Demo@12345'],
  },
  employee: {
    title: 'Employee / agent (My Work)',
    fill: { email: 'karthik@precisionscales.in', password: 'Demo@12345' },
    lines: ['karthik@precisionscales.in', 'Demo@12345'],
  },
}

function isPlatformEmail(email: string) {
  return email.trim().toLowerCase() === 'admin@novacrm.com'
}

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (isPlatformEmail(email)) {
        await platformLogin(email.trim(), password)
        localStorage.setItem(
          'novacrm-platform-admin',
          JSON.stringify({ email: email.trim(), name: 'Nova Super Admin', live: true }),
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
            message: 'Signed in to Employee desk — open My Tasks for your assignments',
          })
        } else {
          addToast({ type: 'success', message: 'Signed in to company workspace' })
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#1a1750] px-4 py-10 font-sans">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-[#3b2f9b]/50 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-96 w-96 rounded-full bg-[#2563eb]/30 blur-3xl" />
        <svg className="absolute inset-0 h-full w-full opacity-40" viewBox="0 0 1440 800" preserveAspectRatio="none">
          <path fill="#2a2480" d="M0,160 C320,320 480,0 720,160 C960,320 1120,80 1440,200 L1440,800 L0,800 Z" />
          <path fill="#1e1a66" d="M0,320 C360,480 600,200 900,340 C1140,460 1280,280 1440,400 L1440,800 L0,800 Z" />
        </svg>
      </div>

      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/20 bg-white/10 shadow-2xl backdrop-blur-xl lg:grid-cols-2">
        <div className="relative hidden min-h-[480px] items-center justify-center p-10 lg:flex">
          <div className="absolute inset-8 rounded-[24px] bg-gradient-to-br from-white/10 to-transparent" />
          <div className="relative flex flex-col items-center">
            <div className="rounded-2xl bg-white px-6 py-5 shadow-xl">
              <BrandLogo size="hero" />
            </div>
            <p className="mt-6 max-w-xs text-center text-sm text-sky-100/90">
              Multi-tenant CRM + ERP for your Tamil Nadu customers — leads, deals, inventory and invoices in one place.
            </p>
          </div>
        </div>

        <div className="relative flex flex-col justify-center p-8 sm:p-10">
          <div className="mb-8">
            <div className="inline-flex rounded-xl bg-white px-4 py-3 shadow-lg">
              <BrandLogo size="lg" />
            </div>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="mb-1.5 block text-sm text-white/90">Email</label>
              <input
                className="h-11 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 outline-none ring-2 ring-transparent focus:ring-sky-400"
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
                <label className="text-sm text-white/90">Password</label>
                <span className="text-xs text-sky-300">Demo passwords below</span>
              </div>
              <div className="relative">
                <input
                  className="h-11 w-full rounded-lg border-0 bg-white px-3 pr-10 text-sm text-slate-900 outline-none ring-2 ring-transparent focus:ring-sky-400"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label="Toggle password"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-white/90">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-white/40"
              />
              Remember Me
            </label>

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-lg bg-[#3b82f6] text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-500 disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            <p className="text-center text-xs uppercase tracking-wider text-white/50">Demo credentials</p>
            {[DEMO.platform, DEMO.client, DEMO.employee].map((block) => (
              <button
                key={block.title}
                type="button"
                onClick={() => {
                  setEmail(block.fill.email)
                  setPassword(block.fill.password)
                }}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-left transition hover:bg-white/10"
              >
                <div className="text-sm font-medium text-sky-200">{block.title}</div>
                <div className="mt-1 font-mono text-[11px] text-white/70">
                  {block.lines.join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
