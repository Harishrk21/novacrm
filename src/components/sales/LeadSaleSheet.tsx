import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import type { LeadOrderedProduct } from '@/lib/hmsLead'

export type LeadReleaseProduct = {
  index: number
  label: string
  stampingRequired?: boolean | null
  stampingDate?: string | null
  nextDueDate?: string | null
  confirmed?: boolean
  serialNo?: string | null
  hmsUniqId?: string | null
  stockReduced?: boolean
}

export type LeadSaleLine = {
  productName: string
  serialNo?: string | null
  hmsUniqId?: string | null
  qty?: number
}

function matchRelease(name: string, rows: LeadReleaseProduct[]) {
  const n = name.trim().toLowerCase()
  return (
    rows.find((r) => r.label.trim().toLowerCase() === n) ??
    rows.find((r) => {
      const l = r.label.trim().toLowerCase()
      return l.includes(n) || n.includes(l)
    })
  )
}

function matchLine(name: string, rows: LeadSaleLine[]) {
  const n = name.trim().toLowerCase()
  return (
    rows.find((r) => r.productName.trim().toLowerCase() === n) ??
    rows.find((r) => {
      const l = r.productName.trim().toLowerCase()
      return l.includes(n) || n.includes(l)
    })
  )
}

/** One shared sheet: customer + ordered products + inventory identity. */
export function LeadSaleSheet({
  enquiryId,
  customerName,
  company,
  phone,
  area,
  contactId,
  ownerName,
  serviceType,
  products,
  releaseProducts,
  challanLines,
  quoteTotal,
  quoteAdvance,
  saleDcNo,
  reqNumber,
  inventoryStatus,
}: {
  enquiryId: string
  customerName: string
  company?: string | null
  phone?: string | null
  area?: string | null
  contactId?: string | null
  ownerName?: string | null
  serviceType?: string | null
  products: LeadOrderedProduct[]
  releaseProducts: LeadReleaseProduct[]
  challanLines: LeadSaleLine[]
  quoteTotal: number
  quoteAdvance: number
  saleDcNo?: string | null
  reqNumber?: string | null
  inventoryStatus: string
}) {
  const rows =
    products.length > 0
      ? products.map((p, i) => {
          const rel = matchRelease(p.name, releaseProducts)
          const line = matchLine(p.name, challanLines)
          return {
            key: `${p.id ?? p.name}-${i}`,
            qty: p.qty,
            name: p.name,
            serial: rel?.serialNo || line?.serialNo || null,
            hms: rel?.hmsUniqId || line?.hmsUniqId || null,
            stamp: !rel
              ? '—'
              : !rel.confirmed
                ? 'Pending'
                : rel.stampingRequired
                  ? rel.stampingDate
                    ? `Yes · ${formatDate(rel.stampingDate)}`
                    : 'Yes'
                  : 'Not required',
            reduced: Boolean(rel?.stockReduced),
          }
        })
      : releaseProducts.map((rel, i) => ({
          key: `rel-${rel.index}-${i}`,
          qty: 1,
          name: rel.label,
          serial: rel.serialNo,
          hms: rel.hmsUniqId,
          stamp: !rel.confirmed
            ? 'Pending'
            : rel.stampingRequired
              ? rel.stampingDate
                ? `Yes · ${formatDate(rel.stampingDate)}`
                : 'Yes'
              : 'Not required',
          reduced: Boolean(rel.stockReduced),
        }))

  const due = Math.max(0, quoteTotal - quoteAdvance)
  const units = rows.reduce((s, r) => s + r.qty, 0)

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
              Shared sale sheet
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-text-primary">
              Customer &amp; products
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Same view for sales desk, inventory, and admin · {enquiryId}
              {reqNumber ? ` · ${reqNumber}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {serviceType ? <Badge color="blue">{serviceType}</Badge> : null}
            {saleDcNo ? (
              <Badge color="cyan" solid>
                DC {saleDcNo}
              </Badge>
            ) : (
              <Badge color="gray">No sale DC yet</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-0 border-b border-border lg:grid-cols-[minmax(240px,280px)_1fr]">
        <dl className="space-y-3 border-b border-border p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Customer
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-text-primary">{customerName}</dd>
            {company ? <dd className="text-xs text-text-secondary">{company}</dd> : null}
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Phone
            </dt>
            <dd className="mt-0.5 tabular-nums text-sm font-medium">
              {phone ? formatPhone(phone) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Area
            </dt>
            <dd className="mt-0.5 text-sm">{area || '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Sales owner
            </dt>
            <dd className="mt-0.5 text-sm">{ownerName || 'Unassigned'}</dd>
          </div>
          {contactId ? (
            <Link
              to={`/contacts/${contactId}`}
              className="inline-block text-xs font-semibold text-accent-blue hover:underline"
            >
              Open customer Machines →
            </Link>
          ) : (
            <p className="text-[11px] text-text-secondary">Prospect — not on customer list yet</p>
          )}
        </dl>

        <div className="min-w-0 overflow-x-auto p-4 lg:p-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">Products ordered</h3>
            <span className="text-[11px] text-text-secondary">
              {rows.length ? `${rows.length} model${rows.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}` : 'None yet'}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-text-secondary">
              No product on this lead yet.
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                  <th className="w-10 py-2 pr-2">#</th>
                  <th className="w-14 py-2 pr-2">Qty</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Serial / HMS</th>
                  <th className="py-2 pr-3">Stamping</th>
                  <th className="py-2">Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-b border-border/80 last:border-0">
                    <td className="py-2.5 pr-2 align-top text-xs text-text-secondary">{i + 1}</td>
                    <td className="py-2.5 pr-2 align-top tabular-nums font-semibold">{r.qty}</td>
                    <td className="py-2.5 pr-3 align-top font-medium leading-snug text-text-primary">
                      {r.name}
                    </td>
                    <td className="py-2.5 pr-3 align-top font-mono text-xs">
                      {r.serial || r.hms ? (
                        <div className="space-y-0.5">
                          {r.serial ? <div>S/No {r.serial}</div> : null}
                          {r.hms && r.hms !== r.serial ? <div>HMS {r.hms}</div> : null}
                        </div>
                      ) : (
                        <span className="font-sans text-text-secondary">Not reduced yet</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 align-top text-xs text-text-secondary">{r.stamp}</td>
                    <td className="py-2.5 align-top">
                      {r.reduced ? (
                        <Badge color="green">On customer</Badge>
                      ) : (
                        <span className="text-xs text-text-secondary">In warehouse</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-4">
        {[
          ['Quote total', quoteTotal > 0 ? formatCurrency(quoteTotal) : '—'],
          ['Advance', quoteAdvance > 0 ? formatCurrency(quoteAdvance) : '—'],
          ['Balance due', quoteTotal > 0 ? formatCurrency(due) : '—'],
          ['Inventory', inventoryStatus],
        ].map(([label, value]) => (
          <div key={label} className="bg-card px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              {label}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-text-primary">{value}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
