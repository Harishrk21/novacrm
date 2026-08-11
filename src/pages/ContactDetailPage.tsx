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
  TicketPlus,
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
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type Tab = 'Overview' | 'Machines' | 'Purchases' | 'Deals' | 'Tickets' | 'Notes'

const MACHINE_TYPES = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing machine' },
  { value: 'CCM', label: 'CCM' },
  { value: 'CCTV', label: 'CCTV' },
  { value: 'BIOMETRIC', label: 'Biometric' },
  { value: 'PAPER_SHREDDER', label: 'Paper shredder' },
  { value: 'PAPER_ROLL', label: 'Paper roll' },
  { value: 'OTHER', label: 'Other' },
]

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [savingMachine, setSavingMachine] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    title: '',
    department: '',
    street: '',
    doorNo: '',
    area: '',
    pincode: '',
    location: '',
    city: '',
    state: '',
    accountId: '',
    description: '',
  })
  const [machineForm, setMachineForm] = useState({
    machineType: 'WEIGHING',
    name: '',
    capacity: '',
    accuracy: '',
    platformSize: '',
    model: '',
    serialNo: '',
    servicePlan: 'NON_AMC',
    amcEndDate: '',
    remindersEnabled: true,
    stampingDate: '',
    nextDueDate: '',
    notes: '',
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
        street: String(row.street ?? ''),
        doorNo: String(row.doorNo ?? ''),
        area: String(row.area ?? ''),
        pincode: String(row.pincode ?? ''),
        location: String(row.location ?? ''),
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
        street: form.street || null,
        doorNo: form.doorNo || null,
        area: form.area || null,
        pincode: form.pincode || null,
        location: form.location || null,
        city: form.city || null,
        state: form.state || null,
        accountId: form.accountId || null,
        description: form.description || null,
      })
      setContact(updated)
      setEditOpen(false)
      addToast({ type: 'success', message: 'Customer updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    }
  }

  async function saveMachine() {
    if (!id || !machineForm.name.trim()) {
      addToast({ type: 'error', message: 'Machine name is required' })
      return
    }
    setSavingMachine(true)
    try {
      await api.createAsset({
        contactId: id,
        machineType: machineForm.machineType,
        name: machineForm.name.trim(),
        capacity: machineForm.capacity || null,
        accuracy: machineForm.accuracy || null,
        platformSize: machineForm.platformSize || null,
        model: machineForm.model || null,
        serialNo: machineForm.serialNo || null,
        servicePlan: machineForm.servicePlan,
        amcEndDate: machineForm.servicePlan === 'AMC' ? machineForm.amcEndDate || null : null,
        remindersEnabled: machineForm.remindersEnabled,
        stampingDate: machineForm.stampingDate || null,
        nextDueDate: machineForm.nextDueDate || null,
        notes: machineForm.notes || null,
      })
      setMachineOpen(false)
      setMachineForm({
        machineType: 'WEIGHING',
        name: '',
        capacity: '',
        accuracy: '',
        platformSize: '',
        model: '',
        serialNo: '',
        servicePlan: 'NON_AMC',
        amcEndDate: '',
        remindersEnabled: true,
        stampingDate: '',
        nextDueDate: '',
        notes: '',
      })
      addToast({ type: 'success', message: 'Machine saved' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save machine',
      })
    } finally {
      setSavingMachine(false)
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
        <Button
          onClick={() =>
            navigate(
              `/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1${
                contact.accountId ? `&accountId=${encodeURIComponent(String(contact.accountId))}` : ''
              }`,
            )
          }
        >
          <TicketPlus size={16} /> New service ticket
        </Button>
        <Button variant="outline" onClick={() => setEditOpen((v) => !v)}>
          <Edit3 size={16} /> {editOpen ? 'Close form' : 'Edit'}
        </Button>
      </div>

      <FormPanel
        open={editOpen}
        accent="theme"
        eyebrow="Customers"
        title="Edit customer"
        subtitle="Shop details — street, door, area, pin, phone, location."
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setEditOpen(false)} />
            <Button type="submit" form="edit-contact-form">
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-contact-form"
          onSubmit={(e) => {
            e.preventDefault()
            void saveEdit()
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Input label="Company / shop name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Input label="Street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
          <Input label="Door number" value={form.doorNo} onChange={(e) => setForm({ ...form, doorNo: e.target.value })} />
          <Input label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          <Input label="Pin code" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
          <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="lg:col-span-2" />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select
            label="Account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'Select account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>
      </FormPanel>

      <FormPanel
        open={machineOpen}
        accent="theme"
        eyebrow="Machines"
        title="Add machine"
        subtitle="Weighing / billing / CCTV etc. Set AMC here — reminders use next due + AMC end."
        onClose={() => setMachineOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setMachineOpen(false)} />
            <Button disabled={savingMachine} onClick={() => void saveMachine()}>
              {savingMachine ? 'Saving…' : 'Save machine'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Machine type"
            value={machineForm.machineType}
            onChange={(e) => setMachineForm({ ...machineForm, machineType: e.target.value })}
            options={MACHINE_TYPES}
          />
          <Input
            label="Machine name *"
            placeholder="WEIGHING SCALE 20KG"
            value={machineForm.name}
            onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
            className="lg:col-span-2"
          />
          <Input label="Capacity" placeholder="20KG / CAP" value={machineForm.capacity} onChange={(e) => setMachineForm({ ...machineForm, capacity: e.target.value })} />
          <Input label="Accuracy" placeholder="ACC" value={machineForm.accuracy} onChange={(e) => setMachineForm({ ...machineForm, accuracy: e.target.value })} />
          <Input label="Platform size" value={machineForm.platformSize} onChange={(e) => setMachineForm({ ...machineForm, platformSize: e.target.value })} />
          <Input label="Model" value={machineForm.model} onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })} />
          <Input label="Serial number" value={machineForm.serialNo} onChange={(e) => setMachineForm({ ...machineForm, serialNo: e.target.value })} />
          <Select
            label="Service plan"
            value={machineForm.servicePlan}
            onChange={(e) => setMachineForm({ ...machineForm, servicePlan: e.target.value })}
            options={[
              { value: 'NON_AMC', label: 'Non-AMC' },
              { value: 'AMC', label: 'AMC' },
            ]}
          />
          {machineForm.servicePlan === 'AMC' ? (
            <Input
              label="AMC end date"
              type="date"
              value={machineForm.amcEndDate}
              onChange={(e) => setMachineForm({ ...machineForm, amcEndDate: e.target.value })}
            />
          ) : null}
          <Input label="Stamping date" type="date" value={machineForm.stampingDate} onChange={(e) => setMachineForm({ ...machineForm, stampingDate: e.target.value })} />
          <Input label="Next due date" type="date" value={machineForm.nextDueDate} onChange={(e) => setMachineForm({ ...machineForm, nextDueDate: e.target.value })} />
          <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2 lg:col-span-3">
            <input
              type="checkbox"
              checked={machineForm.remindersEnabled}
              onChange={(e) => setMachineForm({ ...machineForm, remindersEnabled: e.target.checked })}
            />
            Auto WhatsApp reminders (~1 week before maintenance due and AMC end)
          </label>
          <Input label="Notes" value={machineForm.notes} onChange={(e) => setMachineForm({ ...machineForm, notes: e.target.value })} className="sm:col-span-2 lg:col-span-3" />
        </div>
      </FormPanel>

      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={String(contact.name)} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text-primary">{String(contact.name)}</h1>
            <p className="mt-1 font-mono text-sm font-semibold text-accent-blue">
              {contact.customerCode ? String(contact.customerCode) : 'Customer ID pending'}
            </p>
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
        {(['Overview', 'Machines', 'Purchases', 'Deals', 'Tickets', 'Notes'] as Tab[]).map((t) => (
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

      {tab === 'Machines' && (
        <Card padding={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="text-sm font-semibold">Machines / equipment</div>
            <Button size="sm" onClick={() => setMachineOpen(true)}>
              Add machine
            </Button>
          </div>
          {((contact.assets as Array<Record<string, unknown>>) ?? []).length === 0 ? (
            <EmptyState
              icon={<Package size={22} />}
              title="No machines yet"
              subtitle="Add weighing scales, billing machines, CCTV, etc. for this customer."
              actionLabel="Add machine"
              onAction={() => setMachineOpen(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Machine', 'Type', 'Plan', 'Serial / Cap', 'Stamping', 'Next due', 'AMC end', ''].map((h) => (
                      <th key={h || 'a'} className="px-4 py-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {((contact.assets as Array<Record<string, unknown>>) ?? []).map((a) => (
                    <tr key={String(a.id)} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{String(a.name)}</td>
                      <td className="px-4 py-3">
                        <Badge color="blue">{String(a.machineType).replaceAll('_', ' ')}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={a.servicePlan === 'AMC' ? 'green' : 'gray'}>
                          {a.servicePlan === 'AMC' ? 'AMC' : 'Non-AMC'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {[a.serialNo, a.capacity].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {a.stampingDate ? formatDate(String(a.stampingDate)) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {a.nextDueDate ? formatDate(String(a.nextDueDate)) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&open=1`,
                            )
                          }
                        >
                          New job
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="font-semibold">Service history</div>
            <Button
              size="sm"
              onClick={() =>
                navigate(`/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1`)
              }
            >
              <TicketPlus size={14} /> New ticket
            </Button>
          </div>
          {tickets.length === 0 ? (
            <EmptyState
              icon={<TicketCheck size={22} />}
              title="No service tickets yet"
              subtitle="Open a ticket after reviewing purchases — assign an agent and SLA."
              actionLabel="New service ticket"
              onAction={() =>
                navigate(`/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1`)
              }
            />
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
                      <Badge color={ticketStatusColor[String(t.status)] ?? 'gray'}>{String(t.status)}</Badge>
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
