import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Toast } from '@/types'
import { applyTheme, type ColorPalette, type ThemeMode } from '@/lib/theme'

interface UIState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  globalSearchOpen: boolean
  setGlobalSearchOpen: (v: boolean) => void
  currentUserId: string
  themeMode: ThemeMode
  palette: ColorPalette
  setThemeMode: (mode: ThemeMode) => void
  setPalette: (palette: ColorPalette) => void
  toggleThemeMode: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toasts: [],
      addToast: (toast) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
        setTimeout(() => {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        }, 4000)
      },
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      globalSearchOpen: false,
      setGlobalSearchOpen: (v) => set({ globalSearchOpen: v }),
      currentUserId: 'user-1',
      themeMode: 'light',
      palette: 'ocean',
      setThemeMode: (mode) => {
        set({ themeMode: mode })
        applyTheme(mode, get().palette)
      },
      setPalette: (palette) => {
        set({ palette })
        applyTheme(get().themeMode, palette)
      },
      toggleThemeMode: () => {
        const next = get().themeMode === 'light' ? 'dark' : 'light'
        set({ themeMode: next })
        applyTheme(next, get().palette)
      },
    }),
    {
      name: 'novacrm-ui',
      partialize: (s) => ({
        themeMode: s.themeMode,
        palette: s.palette,
        sidebarCollapsed: s.sidebarCollapsed,
        currentUserId: s.currentUserId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.themeMode, state.palette)
      },
    },
  ),
)
