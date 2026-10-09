import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ticketStatusColor, type BadgeColor } from '@/components/ui/Badge'

export const TICKET_STATUS_STEPS = [
  { key: 'OPEN', label: 'Open', short: 'Open', hint: 'Created / accept' },
  { key: 'IN_PROGRESS', label: 'In progress', short: 'Working', hint: 'Engineer on site' },
  { key: 'PENDING', label: 'Pending', short: 'Pending', hint: 'Waiting / parts' },
  { key: 'RESOLVED', label: 'Resolved', short: 'Done', hint: 'Awaiting admin close' },
  { key: 'CLOSED', label: 'Completed', short: 'Closed', hint: 'Job completed' },
] as const

export type TicketStatusKey = (typeof TICKET_STATUS_STEPS)[number]['key']

const stepTone: Record<string, { ring: string; fill: string; bar: string; text: string }> = {
  blue: {
    ring: 'ring-sky-500/30',
    fill: 'bg-sky-600 text-white',
    bar: 'bg-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
  },
  amber: {
    ring: 'ring-amber-500/30',
    fill: 'bg-amber-500 text-white',
    bar: 'bg-amber-500',
    text: 'text-amber-800 dark:text-amber-300',
  },
  orange: {
    ring: 'ring-orange-500/30',
    fill: 'bg-orange-500 text-white',
    bar: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-300',
  },
  purple: {
    ring: 'ring-violet-500/30',
    fill: 'bg-violet-600 text-white',
    bar: 'bg-violet-500',
    text: 'text-violet-700 dark:text-violet-300',
  },
  green: {
    ring: 'ring-emerald-500/30',
    fill: 'bg-emerald-600 text-white',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  gray: {
    ring: 'ring-border',
    fill: 'bg-muted text-text-secondary',
    bar: 'bg-border',
    text: 'text-text-secondary',
  },
}

function statusIndex(status: string): number {
  const i = TICKET_STATUS_STEPS.findIndex((s) => s.key === status)
  return i >= 0 ? i : 0
}

function toneFor(color: BadgeColor | string) {
  return stepTone[color] ?? stepTone.gray
}

type Props = {
  status: string
  /** compact = list rows; full = detail page */
  size?: 'compact' | 'full'
  className?: string
  /** Skip PENDING step in compact views for cleaner 4-step flow */
  skipPending?: boolean
}

/**
 * Color-coded ticket lifecycle progress until CLOSED (completed).
 */
export function TicketStatusProgress({
  status,
  size = 'compact',
  className,
  skipPending = false,
}: Props) {
  const steps = skipPending
    ? TICKET_STATUS_STEPS.filter((s) => s.key !== 'PENDING')
    : [...TICKET_STATUS_STEPS]

  // Map PENDING onto IN_PROGRESS visually when skipped
  const effective =
    skipPending && status === 'PENDING' ? 'IN_PROGRESS' : status
  const currentIdx = Math.max(
    0,
    steps.findIndex((s) => s.key === effective),
  )
  const completed = effective === 'CLOSED'
  const color = ticketStatusColor[effective] ?? 'gray'
  const currentTone = toneFor(color)

  if (size === 'compact') {
    const pct = completed
      ? 100
      : Math.round(((currentIdx + 0.55) / Math.max(steps.length - 1, 1)) * 100)
    return (
      <div className={cn('min-w-[7.5rem]', className)} title={labelizeStatus(effective)}>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className={cn('text-[11px] font-semibold', currentTone.text)}>
            {steps[currentIdx]?.short ?? labelizeStatus(effective)}
          </span>
          <span className="text-[10px] tabular-nums text-text-secondary">{pct}%</span>
        </div>
        <div className="flex items-center gap-0.5">
          {steps.map((s, i) => {
            const done = i < currentIdx || completed
            const current = i === currentIdx && !completed
            const t = toneFor(ticketStatusColor[s.key] ?? 'gray')
            return (
              <div
                key={s.key}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition',
                  done || current ? t.bar : 'bg-border',
                  current && 'ring-1 ring-offset-1 ring-offset-card',
                  current && t.ring,
                )}
                title={s.label}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className={cn('text-sm font-semibold', currentTone.text)}>
          {completed ? 'Completed' : labelizeStatus(effective)}
        </div>
        <div className="text-xs text-text-secondary">
          Step {Math.min(currentIdx + 1, steps.length)} of {steps.length}
          {completed ? ' · Closed' : ' · Until completed'}
        </div>
      </div>
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {steps.map((s, i) => {
          const done = i < currentIdx || (completed && i <= currentIdx)
          const current = i === currentIdx && !completed
          const t = toneFor(ticketStatusColor[s.key] ?? 'gray')
          return (
            <div key={s.key} className="flex min-w-0 flex-1 items-start">
              <div className="flex w-full min-w-[4.25rem] flex-col items-center text-center">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                    done && !current && 'bg-emerald-600 text-white',
                    current && cn(t.fill, 'ring-4', t.ring),
                    !done && !current && 'bg-muted text-text-secondary ring-1 ring-border',
                  )}
                >
                  {done && !current ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'mt-1.5 text-[11px] font-semibold leading-tight sm:text-xs',
                    done || current ? t.text : 'text-text-secondary',
                  )}
                >
                  {s.label}
                </span>
                <span className="mt-0.5 hidden text-[10px] text-text-secondary sm:block">
                  {s.hint}
                </span>
              </div>
              {i < steps.length - 1 ? (
                <div
                  className={cn(
                    'mt-4 h-0.5 w-full min-w-[8px] shrink',
                    i < currentIdx || completed ? 'bg-emerald-500/70' : 'bg-border',
                  )}
                  aria-hidden
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function labelizeStatus(s: string) {
  return s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Tiny solid status pill with unique color */
export function TicketStatusPill({ status }: { status: string }) {
  const color = ticketStatusColor[status] ?? 'gray'
  const label =
    TICKET_STATUS_STEPS.find((s) => s.key === status)?.label ?? labelizeStatus(status)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold text-white',
        toneFor(color).fill,
      )}
    >
      {label}
    </span>
  )
}
