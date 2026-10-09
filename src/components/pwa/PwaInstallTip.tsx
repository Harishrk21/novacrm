import { useEffect, useState } from 'react'
import { Download, Share, Smartphone, X } from 'lucide-react'
import { isStandalonePwa, useFieldShell } from '@/hooks/useFieldShell'
import { isServiceEngineer } from '@/lib/roles'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'

const DISMISS_KEY = 'nova.pwaInstall.dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectClient() {
  const ua = navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/i.test(ua)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Edg\//.test(ua)
  const isChrome = /Chrome|CriOS|Chromium|Edg\//.test(ua) && !/OPR|Opera/.test(ua)
  return { isIos, isAndroid, isSafari, isChrome }
}

/**
 * Shown to service engineers on Home — how to install the Field app.
 * Does not require the phone shell or a live beforeinstallprompt event
 * (those often missing on desktop / Vite dev).
 */
export function PwaInstallTip() {
  const role = useAuthStore((s) => s.user?.role)
  const fieldShell = useFieldShell()
  const engineer = isServiceEngineer(role)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(isStandalonePwa)
  const [client, setClient] = useState(() =>
    typeof window === 'undefined'
      ? { isIos: false, isAndroid: false, isSafari: false, isChrome: false }
      : detectClient(),
  )

  useEffect(() => {
    setStandalone(isStandalonePwa())
    setClient(detectClient())

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    const onInstalled = () => {
      setStandalone(true)
      setDeferred(null)
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!engineer || standalone || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }

  const onPhone = fieldShell || client.isIos || client.isAndroid
  let body: string
  let steps: string

  if (deferred) {
    body = 'Add to your home screen for one-tap access when tickets are assigned.'
    steps = ''
  } else if (client.isIos) {
    body = 'Install from Safari so it opens like an app when you’re on site.'
    steps = 'Tap Share → Add to Home Screen → Add'
  } else if (client.isAndroid || (onPhone && client.isChrome)) {
    body = 'Install from Chrome for a home-screen icon (no Play Store needed).'
    steps = 'Chrome menu (⋮) → Install app / Add to Home screen'
  } else {
    body =
      'Field layout + Install appear on your phone. Open this same login URL in Chrome or Safari on the phone.'
    steps = 'Phone → sign in as engineer → Home → Install / Add to Home Screen'
  }

  return (
    <div className="mb-3 rounded-xl border border-[color:var(--color-accent-blue)]/35 bg-[color:var(--color-accent-blue)]/10 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-accent-blue)] text-white">
          {onPhone ? <Download size={20} /> : <Smartphone size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">
            {onPhone ? 'Install Field app' : 'Use Field app on your phone'}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{body}</p>
          {steps ? (
            <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-text-primary">
              {client.isIos ? <Share size={14} className="mt-0.5 shrink-0" /> : null}
              {steps}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {deferred ? (
              <Button size="sm" onClick={() => void install()}>
                <Download size={14} /> Install
              </Button>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              className="text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-text-secondary hover:bg-muted"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
