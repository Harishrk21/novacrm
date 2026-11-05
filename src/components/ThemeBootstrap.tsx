import { useEffect, useRef } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { MEISTER_COLORS } from '@/lib/branding'
import { applyTheme, type ColorPalette } from '@/lib/theme'

const PALETTE_KEYS = new Set(['ocean', 'emerald', 'violet', 'amber', 'rose', 'slate'])

function asPalette(v: unknown): ColorPalette | null {
  return typeof v === 'string' && PALETTE_KEYS.has(v) ? (v as ColorPalette) : null
}

/** Meister chrome for platform console — never inherits tenant dashboard kits. */
function applyPlatformTheme(mode: 'light' | 'dark') {
  applyTheme(mode, 'ocean', {
    accent: MEISTER_COLORS.blue,
    accentHover: MEISTER_COLORS.blueHover,
    sidebarBg: MEISTER_COLORS.navy,
  })
}

/**
 * Applies theme for the active session.
 * Platform admin always uses Meister colors. Tenant branding is applied to :root
 * without writing into the shared `novacrm-ui` palette (which platform also reads).
 */
export function ThemeBootstrap({ children }: { children: React.ReactNode }) {
  const themeMode = useUIStore((s) => s.themeMode)
  const palette = useUIStore((s) => s.palette)
  const setPalette = useUIStore((s) => s.setPalette)
  const branding = useAuthStore((s) => s.user?.branding)
  const kind = useAuthStore((s) => s.kind)
  const appliedDefault = useRef<string | null>(null)

  useEffect(() => {
    if (kind === 'platform') {
      applyPlatformTheme(themeMode)
      return
    }

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
      // Locked kit applies to :root only — never persist into shared novacrm-ui
      // (platform admin also reads that store).
      applyTheme(themeMode, brandPalette, overrides)
      return
    }

    // Unlocked: seed user preference once from platform branding, then let them change it
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
