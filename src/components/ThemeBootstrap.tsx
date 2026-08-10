import { useEffect } from 'react'
import { useUIStore } from '@/store/uiStore'
import { applyTheme } from '@/lib/theme'

/** Applies persisted theme before paint of child routes. */
export function ThemeBootstrap({ children }: { children: React.ReactNode }) {
  const themeMode = useUIStore((s) => s.themeMode)
  const palette = useUIStore((s) => s.palette)

  useEffect(() => {
    applyTheme(themeMode, palette)
  }, [themeMode, palette])

  return children
}
