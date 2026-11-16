import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { serviceCategoryLabel } from '@/lib/serviceFlow'
import { cn, formatDate, formatPhone } from '@/lib/utils'
import { normalizeWorkEntries } from '@/lib/workReport'

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <div className="text-[11px] font-medium text-text-secondary">{label}</div>
      <div className="mt-0.5 text-sm text-text-primary">{children}</div>
    </div>
  )
}

/**
 * Everything about the job at a glance on Overview — customer, machine and its cover, type, engineer,
 * what was done, payment and dates — so the desk doesn't open four tabs to answer a customer's call.
 */
export function JobSummaryCard({ ticket, assigneeName }: { ticket: Row; assigneeName: string | null }) {
  const cf = (ticket.customFields && typeof ticket.customFields === 'object' ? ticket.customFields : {}) as Row
  const contact = (ticket.contact ?? null) as Row | null
  const asset = (ticket.asset ?? null) as Row | null
  const work = normalizeWorkEntries(cf.dayNotes)
  const last = work[work.length - 1]
  const photos = work.reduce((n, e) => n + e.photos.length, 0)
  const total = Number(ticket.paymentTotal ?? 0) || 0
  const advance = Number(ticket.advanceAmount ?? 0) || 0
  const paid = str(ticket.paymentStatus) === 'PAID'
  const plan = str(asset?.servicePlan)
  const outside = str(asset?.origin) === 'THIRD_PARTY'

  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-text-secondary">Job summary</div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <Item label="Customer">
          {contact ? (
            <>
              <Link to={`/contacts/${str(contact.id)}`} className="font-medium hover:text-accent-blue hover:underline">
                {str(contact.name)}
              </Link>
              <div className="text-xs text-text-secondary">
                {[contact.customerCode, contact.phone ? formatPhone(str(contact.phone)) : null].filter(Boolean).map(str).join(' · ')}
              </div>
            </>
          ) : (
            '—'
          )}
        </Item>
        <Item label="Machine">
          {asset ? (
            <>
              <div className="font-medium">{str(asset.name)}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
                {asset.serialNo ? <span className="font-mono">{str(asset.serialNo)}</span> : null}
                <Badge color={outside ? 'amber' : 'blue'}>{outside ? 'Outside' : 'From HMS'}</Badge>
                {plan ? (
                  <Badge color={plan === 'AMC' ? 'green' : plan === 'GC' ? 'blue' : 'gray'}>
                    {plan === 'GC' ? 'Guarantee' : plan === 'AMC' ? 'AMC' : 'No cover'}
                  </Badge>
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-text-secondary">No machine picked</span>
          )}
        </Item>
        <Item label="Job">
          <div className="font-medium">{serviceCategoryLabel(cf.category)}</div>
          <div className="text-xs text-text-secondary">Engineer: {assigneeName ?? 'not assigned yet'}</div>
        </Item>
        <Item label="Payment">
          {cf.freeJob ? (
            <span className="font-medium text-emerald-600">Free — guarantee / AMC</span>
          ) : total ? (
            <>
              <span className={cn('font-medium tabular-nums', paid ? 'text-emerald-600' : 'text-rose-600')}>
                {paid ? `${inr(total)} paid` : `${inr(Math.max(0, total - advance))} due`}
              </span>
              <div className="text-xs text-text-secondary">
                {[ticket.paymentMethod ? str(ticket.paymentMethod) : null, ticket.paymentReference ? str(ticket.paymentReference) : null]
                  .filter(Boolean)
                  .join(' · ') || (paid ? '' : `of ${inr(total)}`)}
              </div>
            </>
          ) : (
            <span className="text-text-secondary">No charge entered</span>
          )}
        </Item>
        <Item label="What the customer said" wide>
          <span className="line-clamp-2">{str(ticket.description) || str(ticket.subject) || '—'}</span>
        </Item>
        <Item label={`Work done${work.length ? ` · ${work.length} visit${work.length === 1 ? '' : 's'}` : ''}`} wide>
          {last ? (
            <>
              <span className="line-clamp-2">{last.done || last.found || last.note}</span>
              {photos ? <div className="text-xs text-text-secondary">{photos} photo{photos === 1 ? '' : 's'} in the work report</div> : null}
            </>
          ) : (
            <span className="text-text-secondary">No work report yet</span>
          )}
        </Item>
        <Item label="Dates" wide>
          <span className="text-xs text-text-secondary">
            Logged {ticket.createdAt ? formatDate(str(ticket.createdAt)) : '—'}
            {ticket.resolvedAt ? ` · completed ${formatDate(str(ticket.resolvedAt))}` : ''}
            {ticket.closedAt ? ` · closed ${formatDate(str(ticket.closedAt))}` : ''}
          </span>
        </Item>
      </div>
    </Card>
  )
}
