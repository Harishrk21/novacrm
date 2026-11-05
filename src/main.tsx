import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'react-loading-skeleton/dist/skeleton.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ThemeBootstrap } from '@/components/ThemeBootstrap'
import { MEISTER_COLORS } from '@/lib/branding'
import { applyTheme } from '@/lib/theme'

try {
  const authRaw = localStorage.getItem('novacrm-auth')
  const auth = authRaw ? (JSON.parse(authRaw) as { kind?: string }) : null
  const uiRaw = localStorage.getItem('novacrm-ui')
  const ui = uiRaw
    ? (JSON.parse(uiRaw) as { state?: { themeMode?: 'light' | 'dark'; palette?: string } })
    : null
  const mode = ui?.state?.themeMode ?? 'light'
  // Platform session must boot with Meister chrome, not a tenant kit left in novacrm-ui
  if (auth?.kind === 'platform') {
    applyTheme(mode, 'ocean', {
      accent: MEISTER_COLORS.blue,
      accentHover: MEISTER_COLORS.blueHover,
      sidebarBg: MEISTER_COLORS.navy,
    })
  } else if (ui?.state?.palette) {
    const palette = ui.state.palette as
      | 'ocean'
      | 'emerald'
      | 'violet'
      | 'amber'
      | 'rose'
      | 'slate'
    applyTheme(mode, palette)
  } else {
    applyTheme('light', 'ocean')
  }
} catch {
  applyTheme('light', 'ocean')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeBootstrap>
        <App />
      </ThemeBootstrap>
    </ErrorBoundary>
  </StrictMode>,
)
