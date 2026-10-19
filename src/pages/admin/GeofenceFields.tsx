import { MapPin, Navigation } from 'lucide-react'

export type GeofenceForm = {
  enabled: boolean
  lat: string
  lng: string
  radiusM: string
}

export const emptyGeofence = (): GeofenceForm => ({
  enabled: false,
  lat: '',
  lng: '',
  radiusM: '10',
})

type Props = {
  value: GeofenceForm
  onChange: (next: GeofenceForm) => void
  idPrefix?: string
}

/** Platform admin: office pin + toggle for Attendance clock-in geofence. */
export function GeofenceFields({ value, onChange, idPrefix = 'geo' }: Props) {
  function useMyLocation() {
    if (!navigator.geolocation) {
      window.alert('This browser cannot read GPS location.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          ...value,
          enabled: true,
          lat: pos.coords.latitude.toFixed(7),
          lng: pos.coords.longitude.toFixed(7),
        })
      },
      () => window.alert('Could not read your location. Enter coordinates manually.'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const mapsHref =
    value.lat && value.lng
      ? `https://www.google.com/maps?q=${encodeURIComponent(`${value.lat},${value.lng}`)}`
      : 'https://www.google.com/maps'

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MapPin className="h-4 w-4 text-sky-700" />
            Attendance office GPS
          </div>
          <p className="mt-1 text-xs text-slate-600">
            When on, employees can mark attendance only within the radius of this pin (default 10 m).
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-700">
          <input
            id={`${idPrefix}-enabled`}
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300"
          />
          Enforce
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-medium text-slate-600">
          Latitude
          <input
            id={`${idPrefix}-lat`}
            type="number"
            step="any"
            value={value.lat}
            onChange={(e) => onChange({ ...value, lat: e.target.value })}
            placeholder="13.0827000"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Longitude
          <input
            id={`${idPrefix}-lng`}
            type="number"
            step="any"
            value={value.lng}
            onChange={(e) => onChange({ ...value, lng: e.target.value })}
            placeholder="80.2707000"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Radius (metres)
          <input
            id={`${idPrefix}-radius`}
            type="number"
            min={5}
            max={5000}
            value={value.radiusM}
            onChange={(e) => onChange({ ...value, radiusM: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          <Navigation className="h-3.5 w-3.5" />
          Use my current location
        </button>
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  )
}

export function geofencePayload(form: GeofenceForm): {
  attendanceGeofenceEnabled: boolean
  attendanceGeofenceLat: number | null
  attendanceGeofenceLng: number | null
  attendanceGeofenceRadiusM: number
} {
  const lat = form.lat.trim() === '' ? null : Number(form.lat)
  const lng = form.lng.trim() === '' ? null : Number(form.lng)
  const radius = Number(form.radiusM) || 10
  if (form.enabled && (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng))) {
    throw new Error('Enter valid latitude and longitude when GPS enforcement is on')
  }
  return {
    attendanceGeofenceEnabled: form.enabled,
    attendanceGeofenceLat: lat != null && !Number.isNaN(lat) ? lat : null,
    attendanceGeofenceLng: lng != null && !Number.isNaN(lng) ? lng : null,
    attendanceGeofenceRadiusM: Math.min(5000, Math.max(5, radius)),
  }
}
