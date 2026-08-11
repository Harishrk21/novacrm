import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  FileText,
  MapPin,
  Pencil,
  Phone,
  Ticket,
  Users,
} from 'lucide-react'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import {
  AccountFormFields,
  accountToForm,
  emptyAccountForm,
  formToPayload,
  type AccountFormState,
} from '@/components/accounts/AccountFormFields'

function fmtAddr(a: unknown) {
  if (!a || typeof a !== 'object') return null
  const o = a as Record<string, string>
  const parts = [o.line1, o.line2, [o.city, o.state].filter(Boolean).join(', '), o.pincode, o.country]
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [account, setAccount] = useState<Record<string, unknown> | null>(null)
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<AccountFormState>(emptyAccountForm())

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [acc, lookups] = await Promise.all([api.getAccount(id), api.lookups()])
      setAccount(acc)
      setUsers(lookups.users)
    } catch {
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const contacts = useMemo(
    () => (account?.contacts as Array<Record<string, unknown>>) ?? [],
    [account],
  )
  const deals = useMemo(() => (account?.deals as Array<Record<string, unknown>>) ?? [], [account])
  const invoices = useMemo(
    () => (account?.invoices as Array<Record<string, unknown>>) ?? [],
    [account],
  )
  const tickets = useMemo(
    () => (account?.tickets as Array<Record<string, unknown>>) ?? [],
    [account],
  )

  const openDeals = deals.filter((d) => !d.closedAt)
  const wonRevenue = deals
    .filter((d) => d.closedAt)
    .reduce((s, d) => s + num(d.amount), 0)
  const invoiceTotal = invoices.reduce((s, inv) => s + num(inv.grandTotal), 0)
  const ownerName = users.find((u) => u.id === account?.ownerUserId)?.name
  const tags = Array.isArray(account?.tags) ? (account!.tags as string[]) : []
  const cf = (account?.customFields as Record<string, unknown> | null) ?? {}
  const billing = fmtAddr(account?.billingAddress)
  const shipping = fmtAddr(account?.shippingAddress)

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    try {
      const updated = await api.updateAccount(id, formToPayload(form))
      setAccount(updated)
      setEditOpen(false)
      addToast({ type: 'success', message: 'Account updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    }
  }

  if (loading) return <Card className="p-6 text-sm text-text-secondary">Loading account…</Card>
  if (!account) {
    return (
      <EmptyState
        icon={<Building2 size={26} />}
        title="Account not found"
        actionLabel="Back"
        onAction={() => navigate('/accounts')}
      />
    )
  }

  const kpis = [
    { label: 'Contacts', value: contacts.length, icon: Users, tint: 'bg-blue-50 text-accent-blue' },
    { label: 'Open deals', value: openDeals.length, icon: Briefcase, tint: 'bg-violet-50 text-accent-purple' },
    { label: 'Won revenue', value: formatCurrency(wonRevenue), icon: Briefcase, tint: 'bg-emerald-50 text-accent-green' },
    { label: 'Invoiced', value: formatCurrency(invoiceTotal), icon: FileText, tint: 'bg-amber-50 text-accent-amber' },
    { label: 'Tickets', value: tickets.length, icon: Ticket, tint: 'bg-rose-50 text-accent-red' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => navigate('/accounts')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <Button
          variant={editOpen ? 'outline' : 'primary'}
          onClick={() => {
            if (editOpen) {
              setEditOpen(false)
              return
            }
            setForm(accountToForm(account))
            setEditOpen(true)
          }}
        >
          <Pencil size={16} /> {editOpen ? 'Close form' : 'Edit account'}
        </Button>
      </div>

      <FormPanel
        open={editOpen}
        accent="violet"
        eyebrow="Accounts"
        title="Edit account"
        subtitle="Update company, tax, addresses and commercial terms."
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setEditOpen(false)} />
            <Button type="submit" form="edit-account">
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-account" onSubmit={saveEdit}>
          <AccountFormFields form={form} setForm={setForm} users={users} />
        </form>
      </FormPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">{String(account.name)}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {account.accountType ? <Badge color="blue">{String(account.accountType)}</Badge> : null}
              {account.industry ? <Badge color="slate">{String(account.industry)}</Badge> : null}
              {tags.map((t) => (
                <Badge key={t} color="amber">
                  {t}
                </Badge>
              ))}
            </div>
            {account.description ? (
              <p className="mt-3 max-w-2xl text-sm text-text-secondary">{String(account.description)}</p>
            ) : null}
          </div>
          <div className="text-sm text-text-secondary">
            {ownerName ? <div>Owner: <span className="font-medium text-text-primary">{ownerName}</span></div> : null}
            {account.createdAt ? <div>Created {formatDate(String(account.createdAt))}</div> : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${k.tint}`}>
                <k.icon size={18} />
              </div>
              <div>
                <div className="text-lg font-semibold text-text-primary">{k.value}</div>
                <div className="text-xs text-text-secondary">{k.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Building2 size={16} /> Company profile
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            {[
              ['Phone', account.phone],
              ['Email', account.email],
              ['Website', account.website],
              ['City / State', [account.city, account.state].filter(Boolean).join(', ')],
              ['Country', account.country],
              ['Employees', account.employeeCount],
              ['Annual revenue', account.annualRevenue ? formatCurrency(num(account.annualRevenue)) : null],
              ['LinkedIn', cf.linkedin],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs text-text-secondary">{String(k)}</dt>
                <dd className="font-medium break-all">{v != null && v !== '' ? String(v) : '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Tax & compliance</h2>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            {[
              ['GSTIN', account.gstin],
              ['PAN', account.pan],
              ['Payment terms', cf.payment_terms],
              ['Credit limit', cf.credit_limit != null ? formatCurrency(num(cf.credit_limit)) : null],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs text-text-secondary">{String(k)}</dt>
                <dd className="font-medium font-mono text-sm">{v != null && v !== '' ? String(v) : '—'}</dd>
              </div>
            ))}
          </dl>
          {cf.notes ? (
            <p className="mt-4 rounded-[8px] bg-surface p-3 text-sm text-text-secondary">{String(cf.notes)}</p>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <MapPin size={16} /> Billing address
          </h2>
          <p className="text-sm text-text-primary">{billing ?? 'No billing address on file'}</p>
          <h2 className="mb-2 mt-4 flex items-center gap-2 font-semibold">
            <MapPin size={16} /> Shipping address
          </h2>
          <p className="text-sm text-text-primary">{shipping ?? 'Same as billing / not set'}</p>
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Phone size={16} /> Quick actions
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link to={`/contacts?accountId=${account.id}`}>
              <Button variant="outline" size="sm">
                Contacts
              </Button>
            </Link>
            <Link to={`/deals?accountId=${account.id}`}>
              <Button variant="outline" size="sm">
                Deals
              </Button>
            </Link>
            <Link to={`/activities?accountId=${account.id}`}>
              <Button variant="outline" size="sm">
                Log activity
              </Button>
            </Link>
            <Link to={`/tickets?accountId=${account.id}`}>
              <Button variant="outline" size="sm">
                Ticket
              </Button>
            </Link>
            <Link to={`/erp/invoices?accountId=${account.id}&open=1`}>
              <Button size="sm">Create invoice</Button>
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Contacts ({contacts.length})</div>
          <ul className="divide-y divide-border">
            {contacts.map((c) => (
              <li key={String(c.id)} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link className="font-medium text-accent-blue hover:underline" to={`/contacts/${c.id}`}>
                  {String(c.name)}
                </Link>
                <span className="text-text-secondary">{String(c.phone || c.email || '—')}</span>
              </li>
            ))}
            {!contacts.length && <li className="p-6 text-center text-sm text-text-secondary">No contacts</li>}
          </ul>
        </Card>

        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Deals ({deals.length})</div>
          <ul className="divide-y divide-border">
            {deals.map((d) => (
              <li key={String(d.id)} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link className="font-medium text-accent-blue hover:underline" to={`/deals/${d.id}`}>
                  {String(d.name)}
                </Link>
                <span className="font-semibold">{formatCurrency(num(d.amount))}</span>
              </li>
            ))}
            {!deals.length && <li className="p-6 text-center text-sm text-text-secondary">No deals</li>}
          </ul>
        </Card>

        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Invoices ({invoices.length})</div>
          <ul className="divide-y divide-border">
            {invoices.map((inv) => (
              <li key={String(inv.id)} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{String(inv.invoiceNumber)}</div>
                  <div className="text-xs text-text-secondary">
                    {inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : ''} · {String(inv.status ?? '')}
                  </div>
                </div>
                <span className="font-semibold">{formatCurrency(num(inv.grandTotal))}</span>
              </li>
            ))}
            {!invoices.length && <li className="p-6 text-center text-sm text-text-secondary">No invoices</li>}
          </ul>
        </Card>

        <Card padding={false}>
          <div className="border-b border-border px-4 py-3 font-semibold">Tickets ({tickets.length})</div>
          <ul className="divide-y divide-border">
            {tickets.map((t) => (
              <li key={String(t.id)} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link className="font-medium text-accent-blue hover:underline" to={`/tickets/${t.id}`}>
                  {String(t.subject)}
                </Link>
                <Badge color={ticketStatusColor[String(t.status)] ?? 'gray'}>{String(t.status)}</Badge>
              </li>
            ))}
            {!tickets.length && <li className="p-6 text-center text-sm text-text-secondary">No tickets</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}
