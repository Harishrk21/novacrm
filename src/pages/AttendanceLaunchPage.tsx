import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiClientError } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

/**
 * Fetches a one-time Attendance SSO URL from the HMS API, then navigates there.
 * No second login — ticket is minted server-side with the stored SSO secret.
 */
export function AttendanceLaunchPage() {
  const attendanceEnabled = useAuthStore((s) => s.user?.attendanceEnabled)
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (attendanceEnabled === false) {
      setError('Attendance is not enabled for your company.')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const redirect = searchParams.get('redirect') || '/'
        const embed = searchParams.get('embed') === '1'
        // Prefer explicit returnUrl from sidebar; else restore Meister home of this origin.
        const returnUrl =
          searchParams.get('returnUrl') ||
          `${window.location.origin}/`
        const { url } = await api.launchAttendance({ redirect, embed, returnUrl })
        if (cancelled) return
        window.location.assign(url)
      } catch (e) {
        if (cancelled) return
        const msg =
          e instanceof ApiClientError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Could not open Attendance'
        setError(msg)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [attendanceEnabled, searchParams])

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Attendance unavailable</h1>
        <p className="text-sm text-slate-600">{error}</p>
        <Link to="/" className="text-sm font-medium text-sky-700 underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      <p className="text-sm text-slate-600">Opening Attendance…</p>
    </div>
  )
}
