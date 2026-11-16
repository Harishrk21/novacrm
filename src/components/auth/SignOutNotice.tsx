import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { clearSignOutReason, peekSignOutReason, signOutReasonMessage } from '@/lib/sessionPolicy'

/** Login pages: explain why the user was signed out (idle / session ended / browser closed). */
export function SignOutNotice() {
  const [reason] = useState(peekSignOutReason)
  // Consume after first render so a later visit to the login page doesn't repeat it.
  useEffect(() => clearSignOutReason(), [])
  if (!reason) return null
  return (
    <div
      role="status"
      className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] leading-snug text-amber-100"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <span>{signOutReasonMessage(reason)}</span>
    </div>
  )
}
