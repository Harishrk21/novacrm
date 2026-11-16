import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Clock, MapPin, Navigation, Phone, RefreshCw, Wrench } from 'lucide-react'
import { api, ApiClientError } from '@/lib/api'
import { formatServiceId } from '@/lib/serviceId'
import { serviceCategoryLabel } from '@/lib/serviceFlow'
import { cn, timeAgo } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useFieldLocationPings } from '@/lib/fieldLocation'
import { useUIStore } from '@/store/uiStore'

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})

/** Google Maps directions to the customer (address → area → name). */
export function directionsUrl(contact: Row) {
  const parts = [contact.doorNo, contact.street, contact.location, contact.area, contact.city, contact.pincode].map(str).filter(Boolean)
  const q = parts.length ? parts.join(', ') : str(contact.name)
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`
}
export const telUrl = (contact: Row) => {
  const p = str(contact.mobile || contact.phone).replace(/[^\d+]/g, '')
  return p ? `tel:${p.startsWith('+') ? p : p.length === 10 ? `+91${p}` : p}` : ''
}

function dueText(t: Row) {
  if (!t.slaDueAt) return { text: `Logged ${timeAgo(str(t.createdAt))}`, late: false }
  const mins = Math.round((new Date(str(t.slaDueAt)).getTime() - Date.now()) / 60000)
  if (mins < 0) return { text: `Overdue by ${mins > -60 ? `${-mins} min` : `${Math.round(-mins / 60)} h`}`, late: true }
  return { text: `Due in ${mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`}`, late: false }
}

const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Not started', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  PENDING: { label: 'On hold', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  RESOLVED: { label: 'With desk', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
}

