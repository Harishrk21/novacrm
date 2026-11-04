import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { timeAgo, cn } from '@/lib/utils'
import type { AppNotification } from '@/store/notificationsStore'

function typeColor(type: string) {
  if (
    type.includes('AVAILABLE') ||
    type.includes('CLAIMABLE') ||
    type === 'REQUISITION_PENDING' ||
    type.includes('REQUISITION_PENDING')
  ) {
    return 'red' as const
  }
  if (type.includes('PENDING') || type.includes('CREATED')) return 'amber' as const
  if (type.includes('ASSIGNED') || type.includes('REASSIGNED')) return 'blue' as const
  if (type.includes('CLOSED') || type.includes('APPROV')) return 'green' as const
  if (type.includes('PROGRESS')) return 'purple' as const
  return 'gray' as const
}

function isReadyToAcceptNotif(type: string) {
  const t = type.toUpperCase()
  return (
    t.includes('TICKET_AVAILABLE') ||
    t.includes('CLAIMABLE') ||
    t.includes('OPEN_POOL') ||
    t === 'REQUISITION_PENDING' ||
    t.includes('REQUISITION_PENDING')
  )
}

function readyToAcceptLabel(type: string) {
  const t = type.toUpperCase()
  if (t.includes('REQUISITION')) return 'Awaiting accept'
  return 'Ready to accept'
}

export type NotificationItemProps = {
  n: AppNotification
  /** Compact = topbar panel; comfortable = full notifications page */
  density?: 'compact' | 'comfortable'
  expired?: boolean
  showTypeBadge?: boolean
  onOpen: () => void
  onClear: () => void
}

/** Shared notification row — wraps text, stacks time, touch-friendly actions. */
export function NotificationItem({
  n,
  density = 'compact',
  expired = false,
  showTypeBadge = false,
  onOpen,
  onClear,
}: NotificationItemProps) {
  const unread = !n.isRead && !expired
  const live = Boolean(n.ephemeral || n.id.startsWith('live-'))
  const readyToAccept = isReadyToAcceptNotif(n.type ?? n.kind)
  const pad = density === 'comfortable' ? 'px-3.5 py-3 sm:px-4' : 'px-3 py-2.5'

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group w-full cursor-pointer border-b border-border text-left transition-colors last:border-b-0',
        'hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
        unread && !readyToAccept && 'border-l-[3px] border-l-accent-blue bg-muted/40',
        readyToAccept &&
          !expired &&
          'border-l-[3px] border-l-red-600 bg-red-50/80 hover:bg-red-50 dark:bg-red-950/30 dark:hover:bg-red-950/45',
        expired && 'opacity-85',
        pad,
      )}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {unread ? (
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      readyToAccept ? 'bg-red-600' : 'bg-accent-blue',
                    )}
                    aria-hidden
                  />
                ) : null}
                <h3
                  className={cn(
                    'text-sm font-semibold leading-snug text-text-primary',
                    density === 'compact' ? 'line-clamp-2' : '',
                  )}
                >
                  {n.title}
                </h3>
                {readyToAccept && !expired ? (
                  <Badge color="red" solid className="!px-1.5 !py-0 text-[10px]">
                    {readyToAcceptLabel(n.type ?? n.kind)}
                  </Badge>
                ) : null}
                {unread ? (
                  <Badge
                    color={readyToAccept ? 'red' : 'blue'}
                    className="!px-1.5 !py-0 text-[10px]"
                  >
                    New
                  </Badge>
                ) : null}
                {expired ? (
                  <Badge color="gray" className="!px-1.5 !py-0 text-[10px]">
                    Expired
                  </Badge>
                ) : null}
                {live ? (
                  <Badge color="amber" className="!px-1.5 !py-0 text-[10px]">
                    Live
                  </Badge>
                ) : null}
                {showTypeBadge ? (
                  <Badge
                    color={typeColor(n.type ?? n.kind)}
                    className="!px-1.5 !py-0 text-[10px]"
                  >
                    {(n.type ?? n.kind).replaceAll('_', ' ')}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-text-secondary">
                {timeAgo(n.createdAt)}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg p-2 text-text-secondary hover:bg-muted hover:text-accent-red"
              title="Clear notification"
              aria-label="Clear notification"
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>

          <p
            className={cn(
              'mt-1 text-xs leading-relaxed text-text-secondary',
              density === 'compact' ? 'line-clamp-2' : 'line-clamp-3 sm:line-clamp-none',
            )}
          >
            {n.message}
          </p>

          <div className="mt-2">
            <span
              className="inline-flex min-h-[28px] items-center rounded-md px-2 py-1 text-[11px] font-semibold text-accent-blue group-hover:bg-accent-blue/10"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              role="link"
            >
              Open →
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
