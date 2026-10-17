import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { activityHref } from '@/lib/recordLinks'
import { CalendarDays, Check, Clock, Mail, Pencil, Phone, Plus, RefreshCw, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, activityStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  SelectCheckbox,
} from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/Modal'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, isTenantSession, num } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import type { ActivityType } from '@/types'
import { TableSkeleton } from '@/components/ui/Skeleton'

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
  leadId?: string | null
  accountId?: string | null
  customFields?: Record<string, unknown> | null
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
  const [editing, setEditing] = useState<ActivityRow | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [busySave, setBusySave] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [users, setUsers] = useState<LookupUser[]>([])
  const [contacts, setContacts] = useState<LookupContact[]>([])
  const [deals, setDeals] = useState<LookupDeal[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const [returnContactId, setReturnContactId] = useState('')

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
            leadId: (r.leadId as string) ?? null,
            accountId: (r.accountId as string) ?? null,
            customFields: (r.customFields as Record<string, unknown>) ?? null,
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

  useEffect(() => {
    const open = searchParams.get('open') === '1'
    const contactId = searchParams.get('contactId') || ''
    if (!open && !contactId) return
    setModalOpen(true)
    if (contactId) setReturnContactId(contactId)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

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

  const ids = useMemo(() => filtered.map((a) => a.id), [filtered])
  const selection = useRowSelection(ids)

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

  const parseActivityForm = (form: FormData) => {
    const linkType = String(form.get('linkType') ?? 'CONTACT')
    const linkedId = String(form.get('linkedId') ?? '') || undefined
    const scheduledRaw = String(form.get('scheduledAt') ?? '')
    return {
      type: String(form.get('type') ?? 'TASK'),
      title: String(form.get('title') ?? '').trim(),
      description: String(form.get('description') ?? '') || null,
      status: String(form.get('status') ?? 'PENDING'),
      scheduledAt: scheduledRaw ? new Date(scheduledRaw).toISOString() : null,
      durationMinutes: Number(form.get('duration')) || null,
      assignedToId: String(form.get('assignedToId') ?? '') || authUser?.id || null,
      contactId: linkType === 'CONTACT' ? linkedId ?? null : null,
      dealId: linkType === 'DEAL' ? linkedId ?? null : null,
    }
  }

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = parseActivityForm(new FormData(event.currentTarget))
    if (!body.title) {
      addToast({ type: 'error', message: 'Title is required' })
      return
    }
    setBusySave(true)
    try {
      await api.createActivity({ ...body, status: 'PENDING' })
      setModalOpen(false)
      addToast({ type: 'success', message: 'Activity created' })
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not create activity',
      })
    } finally {
      setBusySave(false)
    }
  }

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const body = parseActivityForm(new FormData(event.currentTarget))
    if (!body.title) {
      addToast({ type: 'error', message: 'Title is required' })
      return
    }
    setBusySave(true)
    try {
      await api.updateActivity(editing.id, body)
      setEditing(null)
      addToast({ type: 'success', message: 'Activity updated' })
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not update activity',
      })
    } finally {
      setBusySave(false)
    }
  }

  const runDelete = async (deleteIds: string[]) => {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteActivity(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      selection.clear()
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not delete activity',
      })
    } finally {
      setBusyDelete(false)
      setConfirm(null)
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
            <Button
              variant={modalOpen || editing ? 'outline' : 'primary'}
              onClick={() => {
                setEditing(null)
                setModalOpen((v) => !v)
              }}
            >
              <Plus size={16} /> {modalOpen || editing ? 'Close form' : 'Create Activity'}
            </Button>
          </div>
        }
      />
      <PageTip moduleKey="crm.activities" />

      <ActivityFormPanel
        key={editing ? `edit-${editing.id}` : `create-${returnContactId || 'new'}`}
        open={modalOpen || Boolean(editing)}
        mode={editing ? 'edit' : 'create'}
        initial={editing}
        busy={busySave}
        onClose={() => {
          setModalOpen(false)
          setEditing(null)
          setReturnContactId('')
        }}
        onSubmit={editing ? saveEdit : create}
        contacts={contacts}
        deals={deals}
        users={users}
        defaultAssigneeId={authUser?.id}
        initialContactId={returnContactId}
      />

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
        {selection.someSelected ? (
          <div className="border-b border-border px-4 pt-3">
            <BulkActionBar
              count={selection.selectedCount}
              noun="activity"
              busy={busyDelete}
              onClear={selection.clear}
              onDelete={() => setConfirm({ ids: selection.selectedIds })}
            />
          </div>
        ) : null}
        <div className="divide-y divide-border">
          {filtered.length > 0 ? (
            <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2">
              <SelectCheckbox
                checked={selection.allSelected}
                indeterminate={selection.someSelected && !selection.allSelected}
                onChange={selection.toggleAll}
                aria-label="Select all"
              />
              <span className="text-xs font-medium text-text-secondary">Select all</span>
            </div>
          ) : null}
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
                <div className="flex items-center gap-3">
                  <SelectCheckbox
                    checked={selection.isSelected(activity.id)}
                    onChange={() => selection.toggle(activity.id)}
                    aria-label={`Select ${activity.title}`}
                  />
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]',
                      typeStyles[activity.type] ?? 'bg-slate-100 text-text-secondary',
                    )}
                  >
                    <Icon size={18} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const href = activityHref(activity as unknown as Record<string, unknown>)
                      return href ? (
                        <Link
                          to={href}
                          className="font-semibold text-accent-blue hover:underline"
                        >
                          {activity.title}
                        </Link>
                      ) : (
                        <h2 className="font-semibold text-text-primary">{activity.title}</h2>
                      )
                    })()}
                    <Badge color={activityStatusColor[activity.status] ?? 'slate'}>
                      {labelize(activity.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    {contact?.id ? (
                      <Link
                        to={`/contacts/${contact.id}`}
                        className="text-accent-blue hover:underline"
                      >
                        {contact.name}
                      </Link>
                    ) : (
                      (contact?.name ?? 'No contact')
                    )}
                    {deal?.id ? (
                      <>
                        {' · '}
                        <Link
                          to={`/deals/${deal.id}`}
                          className="text-accent-blue hover:underline"
                        >
                          {deal.name}
                        </Link>
                      </>
                    ) : deal ? (
                      ` · ${deal.name}`
                    ) : (
                      ''
                    )}
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
                    onClick={() => {
                      setModalOpen(false)
                      setEditing(activity)
                    }}
                    aria-label="Edit activity"
                  >
                    <Pencil size={15} />
                  </Button>
                  <DeleteIconButton
                    disabled={busyDelete}
                    onClick={() => setConfirm({ ids: [activity.id] })}
                  />
                </div>
              </div>
            )
          })}
          {loading && <TableSkeleton rows={8} className="p-6" />}
          {!loading && !filtered.length && (
            <p className="p-12 text-center text-text-secondary">No activities match these filters.</p>
          )}
        </div>
      </Card>
      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={
          confirm?.ids.length === 1 ? 'Delete activity?' : `Delete ${confirm?.ids.length ?? 0} activities?`
        }
        body={
          confirm?.ids.length === 1
            ? 'This activity will be permanently removed.'
            : 'Selected activities will be permanently removed.'
        }
      />
    </div>
  )
}

