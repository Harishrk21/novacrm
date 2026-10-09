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
  howItWorksOpen: boolean
  setHowItWorksOpen: (v: boolean) => void
  openHowItWorks: () => void
  currentUserId: string
  themeMode: ThemeMode
  palette: ColorPalette
  setThemeMode: (mode: ThemeMode) => void
  setPalette: (palette: ColorPalette) => void
  toggleThemeMode: () => void
  teamChatOpen: boolean
  teamChatTab: 'pins' | 'chats' | 'channels' | 'threads' | 'people'
  teamChatListTab: 'all' | 'people' | 'channels' | 'messages'
  teamChatChannelId: string | null
  teamChatUnread: number
  teamChatMinimized: boolean
  openTeamChat: (tab?: UIState['teamChatTab'], channelId?: string | null) => void
  closeTeamChat: () => void
  closeChatWindow: () => void
  setTeamChatTab: (tab: UIState['teamChatTab']) => void
  setTeamChatListTab: (tab: UIState['teamChatListTab']) => void
  setTeamChatChannelId: (id: string | null) => void
  setTeamChatUnread: (n: number) => void
  setTeamChatMinimized: (v: boolean) => void
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
      howItWorksOpen: false,
      setHowItWorksOpen: (v) => set({ howItWorksOpen: v }),
      openHowItWorks: () => set({ howItWorksOpen: true }),
      currentUserId: 'user-1',
      themeMode: 'dark',
      palette: 'violet',
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
      teamChatOpen: false,
      teamChatTab: 'chats',
      teamChatListTab: 'all',
      teamChatChannelId: null,
      teamChatUnread: 0,
      teamChatMinimized: false,
      openTeamChat: (tab = 'chats', channelId?: string | null) =>
        set({
          teamChatOpen: true,
          teamChatTab: tab,
          // Only change active channel when caller passes an explicit id/null
          teamChatChannelId: channelId === undefined ? get().teamChatChannelId : channelId,
          teamChatMinimized: false,
          teamChatListTab:
            tab === 'channels'
              ? 'channels'
              : tab === 'people'
                ? 'people'
                : tab === 'chats'
                  ? 'all'
                  : tab === 'threads'
                    ? 'messages'
                    : 'all',
        }),
      closeTeamChat: () => set({ teamChatOpen: false, teamChatMinimized: false }),
      closeChatWindow: () => set({ teamChatChannelId: null, teamChatMinimized: false }),
      setTeamChatTab: (tab) =>
        set({
          teamChatTab: tab,
          teamChatOpen: true,
          teamChatMinimized: false,
          teamChatListTab:
            tab === 'channels'
              ? 'channels'
              : tab === 'people'
                ? 'people'
                : tab === 'chats'
                  ? 'all'
                  : tab === 'threads'
                    ? 'messages'
                    : 'all',
        }),
      setTeamChatListTab: (tab) => set({ teamChatListTab: tab, teamChatOpen: true }),
      setTeamChatChannelId: (id) =>
        set({ teamChatChannelId: id, teamChatOpen: true, teamChatMinimized: false }),
      setTeamChatUnread: (n) => set({ teamChatUnread: n }),
      setTeamChatMinimized: (v) => set({ teamChatMinimized: v }),
    }),
    {
      name: 'novacrm-ui',
      version: 2,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<{
          themeMode: ThemeMode
          palette: ColorPalette
          sidebarCollapsed: boolean
          currentUserId: string
        }>
        return {
          themeMode: version < 2 ? ('dark' as ThemeMode) : (s.themeMode ?? 'dark'),
          palette: version < 2 ? ('violet' as ColorPalette) : (s.palette ?? 'violet'),
          sidebarCollapsed: s.sidebarCollapsed ?? false,
          currentUserId: s.currentUserId ?? 'user-1',
        }
      },
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
