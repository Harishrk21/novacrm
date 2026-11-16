import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { api, getAuth } from '@/lib/api'
import { loginPathFor } from '@/lib/lastTenantSlug'
import {
  IDLE_TIMEOUT_MS,
  WARNING_MS,
  readLastActivity,
  setSignOutReason,
  takeReturnPass,
  touchActivity,
} from '@/lib/sessionPolicy'

/** Real user input only — no `scroll` (data loads / layout shifts fire it without the user). */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
/** Don't hammer localStorage on every mousemove. */
const WRITE_THROTTLE_MS = 10_000
const TICK_MS = 1_000

/**
 * Inactivity sign-out shared across tabs. Activity in any tab keeps every tab alive;
 * when one tab signs out, the others follow on their next tick.
 */
export function SessionGuard() {
  const kind = useAuthStore((s) => s.kind)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastWriteRef = useRef(0)
  const warningRef = useRef(false)
  const signingOutRef = useRef(false)
  const verifyingRef = useRef(false)

  const loginPath = useCallback(() => loginPathFor(kind, user?.tenantSlug), [kind, user?.tenantSlug])

  const signOut = useCallback(
    async (reason: 'idle' | 'expired') => {
      if (signingOutRef.current) return
      signingOutRef.current = true
      setSecondsLeft(null)
      warningRef.current = false
      setSignOutReason(reason)
      try {
        await logout()
      } finally {
        navigate(loginPath(), { replace: true })
        signingOutRef.current = false
      }
    },
    [logout, navigate, loginPath],
  )

  const stayActive = useCallback(() => {
    lastWriteRef.current = Date.now()
    touchActivity(lastWriteRef.current)
    warningRef.current = false
    setSecondsLeft(null)
  }, [])

  // Back from Attendance with a signed return pass: time spent there counts as activity.
  useEffect(() => {
    if (!kind) return
    const pass = takeReturnPass()
    if (!pass) return
    verifyingRef.current = true
    api
      .verifyAttendanceReturn(pass)
      .then(() => touchActivity())
      .catch(() => undefined) // invalid/expired → normal idle rules apply
      .finally(() => {
        verifyingRef.current = false
      })
  }, [kind])

  useEffect(() => {
    if (!kind) return

    const onActivity = (e: Event) => {
      if (!e.isTrusted) return
      // Browsers fire synthetic pointermove (no movement) when layout shifts under a still cursor.
      if (e.type === 'pointermove') {
        const pe = e as PointerEvent
        if (pe.movementX === 0 && pe.movementY === 0) return
      }
      // While the warning is up, only the explicit "Stay signed in" counts.
      if (warningRef.current) return
      const now = Date.now()
      if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return
      lastWriteRef.current = now
      touchActivity(now)
    }

    const check = () => {
      if (signingOutRef.current || verifyingRef.current) return
      const last = readLastActivity() ?? Date.now()
      // Another tab signed out (or tokens cleared) → follow it with the same reason.
      if (!getAuth()) {
        void signOut(Date.now() - last >= IDLE_TIMEOUT_MS ? 'idle' : 'expired')
        return
      }
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - last)
      if (remaining <= 0) {
        void signOut('idle')
      } else if (remaining <= WARNING_MS) {
        warningRef.current = true
        setSecondsLeft(Math.ceil(remaining / 1000))
      } else if (warningRef.current) {
        // Activity in another tab extended the session.
        warningRef.current = false
        setSecondsLeft(null)
      }
    }

    if (readLastActivity() == null) touchActivity()
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true })
    document.addEventListener('visibilitychange', check)
    const id = window.setInterval(check, TICK_MS)
    check()
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity)
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(id)
    }
  }, [kind, signOut])

  if (!kind || secondsLeft == null) return null

  return (
    <Modal
      open
      onClose={stayActive}
      size="sm"
      accent="amber"
      icon={<Clock className="h-5 w-5" />}
      title="Are you still there?"
      subtitle="For security, idle sessions are signed out automatically."
      footer={
        <>
          <Button variant="outline" onClick={() => void signOut('idle')}>
            Sign out now
          </Button>
          <Button onClick={stayActive}>Stay signed in</Button>
        </>
      }
    >
      <p className="text-base text-text-secondary">
        You&apos;ll be signed out in{' '}
        <span className="font-semibold tabular-nums text-text-primary">{secondsLeft}s</span> because
        there has been no activity for {Math.round((IDLE_TIMEOUT_MS - WARNING_MS) / 60_000)} minutes.
      </p>
    </Modal>
  )
}
