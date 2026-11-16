import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CircleDollarSign,
  FileText,
  Package,
  PackagePlus,
  ShoppingBag,
  Wrench,
} from 'lucide-react'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { formatServiceId } from '@/lib/serviceId'
import { serviceCategoryLabel } from '@/lib/serviceFlow'
import { cn, formatCurrency, formatDate, formatPhone } from '@/lib/utils'

type Row = Record<string, unknown>

type Props = {
  contact: Row
  custom: Row
  ownerName: string | null
  account: Row | null | undefined
  tickets: Row[]
  assets: Row[]
  invoices: Row[]
  sales: Row[]
  units: Row[]
  onOpenTab: (tab: 'Machines' | 'Service' | 'Stamping' | 'AMC due') => void
}

const str = (v: unknown) => (v == null ? '' : String(v))
const num = (v: unknown) => Number(v ?? 0) || 0
const today = () => new Date(new Date().toDateString()).getTime()
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {})
const time = (v: unknown) => (v ? new Date(String(v)).getTime() || 0 : 0)

/** Due date: red when overdue, amber within 30 days. */
function Due({ value }: { value: unknown }) {
  if (!value) return <span className="text-text-secondary">—</span>
  const days = Math.round((time(value) - today()) / 864e5)
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        days < 0 ? 'font-semibold text-rose-600' : days <= 30 ? 'font-semibold text-amber-600' : 'text-text-primary',
      )}
      title={days < 0 ? `${-days} days overdue` : `in ${days} days`}
    >
      {formatDate(String(value))}
    </span>
  )
}

/** What protects this machine right now, in plain words. */
function Cover({ a }: { a: Row }) {
  const plan = str(a.servicePlan)
  if (plan === 'AMC') {
    return (
      <span>
        <Badge color="green">AMC</Badge>
        <span className="ml-1.5 text-xs text-text-secondary">till {a.amcEndDate ? formatDate(str(a.amcEndDate)) : '—'}</span>
      </span>
    )
  }
  if (plan === 'GC') {
    return (
      <span>
        <Badge color="blue">Guarantee</Badge>
        {a.warrantyEndDate ? (
          <span className="ml-1.5 text-xs text-text-secondary">till {formatDate(str(a.warrantyEndDate))}</span>
        ) : null}
      </span>
    )
  }
  return <Badge color="gray">{plan === 'NGC' ? 'No cover' : 'Non-AMC'}</Badge>
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {hint ? <p className="text-[11px] text-text-secondary">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-28 shrink-0 text-text-secondary">{label}</div>
      <div className="min-w-0 break-words font-medium text-text-primary">{children || '—'}</div>
    </div>
  )
}

const th = 'px-3 py-2 text-left text-[11px] font-semibold text-text-secondary'
const td = 'px-3 py-2.5 align-top'

/** One service job in a short line: what was done on this machine, by whom, how it was paid. */
export function jobSummary(t: Row) {
  const cf = obj(t.customFields)
  const notes = Array.isArray(cf.dayNotes) ? (cf.dayNotes as Row[]) : []
  const last = notes.length ? obj(notes[notes.length - 1]) : null
  const method = str(t.paymentMethod)
  const pay = cf.freeJob
    ? 'Free (guarantee / AMC)'
    : num(t.paymentTotal)
      ? `${formatCurrency(num(t.paymentTotal))}${method ? ` ${method === 'CASH' ? 'cash' : method}` : ''}${num(t.balanceDue) ? ` · ${formatCurrency(num(t.balanceDue))} due` : ''}`
      : null
  return {
    done: last ? str(last.done ?? last.note) : '',
    found: last ? str(last.found) : '',
    pay,
    open: !['RESOLVED', 'CLOSED'].includes(str(t.status)),
  }
}

