import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeleteIconButton } from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { ConfirmModal } from '@/components/ui/Modal'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import {
  isActivityDueTodayOrOverdue,
  reminderFromActivity,
  type DueReminderItem,
} from '@/lib/activityReminders'
import { can } from '@/lib/permissions'
import { BlockSkeleton } from '@/components/ui/Skeleton'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

type Props = {
  /** Compact = hide empty state (admin overview) */
  hideWhenEmpty?: boolean
  className?: string
  title?: string
  subtitle?: string
}

/** Loads the signed-in user's workqueue calls/tasks/meetings due today (or overdue). */
export function DueTodayRemindersCard({
  hideWhenEmpty = false,
  className,
  title = 'Due today',
  subtitle = 'Your calls, tasks & meetings from Workqueue — today & overdue',
}: Props) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const canDelete = can(user?.role, 'activities:delete')
  const addToast = useUIStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<DueReminderItem[]>([])
  const [busyDelete, setBusyDelete] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!isTenantSession() || !userId) {
      if (!silent) setLoading(false)
      setItems([])
      return
    }
    if (!silent) setLoading(true)
    try {
      const page = await api.activities({ limit: 100, assignedToId: userId }).catch(() => ({
        items: [] as Array<Record<string, unknown>>,
      }))
      setItems(
        (page.items ?? [])
          .filter((a) => isActivityDueTodayOrOverdue(a))
          .map((a) => reminderFromActivity(a))
          .sort((a, b) => a.dueAt - b.dueAt)
          .slice(0, 12),
      )
    } catch {
      if (!silent) setItems([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  async function runDelete(rawId: string) {
    const id = rawId.startsWith('act:') ? rawId.slice(4) : rawId
    setBusyDelete(true)
    try {
      await api.deleteActivity(id)
      addToast({ type: 'success', message: 'Deleted' })
      setDeleteId(null)
      await load({ silent: true })
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not delete',
      })
    } finally {
      setBusyDelete(false)
    }
  }

  if (!loading && hideWhenEmpty && items.length === 0) return null

  return (
    <>
      <Card padding={false} className={className}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
            <p className="text-xs text-text-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-accent-blue hover:underline"
            onClick={() => navigate('/workqueue')}
          >
            Workqueue →
          </button>
        </div>
        {loading && items.length === 0 ? (
          <BlockSkeleton lines={3} />
        ) : items.length === 0 ? (
          <div className="space-y-3 p-4">
            <p className="text-sm text-text-secondary">
              Nothing due today. Create a call, task or meeting from Workqueue — it appears here on
              that day for your login.
            </p>
            <Button size="sm" variant="outline" onClick={() => navigate('/workqueue')}>
              Open workqueue
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => navigate(r.to)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:opacity-90"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{r.title}</div>
                    <div className="truncate text-xs text-text-secondary">{r.subtitle}</div>
                  </div>
                  <Badge color="amber">{r.dueLabel}</Badge>
                </button>
                {canDelete && r.source === 'activity' ? (
                  <DeleteIconButton
                    disabled={busyDelete}
                    onClick={() => setDeleteId(r.id)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmModal
        open={Boolean(deleteId)}
        onClose={() => !busyDelete && setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) void runDelete(deleteId)
        }}
        title="Delete this reminder?"
        body="This removes the call, task or meeting from your queue."
        confirmLabel={busyDelete ? 'Deleting…' : 'Delete'}
        confirmVariant="danger"
        closeOnConfirm={false}
      />
    </>
  )
}
