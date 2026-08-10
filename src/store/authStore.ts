import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, getAuth, setAuth } from '@/lib/api'

type AuthKind = 'platform' | 'tenant' | null

interface AuthUser {
  id: string
  name: string
  email: string
  role?: string
  phone?: string | null
  avatarUrl?: string | null
  tenantId?: string
  tenantSlug?: string
  tenantName?: string
}

interface AuthState {
  kind: AuthKind
  user: AuthUser | null
  bootstrapped: boolean
  setSession: (kind: AuthKind, user: AuthUser | null, tokens?: { accessToken: string; refreshToken: string }) => void
  patchUser: (partial: Partial<AuthUser>) => void
  platformLogin: (email: string, password: string) => Promise<void>
  tenantLogin: (email: string, password: string, tenantSlug?: string) => Promise<void>
  logout: () => Promise<void>
  hydrateFromStorage: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      kind: null,
      user: null,
      bootstrapped: false,

      setSession: (kind, user, tokens) => {
        if (tokens && kind) {
          setAuth({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, kind })
        }
        set({ kind, user })
      },

      patchUser: (partial) => {
        const current = get().user
        if (!current) return
        set({ user: { ...current, ...partial } })
      },

      platformLogin: async (email, password) => {
        const data = await api.platformLogin(email, password)
        get().setSession(
          'platform',
          { id: data.user.id, name: data.user.name, email: data.user.email },
          { accessToken: data.accessToken, refreshToken: data.refreshToken },
        )
      },

      tenantLogin: async (email, password, tenantSlug) => {
        const data = await api.tenantLogin({
          email,
          password,
          ...(tenantSlug ? { tenantSlug } : {}),
        })
        // Drop local mock CRM cache so UI always uses Supabase for tenant sessions
        try {
          localStorage.removeItem('novacrm-data')
        } catch {
          /* ignore */
        }
        get().setSession(
          'tenant',
          {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: data.user.role,
            tenantId: data.user.tenantId,
            tenantSlug: data.user.tenantSlug ?? tenantSlug,
          },
          { accessToken: data.accessToken, refreshToken: data.refreshToken },
        )
      },

      logout: async () => {
        const auth = getAuth()
        try {
          if (auth?.refreshToken) {
            await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/auth/logout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: auth.refreshToken }),
            })
          }
        } catch {
          /* ignore network errors on logout */
        }
        setAuth(null)
        try {
          localStorage.removeItem('novacrm-auth')
          localStorage.removeItem('novacrm-auth-user')
          localStorage.removeItem('novacrm-data')
        } catch {
          /* ignore */
        }
        set({ kind: null, user: null, bootstrapped: true })
      },

      hydrateFromStorage: async () => {
        const auth = getAuth()
        if (!auth?.accessToken) {
          set({ bootstrapped: true, kind: null, user: null })
          return
        }
        try {
          const me = await api.meWithRetry()
          if (auth.kind === 'platform') {
            const admin = me as { id: string; name: string; email: string }
            set({
              kind: 'platform',
              user: { id: admin.id, name: admin.name, email: admin.email },
              bootstrapped: true,
            })
          } else {
            const payload = me as {
              id: string
              name: string
              email: string
              phone?: string | null
              avatarUrl?: string | null
              tenant?: { id: string; slug: string; name: string }
              role?: { code?: string; name?: string }
            }
            set({
              kind: 'tenant',
              user: {
                id: payload.id,
                name: payload.name,
                email: payload.email,
                phone: payload.phone,
                avatarUrl: payload.avatarUrl,
                role: payload.role?.code,
                tenantId: payload.tenant?.id,
                tenantSlug: payload.tenant?.slug,
                tenantName: payload.tenant?.name,
              },
              bootstrapped: true,
            })
          }
        } catch {
          setAuth(null)
          set({ kind: null, user: null, bootstrapped: true })
        }
      },
    }),
    {
      name: 'novacrm-auth-user',
      partialize: (s) => ({ kind: s.kind, user: s.user }),
    },
  ),
)
