import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  ListTodo,
  Phone,
  Plus,
  RefreshCw,
  Ticket,
  UserRound,
  Users,
  CalendarDays,
  Megaphone,
} from 'lucide-react'
import {
  differenceInCalendarDays,
  endOfDay,
  isValid,
  parseISO,
  startOfDay,
  startOfWeek,
  endOfWeek,
  format,
} from 'date-fns'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { useNotificationsStore } from '@/store/notificationsStore'
import {
  isCompanyAdmin,
  isSalesDesk,
  isServiceDesk,
  isServiceEngineer,
} from '@/lib/roles'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useFieldShell } from '@/hooks/useFieldShell'

type Row = Record<string, unknown>

type NavId =
  | 'tasks'
  | 'meetings'
  | 'calls'
  | 'tickets'
  | 'claimable'
  | 'followups'
  | 'leads'
  | 'touched-leads'
  | 'contacts'

type DateFilter = 'today_overdue' | 'today' | 'overdue' | 'week' | 'all'

const PAGE_SIZE = 20

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: 'today_overdue', label: 'Today & Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'This week' },
  { value: 'all', label: 'All open' },
]

function labelize(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function dueLabel(iso?: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: '—', overdue: false }
  const raw = typeof iso === 'string' ? parseISO(iso) : new Date(iso)
  if (!isValid(raw)) return { text: '—', overdue: false }
  const d = startOfDay(raw)
  const today = startOfDay(new Date())
  const diff = differenceInCalendarDays(d, today)
  if (diff < -1) return { text: `Late by ${Math.abs(diff)} days`, overdue: true }
  if (diff === -1) return { text: 'Yesterday', overdue: true }
  if (diff === 0) return { text: 'Today', overdue: false }
  if (diff === 1) return { text: 'Tomorrow', overdue: false }
  return { text: format(d, 'MMM d, yyyy'), overdue: diff < 0 }
}

function isOpenActivity(a: Row) {
  return ['PENDING', 'OVERDUE'].includes(String(a.status))
}

function activityBucket(type: string): 'tasks' | 'meetings' | 'calls' | null {
  if (type === 'TASK' || type === 'NOTE' || type === 'EMAIL') return 'tasks'
  if (type === 'MEETING' || type === 'DEMO' || type === 'VISIT') return 'meetings'
  if (type === 'CALL' || type === 'WHATSAPP') return 'calls'
  return 'tasks'
}

function matchesDateFilter(a: Row, filter: DateFilter): boolean {
  if (filter === 'all') return true
  const iso = a.scheduledAt ? String(a.scheduledAt) : null
  if (!iso) return filter === 'overdue' || filter === 'today_overdue'
  const d = parseISO(iso)
  if (!isValid(d)) return false
  const today = startOfDay(new Date())
  const endToday = endOfDay(new Date())
  if (filter === 'today') return d >= today && d <= endToday
  if (filter === 'overdue') return d < today || String(a.status) === 'OVERDUE'
  if (filter === 'today_overdue') return d <= endToday || String(a.status) === 'OVERDUE'
  if (filter === 'week') {
    const ws = startOfWeek(new Date(), { weekStartsOn: 1 })
    const we = endOfWeek(new Date(), { weekStartsOn: 1 })
    return d >= ws && d <= we
  }
  return true
}

function priorityOf(row: Row): string {
  const cf = (row.customFields as Record<string, unknown> | null) ?? {}
  if (cf.priority) return labelize(String(cf.priority))
  if (row.priority) return labelize(String(row.priority))
  return 'Normal'
}

function statusLabel(row: Row, kind: NavId): string {
  const s = String(row.status ?? '')
  if (kind === 'tasks' || kind === 'meetings' || kind === 'calls') {
    if (s === 'PENDING') return 'Not Started'
    if (s === 'OVERDUE') return 'Overdue'
    return labelize(s)
  }
  return labelize(s)
}

function leadFollowDueIso(l: Row): string | null {
  const cf = (l.customFields as Record<string, unknown> | null) ?? {}
  if (cf.reminder_at) return String(cf.reminder_at)
  if (cf.follow_up_date) {
    const day = String(cf.follow_up_date).slice(0, 10)
    return `${day}T10:00:00`
  }
  return null
}

function matchesLeadFollowFilter(iso: string, filter: DateFilter): boolean {
  const d = parseISO(iso)
  if (!isValid(d)) return false
  const today = startOfDay(new Date())
  const endToday = endOfDay(new Date())
  if (filter === 'all') return true
  if (filter === 'today') return d >= today && d <= endToday
  if (filter === 'overdue') return d < today
  if (filter === 'week') {
    const ws = startOfWeek(new Date(), { weekStartsOn: 1 })
    const we = endOfWeek(new Date(), { weekStartsOn: 1 })
    return d >= ws && d <= we
  }
  // today_overdue — also keep visible items due later today through end of today
  return d <= endToday
}

