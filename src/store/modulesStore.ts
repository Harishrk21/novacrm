import { create } from 'zustand'
import { api, isTenantSession } from '@/lib/api'
import type { TenantModuleRow } from '@/lib/modules'
import { isModuleEnabled } from '@/lib/modules'
import { isUserModuleOn } from '@/lib/userModules'
import { useAuthStore } from '@/store/authStore'

interface ModulesState {
  modules: TenantModuleRow[]
  loaded: boolean
  load: () => Promise<void>
  /** Tenant pack AND (for non-admin) employee allowedModules. */
  enabled: (key: string, fallback?: boolean) => boolean
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  modules: [],
  loaded: false,
  load: async () => {
    if (!isTenantSession()) {
      set({ modules: [], loaded: true })
      return
    }
    try {
      const rows = await api.tenantModules()
      set({
        modules: (rows ?? []).map((r) => ({
          moduleKey: r.moduleKey,
          isEnabled: r.isEnabled,
          label: r.label,
          moduleGroup: r.moduleGroup,
        })),
        loaded: true,
      })
    } catch {
      set({ modules: [], loaded: true })
    }
  },
  enabled: (key, fallback = true) => {
    if (!isModuleEnabled(get().modules, key, fallback)) return false
    const user = useAuthStore.getState().user
    return isUserModuleOn(user?.allowedModules, key, user?.role)
  },
}))