type MachineTableProps = { rows: Row[]; jobsOf: (id: string) => Row[]; outside?: boolean }
function MachineTable({ rows, jobsOf, outside }: MachineTableProps) {
  const heads = outside
    ? ['Machine', 'Serial', 'Where from', 'Cover', 'Stamping due', 'Last service']
    : ['Machine', 'Serial', 'Bought on', 'Cover', 'Stamping due', 'Last service']
  return (
    <div className="-mx-4 -my-4 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/40">
          <tr>
            {heads.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const jobs = jobsOf(str(a.id))
            const lastJob = jobs[0]
            return (
              <Fragment key={str(a.id)}>
              <tr className="border-t border-border/70">
                <td className={td}>
                  <div className="font-medium text-text-primary">{str(a.name)}</div>
                  {(() => {
                    const sub = [a.model && str(a.model).toLowerCase() !== str(a.name).toLowerCase() ? a.model : null, a.capacity]
                      .filter(Boolean)
                      .map(str)
                      .join(' · ')
                    return sub ? <div className="text-xs text-text-secondary">{sub}</div> : null
                  })()}
                </td>
                <td className={cn(td, 'font-mono text-xs')}>{str(a.serialNo) || '—'}</td>
                <td className={cn(td, 'text-xs')}>
                  {outside ? (
                    <span className="text-text-secondary">{str(a.notes) || 'Bought elsewhere'}</span>
                  ) : (
                    <>
                      <div className="whitespace-nowrap text-sm">{a.createdAt ? formatDate(str(a.createdAt)) : '—'}</div>
                      {a.notes ? <div className="text-text-secondary">{str(a.notes)}</div> : null}
                    </>
                  )}
                </td>
                <td className={td}>
                  <Cover a={a} />
                </td>
                <td className={td}>
                  {str(a.machineType) === 'WEIGHING' ? <Due value={a.nextDueDate} /> : <span className="text-xs text-text-secondary">Not needed</span>}
                </td>
                <td className={cn(td, 'whitespace-nowrap text-xs')}>
                  {lastJob ? (
                    <>
                      <div className="text-sm text-text-primary">{formatDate(str(lastJob.closedAt ?? lastJob.createdAt))}</div>
                      <div className="text-text-secondary">{jobs.length} job{jobs.length === 1 ? '' : 's'}</div>
                    </>
                  ) : (
                    <span className="text-text-secondary">Never serviced</span>
                  )}
                </td>
              </tr>
              {jobs.length ? (
                <tr>
                  <td colSpan={6} className="px-3 pb-3 pt-0">
                    <ul className="space-y-1.5 rounded-md border border-border/70 bg-muted/25 px-3 py-2">
                      {jobs.map((t) => {
                        const j = jobSummary(t)
                        return (
                          <li key={str(t.id)} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                            <span className="tabular-nums text-text-secondary">{formatDate(str(t.createdAt))}</span>
                            <Link to={`/tickets/${str(t.id)}`} className="font-semibold text-accent-blue hover:underline">
                              {formatServiceId(t.ticketNo != null ? str(t.ticketNo) : undefined)}
                            </Link>
                            <span className="font-medium text-text-primary">{serviceCategoryLabel(obj(t.customFields).category)}</span>
                            <span className="min-w-0 flex-1 text-text-primary/90">
                              {j.done ? `— ${j.done}` : `— ${str(t.subject)}`}
                            </span>
                            <span className="text-text-secondary">{t.engineerName ? str(t.engineerName) : 'Not assigned'}</span>
                            {j.pay ? <span className={cn('tabular-nums', num(t.balanceDue) > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600')}>{j.pay}</span> : null}
                            <Badge color={ticketStatusColor[str(t.status)] ?? 'gray'}>{str(t.status).replaceAll('_', ' ').toLowerCase()}</Badge>
                          </li>
                        )
                      })}
                    </ul>
                  </td>
                </tr>
              ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type Event = {
  key: string
  at: number
  icon: typeof Wrench
  tone: string
  title: ReactNode
  lines: ReactNode[]
  right?: ReactNode
}

/**
 * The whole customer on one page: who they are, what they bought from HMS, which outside machines we
 * look after, and a dated history of every sale and service job (what was found, what was done, who
 * did it, how it was paid).
 */
export function CustomerOverview({ contact, custom, ownerName, account, tickets, assets, invoices, sales, units, onOpenTab }: Props) {
  const ours = assets.filter((a) => str(a.origin) !== 'THIRD_PARTY')
  const outside = assets.filter((a) => str(a.origin) === 'THIRD_PARTY')
  const assetName = new Map(assets.map((a) => [str(a.id), str(a.name)]))
  // Newest first, so the first one is the machine's last service
  const jobsOf = (id: string) =>
    tickets.filter((t) => str(t.assetId) === id).sort((x, y) => time(y.createdAt) - time(x.createdAt))

  const openJobs = tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(str(t.status)))
  const serviceDue = tickets.reduce((s, t) => s + num(t.balanceDue), 0)
  const proformaDue = invoices
    .filter((i) => str(i.status) !== 'VOID')
    .reduce((s, i) => s + Math.max(0, num(i.grandTotal) - num(i.amountPaid)), 0)
  const completedSales = sales.filter((l) => l.saleCompleted)
  const salesAmount = completedSales.reduce((s, l) => s + num(l.amount), 0)
  const servicePaid = tickets.reduce(
    (s, t) => s + (str(t.paymentStatus) === 'PAID' ? num(t.paymentTotal) : str(t.paymentStatus) === 'PARTIAL' ? num(t.advanceAmount) : 0),
    0,
  )
  const company = account ? str(account.name) : str(custom.companyName ?? custom.company_name)

  const phones = [
    ['Mobile', contact.mobile],
    ['Phone', contact.phone && contact.phone !== contact.mobile ? contact.phone : custom.landline],
    ['Mobile 2', custom.mobile_2],
    ['Mobile 3', custom.mobile_3],
    ['WhatsApp', custom.whatsapp],
  ].filter(([, v]) => v) as Array<[string, unknown]>
  const addressLines = [
    [contact.doorNo, custom.building_name, contact.street].filter(Boolean).join(', '),
    [contact.area, contact.city].filter(Boolean).join(', '),
    [contact.state, contact.pincode].filter(Boolean).join(' – '),
  ].filter(Boolean)

  const tiles = [
    { label: 'Machines', value: String(assets.length), hint: `${ours.length} from HMS · ${outside.length} outside`, icon: Package },
    { label: 'Bought from HMS', value: formatCurrency(salesAmount), hint: `${completedSales.length} sale${completedSales.length === 1 ? '' : 's'} completed`, icon: ShoppingBag },
    { label: 'Service jobs', value: String(tickets.length), hint: openJobs.length ? `${openJobs.length} open now` : 'none open', warn: openJobs.length > 0, icon: Wrench },
    { label: 'Service paid', value: formatCurrency(servicePaid), hint: 'collected on jobs', icon: CircleDollarSign },
    { label: 'Balance due', value: formatCurrency(serviceDue + proformaDue), hint: serviceDue + proformaDue > 0 ? 'to collect' : 'nothing pending', warn: serviceDue + proformaDue > 0, icon: AlertTriangle },
  ]

  // ── History: every sale, job, outside machine and proforma, newest first ──
  const events: Event[] = []
  for (const l of sales) {
    const products = (Array.isArray(l.products) && l.products.length ? (l.products as string[]) : [str(l.product)]).filter(Boolean)
    const lost = ['LOST', 'UNQUALIFIED'].includes(str(l.status))
    events.push({
      key: `s-${str(l.id)}`,
      at: time(l.saleCompletedAt) || time(l.createdAt),
      icon: ShoppingBag,
      tone: l.saleCompleted ? 'bg-emerald-500/15 text-emerald-600' : 'bg-sky-500/15 text-sky-600',
      title: (
        <Link to={`/sale-tracking/${str(l.id)}`} className="hover:text-accent-blue hover:underline">
          {l.saleCompleted ? 'Bought' : lost ? 'Enquiry lost' : 'Enquiry'} — {products.join(' + ') || 'machine'}
        </Link>
      ),
      lines: [
        [
          l.leadNo != null ? `ENQ-${String(l.leadNo).padStart(5, '0')}` : null,
          l.salesperson ? `Sales: ${str(l.salesperson)}` : null,
          l.saleCompleted && l.createdAt ? `enquiry ${formatDate(str(l.createdAt))}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ],
      right: (
        <div className="text-right">
          {num(l.amount) ? <div className="text-sm font-semibold tabular-nums">{formatCurrency(num(l.amount))}</div> : null}
          <Badge color={l.saleCompleted ? 'green' : lost ? 'gray' : 'blue'}>{l.saleCompleted ? 'Sold · paid' : lost ? 'Lost' : 'Open'}</Badge>
        </div>
      ),
    })
  }
  for (const t of tickets) {
    const cf = obj(t.customFields)
    const notes = Array.isArray(cf.dayNotes) ? (cf.dayNotes as Row[]) : []
    const last = notes[notes.length - 1] ? obj(notes[notes.length - 1]) : null
    const free = Boolean(cf.freeJob)
    const paid = str(t.paymentStatus) === 'PAID'
    const method = str(t.paymentMethod)
    const payText = free
      ? 'Free (guarantee / AMC)'
      : num(t.paymentTotal)
        ? `${formatCurrency(num(t.paymentTotal))}${method ? ` · ${method === 'CASH' ? 'Cash' : method}` : ''}${num(t.balanceDue) ? ` · ${formatCurrency(num(t.balanceDue))} due` : ''}`
        : null
    const machine = t.assetId ? assetName.get(str(t.assetId)) : null
    events.push({
      key: `t-${str(t.id)}`,
      at: time(t.createdAt),
      icon: Wrench,
      tone: openJobs.includes(t) ? 'bg-amber-500/15 text-amber-600' : 'bg-violet-500/15 text-violet-600',
      title: (
        <Link to={`/tickets/${str(t.id)}`} className="hover:text-accent-blue hover:underline">
          {formatServiceId(t.ticketNo != null ? str(t.ticketNo) : undefined)} · {serviceCategoryLabel(cf.category)}
          {machine ? ` — ${machine}` : ''}
        </Link>
      ),
      lines: [
        str(t.subject),
        last && str(last.found) ? <><span className="text-text-secondary">Found:</span> {str(last.found)}</> : null,
        last && str(last.done ?? last.note) ? <><span className="text-text-secondary">Done:</span> {str(last.done ?? last.note)}</> : null,
        last && str(last.next) ? <><span className="text-text-secondary">Next:</span> {str(last.next)}</> : null,
        [t.engineerName ? `Engineer: ${str(t.engineerName)}` : 'Not assigned yet', t.closedAt ? `closed ${formatDate(str(t.closedAt))}` : null]
          .filter(Boolean)
          .join(' · '),
      ].filter(Boolean),
      right: (
        <div className="text-right">
          {payText ? (
            <div className={cn('text-xs tabular-nums', num(t.balanceDue) > 0 ? 'font-semibold text-rose-600' : paid || free ? 'text-emerald-600' : 'text-text-secondary')}>
              {payText}
            </div>
          ) : null}
          <Badge color={ticketStatusColor[str(t.status)] ?? 'gray'}>{str(t.status).replaceAll('_', ' ').toLowerCase()}</Badge>
        </div>
      ),
    })
  }
  for (const a of outside) {
    events.push({
      key: `a-${str(a.id)}`,
      at: time(a.createdAt),
      icon: PackagePlus,
      tone: 'bg-slate-500/15 text-text-secondary',
      title: <>Outside machine added — {str(a.name)}</>,
      lines: [[a.model, a.serialNo ? `Serial ${str(a.serialNo)}` : null, a.notes].filter(Boolean).map(str).join(' · ')],
    })
  }
  for (const i of invoices) {
    const bal = str(i.status) === 'VOID' ? 0 : Math.max(0, num(i.grandTotal) - num(i.amountPaid))
    events.push({
      key: `i-${str(i.id)}`,
      at: time(i.invoiceDate ?? i.createdAt),
      icon: FileText,
      tone: 'bg-slate-500/15 text-text-secondary',
      title: <>Proforma {str(i.invoiceNumber)}</>,
      lines: [],
      right: (
        <div className="text-right text-xs tabular-nums">
          <div className="text-sm font-semibold">{formatCurrency(num(i.grandTotal))}</div>
          <span className={bal > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'}>
            {str(i.status) === 'VOID' ? 'Cancelled' : bal > 0 ? `${formatCurrency(bal)} due` : 'Paid'}
          </span>
        </div>
      ),
    })
  }
  events.sort((a, b) => b.at - a.at)
  const withCustomer = units.filter((u) => ['DEMO', 'RENTED'].includes(str(u.status)))

  return (
    <div className="space-y-5">
      {/* Key figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-card px-3 py-3">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <t.icon size={13} /> {t.label}
            </div>
            <div className={cn('mt-1 text-lg font-semibold tabular-nums', t.warn ? 'text-rose-600' : 'text-text-primary')}>{t.value}</div>
            <div className="text-[11px] text-text-secondary">{t.hint}</div>
          </div>
        ))}
      </div>

      {/* Contact + address — each detail once */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Contact">
          <div className="space-y-2">
            <Field label="Customer ID">
              {contact.customerCode ? <span className="font-mono">{str(contact.customerCode)}</span> : null}
            </Field>
            {company ? (
              <Field label="Company">
                {account ? (
                  <Link to={`/accounts/${str(account.id)}`} className="text-accent-blue hover:underline">
                    {company}
                  </Link>
                ) : (
                  company
                )}
              </Field>
            ) : null}
            {phones.map(([label, v]) => (
              <Field key={label} label={label}>
                <a href={`tel:${str(v).replace(/\s/g, '')}`} className="hover:text-accent-blue">
                  {formatPhone(str(v))}
                </a>
              </Field>
            ))}
            {contact.email ? (
              <Field label="Email">
                <a href={`mailto:${str(contact.email)}`} className="text-accent-blue hover:underline">
                  {str(contact.email)}
                </a>
              </Field>
            ) : null}
            <Field label="Owner">{ownerName ?? 'Unassigned'}</Field>
            <Field label="Customer since">{contact.createdAt ? formatDate(str(contact.createdAt)) : null}</Field>
          </div>
        </Section>
        <Section title="Address">
          <div className="space-y-2 text-sm">
            {addressLines.length ? (
              <p className="font-medium leading-relaxed text-text-primary">
                {addressLines.map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-text-secondary">No address on file.</p>
            )}
            {contact.location ? <Field label="Landmark">{str(contact.location)}</Field> : null}
            {custom.gps_location ? (
              <Field label="Map">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(str(custom.gps_location))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-blue hover:underline"
                >
                  Open in Google Maps
                </a>
              </Field>
            ) : null}
            {contact.description ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-text-secondary">{str(contact.description)}</p>
            ) : null}
          </div>
        </Section>
      </div>

      {/* Machines — bought from HMS vs outside */}
      <Section
        title={`Bought from HMS (${ours.length})`}
        hint="Machines we sold — guarantee, stamping and AMC are tracked from the sale"
        action={
          <button type="button" className="shrink-0 text-xs font-medium text-accent-blue hover:underline" onClick={() => onOpenTab('Machines')}>
            Manage machines →
          </button>
        }
      >
        {ours.length ? (
          <MachineTable rows={ours} jobsOf={jobsOf} />
        ) : (
          <p className="text-sm text-text-secondary">This customer hasn't bought a machine from HMS yet.</p>
        )}
      </Section>

      {outside.length ? (
        <Section title={`Outside machines we service (${outside.length})`} hint="Bought from another dealer — HMS services them">
          <MachineTable rows={outside} jobsOf={jobsOf} outside />
        </Section>
      ) : null}

      {withCustomer.length ? (
        <Section title="On demo / rented with this customer">
          <ul className="space-y-1 text-sm">
            {withCustomer.map((u) => (
              <li key={str(u.id)} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {str(u.productName) || 'Unit'} <span className="font-mono text-xs text-text-secondary">{str(u.hmsUniqId || u.serialNo)}</span>
                </span>
                <Badge color={str(u.status) === 'DEMO' ? 'amber' : 'purple'}>{str(u.status) === 'DEMO' ? 'On demo' : 'Rented'}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* History */}
      <Section
        title="History"
        hint="Every sale, service job and machine — newest first"
        action={
          <button type="button" className="shrink-0 text-xs font-medium text-accent-blue hover:underline" onClick={() => onOpenTab('Service')}>
            All service jobs →
          </button>
        }
      >
        {events.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing yet — sales and service jobs will appear here.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-border pl-5">
            {events.map((e) => (
              <li key={e.key} className="relative">
                <span className={cn('absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-card', e.tone)}>
                  <e.icon size={12} />
                </span>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] tabular-nums text-text-secondary">{e.at ? formatDate(new Date(e.at).toISOString()) : ''}</div>
                    <div className="text-sm font-semibold text-text-primary">{e.title}</div>
                    {e.lines.filter(Boolean).map((l, i) => (
                      <div key={i} className="mt-0.5 text-xs leading-relaxed text-text-primary/90">
                        {l}
                      </div>
                    ))}
                  </div>
                  {e.right ? <div className="shrink-0">{e.right}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}
