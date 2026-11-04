/** Shared helpers for dashboard / workqueue day-of reminders. */

export type DueReminderKind = 'call' | 'meeting' | 'task' | 'followup'

export type DueReminderItem = {
  id: string
  kind: DueReminderKind
  title: string
  subtitle: string
  dueLabel: string
  dueAt: number
  to: string
  source: 'lead' | 'activity'
}

function endOfToday(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function isOpenActivityStatus(status: unknown): boolean {
  return ['PENDING', 'OVERDUE'].includes(String(status))
}

/** Pending/overdue activity scheduled today or earlier (same-day + overdue reminder). */
export function isActivityDueTodayOrOverdue(a: Record<string, unknown>, end = endOfToday()): boolean {
  if (!isOpenActivityStatus(a.status)) return false
  if (!a.scheduledAt) return true
  const t = new Date(String(a.scheduledAt)).getTime()
  return !Number.isNaN(t) && t <= end.getTime()
}

export function isActivityDueThisWeek(
  a: Record<string, unknown>,
  start = startOfToday(),
  weekEnd?: Date,
): boolean {
  if (!isOpenActivityStatus(a.status) || !a.scheduledAt) return false
  const end =
    weekEnd ??
    (() => {
      const e = new Date(start)
      e.setDate(e.getDate() + 7)
      e.setHours(23, 59, 59, 999)
      return e
    })()
  const t = new Date(String(a.scheduledAt)).getTime()
  return !Number.isNaN(t) && t >= start.getTime() && t <= end.getTime()
}

export function activityReminderKind(type: unknown): DueReminderKind {
  const t = String(type)
  if (t === 'CALL' || t === 'WHATSAPP') return 'call'
  if (t === 'MEETING' || t === 'DEMO' || t === 'VISIT') return 'meeting'
  return 'task'
}

export function activityKindLabel(kind: DueReminderKind): string {
  if (kind === 'call') return 'Call'
  if (kind === 'meeting') return 'Meeting'
  if (kind === 'followup') return 'Follow-up'
  return 'Task'
}

export function activityWorkqueueNav(kind: DueReminderKind): string {
  if (kind === 'call') return '/workqueue?nav=calls'
  if (kind === 'meeting') return '/workqueue?nav=meetings'
  if (kind === 'followup') return '/workqueue?nav=followups'
  return '/workqueue?nav=tasks'
}

export function formatActivityDueLabel(scheduledAt: unknown): string {
  if (!scheduledAt) return 'Due'
  const raw = String(scheduledAt)
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16).replace('T', ' ')
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function reminderFromActivity(a: Record<string, unknown>): DueReminderItem {
  const kind = activityReminderKind(a.type)
  const scheduledAt = a.scheduledAt ? String(a.scheduledAt) : ''
  const dueAt = scheduledAt ? new Date(scheduledAt).getTime() : 0
  const contact = a.contact as { name?: string } | null
  const leadName = a.leadName != null ? String(a.leadName) : ''
  return {
    id: `act:${String(a.id)}`,
    kind,
    title: String(a.title ?? kind),
    subtitle: [activityKindLabel(kind), contact?.name, leadName].filter(Boolean).join(' · ') || activityKindLabel(kind),
    dueLabel: formatActivityDueLabel(a.scheduledAt),
    dueAt: Number.isNaN(dueAt) ? 0 : dueAt,
    to: activityWorkqueueNav(kind),
    source: 'activity',
  }
}
