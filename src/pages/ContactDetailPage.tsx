import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CircleDollarSign,
  Edit3,
  Mail,
  MapPin,
  Package,
  Phone,
  ShoppingBag,
  TicketCheck,
  UserRound,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type Tab = 'Overview' | 'Purchases' | 'Deals' | 'Tickets' | 'Notes'

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    title: '',
    department: '',
    city: '',
    state: '',
    accountId: '',
    description: '',
  })

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups] = await Promise.all([api.getContact(id), api.lookups()])
      setContact(row)
      setAccounts(lookups.accounts)
      setForm({
        name: String(row.name ?? ''),
        email: String(row.email ?? ''),
        phone: String(row.phone ?? ''),
        mobile: String(row.mobile ?? ''),
        title: String(row.title ?? ''),
        department: String(row.department ?? ''),
        city: String(row.city ?? ''),
        state: String(row.state ?? ''),
        accountId: String(row.accountId ?? ''),
        description: String(row.description ?? ''),
      })
    } catch {
      setContact(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function saveEdit() {
    if (!id) return
    try {
      const updated = await api.updateContact(id, {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        title: form.title || null,
        department: form.department || null,
        city: form.city || null,
        state: form.state || null,
        accountId: form.accountId || null,
        description: form.description || null,
      })
      setContact(updated)
      setEditOpen(false)
      addToast({ type: 'success', message: 'Contact updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    }
  }

  if (loading) {
    return <Card className="p-8 text-sm text-text-secondary">Loading contact…</Card>
  }

  if (!contact) {
    return (
      <Card>
        <EmptyState
          icon={<UserRound size={26} />}
          title="Contact not found"
          subtitle="This contact may have been removed or the link is incorrect."
          actionLabel="Back to contacts"
          onAction={() => navigate('/contacts')}
        />
      </Card>
    )
  }

  const account = contact.account as Record<string, unknown> | null | undefined
  const deals = (contact.deals as Array<Record<string, unknown>>) ?? []
  const tickets = (contact.tickets as Array<Record<string, unknown>>) ?? []
  const notes = (contact.notes as Array<Record<string, unknown>>) ?? []
  const invoices = (contact.invoices as Array<Record<string, unknown>>) ?? []
  const purchaseSummary = (contact.purchaseSummary as {
    invoiceCount: number
    totalBilled: number
    totalPaid: number
    productsBought: Array<{ id: string; sku: string; name: string; qty: number; amount: number; imageUrl?: string | null }>
  }) ?? { invoiceCount: 0, totalBilled: 0, totalPaid: 0, productsBought: [] }
  const custom = (contact.customFields as Record<string, unknown> | null) ?? {}

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => navigate('/contacts')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Edit3 size={16} /> Edit
        </Button>
      </div>

      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={String(contact.name)} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text-primary">{String(contact.name)}</h1>
            <p className="text-sm text-text-secondary">
              {[contact.title, contact.department].filter(Boolean).join(' · ') || 'No title set'}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {contact.phone || contact.mobile ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={14} /> {formatPhone(String(contact.phone || contact.mobile))}
                </span>
              ) : null}
              {contact.email ? (
                <span className="inline-flex items-center gap-1.5">
                  <Mail size={14} /> {String(contact.email)}
                </span>
              ) : null}
              {contact.city || contact.state ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} /> {[contact.city, contact.state].filter(Boolean).join(', ')}
                </span>
              ) : null}
              {account ? (
                <Link
                  to={`/accounts/${account.id}`}
                  className="inline-flex items-center gap-1.5 text-accent-blue hover:underline"
                >
                  <Building2 size={14} /> {String(account.name)}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div className="rounded-[10px] bg-emerald-50 px-4 py-3 text-accent-green">
              <ShoppingBag size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{purchaseSummary.invoiceCount}</div>
              <div className="text-xs opacity-80">Invoices</div>
            </div>
            <div className="rounded-[10px] bg-blue-50 px-4 py-3 text-accent-blue">
              <CircleDollarSign size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{formatCurrency(purchaseSummary.totalBilled)}</div>
              <div className="text-xs opacity-80">Total spend</div>
            </div>
            <div className="rounded-[10px] bg-violet-50 px-4 py-3 text-accent-purple">
              <Briefcase size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{deals.length}</div>
              <div className="text-xs opacity-80">Deals</div>
            </div>
            <div className="rounded-[10px] bg-amber-50 px-4 py-3 text-accent-amber">
              <TicketCheck size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{tickets.length}</div>
              <div className="text-xs opacity-80">Tickets</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['Overview', 'Purchases', 'Deals', 'Tickets', 'Notes'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-accent-blue text-white' : 'bg-muted text-text-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <ContactAnalytics
          contact={contact}
          custom={custom}
          deals={deals}
          tickets={tickets}
          invoices={invoices}
          productsBought={purchaseSummary.productsBought}
          totalPaid={purchaseSummary.totalPaid}
          totalBilled={purchaseSummary.totalBilled}
        />
      )}

      {tab === 'Purchases' && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">Products bought</h2>
            {purchaseSummary.productsBought.length === 0 ? (
              <EmptyState icon={<CircleDollarSign size={22} />} title="No purchases yet" subtitle="Invoices for this contact or their company will show here." />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Product', 'SKU', 'Qty', 'Amount'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {purchaseSummary.productsBought.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                      <td className="px-3 py-2">{p.qty}</td>
                      <td className="px-3 py-2">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card padding={false}>
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Invoice history</div>
            {invoices.length === 0 ? (
              <EmptyState title="No invoices" subtitle="Create an invoice from ERP → Invoices for this customer." />
            ) : (
              <div className="divide-y divide-border">
                {invoices.map((inv) => (
                  <div key={String(inv.id)} className="px-4 py-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono text-sm font-semibold">{String(inv.invoiceNumber)}</div>
                        <div className="text-xs text-text-secondary">
                          {inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : '—'} · {String(inv.status)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{formatCurrency(num(inv.grandTotal))}</div>
                        <div className="text-xs text-text-secondary">
                          Balance {formatCurrency(num(inv.balanceDue))}
                        </div>
                      </div>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="text-text-secondary">
                        <tr>
                          <th className="py-1 font-medium">Item</th>
                          <th className="py-1 font-medium">Qty</th>
                          <th className="py-1 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {((inv.lines as Array<Record<string, unknown>>) ?? []).map((l) => (
                          <tr key={String(l.id)} className="border-t border-border/60">
                            <td className="py-1.5">{String(l.description)}</td>
                            <td className="py-1.5">{num(l.quantity)}</td>
                            <td className="py-1.5">{formatCurrency(num(l.lineTotal))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'Deals' && (
        <Card padding={false}>
          {deals.length === 0 ? (
            <EmptyState icon={<CircleDollarSign size={22} />} title="No deals" subtitle="Convert a lead or create a deal linked to this contact." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['Deal', 'Amount', 'Probability', 'Created'].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={String(d.id)} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">
                      <Link className="text-accent-blue hover:underline" to={`/deals/${d.id}`}>
                        {String(d.name)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{formatCurrency(num(d.amount))}</td>
                    <td className="px-4 py-3">{num(d.probability)}%</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {d.createdAt ? formatDate(String(d.createdAt)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'Tickets' && (
        <Card padding={false}>
          {tickets.length === 0 ? (
            <EmptyState icon={<TicketCheck size={22} />} title="No tickets" subtitle="Support history for this customer will appear here." />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['#', 'Subject', 'Priority', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={String(t.id)} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link className="text-accent-blue hover:underline" to={`/tickets/${t.id}`}>
                        #{String(t.ticketNo)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{String(t.subject)}</td>
                    <td className="px-4 py-3">
                      <Badge color="amber">{String(t.priority)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color="blue">{String(t.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'Notes' && (
        <Card>
          {notes.length === 0 ? (
            <p className="text-sm text-text-secondary">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={String(n.id)} className="rounded-lg border border-border p-3 text-sm">
                  <p>{String(n.content)}</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {n.createdAt ? formatDate(String(n.createdAt)) : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit contact"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()}>Save changes</Button>
          </>
        }
      >
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <Input label="Name" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Title" placeholder="e.g. Purchase Manager" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Department" placeholder="e.g. Procurement" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          <Select
            label="Account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'Select account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <Input label="Email" placeholder="name@company.in" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" placeholder="+91 98400 10001" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Mobile" placeholder="+91 98400 10002" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Input label="City" placeholder="Chennai" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" placeholder="Tamil Nadu" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder="Relationship notes, preferences…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}

const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4']

function ContactAnalytics({
  contact,
  custom,
  deals,
  tickets,
  invoices,
  productsBought,
  totalPaid,
  totalBilled,
}: {
  contact: Record<string, unknown>
  custom: Record<string, unknown>
  deals: Array<Record<string, unknown>>
  tickets: Array<Record<string, unknown>>
  invoices: Array<Record<string, unknown>>
  productsBought: Array<{ id: string; sku: string; name: string; qty: number; amount: number }>
  totalPaid: number
  totalBilled: number
}) {
  const spendOverTime = useMemo(() => {
    const map: Record<string, number> = {}
    for (const inv of invoices) {
      const d = inv.invoiceDate ? new Date(String(inv.invoiceDate)) : null
      if (!d || Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map[key] = (map[key] ?? 0) + num(inv.grandTotal)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, spend]) => ({ month, spend }))
  }, [invoices])

  const dealMix = useMemo(() => {
    const open = deals.filter((d) => !d.closedAt).length
    const won = deals.filter((d) => d.closedAt && num(d.probability) >= 100).length
    const closed = deals.filter((d) => d.closedAt).length
    const lost = Math.max(0, closed - won)
    return [
      { name: 'Open', value: open || 0 },
      { name: 'Won', value: won || 0 },
      { name: 'Lost/Other', value: lost || 0 },
    ].filter((x) => x.value > 0)
  }, [deals])

  const productBars = useMemo(
    () =>
      productsBought.slice(0, 6).map((p) => ({
        name: p.name.length > 18 ? `${p.name.slice(0, 16)}…` : p.name,
        qty: p.qty,
        amount: p.amount,
      })),
    [productsBought],
  )

  const ticketStatus = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of tickets) {
      const s = String(t.status ?? 'OPEN')
      map[s] = (map[s] ?? 0) + 1
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [tickets])

  const openPipeline = deals.filter((d) => !d.closedAt).reduce((s, d) => s + num(d.amount), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Lifetime billed', value: formatCurrency(totalBilled), icon: CircleDollarSign, tint: 'bg-blue-50 text-accent-blue' },
          { label: 'Amount paid', value: formatCurrency(totalPaid), icon: ShoppingBag, tint: 'bg-emerald-50 text-accent-green' },
          { label: 'Open pipeline', value: formatCurrency(openPipeline), icon: Briefcase, tint: 'bg-violet-50 text-accent-purple' },
          { label: 'Products bought', value: productsBought.length, icon: Package, tint: 'bg-amber-50 text-accent-amber' },
        ].map((k) => (
          <Card key={k.label}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${k.tint}`}>
                <k.icon size={18} />
              </div>
              <div>
                <div className="text-lg font-semibold">{k.value}</div>
                <div className="text-xs text-text-secondary">{k.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Spend over time</h3>
          {spendOverTime.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spendOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrency(num(v))} />
                  <Line type="monotone" dataKey="spend" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No invoice spend yet</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Deal mix</h3>
          {dealMix.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dealMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {dealMix.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No deals linked</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Purchases by product</h3>
          {productBars.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="qty" fill="#10B981" name="Qty" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No products purchased</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Ticket status</h3>
          {ticketStatus.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ticketStatus} dataKey="value" nameKey="name" outerRadius={75}>
                    {ticketStatus.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No support tickets</p>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Profile</h3>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Full name', contact.name],
            ['Title', contact.title],
            ['Department', contact.department],
            ['Email', contact.email],
            ['Alternate email', custom.alternate_email],
            ['Phone', contact.phone],
            ['Mobile', contact.mobile],
            ['WhatsApp', custom.whatsapp],
            ['LinkedIn', custom.linkedin],
            ['Address', custom.address_line],
            ['City', contact.city],
            ['State', contact.state],
            ['Pincode', custom.pincode],
            ['Country', contact.country],
            ['Created', contact.createdAt ? formatDate(String(contact.createdAt)) : '—'],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-text-secondary">{String(label)}</dt>
              <dd className="text-sm font-medium text-text-primary">{String(value ?? '—')}</dd>
            </div>
          ))}
        </dl>
        {contact.description ? (
          <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-text-primary">{String(contact.description)}</p>
        ) : null}
      </Card>
    </div>
  )
}