function JobCard({ t, pool, busy, onAccept }: { t: Row; pool?: boolean; busy?: boolean; onAccept?: () => void }) {
  const c = obj(t.contact)
  const a = obj(t.asset)
  const cf = obj(t.customFields)
  const due = dueText(t)
  const st = STATUS[str(t.status)] ?? { label: str(t.status), cls: 'bg-muted text-text-secondary' }
  const tel = telUrl(c)
  return (
    <div className={cn('rounded-2xl border bg-card p-4 shadow-sm', pool ? 'border-rose-400/60' : 'border-border')}>
      <Link to={`/tickets/${str(t.id)}`} className="block">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-semibold text-text-secondary">
            {formatServiceId(t.ticketNo != null ? str(t.ticketNo) : undefined)} · {serviceCategoryLabel(cf.category)}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', pool ? 'bg-rose-500/15 text-rose-600' : st.cls)}>
            {pool ? 'New job' : st.label}
          </span>
        </div>
        <div className="mt-1.5 text-[17px] font-semibold leading-snug text-text-primary">{str(c.name) || 'Customer'}</div>
        <div className="mt-0.5 flex items-center gap-1 text-sm text-text-secondary">
          <MapPin size={13} className="shrink-0" />
          <span className="truncate">{[c.area, c.city].map(str).filter(Boolean).join(', ') || 'Area not set'}</span>
        </div>
        {a.name ? (
          <div className="mt-1 text-sm text-text-primary">
            <Wrench size={13} className="mr-1 inline text-text-secondary" />
            {str(a.name)}
            {a.serialNo ? <span className="ml-1 font-mono text-xs text-text-secondary">{str(a.serialNo)}</span> : null}
          </div>
        ) : null}
        <p className="mt-2 line-clamp-2 text-sm text-text-primary/90">{str(t.subject)}</p>
        <div className={cn('mt-2 flex items-center gap-1 text-xs font-medium', due.late ? 'text-rose-600' : 'text-text-secondary')}>
          <Clock size={12} /> {due.text}
        </div>
      </Link>
      {pool ? (
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-blue text-base font-semibold text-white active:scale-[0.99] disabled:opacity-60"
        >
          <CheckCircle2 size={18} /> {busy ? 'Accepting…' : 'Accept job'}
        </button>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {tel ? (
            <a href={tel} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium text-text-primary active:bg-muted">
              <Phone size={16} /> Call
            </a>
          ) : (
            <span className="flex h-11 items-center justify-center rounded-xl border border-dashed border-border text-xs text-text-secondary">No phone</span>
          )}
          <a
            href={directionsUrl(c)}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium text-text-primary active:bg-muted"
          >
            <Navigation size={16} /> Directions
          </a>
          <Link
            to={`/tickets/${str(t.id)}`}
            className="flex h-11 items-center justify-center gap-1 rounded-xl bg-accent-blue text-sm font-semibold text-white active:brightness-95"
          >
            Open <ChevronRight size={16} />
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * Engineer home on a phone — feels like an app: what to accept, my jobs for today with Call /
 * Directions, and nothing else in the way.
 */
export function FieldHome() {
  const user = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const navigate = useNavigate()
  const [pool, setPool] = useState<Row[] | null>(null)
  const [mine, setMine] = useState<Row[]>([])
  const [doneToday, setDoneToday] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const location = useFieldLocationPings(false) // pings run from the app shell; this just reads the state

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [page, sum] = await Promise.all([
        api.tickets({ limit: 100, sort: 'sla', mine: 1, claimable: 1 }),
        api.ticketsSummary().catch(() => null),
      ])
      const items = (page.items ?? []) as Row[]
      setPool(items.filter((t) => str(t.status) === 'OPEN' && !t.assignedToId))
      setMine(items.filter((t) => t.assignedToId && ['OPEN', 'IN_PROGRESS', 'PENDING'].includes(str(t.status))))
      setDoneToday(Number(sum?.resolvedToday ?? 0))
    } catch (e) {
      setPool([])
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not load jobs' })
    } finally {
      setRefreshing(false)
    }
  }, [addToast])
  useEffect(() => {
    void load()
  }, [load])

  async function accept(t: Row) {
    setBusyId(str(t.id))
    try {
      await api.claimTicket(str(t.id))
      addToast({ type: 'success', message: `${formatServiceId(str(t.ticketNo))} is yours` })
      navigate(`/tickets/${str(t.id)}`)
    } catch (e) {
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Someone else accepted it first' })
      void load()
    } finally {
      setBusyId(null)
    }
  }

  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })

  return (
    <div className="-mx-1 space-y-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-text-secondary">{today}</div>
          <h1 className="text-2xl font-bold text-text-primary">
            {hello}, {user?.name?.split(' ')[0] ?? 'there'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-text-secondary active:bg-muted"
        >
          <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {location === 'denied' || location === 'unavailable' ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-400/60 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          <MapPin size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Location is off</div>
            <div className="text-xs">
              The office can't see that you reached the customer. Turn on Location for this app (phone Settings → Chrome / Safari → Location → Allow), then refresh.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'To accept', value: pool?.length ?? '…', to: '/tickets?queue=awaiting', tone: (pool?.length ?? 0) > 0 ? 'text-rose-600' : 'text-text-primary' },
          { label: 'My open jobs', value: mine.length, to: '/tickets', tone: 'text-text-primary' },
          { label: 'Done today', value: doneToday, to: '/tickets?queue=closed', tone: 'text-emerald-600' },
        ].map((s) => (
          <Link key={s.label} to={s.to} className="rounded-2xl border border-border bg-card px-3 py-3 text-center active:bg-muted">
            <div className={cn('text-2xl font-bold tabular-nums', s.tone)}>{s.value}</div>
            <div className="text-[11px] font-medium text-text-secondary">{s.label}</div>
          </Link>
        ))}
      </div>

      {pool && pool.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Ready to accept <span className="ml-1 rounded-full bg-rose-600 px-2 text-xs text-white">{pool.length}</span>
          </h2>
          {pool.slice(0, 5).map((t) => (
            <JobCard key={str(t.id)} t={t} pool busy={busyId === str(t.id)} onAccept={() => void accept(t)} />
          ))}
          {pool.length > 5 ? (
            <Link to="/tickets?queue=awaiting" className="block text-center text-sm font-medium text-accent-blue">
              See all {pool.length} →
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">My jobs</h2>
        {pool == null ? (
          <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />
        ) : mine.length ? (
          mine.map((t) => <JobCard key={str(t.id)} t={t} />)
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-600" />
            <div className="mt-2 text-sm font-semibold text-text-primary">No jobs on your list</div>
            <div className="text-xs text-text-secondary">
              {pool?.length ? 'Accept one above to start.' : 'New jobs from the desk will show up here.'}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
