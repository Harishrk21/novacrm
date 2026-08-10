import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [deal, setDeal] = useState<Record<string, unknown> | null>(null)
  const [stages, setStages] = useState<
    Array<{ id: string; name: string; probability: number; isWon?: boolean; isLost?: boolean }>
  >([])
  const [lookups, setLookups] = useState<{
    contacts: Array<{ id: string; name: string }>
    accounts: Array<{ id: string; name: string }>
    users: Array<{ id: string; name: string }>
  }>({ contacts: [], accounts: [], users: [] })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, pipeline, meta] = await Promise.all([
        api.getDeal(id),
        api.dealsPipeline(),
        api.lookups(),
      ])
      setDeal(row)
      setStages(pipeline)
      setLookups({ contacts: meta.contacts, accounts: meta.accounts, users: meta.users })
    } catch {
      setDeal(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStage(stageId: string) {
    if (!id || !deal) return
    try {
      const updated = await api.moveDeal(id, stageId)
      setDeal(updated)
      const stage = stages.find((s) => s.id === stageId)
      addToast({ type: 'success', message: `Moved to ${stage?.name ?? 'stage'}` })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update stage',
      })
    }
  }

  if (loading) return <Card className="p-8 text-sm text-text-secondary">Loading deal…</Card>
  if (!deal) {
    return (
      <EmptyState
        icon={<Building2 size={24} />}
        title="Deal not found"
        actionLabel="Back to deals"
        onAction={() => navigate('/deals')}
      />
    )
  }

  const stage = stages.find((s) => s.id === String(deal.stageId))
  const contact = lookups.contacts.find((c) => c.id === deal.contactId)
  const account = lookups.accounts.find((a) => a.id === deal.accountId)
  const owner = lookups.users.find((u) => u.id === deal.ownerUserId)
  const isWon = Boolean(stage?.isWon)
  const invoiceHref = `/erp/invoices?accountId=${deal.accountId ?? ''}&contactId=${deal.contactId ?? ''}&dealId=${deal.id}&open=1`

  return (
    <div>
      <Link
        to="/deals"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-accent-blue"
      >
        <ArrowLeft size={16} /> Back to deals
      </Link>

      {isWon && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-emerald-800">Deal won — ready to bill</div>
              <p className="text-sm text-emerald-700">
                Create an invoice for this customer. Stocked products deduct from inventory automatically.
              </p>
            </div>
            <Button onClick={() => navigate(invoiceHref)}>Create invoice</Button>
          </div>
        </Card>
      )}

      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge color={isWon ? 'green' : stage?.isLost ? 'red' : 'blue'}>{stage?.name ?? 'Stage'}</Badge>
              <Badge color="amber">{String(deal.priority ?? 'MEDIUM')}</Badge>
            </div>
            <h1 className="text-2xl font-bold">{String(deal.name)}</h1>
            <p className="mt-2 text-3xl font-bold tabular-nums">{formatCurrency(num(deal.amount))}</p>
          </div>
          <div className="min-w-64">
            <Select
              label="Move stage"
              value={String(deal.stageId ?? '')}
              onChange={(e) => void changeStage(e.target.value)}
              options={stages.map((s) => ({ value: s.id, label: s.name }))}
            />
            <div className="mt-3">
              <div className="mb-1 text-xs text-text-secondary">Probability</div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent-blue"
                    style={{ width: `${num(deal.probability)}%` }}
                  />
                </div>
                <span className="text-sm font-semibold">{num(deal.probability)}%</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">Linked customer</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-text-secondary">Contact</dt>
              <dd className="font-medium">
                {contact ? (
                  <Link className="text-accent-blue hover:underline" to={`/contacts/${contact.id}`}>
                    {contact.name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Account</dt>
              <dd className="font-medium">
                {account ? (
                  <Link className="text-accent-blue hover:underline" to={`/accounts/${account.id}`}>
                    {account.name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Owner</dt>
              <dd className="font-medium">{owner?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Expected close</dt>
              <dd className="font-medium">
                {deal.expectedCloseDate ? formatDate(String(deal.expectedCloseDate)) : '—'}
              </dd>
            </div>
          </dl>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Next steps</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text-secondary">
            <li>Log calls / visits under Activities against this contact.</li>
            <li>Move the deal forward as you quote and negotiate.</li>
            <li>
              When the customer confirms, move to <strong>Won</strong>, then create an invoice.
            </li>
            <li>If they drop out, move to Lost so the pipeline stays accurate.</li>
          </ol>
          {deal.description ? (
            <p className="mt-4 rounded-lg bg-muted p-3 text-sm">{String(deal.description)}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => navigate(invoiceHref)}>Create invoice</Button>
            <Button variant="outline" onClick={() => navigate('/activities')}>
              Log activity
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default DealDetailPage
