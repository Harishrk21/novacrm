import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, ExternalLink, MapPin, Phone, RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { api, ApiClientError, type FieldEngineer } from '@/lib/api'
import { formatDistance } from '@/lib/fieldLocation'
import { formatServiceId } from '@/lib/serviceId'
import { cn, formatPhone, timeAgo } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const EVENT_LABEL: Record<string, string> = {
  ACCEPT: 'Accepted job',
  CHECK_IN: 'Checked in at site',
  START: 'Started work',
  REPORT: 'Saved work report',
  COMPLETE: 'Marked complete',
  PING: 'Location update',
}
const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
/** OpenStreetMap embed (no key) centred on the point with a marker */
const osmEmbed = (lat: number, lng: number) => {
  const d = 0.006
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`
}

function status(e: FieldEngineer, atSiteM: number) {
  const ageMin = e.last?.at ? (Date.now() - new Date(e.last.at).getTime()) / 60000 : Infinity
  if (!e.last || ageMin > 12 * 60) return { text: 'Location not shared today', tone: 'gray' as const }
  if (!e.currentJob) return { text: 'No open job', tone: 'gray' as const }
  if (e.currentJob.distanceM == null) return { text: 'Customer location not saved yet', tone: 'gray' as const }
  if (e.currentJob.distanceM <= atSiteM) return { text: `At ${e.currentJob.customer ?? 'customer'} ✓`, tone: 'green' as const }
  return { text: `${formatDistance(e.currentJob.distanceM)} from ${e.currentJob.customer ?? 'the job'}`, tone: 'amber' as const }
}
const TONE = {
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  gray: 'bg-muted text-text-secondary',
}

/**
 * Owner / admin: where each service engineer is, whether they're at the customer, and today's visits.
 * Locations come from the engineer's phone while the HMS app is open and on every job action.
 */
export function FieldTrackingPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [items, setItems] = useState<FieldEngineer[] | null>(null)
  const [atSiteM, setAtSiteM] = useState(300)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const d = await api.fieldEngineers()
      setItems(d.items)
      setAtSiteM(d.atSiteMeters)
      setSelected((cur) => cur ?? d.items.find((e) => e.last)?.id ?? null)
    } catch (e) {
      setItems([])
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not load field tracking' })
    } finally {
      setBusy(false)
    }
  }, [addToast])
  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(t)
  }, [load])

  const sel = useMemo(() => items?.find((e) => e.id === selected) ?? null, [items, selected])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Field tracking"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Field tracking' }]}
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />
      <p className="-mt-2 max-w-3xl text-xs text-text-secondary">
        Engineers' phones send their location while the HMS app is open (every 5 minutes) and with every job action —
        accept, check in at site, start, work report, complete. "At customer" means within {atSiteM} m of the customer's
        saved location (saved automatically on the first check-in). Phones can't report while the app is fully closed.
      </p>

      {items == null ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-secondary">No active service engineers.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((e) => {
              const st = status(e, atSiteM)
              return (
                <div
                  key={e.id}
                  className={cn(
                    'cursor-pointer rounded-xl border bg-card p-4 transition',
                    selected === e.id ? 'border-accent-blue ring-1 ring-accent-blue/40' : 'border-border hover:border-accent-blue/40',
                  )}
                  onClick={() => setSelected(e.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-text-primary">{e.name}</div>
                      <div className="text-xs text-text-secondary">
                        {e.last?.at ? `Last seen ${timeAgo(e.last.at)} · ${time(e.last.at)}` : 'Not seen yet'}
                        {e.last?.accuracy ? ` · ±${e.last.accuracy} m` : ''}
                      </div>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', TONE[st.tone])}>{st.text}</span>
                  </div>
                  {e.currentJob ? (
                    <Link
                      to={`/tickets/${e.currentJob.id}`}
                      onClick={(ev) => ev.stopPropagation()}
                      className="mt-2 block rounded-lg bg-muted/40 px-3 py-2 text-sm hover:bg-muted/70"
                    >
                      <span className="font-mono text-xs text-text-secondary">{formatServiceId(String(e.currentJob.ticketNo))}</span>{' '}
                      <span className="font-medium text-text-primary">{e.currentJob.customer ?? '—'}</span>
                      {e.currentJob.area ? <span className="text-text-secondary"> · {e.currentJob.area}</span> : null}
                      <div className="truncate text-xs text-text-secondary">{e.currentJob.subject}</div>
                    </Link>
                  ) : (
                    <div className="mt-2 text-sm text-text-secondary">No open job</div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {e.phone ? (
                      <a href={`tel:${e.phone}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:border-accent-blue/50">
                        <Phone size={12} /> {formatPhone(e.phone)}
                      </a>
                    ) : null}
                    {e.last ? (
                      <a
                        href={mapsUrl(e.last.lat, e.last.lng)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:border-accent-blue/50"
                      >
                        <ExternalLink size={12} /> Google Maps
                      </a>
                    ) : null}
                    <span className="inline-flex items-center gap-1 px-1 py-1 text-text-secondary">
                      {e.openJobs} open job{e.openJobs === 1 ? '' : 's'} · {e.updatesToday} update{e.updatesToday === 1 ? '' : 's'} today
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <aside className="space-y-3">
            {sel ? (
              <>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <div className="text-sm font-semibold text-text-primary">{sel.name}</div>
                    <div className="text-xs text-text-secondary">{sel.last?.at ? `${time(sel.last.at)} · ${timeAgo(sel.last.at)}` : ''}</div>
                  </div>
                  {sel.last ? (
                    <iframe title={`${sel.name} location`} src={osmEmbed(sel.last.lat, sel.last.lng)} className="h-64 w-full border-0" loading="lazy" />
                  ) : (
                    <div className="flex h-40 items-center justify-center text-sm text-text-secondary">
                      <MapPin size={16} className="mr-1" /> No location from this engineer yet
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text-primary">Today</div>
                  {sel.today.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-text-secondary">No job actions yet today.</p>
                  ) : (
                    <ol className="space-y-2.5 p-4">
                      {sel.today.map((ev, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="w-16 shrink-0 tabular-nums text-xs text-text-secondary">{time(ev.at)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-text-primary">{EVENT_LABEL[ev.event] ?? ev.event}</div>
                            <div className="text-xs text-text-secondary">
                              {ev.job ? (
                                <Link to={`/tickets/${ev.ticketId}`} className="hover:text-accent-blue hover:underline">
                                  {ev.job}
                                </Link>
                              ) : null}
                              {ev.customer ? ` · ${ev.customer}` : ''}
                            </div>
                          </div>
                          {ev.distanceM == null ? (
                            <a href={mapsUrl(ev.lat, ev.lng)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-accent-blue hover:underline">
                              map
                            </a>
                          ) : ev.distanceM <= atSiteM ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
                              <CheckCircle2 size={13} /> at customer
                            </span>
                          ) : (
                            <a href={mapsUrl(ev.lat, ev.lng)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-600 hover:underline">
                              <TriangleAlert size={13} /> {formatDistance(ev.distanceM)} away
                            </a>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-secondary">
                <Clock size={16} className="mr-1" /> Pick an engineer
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

export default FieldTrackingPage
