import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { formatDate, timeAgo } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export function TicketsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isAgent = authUser?.role === 'AGENT'
  const tip = DEFAULT_TIPS['crm.tickets'] ?? {
    title: 'Support tickets',
    body: 'Log every customer issue with category, channel, product and SLA.',
    tipType: 'TIP' as const,
  }

  const [tickets, setTickets] = useState<Record<string, unknown>[]>([])
  const [contacts, setContacts] = useState<Array<{ id: string; name: string }>>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    subject: '',
    description: '',
    priority: 'MEDIUM',
    contactId: '',
    accountId: '',
    productId: '',
    assignedToId: '',
    category: 'General',
    channel: 'Phone',
    slaHours: '24',
  })

  const load = useCallback(async () => {
    try {
      const [res, lookups] = await Promise.all([
        api.tickets({
          limit: 100,
          status: status || undefined,
          priority: priority || undefined,
          ...(isAgent && authUser?.id ? { assignedToId: authUser.id } : {}),
        }),
        api.lookups(),
      ])
      setTickets(res.items ?? [])
      setContacts(lookups.contacts)
      setAccounts(lookups.accounts)
      setProducts(lookups.products.map((p) => ({ id: p.id, name: p.name })))
      setUsers(lookups.users)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Failed to load tickets' })
    }
  }, [addToast, authUser?.id, isAgent, priority, status])

  useEffect(() => {
    void load()
  }, [load])

  const contactName = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c.name])),
    [contacts],
  )
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users])

  async function createTicket(e: FormEvent) {
    e.preventDefault()
    try {
      await api.createTicket({
        subject: form.subject,
        description: form.description,
        priority: form.priority,
        contactId: form.contactId || null,
        accountId: form.accountId || null,
        productId: form.productId || null,
        assignedToId: form.assignedToId || null,
        category: form.category,
        channel: form.channel,
        slaHours: Number(form.slaHours) || 24,
      })
      setOpen(false)
      addToast({ type: 'success', message: 'Ticket created' })
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    }
  }

  return (
    <div>
      <PageHeader
        title="Tickets"
        count={tickets.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Tickets' }]}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Add ticket
          </Button>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-44"
            options={[
              { value: '', label: 'All statuses' },
              ...['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'].map((v) => ({
                value: v,
                label: labelize(v),
              })),
            ]}
          />
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-44"
            options={[
              { value: '', label: 'All priorities' },
              ...['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) })),
            ]}
          />
        </div>
      </PageHeader>
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <Card padding={false}>
        {tickets.length === 0 ? (
          <EmptyState title="No tickets" subtitle="Log support requests with full context." actionLabel="Add ticket" onAction={() => setOpen(true)} />
        ) : (
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-surface text-xs text-text-secondary">
              <tr className="border-b border-border">
                {['Ticket', 'Subject', 'Contact', 'Category', 'Channel', 'Priority', 'Status', 'Agent', 'SLA', 'Updated'].map(
                  (h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => {
                const cf = (ticket.customFields as Record<string, unknown>) ?? {}
                return (
                  <tr key={String(ticket.id)} className="border-b border-border last:border-0 hover:bg-surface">
                    <td className="px-4 py-3 font-semibold">
                      <Link className="text-accent-blue hover:underline" to={`/tickets/${ticket.id}`}>
                        #{String(ticket.ticketNo)}
                      </Link>
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      <Link className="font-medium hover:text-accent-blue" to={`/tickets/${ticket.id}`}>
                        {String(ticket.subject)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{contactName[String(ticket.contactId)] ?? '—'}</td>
                    <td className="px-4 py-3">{String(cf.category ?? '—')}</td>
                    <td className="px-4 py-3">{String(cf.channel ?? '—')}</td>
                    <td className="px-4 py-3">
                      <Badge color="amber">{labelize(String(ticket.priority))}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color="blue">{labelize(String(ticket.status))}</Badge>
                    </td>
                    <td className="px-4 py-3">{userName[String(ticket.assignedToId)] ?? 'Unassigned'}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {ticket.slaDueAt ? formatDate(String(ticket.slaDueAt)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {ticket.updatedAt ? timeAgo(String(ticket.updatedAt)) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add ticket"
        subtitle="Support case with category, channel, product, SLA and assignment."
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-ticket-form">
              Create ticket
            </Button>
          </>
        }
      >
        <form id="add-ticket-form" onSubmit={createTicket} className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <Input
            className="sm:col-span-2"
            label="Subject *"
            placeholder="e.g. Platform scale display blank"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            required
          />
          <Select
            label="Contact"
            value={form.contactId}
            onChange={(e) => setForm({ ...form, contactId: e.target.value })}
            options={[{ value: '', label: 'Select contact' }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <Select
            label="Account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'Select account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <Select
            label="Related product"
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
            options={[{ value: '', label: 'Select product' }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            label="Assign to"
            value={form.assignedToId}
            onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
            options={[{ value: '', label: 'Select assignee' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Select
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: labelize(v) }))}
          />
          <Select
            label="Category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={['General', 'Installation', 'Breakdown', 'Warranty', 'Billing', 'Delivery', 'Training'].map(
              (v) => ({ value: v, label: v }),
            )}
          />
          <Select
            label="Channel"
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value })}
            options={['Phone', 'Email', 'WhatsApp', 'Walk-in', 'Portal'].map((v) => ({ value: v, label: v }))}
          />
          <Input
            label="SLA hours"
            type="number"
            value={form.slaHours}
            onChange={(e) => setForm({ ...form, slaHours: e.target.value })}
          />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-text-secondary">Description *</span>
            <textarea
              required
              className="mt-1 min-h-28 w-full rounded-[6px] border border-border bg-card p-3 text-text-primary outline-none focus:border-accent-blue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What happened? Serial no., error codes, site address…"
            />
          </label>
        </form>
      </Modal>
    </div>
  )
}

export default TicketsPage
