import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, Download, PhoneCall, RefreshCw, ShieldCheck, Stamp, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { api, ApiClientError, type RenewalItem, type RenewalKind, type RenewalStatus } from '@/lib/api'
import { downloadXlsx } from '@/lib/reportExport'
import { can } from '@/lib/permissions'
import { cn, formatDate, formatPhone } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

/* ───────────────────────── rules ───────────────────────── */

const TABS: Array<{ id: RenewalKind; label: string; hint: string }> = [
  { id: 'STAMPING', label: 'Stamping', hint: 'Weighing machines — legal stamping every year' },
  { id: 'AMC', label: 'AMC renewal', hint: 'AMC contracts ending — renew for another year' },
  { id: 'VISIT', label: 'AMC visit due', hint: 'Free AMC service visits (2 a year, every 6 months) — book the visit; closing the job moves the next one 6 months ahead' },
  { id: 'GC', label: 'Guarantee ending', hint: 'HMS guarantee (GC) ending — weighing can move to AMC, others become chargeable (NGC)' },
  { id: 'NGC', label: 'AMC offer', hint: 'Weighing machines with no cover (after guarantee, or bought elsewhere) — offer AMC' },
]

type Bucket = 'all' | 'overdue' | 'd30' | 'd90' | 'later' | 'none'
const BUCKETS: Array<{ id: Bucket; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'd30', label: 'Next 30 days' },
  { id: 'd90', label: '31–90 days' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'Date not recorded' },
]

const STATUS: Record<RenewalStatus, { label: string; color: 'blue' | 'green' | 'amber' | 'gray' | 'red' | 'purple' }> = {
  CALLED: { label: 'Called', color: 'blue' },
  INTERESTED: { label: 'Interested', color: 'green' },
  NO_ANSWER: { label: 'No answer', color: 'amber' },
  CALL_BACK: { label: 'Call back later', color: 'purple' },
  NOT_INTERESTED: { label: 'Not interested', color: 'gray' },
  RENEWED: { label: 'Renewed', color: 'green' },
}

