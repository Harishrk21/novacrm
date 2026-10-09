import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, ApiClientError, getAuth, setAuth } from '@/lib/api'
import {
  resolveInventoryAreas,
  type InventoryAreas,
} from '@/lib/inventoryAreas'
import type { AllowedModules } from '@/lib/userModules'

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
  inventoryAreas?: InventoryAreas
  /** Platform-enabled modules this employee may see (admin-assigned). */
  allowedModules?: AllowedModules
  branding?: {
    palette?: string
    locked?: boolean
    accent?: string
    accentHover?: string
    sidebarBg?: string
  } | null
}

function tenantUserFromMe(payload: {
  id: string
  name: string
  email: string
  phone?: string | null
  avatarUrl?: string | null
  inventoryAreas?: InventoryAreas
  allowedModules?: AllowedModules
  tenant?: {
    id: string
    slug: string
    name: string
    branding?: AuthUser['branding']
  }
  role?: { code?: string; name?: string }
}): AuthUser {
  return {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    avatarUrl: payload.avatarUrl,
    role: payload.role?.code,
    tenantId: payload.tenant?.id,
    tenantSlug: payload.tenant?.slug,
    tenantName: payload.tenant?.name,
    branding: payload.tenant?.branding ?? null,
    inventoryAreas: resolveInventoryAreas(payload.inventoryAreas, payload.role?.code),
    allowedModules: payload.allowedModules,
  }
}

interface AuthState {
  kind: AuthKind
  user: AuthUser | null
  bootstrapped: boolean
  setSession: (
    kind: AuthKind,
    user: AuthUser | null,
    tokens?: { accessToken: string; refreshToken: string },
  ) => void
  patchUser: (partial: Partial<AuthUser>) => void
  platformLogin: (email: string, password: string) => Promise<void>
  tenantLogin: (email: string, password: string, tenantSlug?: string) => Promise<void>
  logout: () => Promise<void>
  hydrateFromStorage: () => Promise<void>
  /** Re-fetch /auth/me so inventoryAreas stay in sync after admin changes. */
  refreshSession: () => Promise<void>
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
        set({ kind, user, bootstrapped: Boolean(kind && user) })
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
          {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: data.user.role,
          },
          { accessToken: data.accessToken, refreshToken: data.refreshToken },
        )
      },

      tenantLogin: async (email, password, tenantSlug) => {
        const data = await api.tenantLogin({
          email,
          password,
          ...(tenantSlug ? { tenantSlug } : {}),
        })
        try {
          localStorage.removeItem('novacrm-data')
        } catch {
          /* ignore */
        }
        const loginUser = data.user as {
          id: string
          name: string
          email: string
          phone?: string | null
          avatarUrl?: string | null
          role?: string
          tenantId?: string
          tenantSlug?: string
          tenantName?: string
          branding?: AuthUser['branding']
          inventoryAreas?: InventoryAreas
          allowedModules?: AllowedModules
        }
        get().setSession(
          'tenant',
          {
            id: loginUser.id,
            name: loginUser.name,
            email: loginUser.email,
            phone: loginUser.phone ?? null,
            avatarUrl: loginUser.avatarUrl ?? null,
            role: loginUser.role,
            tenantId: loginUser.tenantId,
            tenantSlug: loginUser.tenantSlug ?? tenantSlug,
            tenantName: loginUser.tenantName,
            branding: loginUser.branding ?? null,
            inventoryAreas: resolveInventoryAreas(
              loginUser.inventoryAreas,
              loginUser.role,
            ),
            allowedModules: loginUser.allowedModules,
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
          /* ignore */
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

      refreshSession: async () => {
        const auth = getAuth()
        if (!auth?.accessToken || auth.kind !== 'tenant') return
        try {
          const me = await api.meWithRetry()
          const next = tenantUserFromMe(me as Parameters<typeof tenantUserFromMe>[0])
          const prev = get().user
          const same =
            prev &&
            prev.id === next.id &&
            prev.role === next.role &&
            prev.name === next.name &&
            prev.avatarUrl === next.avatarUrl &&
            prev.phone === next.phone &&
            JSON.stringify(prev.inventoryAreas) === JSON.stringify(next.inventoryAreas) &&
            JSON.stringify(prev.allowedModules) === JSON.stringify(next.allowedModules)
          if (!same) {
            set({ kind: 'tenant', user: next, bootstrapped: true })
          } else if (!get().bootstrapped) {
            set({ bootstrapped: true })
          }
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 401) {
            setAuth(null)
            set({ kind: null, user: null, bootstrapped: true })
          }
        }
      },

      hydrateFromStorage: async () => {
        const auth = getAuth()
        if (!auth?.accessToken) {
          set({ bootstrapped: true, kind: null, user: null })
          return
        }
        if (auth.kind === 'platform') {
          const existing = get()
          if (existing.bootstrapped && existing.user && existing.kind === 'platform') {
            return
          }
          try {
            const me = await api.meWithRetry()
            const admin = me as { id: string; name: string; email: string; role?: string }
            set({
              kind: 'platform',
              user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
              bootstrapped: true,
            })
          } catch (err) {
            if (err instanceof ApiClientError && err.status === 401) {
              setAuth(null)
              set({ kind: null, user: null, bootstrapped: true })
            } else {
              set({ bootstrapped: true })
            }
          }
          return
        }

        const existing = get()
        if (existing.bootstrapped && existing.user && existing.kind === 'tenant') {
          void get().refreshSession()
          return
        }
        try {
          const me = await api.meWithRetry()
          set({
            kind: 'tenant',
            user: tenantUserFromMe(me as Parameters<typeof tenantUserFromMe>[0]),
            bootstrapped: true,
          })
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 401) {
            setAuth(null)
            set({ kind: null, user: null, bootstrapped: true })
          } else if (existing.user && existing.kind === 'tenant') {
            set({ bootstrapped: true })
          } else {
            set({ kind: null, user: null, bootstrapped: true })
          }
        }
      },
    }),
    {
      name: 'novacrm-auth-user',
      partialize: (s) => ({ kind: s.kind, user: s.user }),
    },
  ),
)
