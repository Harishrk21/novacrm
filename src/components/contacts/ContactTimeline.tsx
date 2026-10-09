import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  FileText,
  Filter,
  Package,
  ShoppingBag,
  TicketCheck,
  Wrench,
} from 'lucide-react'
import { formatServiceId } from '@/lib/serviceId'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

export type TimelineKind =
  | 'note'
  | 'ticket'
  | 'activity'
  | 'invoice'
  | 'spare'
  | 'machine'
  | 'rental'
  | 'contact'

export type TimelineEvent = {
  id: string
  at: string
  kind: TimelineKind
  title: string
  detail?: string
  by?: string | null
  href?: string
}

type Props = {
  events: TimelineEvent[]
  loading?: boolean
}

function dayKey(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleDateString('en-GB') // DD/MM/YYYY like Zoho
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function KindIcon({ kind }: { kind: TimelineKind }) {
  const cls = 'size-3.5'
  switch (kind) {
    case 'ticket':
      return <TicketCheck className={cls} />
    case 'note':
      return <FileText className={cls} />
    case 'spare':
      return <Wrench className={cls} />
    case 'machine':
      return <Package className={cls} />
    case 'invoice':
      return <ShoppingBag className={cls} />
    case 'rental':
      return <ShoppingBag className={cls} />
    default:
      return <Clock className={cls} />
  }
}

function kindColor(kind: TimelineKind) {
  switch (kind) {
    case 'ticket':
      return 'bg-amber-500 text-white'
    case 'note':
      return 'bg-sky-500 text-white'
    case 'spare':
      return 'bg-violet-500 text-white'
    case 'machine':
      return 'bg-emerald-500 text-white'
    case 'invoice':
      return 'bg-blue-600 text-white'
    case 'rental':
      return 'bg-rose-500 text-white'
    case 'activity':
      return 'bg-indigo-500 text-white'
    default:
      return 'bg-muted text-text-secondary'
  }
}

export function ContactTimeline({ events, loading }: Props) {
  const groups = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    )
    const map = new Map<string, TimelineEvent[]>()
    for (const e of sorted) {
      const k = dayKey(e.at)
      const list = map.get(k) ?? []
      list.push(e)
      map.set(k, list)
    }
    return [...map.entries()]
  }, [events])

  if (loading) {
    return (
      <div className="space-y-4 py-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    )
  }

  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
        No timeline events yet. Notes, service tickets, spare parts, invoices, and rentals will appear
        here.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Timeline history</h2>
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
          <Filter size={12} /> {events.length} events
        </span>
      </div>

      <div className="relative space-y-6 pl-1">
        {groups.map(([day, items]) => (
          <section key={day}>
            <div className="mb-3 inline-flex rounded-md bg-muted px-2.5 py-1 text-[11px] font-semibold tabular-nums text-text-secondary">
              {day}
            </div>
            <ol className="relative space-y-0 border-l border-border ml-3">
              {items.map((e) => {
                const body = (
                  <div className="min-w-0 flex-1 pb-5">
                    <div className="text-sm font-medium text-text-primary">{e.title}</div>
                    {e.detail ? (
                      <p className="mt-0.5 text-xs text-text-secondary">{e.detail}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-secondary">
                      {e.by ? <span>by {e.by}</span> : null}
                      <span>{formatDate(e.at)}</span>
                    </div>
                  </div>
                )
                return (
                  <li key={e.id} className="relative flex gap-3 pl-5">
                    <span
                      className={cn(
                        'absolute -left-[9px] top-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-card',
                        kindColor(e.kind),
                      )}
                    >
                      <KindIcon kind={e.kind} />
                    </span>
                    <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] font-medium tabular-nums text-text-secondary">
                      {timeLabel(e.at)}
                    </div>
                    {e.href ? (
                      <Link to={e.href} className="min-w-0 flex-1 hover:opacity-90">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Build timeline events from contact payload + related fetches. */
export function buildContactTimelineEvents(opts: {
  contact: Record<string, unknown>
  tickets: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  invoices: Array<Record<string, unknown>>
  assets: Array<Record<string, unknown>>
  rentals: Array<Record<string, unknown>>
  activities: Array<Record<string, unknown>>
  spares: Array<Record<string, unknown>>
  users?: Array<{ id: string; name: string }>
}): TimelineEvent[] {
  const userName = (id?: string | null) => {
    if (!id) return null
    return opts.users?.find((u) => u.id === id)?.name ?? null
  }
  const events: TimelineEvent[] = []

  if (opts.contact.createdAt) {
    events.push({
      id: `contact-created-${opts.contact.id}`,
      at: String(opts.contact.createdAt),
      kind: 'contact',
      title: 'Customer created',
      detail: opts.contact.customerCode
        ? `ID ${String(opts.contact.customerCode)}`
        : undefined,
      by: userName(opts.contact.ownerUserId ? String(opts.contact.ownerUserId) : null),
    })
  }

  for (const n of opts.notes) {
    events.push({
      id: `note-${n.id}`,
      at: String(n.createdAt ?? n.updatedAt ?? ''),
      kind: 'note',
      title: 'Note added',
      detail: String(n.content ?? '').slice(0, 160),
      by: n.authorName ? String(n.authorName) : userName(n.createdById ? String(n.createdById) : null),
    })
  }

  for (const t of opts.tickets) {
    const svc = formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)
    events.push({
      id: `ticket-open-${t.id}`,
      at: String(t.createdAt ?? ''),
      kind: 'ticket',
      title: `Service ticket opened — ${svc}`,
      detail: `${String(t.subject ?? '')} · ${String(t.status ?? '').replaceAll('_', ' ')}`,
      by: userName(t.assignedToId ? String(t.assignedToId) : null),
      href: `/tickets/${t.id}`,
    })
    if (t.resolvedAt) {
      events.push({
        id: `ticket-resolved-${t.id}`,
        at: String(t.resolvedAt),
        kind: 'ticket',
        title: `Service ticket completed — ${svc}`,
        detail: String(t.subject ?? ''),
        href: `/tickets/${t.id}`,
      })
    }
    if (t.closedAt || (String(t.status) === 'CLOSED' && t.updatedAt)) {
      events.push({
        id: `ticket-closed-${t.id}`,
        at: String(t.closedAt ?? t.updatedAt),
        kind: 'ticket',
        title: `Service ticket closed — ${svc}`,
        detail: String(t.subject ?? ''),
        href: `/tickets/${t.id}`,
      })
    }
    const tcf =
      t.customFields && typeof t.customFields === 'object'
        ? (t.customFields as Record<string, unknown>)
        : {}
    const sr = tcf.serviceReport
    if (sr && typeof sr === 'object') {
      const report = sr as Record<string, unknown>
      events.push({
        id: `service-report-${t.id}`,
        at: String(report.savedAt || t.closedAt || t.updatedAt || ''),
        kind: 'note',
        title: `Service report — ${svc}`,
        detail: [
          report.machineName ? String(report.machineName) : null,
          report.workDone
            ? String(report.workDone).slice(0, 100)
            : report.issues
              ? String(report.issues).slice(0, 100)
              : null,
          report.sparePartsCount != null && Number(report.sparePartsCount) > 0
            ? `${Number(report.sparePartsCount)} spare change(s)`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        by: report.savedBy ? String(report.savedBy) : null,
        href: `/tickets/${t.id}`,
      })
    }
  }

  for (const inv of opts.invoices) {
    events.push({
      id: `inv-${inv.id}`,
      at: String(inv.invoiceDate ?? inv.createdAt ?? ''),
      kind: 'invoice',
      title: `Invoice ${String(inv.invoiceNumber ?? '')}`,
      detail: `${formatCurrency(Number(inv.grandTotal ?? 0))} · ${String(inv.status ?? '')}`,
      href: `/invoices/${inv.id}`,
    })
  }

  for (const a of opts.assets) {
    events.push({
      id: `asset-${a.id}`,
      at: String(a.createdAt ?? a.updatedAt ?? ''),
      kind: 'machine',
      title: `Machine added — ${String(a.name ?? 'Machine')}`,
      detail: [
        a.origin === 'THIRD_PARTY' ? 'Outside' : 'Sold by us',
        a.servicePlan ? String(a.servicePlan) : null,
        a.serialNo ? `S/N ${String(a.serialNo)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })
    if (a.stampingDate) {
      events.push({
        id: `stamp-${a.id}-${a.stampingDate}`,
        at: `${String(a.stampingDate).slice(0, 10)}T12:00:00`,
        kind: 'machine',
        title: `Stamping recorded — ${String(a.name ?? 'Machine')}`,
        detail: a.nextDueDate
          ? `Valid till ${formatDate(String(a.nextDueDate))}`
          : undefined,
      })
    }
  }

  for (const s of opts.spares) {
    events.push({
      id: `spare-${s.id}`,
      at: String(s.changedAt ?? s.createdAt ?? ''),
      kind: 'spare',
      title: `Spare part ${String(s.changeType ?? 'REPLACED').toLowerCase()} — ${String(s.partName ?? '')}`,
      detail: [
        s.underWarranty ? 'Under warranty / GC' : null,
        s.chargeAmount != null ? formatCurrency(Number(s.chargeAmount)) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      href: s.ticketId ? `/tickets/${s.ticketId}` : undefined,
    })
  }

  for (const r of opts.rentals) {
    if (r.issuedAt || r.createdAt) {
      const product = r.product as { name?: string } | null
      events.push({
        id: `rental-out-${r.id}`,
        at: String(r.issuedAt ?? r.createdAt),
        kind: 'rental',
        title: `Rental issued — ${String(r.rentalNo ?? '')}`,
        detail: product?.name ? String(product.name) : undefined,
      })
    }
    if (r.returnedAt) {
      events.push({
        id: `rental-in-${r.id}`,
        at: String(r.returnedAt),
        kind: 'rental',
        title: `Rental returned — ${String(r.rentalNo ?? '')}`,
      })
    }
  }

  for (const act of opts.activities) {
    events.push({
      id: `act-${act.id}`,
      at: String(act.completedAt ?? act.scheduledAt ?? act.createdAt ?? ''),
      kind: 'activity',
      title: `${String(act.type ?? 'Activity')} — ${String(act.title ?? '')}`,
      detail: act.outcome
        ? String(act.outcome)
        : act.description
          ? String(act.description).slice(0, 140)
          : undefined,
      by:
        (act.assignedTo as { name?: string } | null)?.name ??
        userName(act.assignedToId ? String(act.assignedToId) : null),
    })
  }

  return events.filter((e) => e.at && !Number.isNaN(new Date(e.at).getTime()))
}