const weighing = (r: RenewalItem) => r.machineType === 'WEIGHING'
const todayIso = () => new Date().toISOString().slice(0, 10)
const daysTo = (iso: string | null) =>
  iso ? Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${todayIso()}T12:00:00`).getTime()) / 864e5) : null
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

/** Which list a machine belongs to and the date that matters there. */
function inKind(r: RenewalItem, kind: RenewalKind): { in: boolean; due: string | null } {
  if (kind === 'STAMPING') return { in: weighing(r), due: r.nextDueDate }
  if (kind === 'AMC') return { in: r.plan === 'AMC', due: r.amcEndDate }
  if (kind === 'VISIT') return { in: r.plan === 'AMC', due: r.nextServiceDueDate }
  if (kind === 'GC') return { in: r.plan === 'GC', due: r.warrantyEndDate }
  return { in: weighing(r) && (r.plan === 'NGC' || r.plan === 'NON_AMC'), due: null }
}
function bucketOf(due: string | null): Bucket {
  const d = daysTo(due)
  if (d == null) return 'none'
  if (d < 0) return 'overdue'
  if (d <= 30) return 'd30'
  if (d <= 90) return 'd90'
  return 'later'
}

function DueText({ iso }: { iso: string | null }) {
  const d = daysTo(iso)
  if (d == null) return <span className="text-xs text-text-secondary">Not recorded</span>
  return (
    <div>
      <div className="whitespace-nowrap text-sm font-medium text-text-primary">{formatDate(iso!)}</div>
      <div className={cn('text-xs font-semibold', d < 0 ? 'text-rose-600' : d <= 30 ? 'text-amber-600' : 'text-text-secondary')}>
        {d < 0 ? `${-d} days overdue` : d === 0 ? 'Today' : `in ${d} days`}
      </div>
    </div>
  )
}

function CoverBadge({ r }: { r: RenewalItem }) {
  if (r.plan === 'AMC')
    return (
      <div>
        <Badge color="green">AMC</Badge>
        <div className="mt-0.5 text-[11px] text-text-secondary">
          {r.amcStartDate ? formatDate(r.amcStartDate) : '—'} – {r.amcEndDate ? formatDate(r.amcEndDate) : '—'}
        </div>
      </div>
    )
  if (r.plan === 'GC')
    return (
      <div>
        <Badge color="blue">Guarantee (GC)</Badge>
        <div className="mt-0.5 text-[11px] text-text-secondary">till {r.warrantyEndDate ? formatDate(r.warrantyEndDate) : '—'}</div>
      </div>
    )
  return (
    <div>
      <Badge color="gray">No cover (NGC)</Badge>
      <div className="mt-0.5 text-[11px] text-text-secondary">service & parts charged</div>
    </div>
  )
}

/* ───────────────────────── page ───────────────────────── */

export function RenewalsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = can(role, 'renewals:write')
  const canJob = can(role, 'tickets:create')
  const jobLink = (r: RenewalItem, k: 'stamping' | 'visit') =>
    k === 'stamping'
      ? `/tickets?open=1&job=stamping&category=Stamping&contactId=${r.customer.id}&assetId=${r.id}`
      : `/tickets?open=1&job=service&category=${encodeURIComponent('AMC visit')}&contactId=${r.customer.id}&assetId=${r.id}`
  const [params, setParams] = useSearchParams()
  const kind = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'STAMPING') as RenewalKind
  const bucket = (BUCKETS.some((b) => b.id === params.get('due')) ? params.get('due') : 'all') as Bucket
  const [rows, setRows] = useState<RenewalItem[] | null>(null)
  const [search, setSearch] = useState('')
  const [area, setArea] = useState('')
  const [fu, setFu] = useState<'' | 'none' | 'due' | RenewalStatus>('')
  const [follow, setFollow] = useState<RenewalItem | null>(null)
  const [renew, setRenew] = useState<RenewalItem | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api.renewals()
      setRows(d.items)
    } catch (e) {
      setRows([])
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not load renewals' })
    }
  }, [addToast])
  useEffect(() => {
    void load()
  }, [load])

  const setQuery = (patch: Record<string, string>) => {
    const n = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) n.set(k, v)
      else n.delete(k)
    }
    setParams(n, { replace: true })
  }

  const all = rows ?? []
  const counts = useMemo(() => {
    const c = { stampOverdue: 0, stamp30: 0, amc60: 0, visit30: 0, gc60: 0, offer: 0, tab: {} as Record<RenewalKind, number> }
    for (const t of TABS) c.tab[t.id] = 0
    for (const r of all) {
      for (const t of TABS) if (inKind(r, t.id).in) c.tab[t.id]++
      if (weighing(r)) {
        const d = daysTo(r.nextDueDate)
        if (d != null && d < 0) c.stampOverdue++
        else if (d != null && d <= 30) c.stamp30++
      }
      if (r.plan === 'AMC') {
        const d = daysTo(r.amcEndDate)
        if (d != null && d <= 60) c.amc60++
        const v = daysTo(r.nextServiceDueDate)
        if (v != null && v <= 30) c.visit30++
      }
      if (r.plan === 'GC') {
        const d = daysTo(r.warrantyEndDate)
        if (d != null && d <= 60) c.gc60++
      }
      if (inKind(r, 'NGC').in) c.offer++
    }
    return c
  }, [all])

  const areas = useMemo(() => [...new Set(all.map((r) => r.customer.area).filter(Boolean) as string[])].sort(), [all])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const today = todayIso()
    return all
      .map((r) => ({ r, due: inKind(r, kind).due, f: r.renewal?.[kind] }))
      .filter(({ r }) => inKind(r, kind).in)
      .filter(({ due }) => kind === 'NGC' || bucket === 'all' || bucketOf(due) === bucket)
      .filter(({ r }) => !area || r.customer.area === area)
      .filter(({ f }) =>
        !fu ? true : fu === 'none' ? !f : fu === 'due' ? Boolean(f?.nextFollowUp && f.nextFollowUp <= today) : f?.status === fu,
      )
      .filter(({ r }) =>
        !q
          ? true
          : [r.customer.name, r.customer.code, r.customer.company, r.customer.phone, r.name, r.serialNo, r.customer.area]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.due ?? '9999') .localeCompare(b.due ?? '9999') || a.r.customer.name.localeCompare(b.r.customer.name))
  }, [all, kind, bucket, area, fu, search])

  const tab = TABS.find((t) => t.id === kind)!
  const tiles = [
    { label: 'Stamping overdue', value: counts.stampOverdue, tab: 'STAMPING', due: 'overdue', icon: Stamp, warn: counts.stampOverdue > 0 },
    { label: 'Stamping due in 30 days', value: counts.stamp30, tab: 'STAMPING', due: 'd30', icon: Stamp, warn: false },
    { label: 'AMC ending in 60 days', value: counts.amc60, tab: 'AMC', due: '', icon: RefreshCw, warn: false },
    { label: 'AMC visits due in 30 days', value: counts.visit30, tab: 'VISIT', due: '', icon: Wrench, warn: false },
    { label: 'Guarantee ending in 60 days', value: counts.gc60, tab: 'GC', due: '', icon: ShieldCheck, warn: false },
    { label: 'Can take AMC', value: counts.offer, tab: 'NGC', due: '', icon: CalendarClock, warn: false },
  ] as const

  function exportList() {
    const sheet = list.map(({ r, due, f }) => ({
      Customer: r.customer.name,
      'Customer ID': r.customer.code ?? '',
      Company: r.customer.company ?? '',
      Phone: r.customer.phone ?? '',
      Area: r.customer.area ?? '',
      Machine: r.name,
      Serial: r.serialNo ?? '',
      'Bought from': r.origin === 'THIRD_PARTY' ? 'Outside' : 'HMS',
      Cover: r.plan === 'NON_AMC' ? 'NGC' : r.plan,
      'Due date': due ?? '',
      'Days left': daysTo(due) ?? '',
      'Last follow-up': f ? STATUS[f.status]?.label ?? f.status : '',
      'Follow-up note': f?.note ?? '',
      'Next follow-up': f?.nextFollowUp ?? '',
    }))
    downloadXlsx(`HMS-renewals-${tab.label.replace(/\s+/g, '-')}-${todayIso()}.xlsx`, [{ name: tab.label.slice(0, 31), rows: sheet }])
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Renewals"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Renewals' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw size={15} /> Refresh
            </Button>
            <Button variant="outline" disabled={!list.length} onClick={exportList}>
              <Download size={15} /> Excel
            </Button>
          </div>
        }
      />

      {/* What needs a call */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setQuery({ tab: t.tab, due: t.due })}
            className={cn(
              'rounded-xl border bg-card p-3 text-left transition hover:border-accent-blue/50',
              t.warn ? 'border-rose-400/60' : 'border-border',
            )}
          >
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <t.icon size={13} /> {t.label}
            </div>
            <div className={cn('mt-1 text-2xl font-semibold tabular-nums', t.warn ? 'text-rose-600' : 'text-text-primary')}>
              {rows ? t.value : '…'}
            </div>
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-border px-3 pt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setQuery({ tab: t.id, due: '' })}
              className={cn(
                '-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition',
                kind === t.id ? 'border-accent-blue text-accent-blue' : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {t.label} <span className="ml-1 rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{counts.tab[t.id] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3 p-3">
          <p className="text-xs text-text-secondary">{tab.hint}</p>
          {kind !== 'NGC' ? (
            <div className="flex flex-wrap gap-1.5">
              {BUCKETS.filter((b) => b.id !== 'none' || kind === 'STAMPING').map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setQuery({ due: b.id === 'all' ? '' : b.id })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    bucket === b.id
                      ? b.id === 'overdue'
                        ? 'border-rose-500 bg-rose-500/10 text-rose-600'
                        : 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                      : 'border-border text-text-secondary hover:text-text-primary',
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, phone, machine, serial"
              className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-card px-3 text-sm text-text-primary outline-none focus:border-accent-blue"
            />
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-text-primary"
            >
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={fu}
              onChange={(e) => setFu(e.target.value as typeof fu)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-text-primary"
            >
              <option value="">Any follow-up</option>
              <option value="none">Not contacted yet</option>
              <option value="due">Follow-up due</option>
              {(Object.keys(STATUS) as RenewalStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* List */}
        {rows == null ? (
          <p className="px-4 pb-6 text-sm text-text-secondary">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-text-secondary">Nothing here — no machines match this list.</p>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-muted/40 text-[11px] font-semibold text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Machine</th>
                  <th className="px-3 py-2 text-left">
                    {kind === 'STAMPING' ? 'Stamping due' : kind === 'AMC' ? 'AMC ends' : kind === 'VISIT' ? 'Visit due' : kind === 'GC' ? 'Guarantee ends' : 'Cover'}
                  </th>
                  {kind !== 'NGC' ? <th className="px-3 py-2 text-left">Cover</th> : null}
                  <th className="px-3 py-2 text-left">Follow-up</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ r, due, f }) => (
                  <tr key={r.id} className="border-t border-border/70 align-top">
                    <td className="px-3 py-2.5">
                      <Link to={`/contacts/${r.customer.id}`} className="font-medium text-text-primary hover:text-accent-blue hover:underline">
                        {r.customer.company || r.customer.name}
                      </Link>
                      <div className="text-xs text-text-secondary">
                        {[r.customer.company ? r.customer.name : null, r.customer.code, r.customer.area].filter(Boolean).join(' · ')}
                      </div>
                      {r.customer.phone ? (
                        <a href={`tel:${r.customer.phone}`} className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline">
                          <PhoneCall size={11} /> {formatPhone(r.customer.phone)}
                        </a>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-text-primary">{r.name}</div>
                      <div className="text-xs text-text-secondary">
                        {[r.serialNo, r.capacity].filter(Boolean).join(' · ') || '—'}
                      </div>
                      <Badge color={r.origin === 'THIRD_PARTY' ? 'amber' : 'blue'}>{r.origin === 'THIRD_PARTY' ? 'Outside' : 'From HMS'}</Badge>
                      {kind === 'STAMPING' && r.stampingDate ? (
                        <div className="mt-0.5 text-[11px] text-text-secondary">
                          Last stamped {formatDate(r.stampingDate)}
                          {r.stampingNumber ? ` · No. ${r.stampingNumber}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{kind === 'NGC' ? <CoverBadge r={r} /> : <DueText iso={due} />}</td>
                    {kind !== 'NGC' ? (
                      <td className="px-3 py-2.5">
                        <CoverBadge r={r} />
                      </td>
                    ) : null}
                    <td className="max-w-[260px] px-3 py-2.5">
                      {f ? (
                        <div>
                          <Badge color={STATUS[f.status]?.color ?? 'gray'}>{STATUS[f.status]?.label ?? f.status}</Badge>
                          {f.note ? <div className="mt-0.5 line-clamp-2 text-xs text-text-primary">{f.note}</div> : null}
                          <div className="text-[11px] text-text-secondary">
                            {f.by} · {formatDate(f.at)}
                            {f.nextFollowUp ? (
                              <span className={cn('ml-1 font-semibold', f.nextFollowUp <= todayIso() ? 'text-rose-600' : 'text-text-primary')}>
                                · next {formatDate(f.nextFollowUp)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-text-secondary">Not contacted yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canWrite ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setFollow(r)}>
                            Follow up
                          </Button>
                          {canJob && (kind === 'STAMPING' || kind === 'VISIT') ? (
                            <Link to={jobLink(r, kind === 'STAMPING' ? 'stamping' : 'visit')}>
                              <Button size="sm" variant="outline">{kind === 'STAMPING' ? 'Stamping job' : 'Book visit'}</Button>
                            </Link>
                          ) : null}
                          {weighing(r) && (kind === 'STAMPING' || kind === 'AMC' || kind === 'NGC' || (kind === 'GC' && (daysTo(r.warrantyEndDate) ?? 99) <= 0)) ? (
                            <Button size="sm" onClick={() => setRenew(r)}>
                              {kind === 'STAMPING' ? 'Stamped' : kind === 'AMC' ? 'Renew AMC' : 'Start AMC'}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {follow ? (
        <FollowUpModal
          item={follow}
          kind={kind}
          onClose={() => setFollow(null)}
          onSaved={() => {
            setFollow(null)
            void load()
          }}
        />
      ) : null}
      {renew ? (
        <RenewModal
          item={renew}
          kind={kind === 'STAMPING' ? 'STAMPING' : 'AMC'}
          onClose={() => setRenew(null)}
          onSaved={() => {
            setRenew(null)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

/* ───────────────────────── modals ───────────────────────── */

const field = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-text-primary outline-none focus:border-accent-blue'

function FollowUpModal({ item, kind, onClose, onSaved }: { item: RenewalItem; kind: RenewalKind; onClose: () => void; onSaved: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const [status, setStatus] = useState<RenewalStatus>('CALLED')
  const [note, setNote] = useState('')
  const [next, setNext] = useState(plusDays(7))
  const [busy, setBusy] = useState(false)
  const closing = status === 'NOT_INTERESTED'
  const history = item.renewal?.[kind]?.history ?? []

  async function save() {
    setBusy(true)
    try {
      await api.renewalFollowUp(item.id, { kind, status, note: note.trim(), nextFollowUp: closing ? null : next || null })
      addToast({ type: 'success', message: closing ? 'Saved' : `Saved — follow-up on ${formatDate(next)} added to your Workqueue` })
      onSaved()
    } catch (e) {
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Log follow-up"
      subtitle={`${item.customer.company || item.customer.name} · ${item.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Result</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as RenewalStatus)} className={field}>
            {(Object.keys(STATUS) as RenewalStatus[])
              .filter((s) => s !== 'RENEWED')
              .map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Note</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What did the customer say?"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
        {!closing ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">Next follow-up (goes to your Workqueue)</span>
            <input type="date" value={next} min={todayIso()} onChange={(e) => setNext(e.target.value)} className={field} />
          </label>
        ) : null}
        {history.length ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-text-secondary">Earlier follow-ups</div>
            <ul className="max-h-40 space-y-1 overflow-auto text-xs">
              {history.map((h, i) => (
                <li key={i} className="rounded-md bg-muted/40 px-2 py-1">
                  <span className="font-medium">{STATUS[h.status]?.label ?? h.status}</span> · {formatDate(h.at)} · {h.by}
                  {h.note ? <div className="text-text-secondary">{h.note}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function RenewModal({ item, kind, onClose, onSaved }: { item: RenewalItem; kind: 'STAMPING' | 'AMC'; onClose: () => void; onSaved: () => void }) {
  const addToast = useUIStore((s) => s.addToast)
  const [date, setDate] = useState(todayIso())
  const [number, setNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const isRenewal = item.plan === 'AMC'
  const defaultStart =
    isRenewal && item.amcEndDate && (daysTo(item.amcEndDate) ?? -1) >= 0
      ? new Date(new Date(`${item.amcEndDate}T12:00:00`).getTime() + 864e5).toISOString().slice(0, 10)
      : todayIso()
  const [start, setStart] = useState(defaultStart)

  async function save() {
    setBusy(true)
    try {
      if (kind === 'STAMPING') {
        const res = await api.renewalRenew(item.id, { kind, date, number: number.trim() || null, note: note.trim() })
        addToast({ type: 'success', message: `Stamping saved — next due ${res.nextDueDate ? formatDate(res.nextDueDate) : 'in 1 year'}` })
      } else {
        const res = await api.renewalRenew(item.id, { kind, startDate: start, amount: amount ? Number(amount) : null, note: note.trim() })
        addToast({ type: 'success', message: `AMC ${isRenewal ? 'renewed' : 'started'}: ${formatDate(res.amcStartDate!)} – ${formatDate(res.amcEndDate!)}` })
      }
      onSaved()
    } catch (e) {
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={kind === 'STAMPING' ? 'Record stamping' : isRenewal ? 'Renew AMC' : 'Start AMC'}
      subtitle={`${item.customer.company || item.customer.name} · ${item.name}${item.serialNo ? ` · ${item.serialNo}` : ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {kind === 'STAMPING' ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Stamped on</span>
              <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Stamp / certificate number</span>
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. LM/CHN/2026/4420" className={field} />
            </label>
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-text-secondary">Next stamping due is set to one year from this date.</p>
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Contract starts</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">AMC amount (₹, optional)</span>
              <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
            </label>
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-text-secondary">
              1-year contract · 2 free service visits (first in 6 months) · spare parts charged.
            </p>
          </>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
      </div>
    </Modal>
  )
}

export default RenewalsPage
