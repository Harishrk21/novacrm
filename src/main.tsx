import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ThemeBootstrap } from '@/components/ThemeBootstrap'
import { applyTheme } from '@/lib/theme'

try {
  const raw = localStorage.getItem('novacrm-ui')
  if (raw) {
    const parsed = JSON.parse(raw) as { state?: { themeMode?: 'light' | 'dark'; palette?: string } }
    const mode = parsed.state?.themeMode ?? 'light'
    const palette = (parsed.state?.palette ?? 'ocean') as
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
