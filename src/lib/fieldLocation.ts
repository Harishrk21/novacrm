import { useEffect, useState } from 'react'
import { api, type FieldEvent } from '@/lib/api'

/**
 * Engineer location for the owner's Field tracking. A phone web app can't run in the background, so
 * the location goes up while the app is open (every few minutes) and with every job action.
 * Never blocks the engineer's work: if location is off or slow, the action still goes through.
 */
export type LocationState = 'unknown' | 'on' | 'denied' | 'unavailable'

let lastState: LocationState = 'unknown'
const listeners = new Set<(s: LocationState) => void>()
function setState(s: LocationState) {
  lastState = s
  listeners.forEach((l) => l(s))
}

export function getPosition(timeoutMs = 12000): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setState('unavailable')
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState('on')
        resolve(pos)
      },
      (err) => {
        setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** Send the current location (with an optional job). Resolves to the server's at-site check, or null. */
export async function sendLocation(event: FieldEvent, ticketId?: string | null) {
  const pos = await getPosition()
  if (!pos) return null
  try {
    return await api.fieldLocation({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy),
      event,
      ticketId: ticketId ?? null,
    })
  } catch {
    return null
  }
}

/** While the engineer's app is open and visible: send the location now and every 5 minutes. */
export function useFieldLocationPings(enabled: boolean) {
  const [state, setLocal] = useState<LocationState>(lastState)
  useEffect(() => {
    listeners.add(setLocal)
    return () => {
      listeners.delete(setLocal)
    }
  }, [])
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const ping = () => {
      if (!stopped && document.visibilityState === 'visible') void sendLocation('PING')
    }
    ping()
    const timer = window.setInterval(ping, 5 * 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
  return state
}

export function formatDistance(m: number | null | undefined) {
  if (m == null) return ''
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`
}
