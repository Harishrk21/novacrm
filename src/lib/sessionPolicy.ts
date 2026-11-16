/**
 * Client-side session rules (HMS go-live):
 * - Sign out after IDLE_TIMEOUT_MS with no activity in ANY open tab (shared via localStorage).
 * - Warn WARNING_MS before that.
 * - Closing the browser ends the session: tokens live in localStorage (shared by tabs),
 *   but a browser-session cookie must also exist — browsers drop it when they close.
 * - The 12h hard cap is enforced by the API (SESSION_MAX_AGE): refresh fails after it.
 */

const idleMinutes = Number(import.meta.env.VITE_IDLE_TIMEOUT_MIN ?? 30)
export const IDLE_TIMEOUT_MS = (Number.isFinite(idleMinutes) && idleMinutes > 0 ? idleMinutes : 30) * 60_000
export const WARNING_MS = 60_000

const ACTIVITY_KEY = 'novacrm-last-activity'
const SESSION_COOKIE = 'novacrm-session'
const SIGNOUT_REASON_KEY = 'novacrm-signout-reason'
/** URL param Attendance adds on 'Back to dashboard' (signed, 60 s). */
const RETURN_PASS_PARAM = 'att_return'
const RETURN_PASS_KEY = 'novacrm-attendance-return'

/** Keys that hold a signed-in session (tokens, cached user, cached data). */
export const SESSION_STORAGE_KEYS = ['novacrm-auth', 'novacrm-auth-user', 'novacrm-data'] as const

export type SignOutReason = 'idle' | 'expired' | 'browser-closed'

export function markBrowserSession() {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  // No Expires / Max-Age → deleted when the browser is closed.
  document.cookie = `${SESSION_COOKIE}=1; path=/; SameSite=Strict${secure}`
}

export function clearBrowserSession() {
  document.cookie = `${SESSION_COOKIE}=; path=/; Max-Age=0; SameSite=Strict`
}

function hasBrowserSession() {
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`))
}

export function touchActivity(now = Date.now()) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now))
  } catch {
    /* ignore */
  }
}

export function readLastActivity(): number | null {
  try {
    const n = Number(localStorage.getItem(ACTIVITY_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function clearActivity() {
  try {
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    /* ignore */
  }
}

/** Remember why we signed out so the login page can explain it (survives the redirect). */
export function setSignOutReason(reason: SignOutReason) {
  try {
    sessionStorage.setItem(SIGNOUT_REASON_KEY, reason)
  } catch {
    /* ignore */
  }
}

export function peekSignOutReason(): SignOutReason | null {
  try {
    return sessionStorage.getItem(SIGNOUT_REASON_KEY) as SignOutReason | null
  } catch {
    return null
  }
}

export function clearSignOutReason() {
  try {
    sessionStorage.removeItem(SIGNOUT_REASON_KEY)
  } catch {
    /* ignore */
  }
}

export function signOutReasonMessage(reason: SignOutReason): string {
  switch (reason) {
    case 'idle':
      return `You were signed out after ${Math.round(IDLE_TIMEOUT_MS / 60_000)} minutes of inactivity.`
    case 'expired':
      return 'Your session has ended. Please sign in again.'
    case 'browser-closed':
      return 'The browser was closed, so you were signed out. Please sign in again.'
  }
}

/** Move ?att_return=… from the URL into sessionStorage (keeps it out of history / bookmarks). */
function captureReturnPass(): string | null {
  try {
    const url = new URL(window.location.href)
    const token = url.searchParams.get(RETURN_PASS_PARAM)
    if (!token) return null
    url.searchParams.delete(RETURN_PASS_PARAM)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    sessionStorage.setItem(RETURN_PASS_KEY, token)
    return token
  } catch {
    return null
  }
}

/** One-shot: the pending Attendance return pass, if any. */
export function takeReturnPass(): string | null {
  try {
    const t = sessionStorage.getItem(RETURN_PASS_KEY)
    sessionStorage.removeItem(RETURN_PASS_KEY)
    return t
  } catch {
    return null
  }
}

/**
 * Runs before the auth store hydrates. Drops a stored session when the browser
 * was closed (no session cookie) or the user has been idle past the timeout
 * (e.g. laptop asleep, or browser restored its tabs).
 */
export function enforceSessionOnBoot() {
  try {
    const returnPass = captureReturnPass()
    const raw = localStorage.getItem('novacrm-auth')
    if (!raw) return
    const last = readLastActivity()
    let reason: SignOutReason | null = null
    if (!hasBrowserSession()) reason = 'browser-closed'
    // Coming back from Attendance with a return pass: SessionGuard verifies it before any idle check.
    else if (!returnPass && (last == null || Date.now() - last >= IDLE_TIMEOUT_MS)) reason = 'idle'
    if (!reason) return

    // Best-effort server revoke of the refresh token.
    try {
      const auth = JSON.parse(raw) as { refreshToken?: string }
      const base = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'
      if (auth.refreshToken) {
        void fetch(`${base}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
          keepalive: true,
        }).catch(() => undefined)
      }
    } catch {
      /* ignore */
    }
    for (const k of SESSION_STORAGE_KEYS) localStorage.removeItem(k)
    clearActivity()
    clearBrowserSession()
    setSignOutReason(reason)
  } catch {
    /* ignore */
  }
}