function toDatetimeLocalValue(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ActivityFormPanel({
  open,
  onClose,
  onSubmit,
  mode = 'create',
  initial = null,
  busy = false,
  deals,
  users,
  defaultAssigneeId,
  initialContactId = '',
}: {
  open: boolean
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  mode?: 'create' | 'edit'
  initial?: ActivityRow | null
  busy?: boolean
  contacts: LookupContact[]
  deals: LookupDeal[]
  users: LookupUser[]
  defaultAssigneeId?: string
  initialContactId?: string
}) {
  const isEdit = mode === 'edit' && Boolean(initial)
  const [linkType, setLinkType] = useState(
    initial?.dealId ? 'DEAL' : 'CONTACT',
  )
  const [pickedContact, setPickedContact] = useState<ContactPick | null>(
    initial?.contact
      ? { id: initial.contact.id, name: initial.contact.name }
      : null,
  )
  const [linkedId, setLinkedId] = useState(
    initial?.dealId || initial?.contactId || initialContactId || '',
  )
  const dealOptions = deals.map((item) => ({ value: item.id, label: item.name }))

  useEffect(() => {
    if (!open) return
    if (isEdit && initial) {
      setLinkType(initial.dealId ? 'DEAL' : 'CONTACT')
      setLinkedId(initial.dealId || initial.contactId || '')
      setPickedContact(
        initial.contact ? { id: initial.contact.id, name: initial.contact.name } : null,
      )
      return
    }
    if (initialContactId) {
      setLinkType('CONTACT')
      setLinkedId(initialContactId)
    }
  }, [open, initialContactId, isEdit, initial])

  return (
    <FormPanel
      open={open}
      accent="amber"
      eyebrow="Tasks"
      title={isEdit ? 'Edit activity' : 'Create activity'}
      subtitle={
        isEdit
          ? 'Update type, schedule, assignee, or linked customer.'
          : 'Log a call, email, meeting or task and assign it to a teammate.'
      }
      onClose={onClose}
      footer={
        <>
          <FormPanelCancel onClick={onClose} />
          <Button type="submit" form="activity-form" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create activity'}
          </Button>
        </>
      }
    >
      <form id="activity-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Type"
          name="type"
          defaultValue={initial?.type || 'TASK'}
          options={(['CALL', 'EMAIL', 'MEETING', 'TASK'] as ActivityType[]).map((v) => ({
            value: v,
            label: labelize(v),
          }))}
        />
        <Input
          label="Title"
          name="title"
          placeholder="Activity title"
          required
          className="lg:col-span-2"
          defaultValue={initial?.title || ''}
        />
        {isEdit ? (
          <Select
            label="Status"
            name="status"
            defaultValue={initial?.status || 'PENDING'}
            options={['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE'].map((v) => ({
              value: v,
              label: labelize(v),
            }))}
          />
        ) : (
          <input type="hidden" name="status" value="PENDING" />
        )}
        <Select
          label="Link to"
          name="linkType"
          value={linkType}
          onChange={(e) => {
            setLinkType(e.target.value)
            setLinkedId('')
            setPickedContact(null)
          }}
          options={[
            { value: 'CONTACT', label: 'Customer' },
            { value: 'DEAL', label: 'Deal' },
          ]}
        />
        {linkType === 'CONTACT' ? (
          <div className="sm:col-span-2 lg:col-span-2">
            <ContactPicker
              label="Customer"
              valueId={linkedId}
              selected={pickedContact}
              returnTo="/activities?open=1"
              onSelect={(c) => {
                setPickedContact(c)
                setLinkedId(c?.id ?? '')
              }}
            />
            <input type="hidden" name="linkedId" value={linkedId} />
          </div>
        ) : (
          <Select
            label="Deal"
            name="linkedId"
            value={linkedId}
            onChange={(e) => setLinkedId(e.target.value)}
            options={[
              {
                value: '',
                label: dealOptions.length ? 'Select deal' : 'No deals in database',
              },
              ...dealOptions,
            ]}
          />
        )}
        <Input
          label="Date & time"
          name="scheduledAt"
          type="datetime-local"
          defaultValue={toDatetimeLocalValue(initial?.scheduledAt)}
        />
        <Input
          label="Duration (minutes)"
          name="duration"
          type="number"
          min="0"
          defaultValue={initial?.durationMinutes != null ? String(initial.durationMinutes) : ''}
        />
        <Select
          label="Assigned to"
          name="assignedToId"
          defaultValue={initial?.assignedToId || defaultAssigneeId || users[0]?.id || ''}
          options={[
            { value: '', label: users.length ? 'Select assignee' : 'No users in database' },
            ...users.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <label className="text-sm font-medium text-text-secondary sm:col-span-2 lg:col-span-3">
          Description
          <textarea
            name="description"
            defaultValue={initial?.description || ''}
            className="mt-1 min-h-28 w-full rounded-[8px] border border-border bg-card p-3 text-text-primary outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
          />
        </label>
      </form>
    </FormPanel>
  )
}

export default ActivitiesPage
