import { create } from 'zustand'
import { api, isApiOnline } from '@/lib/api'
import { DEFAULT_TIPS } from '@/components/tips/FeatureTip'

type TipType = 'TIP' | 'NOTE' | 'WARNING' | 'BEST_PRACTICE'

interface Tip {
  title: string
  body: string
  tipType: TipType
}

interface TipsState {
  cache: Record<string, Tip>
  load: (moduleKey: string) => Promise<Tip>
  get: (moduleKey: string) => Tip
}

export const useTipsStore = create<TipsState>((set, get) => ({
  cache: { ...DEFAULT_TIPS },

  get: (moduleKey) => get().cache[moduleKey] ?? DEFAULT_TIPS[moduleKey] ?? DEFAULT_TIPS['crm.dashboard'],

  load: async (moduleKey) => {
    const fallback = DEFAULT_TIPS[moduleKey] ?? {
      title: 'Tip',
      body: 'Use this section to manage your business data.',
      tipType: 'TIP' as const,
    }
    try {
      const online = await isApiOnline()
      if (!online) {
        set((s) => ({ cache: { ...s.cache, [moduleKey]: fallback } }))
        return fallback
      }
      const rows = await api.tips(moduleKey)
      const first = rows[0]
      if (!first) return fallback
      const tip: Tip = {
        title: first.title,
        body: first.body,
        tipType: ((first.tipType || first.type || 'TIP') as TipType),
      }
      set((s) => ({ cache: { ...s.cache, [moduleKey]: tip } }))
      return tip
    } catch {
      return fallback
    }
  },
}))
