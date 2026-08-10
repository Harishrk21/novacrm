import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, Check, Clock, Mail, Pencil, Phone, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, activityStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import type { ActivityType } from '@/types'

const typeIcons: Record<string, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  TASK: Check,
  NOTE: Check,
  WHATSAPP: Phone,
  VISIT: Users,
  DEMO: CalendarDays,
}
const typeStyles: Record<string, string> = {
  CALL: 'bg-blue-50 text-accent-blue',
  EMAIL: 'bg-violet-50 text-accent-purple',
  MEETING: 'bg-emerald-50 text-accent-green',
  TASK: 'bg-amber-50 text-accent-amber',
}
const labelize = (value: string) =>
  value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

type LookupUser = { id: string; name: string; email?: string }
type LookupContact = { id: string; name: string }
type LookupDeal = { id: string; name: string }

type ActivityRow = {
  id: string
  type: string
  title: string
  description?: string | null
  status: string
  scheduledAt?: string | null
  createdAt: string
  durationMinutes?: number | null
  assignedToId?: string | null
  contactId?: string | null
  dealId?: string | null
  assignee?: LookupUser | null
  contact?: LookupContact | null
  deal?: LookupDeal | null
}

export function ActivitiesPage() {
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isAgent = authUser?.role === 'AGENT'
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [date, setDate] = useState('')
  const [assigned, setAssigned] = useState(isAgent && authUser?.id ? authUser.id : '')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [users, setUsers] = useState<LookupUser[]>([])
  const [contacts, setContacts] = useState<LookupContact[]>([])
  const [deals, setDeals] = useState<LookupDeal[]>([])

  const load = useCallback(async () => {
    if (!isTenantSession()) {
      setLoading(false)
      setActivities([])
      return
    }
    setLoading(true)
    try {
      const [lookups, page] = await Promise.all([
        api.lookups(),
        api.activities({
          limit: 200,
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
          ...(assigned ? { assignedToId: assigned } : isAgent ? { mine: 1 } : {}),
        }),
      ])
      setUsers(lookups.users ?? [])
      setContacts(lookups.contacts ?? [])
      setDeals(
        (await api.deals({ limit: 200 })).items.map((d) => ({
          id: String(d.id),
          name: String(d.name ?? 'Deal'),
        })),
      )
      setActivities(
        page.items.map((raw) => {
          const r = raw as ActivityRow & Record<string, unknown>
          return {
            id: String(r.id),
            type: String(r.type),
            title: String(r.title),
            description: (r.description as string) ?? null,
            status: String(r.status),
            scheduledAt: (r.scheduledAt as string) ?? null,
            createdAt: String(r.createdAt),
            durationMinutes: r.durationMinutes != null ? num(r.durationMinutes) : null,
            assignedToId: (r.assignedToId as string) ?? null,
            contactId: (r.contactId as string) ?? null,
            dealId: (r.dealId as string) ?? null,
            assignee: (r.assignee as LookupUser) ?? null,
            contact: (r.contact as LookupContact) ?? null,
            deal: (r.deal as LookupDeal) ?? null,
          }
        }),
      )
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load activities',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, assigned, isAgent, status, type])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!date) return activities
    const now = new Date()
    return activities.filter((item) => {
      const when = item.scheduledAt ? new Date(item.scheduledAt) : new Date(item.createdAt)
      const elapsed = now.getTime() - when.getTime()
      if (date === 'TODAY') return when.toDateString() === now.toDateString()
      if (date === 'WEEK') return elapsed <= 7 * 86400000 && elapsed >= -7 * 86400000
      return elapsed <= 31 * 86400000 && elapsed >= -31 * 86400000
    })
  }, [activities, date])

  const complete = async (id: string) => {
    try {
      await api.completeActivity(id)
      addToast({ type: 'success', message: 'Activity marked complete' })
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not complete activity',
      })
    }
  }

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const linkType = String(form.get('linkType') ?? 'CONTACT')
    const linkedId = String(form.get('linkedId') ?? '') || undefined
    const scheduledRaw = String(form.get('scheduledAt') ?? '')
    try {
      await api.createActivity({
        type: String(form.get('type') ?? 'TASK'),
        title: String(form.get('title') ?? ''),
        description: String(form.get('description') ?? '') || null,
        status: 'PENDING',
        scheduledAt: scheduledRaw ? new Date(scheduledRaw).toISOString() : null,
        durationMinutes: Number(form.get('duration')) || null,
        assignedToId: String(form.get('assignedToId') ?? '') || authUser?.id || null,
        contactId: linkType === 'CONTACT' ? linkedId ?? null : null,
        dealId: linkType === 'DEAL' ? linkedId ?? null : null,
      })
      setModalOpen(false)
      addToast({ type: 'success', message: 'Activity created' })
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not create activity',
      })
    }
  }

  const remove = async () => {
    if (!deleteId) return
    try {
      await api.deleteActivity(deleteId)
      setDeleteId(undefined)
      addToast({ type: 'success', message: 'Activity deleted' })
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not delete activity',
      })
    }
  }

  return (
    <div>
      <PageHeader
        title="Activities"
        count={filtered.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Activities' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
            <Button onClick={() => setModalOpen(true)}>
              <Plus size={16} /> Create Activity
            </Button>
          </div>
        }
      />
      <PageTip moduleKey="crm.activities" />
      <Card className="mb-4 grid gap-3 md:grid-cols-4">
        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: '', label: 'All types' },
            ...['CALL', 'EMAIL', 'MEETING', 'TASK'].map((v) => ({ value: v, label: labelize(v) })),
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            ...['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE'].map((v) => ({
              value: v,
              label: labelize(v),
            })),
          ]}
        />
        <Select
          label="Date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          options={[
            { value: '', label: 'Any date' },
            { value: 'TODAY', label: 'Today' },
            { value: 'WEEK', label: 'This Week' },
            { value: 'MONTH', label: 'This Month' },
          ]}
        />
        <Select
          label="Assigned To"
          value={assigned}
          onChange={(e) => setAssigned(e.target.value)}
          disabled={isAgent}
          options={[
            { value: '', label: isAgent ? 'My activities' : 'Everyone' },
            ...users.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </Card>
      <Card padding={false}>
        <div className="divide-y divide-border">
          {filtered.map((activity) => {
            const Icon = typeIcons[activity.type] ?? CalendarDays
            const agent = activity.assignee ?? users.find((u) => u.id === activity.assignedToId)
            const contact =
              activity.contact ?? contacts.find((c) => c.id === activity.contactId)
            const deal = activity.deal ?? deals.find((d) => d.id === activity.dealId)
            return (
              <div
                key={activity.id}
                className="flex flex-col gap-4 p-4 hover:bg-surface lg:flex-row lg:items-center"
              >
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]',
                    typeStyles[activity.type] ?? 'bg-slate-100 text-text-secondary',
                  )}
                >
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-text-primary">{activity.title}</h2>
                    <Badge color={activityStatusColor[activity.status] ?? 'slate'}>
                      {labelize(activity.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    {contact?.name ?? 'No contact'}
                    {deal ? ` · ${deal.name}` : ''}
                  </p>
                </div>
                <div className="flex min-w-36 items-center gap-2 text-sm">
                  {agent && <Avatar name={agent.name} size="sm" />}
                  <span>{agent?.name ?? 'Unassigned'}</span>
                </div>
                <div className="min-w-44 text-sm text-text-secondary">
                  <p>{formatDateTime(activity.scheduledAt ?? activity.createdAt)}</p>
                  {activity.durationMinutes != null && activity.durationMinutes > 0 && (
                    <p className="mt-1 flex items-center gap-1">
                      <Clock size={13} />
                      {activity.durationMinutes} min
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {activity.status !== 'COMPLETED' && (
                    <Button variant="ghost" size="sm" onClick={() => void complete(activity.id)}>
                      <Check size={15} /> Complete
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addToast({ type: 'info', message: `Editing ${activity.title}` })}
                    aria-label="Edit activity"
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-accent-red"
                    onClick={() => setDeleteId(activity.id)}
                    aria-label="Delete activity"
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            )
          })}
          {loading && <p className="p-12 text-center text-text-secondary">Loading activities…</p>}
          {!loading && !filtered.length && (
            <p className="p-12 text-center text-text-secondary">No activities match these filters.</p>
          )}
        </div>
      </Card>
      <ActivityModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={create}
        contacts={contacts}
        deals={deals}
        users={users}
        defaultAssigneeId={authUser?.id}
      />
      <ConfirmModal
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(undefined)}
        onConfirm={() => void remove()}
        title="Delete activity?"
        body="This activity will be permanently removed."
      />
    </div>
  )
}

function ActivityModal({
  open,
  onClose,
  onCreate,
  contacts,
  deals,
  users,
  defaultAssigneeId,
}: {
  open: boolean
  onClose: () => void
  onCreate: (event: FormEvent<HTMLFormElement>) => void
  contacts: LookupContact[]
  deals: LookupDeal[]
  users: LookupUser[]
  defaultAssigneeId?: string
}) {
  const [linkType, setLinkType] = useState('CONTACT')
  const linkOptions =
    linkType === 'CONTACT'
      ? contacts.map((item) => ({ value: item.id, label: item.name }))
      : deals.map((item) => ({ value: item.id, label: item.name }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Activity"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-activity-form">
            Create Activity
          </Button>
        </>
      }
    >
      <form id="create-activity-form" onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Type"
          name="type"
          defaultValue="TASK"
          options={(['CALL', 'EMAIL', 'MEETING', 'TASK'] as ActivityType[]).map((v) => ({
            value: v,
            label: labelize(v),
          }))}
        />
        <Input label="Title" name="title" placeholder="Activity title" required />
        <Select
          label="Link to"
          name="linkType"
          value={linkType}
          onChange={(e) => setLinkType(e.target.value)}
          options={[
            { value: 'CONTACT', label: 'Contact' },
            { value: 'DEAL', label: 'Deal' },
          ]}
        />
        <Select
          label={linkType === 'CONTACT' ? 'Contact' : 'Deal'}
          name="linkedId"
          options={[
            {
              value: '',
              label: linkOptions.length ? `Select ${linkType === 'CONTACT' ? 'contact' : 'deal'}` : 'No records in database',
            },
            ...linkOptions,
          ]}
        />
        <Input label="Date & time" name="scheduledAt" type="datetime-local" />
        <Input label="Duration (minutes)" name="duration" type="number" min="0" />
        <Select
          label="Assigned to"
          name="assignedToId"
          defaultValue={defaultAssigneeId ?? users[0]?.id ?? ''}
          options={[
            { value: '', label: users.length ? 'Select assignee' : 'No users in database' },
            ...users.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <label className="flex items-end gap-2 pb-2 text-sm font-medium text-text-secondary">
          <input type="checkbox" className="h-4 w-4 accent-accent-blue" />
          Send reminder
        </label>
        <label className="sm:col-span-2 text-sm font-medium text-text-secondary">
          Description
          <textarea
            name="description"
            className="mt-1 min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
      </form>
    </Modal>
  )
}

export default ActivitiesPage