type CreateKind = 'followup' | 'task' | 'call' | 'meeting'

export function WorkqueuePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role = user?.role
  const addToast = useUIStore((s) => s.addToast)
  const prependLive = useNotificationsStore((s) => s.prependLive)
  const fieldShell = useFieldShell()
  const engineer = isServiceEngineer(role)

  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<Row[]>([])
  const [leads, setLeads] = useState<Row[]>([])
  const [tickets, setTickets] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])

  const salesDesk = isSalesDesk(role)
  const [nav, setNav] = useState<NavId>(() => {
    const r = useAuthStore.getState().user?.role
    if (isServiceEngineer(r)) return 'claimable'
    if (isSalesDesk(r)) return 'followups'
    return 'tasks'
  })
  const [dateFilter, setDateFilter] = useState<DateFilter>(() =>
    isSalesDesk(useAuthStore.getState().user?.role) ? 'week' : 'today_overdue',
  )
  const [filterOpen, setFilterOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [localFilter, setLocalFilter] = useState('')
  const [createOpen, setCreateOpen] = useState<CreateKind | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [createForm, setCreateForm] = useState({
    leadId: '',
    title: '',
    scheduledAt: '',
    notes: '',
  })
  const [todayAlertDismissed, setTodayAlertDismissed] = useState(() => {
    try {
      return localStorage.getItem(`nova.followupAlert.${new Date().toISOString().slice(0, 10)}`) === '1'
    } catch {
      return false
    }
  })

  const load = useCallback(async () => {
    if (!isTenantSession() || !user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const scoped = !isCompanyAdmin(role)
      const wantsSalesQueues = salesDesk || isCompanyAdmin(role)
      // Sales desk has no tickets:view — never call /tickets for them (was blanking the page).
      const wantsTickets = !salesDesk

      const settled = await Promise.allSettled([
        api.activities({
          limit: 200,
          ...(scoped ? { assignedToId: user.id } : {}),
        }),
        wantsSalesQueues
          ? api.leads({
              limit: 200,
              ...(salesDesk ? { assignedToId: user.id } : {}),
            })
          : Promise.resolve({ items: [] as Row[] }),
        wantsTickets
          ? api.tickets({
              limit: 100,
              ...(isServiceEngineer(role)
                ? { claimable: 1, mine: 1 }
                : !isCompanyAdmin(role) && !isServiceDesk(role)
                  ? { assignedToId: user.id }
                  : {}),
            })
          : Promise.resolve({ items: [] as Row[] }),
        wantsSalesQueues
          ? api.contacts({ limit: 100 })
          : Promise.resolve({ items: [] as Row[] }),
      ])

      const pick = <T,>(i: number, fallback: T): T => {
        const r = settled[i]
        if (r.status === 'fulfilled') return r.value as T
        return fallback
      }

      const actPage = pick<{ items?: Row[] }>(0, { items: [] })
      const leadPage = pick<{ items?: Row[] }>(1, { items: [] })
      const ticketPage = pick<{ items?: Row[] }>(2, { items: [] })
      const contactPage = pick<{ items?: Row[] }>(3, { items: [] })

      const hardFail = settled[0].status === 'rejected' && settled[1].status === 'rejected'
      if (hardFail) {
        const reason =
          settled[0].status === 'rejected' ? settled[0].reason : (settled[1] as PromiseRejectedResult).reason
        const message =
          reason instanceof ApiClientError ? reason.message : 'Failed to load workqueue'
        addToast({ type: 'error', message })
      }

      setActivities(((actPage.items ?? []) as Row[]).filter(isOpenActivity))
      setLeads((leadPage.items ?? []) as Row[])
      // Desk/admin also need RESOLVED (pending Approve & close) after engineer marks complete
      const ticketStatuses =
        isServiceDesk(role) || isCompanyAdmin(role)
          ? ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED']
          : ['OPEN', 'IN_PROGRESS', 'PENDING']
      setTickets(
        ((ticketPage.items ?? []) as Row[]).filter((t) =>
          ticketStatuses.includes(String(t.status)),
        ),
      )
      setContacts((contactPage.items ?? []) as Row[])
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load workqueue',
      })
    } finally {
      setLoading(false)
    }
  }, [user?.id, role, salesDesk, addToast])

  useEffect(() => {
    void load()
  }, [load])

  // Engineers + desk: soft-refresh so Accept / Mark complete updates show
  useEffect(() => {
    if (!isServiceEngineer(role) && !isServiceDesk(role)) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load()
    }, 20000)
    return () => window.clearInterval(id)
  }, [role, load])

  useEffect(() => {
    setPage(1)
    setLocalFilter('')
  }, [nav, dateFilter])

  const openActivities = useMemo(
    () => activities.filter((a) => matchesDateFilter(a, dateFilter)),
    [activities, dateFilter],
  )

  const tasks = useMemo(
    () => openActivities.filter((a) => activityBucket(String(a.type)) === 'tasks'),
    [openActivities],
  )
  const meetings = useMemo(
    () => openActivities.filter((a) => activityBucket(String(a.type)) === 'meetings'),
    [openActivities],
  )
  const calls = useMemo(
    () => openActivities.filter((a) => activityBucket(String(a.type)) === 'calls'),
    [openActivities],
  )

  const unverifiedLeads = useMemo(
    () =>
      leads.filter((l) => {
        const cf = (l.customFields as Record<string, unknown> | null) ?? {}
        return cf.verified === false
      }),
    [leads],
  )
  const touchedLeads = useMemo(
    () => leads.filter((l) => ['CONTACTED', 'QUALIFIED', 'DEMO'].includes(String(l.status))),
    [leads],
  )
  const myLeads = useMemo(
    () => leads.filter((l) => !['LOST', 'CONVERTED', 'UNQUALIFIED'].includes(String(l.status))),
    [leads],
  )
  /** Leads with follow-up / reminder in the selected date window */
  const dueFollowUpLeads = useMemo(() => {
    const rows = myLeads.filter((l) => {
      const iso = leadFollowDueIso(l)
      if (!iso) return false
      return matchesLeadFollowFilter(iso, dateFilter)
    })
    return [...rows].sort((a, b) => {
      const da = leadFollowDueIso(a) ?? ''
      const db = leadFollowDueIso(b) ?? ''
      return da.localeCompare(db)
    })
  }, [myLeads, dateFilter])

  const followUpsDueToday = useMemo(() => {
    return myLeads.filter((l) => {
      const iso = leadFollowDueIso(l)
      if (!iso) return false
      return matchesLeadFollowFilter(iso, 'today')
    })
  }, [myLeads])

  // Day-of follow-up alert (banner + bell chip once per day)
  useEffect(() => {
    if (!salesDesk || loading || todayAlertDismissed || followUpsDueToday.length === 0) return
    const key = `nova.followupAlertToast.${new Date().toISOString().slice(0, 10)}`
    try {
      if (sessionStorage.getItem(key) === '1') return
      sessionStorage.setItem(key, '1')
    } catch {
      /* ignore */
    }
    const names = followUpsDueToday
      .slice(0, 3)
      .map((l) => String(l.name ?? 'Lead'))
      .join(', ')
    const extra =
      followUpsDueToday.length > 3 ? ` +${followUpsDueToday.length - 3} more` : ''
    addToast({
      type: 'error',
      message: `Follow-up due today: ${names}${extra}`,
    })
    prependLive({
      title: 'Follow-up due today',
      message: `${followUpsDueToday.length} enquir${followUpsDueToday.length === 1 ? 'y' : 'ies'} need a call`,
      kind: 'OVERDUE',
      type: 'LEAD_FOLLOWUP_DUE',
      href: '/workqueue',
    })
  }, [
    salesDesk,
    loading,
    todayAlertDismissed,
    followUpsDueToday,
    addToast,
    prependLive,
  ])
  const myTickets = useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.assignedToId === user?.id ||
          t.receivedByUserId === user?.id ||
          t.deliveredByUserId === user?.id,
      ),
    [tickets, user?.id],
  )
  const claimableTickets = useMemo(
    () =>
      tickets.filter(
        (t) => String(t.status) === 'OPEN' && !t.assignedToId,
      ),
    [tickets],
  )

  const counts: Record<NavId, number> = {
    tasks: tasks.length,
    meetings: meetings.length,
    calls: calls.length,
    tickets: isServiceEngineer(role) ? myTickets.length : tickets.length,
    claimable: claimableTickets.length,
    followups: dueFollowUpLeads.length,
    leads: myLeads.length,
    'touched-leads': touchedLeads.length,
    contacts: contacts.length,
  }

  const navTitle: Record<NavId, string> = {
    tasks: 'Tasks',
    meetings: 'Meetings',
    calls: 'Calls',
    tickets: isServiceEngineer(role) ? 'My service jobs' : 'Service tickets',
    claimable: 'Open to accept',
    followups: 'Follow-ups due',
    leads: 'My leads',
    'touched-leads': 'Touched Leads This Month',
    contacts: 'My Contacts',
  }

  const rows = useMemo(() => {
    const q = localFilter.trim().toLowerCase()
    let list: Row[] = []
    if (nav === 'tasks') list = tasks
    else if (nav === 'meetings') list = meetings
    else if (nav === 'calls') list = calls
    else if (nav === 'tickets') list = isServiceEngineer(role) ? myTickets : tickets
    else if (nav === 'claimable') list = claimableTickets
    else if (nav === 'followups') list = dueFollowUpLeads
    else if (nav === 'leads') list = myLeads
    else if (nav === 'touched-leads') list = touchedLeads
    else if (nav === 'contacts') list = contacts
    else list = []

    if (q) {
      list = list.filter((r) => {
        const hay = [
          r.title,
          r.subject,
          r.name,
          (r.contact as { name?: string; area?: string } | null)?.name,
          (r.contact as { area?: string } | null)?.area,
          (r.customFields as { serviceArea?: string } | null)?.serviceArea,
          (r.deal as { name?: string } | null)?.name,
          r.accountName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }

    return list.slice().sort((a, b) => {
      const as = a.scheduledAt
        ? new Date(String(a.scheduledAt)).getTime()
        : a.slaDueAt
          ? new Date(String(a.slaDueAt)).getTime()
          : Number.MAX_SAFE_INTEGER
      const bs = b.scheduledAt
        ? new Date(String(b.scheduledAt)).getTime()
        : b.slaDueAt
          ? new Date(String(b.slaDueAt)).getTime()
          : Number.MAX_SAFE_INTEGER
      return as - bs
    })
  }, [
    nav,
    localFilter,
    tasks,
    meetings,
    calls,
    tickets,
    myTickets,
    claimableTickets,
    role,
    dueFollowUpLeads,
    myLeads,
    touchedLeads,
    contacts,
  ])

  const [claimBusyId, setClaimBusyId] = useState<string | null>(null)

  async function acceptJob(ticketId: string) {
    setClaimBusyId(ticketId)
    try {
      await api.claimTicket(ticketId)
      addToast({ type: 'success', message: 'Job accepted — it is assigned to you' })
      if (fieldShell) {
        navigate(`/tickets/${ticketId}`)
        return
      }
      await load()
      setNav('tickets')
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Already taken by another engineer',
      })
      await load()
    } finally {
      setClaimBusyId(null)
    }
  }

  const leadOptions = useMemo(
    () =>
      myLeads.map((l) => ({
        value: String(l.id),
        label: String(l.name ?? 'Lead'),
        sublabel: [l.phone, l.company].filter(Boolean).map(String).join(' · ') || undefined,
      })),
    [myLeads],
  )

  function openCreate(kind: CreateKind) {
    const tomorrow = new Date()
    if (kind === 'followup') tomorrow.setDate(tomorrow.getDate() + 1)
    const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
    const defaults: Record<CreateKind, string> = {
      followup: 'Follow up call',
      task: 'Task',
      call: 'Sales call',
      meeting: 'Meeting',
    }
    setCreateForm({
      leadId: '',
      title: defaults[kind],
      scheduledAt: local,
      notes: '',
    })
    setCreateOpen(kind)
  }

  async function submitCreate() {
    if (!createOpen) return
    if (!createForm.title.trim()) {
      addToast({ type: 'error', message: 'Enter a title' })
      return
    }
    if (createOpen === 'followup' && !createForm.leadId) {
      addToast({ type: 'error', message: 'Pick a lead / enquiry for this follow-up' })
      return
    }
    if (!createForm.scheduledAt) {
      addToast({ type: 'error', message: 'Pick date & time' })
      return
    }
    setCreateBusy(true)
    try {
      const typeMap: Record<CreateKind, string> = {
        followup: 'TASK',
        task: 'TASK',
        call: 'CALL',
        meeting: 'MEETING',
      }
      await api.createActivity({
        type: typeMap[createOpen],
        title: createForm.title.trim(),
        description: createForm.notes.trim() || null,
        scheduledAt: new Date(createForm.scheduledAt).toISOString(),
        status: 'PENDING',
        leadId: createForm.leadId || null,
        assignedToId: user?.id ?? null,
        customFields: {
          from_workqueue: true,
          ...(createOpen === 'followup' ? { auto_from: 'lead_followup' } : {}),
        },
      })
      addToast({
        type: 'success',
        message:
          createOpen === 'followup'
            ? 'Follow-up created — shows under Follow-ups due'
            : `${createOpen[0].toUpperCase()}${createOpen.slice(1)} created`,
      })
      setCreateOpen(null)
      if (createOpen === 'followup') setNav('followups')
      else if (createOpen === 'call') setNav('calls')
      else if (createOpen === 'meeting') setNav('meetings')
      else setNav('tasks')
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not create',
      })
    } finally {
      setCreateBusy(false)
    }
  }

  const createAction = useMemo((): { kind: CreateKind; label: string } | null => {
    if (nav === 'followups') return { kind: 'followup', label: 'Create follow-up' }
    if (nav === 'tasks') return { kind: 'task', label: 'Create task' }
    if (nav === 'calls') return { kind: 'call', label: 'Create call' }
    if (nav === 'meetings') return { kind: 'meeting', label: 'Create meeting' }
    if (nav === 'leads') return { kind: 'followup', label: 'Create follow-up' }
    return null
  }, [nav])

  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageSafe = Math.min(page, pageCount)
  const pageRows = rows.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)
  const from = total === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1
  const to = Math.min(pageSafe * PAGE_SIZE, total)

  function NavItem({
    id,
    label,
    icon,
    iconClass,
  }: {
    id: NavId
    label: string
    icon: ReactNode
    iconClass: string
  }) {
    const active = nav === id
    return (
      <button
        type="button"
        onClick={() => setNav(id)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition',
          active
            ? 'bg-[color:var(--color-accent-blue)]/12 font-medium text-text-primary'
            : 'text-text-secondary hover:bg-muted hover:text-text-primary',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white',
            iconClass,
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="tabular-nums text-[12px] text-text-secondary">{counts[id]}</span>
      </button>
    )
  }

  function subjectCell(row: Row) {
    if (nav === 'tickets' || nav === 'claimable') {
      return (
        <Link to={`/tickets/${row.id}`} className="text-[color:var(--color-accent-blue)] hover:underline">
          {String(row.subject ?? 'Ticket')}
        </Link>
      )
    }
    if (nav === 'leads' || nav === 'touched-leads' || nav === 'followups') {
      return (
        <Link
          to={`/sale-tracking/${row.id}`}
          className="text-[color:var(--color-accent-blue)] hover:underline"
        >
          {String(row.name ?? 'Enquiry')}
        </Link>
      )
    }
    if (nav === 'contacts') {
      return (
        <Link
          to={`/contacts/${row.id}`}
          className="text-[color:var(--color-accent-blue)] hover:underline"
        >
          {String(row.name ?? 'Contact')}
        </Link>
      )
    }
    // Follow-up / call / task activities → open the linked enquiry (not /my-tasks,
    // which also loads service tickets and 403s for sales desk).
    if (row.leadId) {
      return (
        <Link
          to={`/sale-tracking/${String(row.leadId)}`}
          className="text-[color:var(--color-accent-blue)] hover:underline"
        >
          {String(row.title ?? 'Follow-up')}
        </Link>
      )
    }
    return (
      <span className="font-medium text-text-primary">{String(row.title ?? 'Activity')}</span>
    )
  }

  function dueCell(row: Row) {
    const cf = (row.customFields as Record<string, unknown> | null) ?? {}
    const iso =
      row.scheduledAt != null
        ? String(row.scheduledAt)
        : cf.reminder_at
          ? String(cf.reminder_at)
          : cf.follow_up_date
            ? `${String(cf.follow_up_date).slice(0, 10)}T10:00:00`
            : row.slaDueAt != null
              ? String(row.slaDueAt)
              : row.expectedCloseDate != null
                ? String(row.expectedCloseDate)
                : null
    const due = dueLabel(iso)
    return (
      <span className={cn('text-[13px]', due.overdue ? 'font-medium text-red-500' : 'text-text-primary')}>
        {due.text}
      </span>
    )
  }

  function relatedCell(row: Row) {
    const deal = row.deal as { id?: string; name?: string } | null
    const contact = row.contact as { id?: string; name?: string } | null
    if (deal?.name) {
      return (
        <Link
          to={deal.id ? `/deals/${deal.id}` : '/deals'}
          className="inline-flex items-center gap-1.5 text-[color:var(--color-accent-blue)] hover:underline"
        >
          <Building2 size={13} className="shrink-0 text-text-secondary" />
          {deal.name}
        </Link>
      )
    }
    if (row.leadId) {
      return (
        <Link
          to={`/sale-tracking/${row.leadId}`}
          className="inline-flex items-center gap-1.5 text-[color:var(--color-accent-blue)] hover:underline"
        >
          <Users size={13} className="shrink-0 text-amber-500" />
          Lead
        </Link>
      )
    }
    if (contact?.name && (nav === 'tickets' || nav === 'tasks' || nav === 'meetings' || nav === 'calls')) {
      return (
        <span className="inline-flex items-center gap-1.5 text-text-secondary">
          <Building2 size={13} />
          —
        </span>
      )
    }
    if (row.accountName) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <Building2 size={13} className="text-text-secondary" />
          {String(row.accountName)}
        </span>
      )
    }
    return <span className="text-text-secondary">—</span>
  }

  function contactCell(row: Row) {
    const contact = row.contact as { id?: string; name?: string } | null
    if (contact?.name) {
      return (
        <Link
          to={contact.id ? `/contacts/${contact.id}` : '/contacts'}
          className="text-[color:var(--color-accent-blue)] hover:underline"
        >
          {contact.name}
        </Link>
      )
    }
    if (nav === 'leads' || nav === 'touched-leads' || nav === 'followups') {
      return <span className="text-text-secondary">{String(row.phone ?? row.email ?? '—')}</span>
    }
    if (nav === 'contacts') {
      return <span className="text-text-secondary">{String(row.email ?? row.phone ?? '—')}</span>
    }
    return <span className="text-text-secondary">—</span>
  }

  const isActivityNav = nav === 'tasks' || nav === 'meetings' || nav === 'calls'

  return (
    <div
      className={cn(
        'flex flex-col bg-surface',
        fieldShell
          ? '-m-3 min-h-0'
          : '-m-3 min-h-[calc(100vh-3.5rem-2.5rem-1.5rem)] sm:-m-4 lg:-m-5 lg:min-h-[calc(100vh-3.5rem-2.5rem-2.5rem)]',
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 overflow-hidden border-border bg-card',
          fieldShell
            ? 'flex-col rounded-none border-0'
            : 'rounded-none border-y sm:rounded-xl sm:border',
        )}
      >
        {/* Left nav — desktop / non-field */}
        <aside
          className={cn(
            'flex w-[240px] shrink-0 flex-col border-r border-border bg-card',
            fieldShell && 'hidden',
          )}
        >
          <div className="border-b border-border px-3 py-3">
            <div className="relative">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                className="h-9 w-full appearance-none rounded-md border border-border bg-muted/50 py-1.5 pl-3 pr-8 text-[13px] font-medium text-text-primary outline-none focus:border-[color:var(--color-accent-blue)]"
              >
                {DATE_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3">
            {salesDesk ? (
              <>
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  Sales desk
                </p>
                <div className="space-y-0.5">
                  <NavItem
                    id="followups"
                    label="Follow-ups due"
                    icon={<Bell size={13} />}
                    iconClass="bg-[#f59e0b]"
                  />
                  <NavItem
                    id="leads"
                    label="My leads"
                    icon={<Users size={13} />}
                    iconClass="bg-[#eab308]"
                  />
                  <NavItem
                    id="calls"
                    label="Calls"
                    icon={<Phone size={13} />}
                    iconClass="bg-[#8b5cf6]"
                  />
                  <NavItem
                    id="tasks"
                    label="Tasks"
                    icon={<CheckSquare size={13} />}
                    iconClass="bg-[#e91e8c]"
                  />
                  <NavItem
                    id="meetings"
                    label="Meetings"
                    icon={<CalendarDays size={13} />}
                    iconClass="bg-[#7c5cfc]"
                  />
                  <NavItem
                    id="contacts"
                    label="My contacts"
                    icon={<UserRound size={13} />}
                    iconClass="bg-[#14b8a6]"
                  />
                </div>
                {unverifiedLeads.length > 0 && (
                  <p className="mt-4 px-2 text-[11px] text-amber-600">
                    {unverifiedLeads.length} enquir
                    {unverifiedLeads.length === 1 ? 'y' : 'ies'} waiting for confirm
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  My Open Activity
                </p>
                <div className="space-y-0.5">
                  <NavItem
                    id="tasks"
                    label="Tasks"
                    icon={<CheckSquare size={13} />}
                    iconClass="bg-[#e91e8c]"
                  />
                  <NavItem
                    id="meetings"
                    label="Meetings"
                    icon={<CalendarDays size={13} />}
                    iconClass="bg-[#7c5cfc]"
                  />
                  <NavItem
                    id="calls"
                    label="Calls"
                    icon={<Phone size={13} />}
                    iconClass="bg-[#8b5cf6]"
                  />
                </div>

                <p className="mb-1.5 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  My Jobs
                </p>
                <div className="space-y-0.5">
                  {isServiceEngineer(role) ? (
                    <NavItem
                      id="claimable"
                      label="Open to accept"
                      icon={<Megaphone size={13} />}
                      iconClass="bg-[#f59e0b]"
                    />
                  ) : null}
                  <NavItem
                    id="tickets"
                    label={isServiceEngineer(role) ? 'My service jobs' : 'Service tickets'}
                    icon={<ListTodo size={13} />}
                    iconClass="bg-[#6366f1]"
                  />
                </div>

                <p className="mb-1.5 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  My Workqueue
                </p>
                <div className="space-y-0.5">
                  <NavItem
                    id="leads"
                    label="My Leads"
                    icon={<Users size={13} />}
                    iconClass="bg-[#eab308]"
                  />
                  <NavItem
                    id="touched-leads"
                    label="Touched Leads This Month"
                    icon={<Users size={13} />}
                    iconClass="bg-[#ca8a04]"
                  />
                  <NavItem
                    id="contacts"
                    label="My Contacts"
                    icon={<UserRound size={13} />}
                    iconClass="bg-[#14b8a6]"
                  />
                </div>

                {unverifiedLeads.length > 0 && (
                  <p className="mt-4 px-2 text-[11px] text-amber-600">
                    {unverifiedLeads.length} lead{unverifiedLeads.length === 1 ? '' : 's'} waiting for
                    confirm — open My Leads
                  </p>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Main panel */}
        <section className="flex min-w-0 flex-1 flex-col">
          {fieldShell && engineer ? (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-border px-3 py-2.5">
              {(
                [
                  { id: 'claimable' as const, label: 'Open to accept' },
                  { id: 'tickets' as const, label: 'My jobs' },
                  { id: 'tasks' as const, label: 'Tasks' },
                ] as const
              ).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setNav(chip.id)}
                  className={cn(
                    'shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition',
                    nav === chip.id
                      ? 'bg-[color:var(--color-accent-blue)] text-white'
                      : 'bg-muted text-text-secondary',
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 border-b border-border px-4',
              fieldShell ? 'h-11' : 'h-12',
            )}
          >
            <h1 className="text-[15px] font-semibold text-text-primary">{navTitle[nav]}</h1>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md p-1.5 text-text-secondary hover:bg-muted hover:text-text-primary"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="ml-auto flex items-center gap-2">
              {filterOpen && (
                <input
                  autoFocus
                  value={localFilter}
                  onChange={(e) => setLocalFilter(e.target.value)}
                  placeholder="Filter records…"
                  className="h-8 w-48 rounded-md border border-border bg-muted/40 px-2.5 text-[13px] outline-none focus:border-[color:var(--color-accent-blue)]"
                />
              )}
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-text-secondary hover:bg-muted hover:text-text-primary',
                  filterOpen && 'border-[color:var(--color-accent-blue)] text-text-primary',
                )}
              >
                <Filter size={14} />
                Filter
              </button>
              {nav === 'leads' ? (
                <Button size="sm" onClick={() => navigate('/sale-tracking?open=1')}>
                  <Plus size={14} /> New lead
                </Button>
              ) : null}
              {createAction ? (
                <Button size="sm" onClick={() => openCreate(createAction.kind)}>
                  <Plus size={14} /> {createAction.label}
                </Button>
              ) : null}
            </div>
          </div>

          {salesDesk && followUpsDueToday.length > 0 && !todayAlertDismissed ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300/70 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <div className="flex min-w-0 items-center gap-2">
                <Bell size={16} className="shrink-0 text-amber-600" />
                <span>
                  <strong>{followUpsDueToday.length}</strong> follow-up
                  {followUpsDueToday.length === 1 ? '' : 's'} due today —{' '}
                  {followUpsDueToday
                    .slice(0, 3)
                    .map((l) => String(l.name))
                    .join(', ')}
                  {followUpsDueToday.length > 3 ? ` +${followUpsDueToday.length - 3}` : ''}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDateFilter('today')
                    setNav('followups')
                  }}
                >
                  View today
                </Button>
                <button
                  type="button"
                  className="text-xs font-medium text-amber-800 underline dark:text-amber-200"
                  onClick={() => {
                    setTodayAlertDismissed(true)
                    try {
                      localStorage.setItem(
                        `nova.followupAlert.${new Date().toISOString().slice(0, 10)}`,
                        '1',
                      )
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={8} />
              </div>
            ) : pageRows.length === 0 ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-text-secondary">
                <Ticket size={28} className="opacity-40" />
                <p>No records in this queue</p>
                {nav === 'followups' ? (
                  <p className="max-w-md text-xs">
                    Tip: date filter is <strong>{DATE_FILTERS.find((f) => f.value === dateFilter)?.label}</strong>.
                    Switch to <strong>This week</strong> or <strong>All open</strong> to see upcoming
                    follow-up dates from new leads.
                  </p>
                ) : null}
                {createAction ? (
                  <Button size="sm" className="mt-2" onClick={() => openCreate(createAction.kind)}>
                    <Plus size={14} /> {createAction.label}
                  </Button>
                ) : null}
              </div>
            ) : fieldShell ? (
              <div className="space-y-2.5 p-3">
                {pageRows.map((row) => {
                  const tid = String(row.id)
                  const unassigned = !row.assignedToId && String(row.status) === 'OPEN'
                  const area =
                    (row.contact as { area?: string } | null)?.area ||
                    (row.customFields as { serviceArea?: string } | null)?.serviceArea ||
                    ''
                  const statusText = isActivityNav
                    ? statusLabel(row, nav)
                    : nav === 'tickets' || nav === 'claimable'
                      ? unassigned
                        ? 'Open · free to accept'
                        : labelize(String(row.status))
                      : labelize(String(row.status ?? 'Open'))
                  return (
                    <div
                      key={tid}
                      className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
                    >
                      <div className="text-[15px] font-semibold text-text-primary">
                        {subjectCell(row)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-secondary">
                        <span>{dueCell(row)}</span>
                        <span>{statusText}</span>
                        <span>{priorityOf(row)}</span>
                        {area ? <span>Area · {area}</span> : null}
                      </div>
                      <div className="mt-1 truncate text-[13px] text-text-secondary">
                        {contactCell(row)}
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        {nav === 'claimable' && unassigned && engineer ? (
                          <button
                            type="button"
                            disabled={claimBusyId === tid}
                            onClick={() => void acceptJob(tid)}
                            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[color:var(--color-accent-blue)] text-[15px] font-semibold text-white disabled:opacity-60"
                          >
                            {claimBusyId === tid ? 'Accepting…' : 'Accept job'}
                          </button>
                        ) : null}
                        <Link
                          to={`/tickets/${tid}`}
                          className="flex min-h-11 w-full items-center justify-center rounded-xl border border-border text-[14px] font-semibold text-accent-blue"
                        >
                          Open job
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <table className="w-full min-w-[880px] border-collapse text-left text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border text-[12px] font-medium text-text-secondary">
                    <th className="px-4 py-2.5 font-medium">Subject</th>
                    <th className="px-3 py-2.5 font-medium">Due Date</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">Related To</th>
                    <th className="px-4 py-2.5 font-medium">Contact Name</th>
                    {nav === 'claimable' || nav === 'tickets' ? (
                      <th className="px-4 py-2.5 font-medium">Action</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const tid = String(row.id)
                    const unassigned = !row.assignedToId && String(row.status) === 'OPEN'
                    const area =
                      (row.contact as { area?: string } | null)?.area ||
                      (row.customFields as { serviceArea?: string } | null)?.serviceArea ||
                      ''
                    return (
                    <tr
                      key={tid}
                      className="border-b border-border/80 transition hover:bg-muted/40"
                    >
                      <td className="max-w-[280px] px-4 py-2.5">
                        <div className="font-medium">{subjectCell(row)}</div>
                        {area ? (
                          <div className="text-[11px] text-text-secondary">Area · {area}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{dueCell(row)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-text-primary">
                        {isActivityNav
                          ? statusLabel(row, nav)
                          : nav === 'tickets' || nav === 'claimable'
                            ? unassigned
                              ? 'Open · free to accept'
                              : labelize(String(row.status))
                            : labelize(String(row.status ?? 'Open'))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-text-primary">
                        {priorityOf(row)}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2.5">{relatedCell(row)}</td>
                      <td className="max-w-[180px] truncate px-4 py-2.5">{contactCell(row)}</td>
                      {nav === 'claimable' || nav === 'tickets' ? (
                        <td className="px-4 py-2.5">
                          {nav === 'claimable' && unassigned && isServiceEngineer(role) ? (
                            <button
                              type="button"
                              disabled={claimBusyId === tid}
                              onClick={() => void acceptJob(tid)}
                              className="rounded-md bg-[color:var(--color-accent-blue)] px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-60"
                            >
                              {claimBusyId === tid ? 'Accepting…' : 'Accept'}
                            </button>
                          ) : (
                            <Link
                              to={`/tickets/${tid}`}
                              className="text-[12px] font-semibold text-accent-blue hover:underline"
                            >
                              Open
                            </Link>
                          )}
                        </td>
                      ) : null}
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[12px] text-text-secondary">
            <span>
              Total Records <span className="font-medium text-text-primary">{total}</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={pageSafe <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded p-1 hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="min-w-[4.5rem] text-center tabular-nums">
                {from} to {to}
              </span>
              <button
                type="button"
                disabled={pageSafe >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="rounded p-1 hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(createOpen)}
        onClose={() => !createBusy && setCreateOpen(null)}
        title={
          createOpen === 'followup'
            ? 'Create follow-up'
            : createOpen === 'call'
              ? 'Create call'
              : createOpen === 'meeting'
                ? 'Create meeting'
                : 'Create task'
        }
        subtitle="Saved to your workqueue and linked to the enquiry when selected."
        size="md"
        accent="amber"
        footer={
          <>
            <Button variant="outline" disabled={createBusy} onClick={() => setCreateOpen(null)}>
              Cancel
            </Button>
            <Button disabled={createBusy} onClick={() => void submitCreate()}>
              {createBusy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {(createOpen === 'followup' || createOpen === 'call' || createOpen === 'meeting' || createOpen === 'task') && (
            <SearchableSelect
              label={createOpen === 'followup' ? 'Lead / enquiry *' : 'Lead / enquiry (optional)'}
              value={createForm.leadId}
              onChange={(v) => setCreateForm((f) => ({ ...f, leadId: v }))}
              options={leadOptions}
              placeholder="Search enquiry…"
              emptyText="No open leads — create a lead first"
            />
          )}
          <Input
            label="Title *"
            value={createForm.title}
            onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
          />
          <Input
            label="Due date & time *"
            type="datetime-local"
            value={createForm.scheduledAt}
            onChange={(e) => setCreateForm((f) => ({ ...f, scheduledAt: e.target.value }))}
          />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-[72px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="What to discuss…"
            />
          </label>
          {createOpen === 'followup' ? (
            <p className="text-xs text-text-secondary">
              This updates the lead’s follow-up date so it appears under Follow-ups due (use date filter
              This week / All open for future dates).
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

export default WorkqueuePage
