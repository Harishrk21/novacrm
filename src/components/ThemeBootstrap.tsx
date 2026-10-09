import { useEffect, useRef } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { applyTheme, type ColorPalette } from '@/lib/theme'

const PALETTE_KEYS = new Set(['ocean', 'emerald', 'violet', 'amber', 'rose', 'slate'])

function asPalette(v: unknown): ColorPalette | null {
  return typeof v === 'string' && PALETTE_KEYS.has(v) ? (v as ColorPalette) : null
}

/** Applies theme; platform branding palette is the source of truth when locked. */
export function ThemeBootstrap({ children }: { children: React.ReactNode }) {
  const themeMode = useUIStore((s) => s.themeMode)
  const palette = useUIStore((s) => s.palette)
  const setPalette = useUIStore((s) => s.setPalette)
  const branding = useAuthStore((s) => s.user?.branding)
  const kind = useAuthStore((s) => s.kind)
  const appliedDefault = useRef<string | null>(null)

  useEffect(() => {
    if (kind !== 'tenant' || !branding) {
      applyTheme(themeMode, palette)
      return
    }
    const brandPalette = asPalette(branding.palette)
    const overrides = {
      accent: branding.accent,
      accentHover: branding.accentHover,
      sidebarBg: branding.sidebarBg,
    }

    if (branding.locked && brandPalette) {
      if (brandPalette !== palette) {
        setPalette(brandPalette)
        return
      }
      applyTheme(themeMode, brandPalette, overrides)
      return
    }

    // Unlocked: seed palette once from platform, then let the user change it
    const seedKey = `${branding.palette ?? ''}`
    if (brandPalette && appliedDefault.current !== seedKey) {
      appliedDefault.current = seedKey
      if (brandPalette !== palette) {
        setPalette(brandPalette)
        return
      }
    }
    applyTheme(themeMode, palette, overrides)
  }, [themeMode, palette, branding, kind, setPalette])

  return children
}
