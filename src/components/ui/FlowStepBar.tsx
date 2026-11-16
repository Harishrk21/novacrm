import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { missedSteps, nextStep } from '@/lib/flowSteps'

export type FlowStep = {
  key: string
  label: string
  hint?: string
  /** Never blocks progress and is never "missed" (e.g. follow-up). */
  optional?: boolean
  /** Can be completed at any point (e.g. payment); doesn't make earlier steps "missed". */
  anytime?: boolean
}

type Props = {
  steps: readonly FlowStep[] | FlowStep[]
  /** Parallel to steps — true when that step is complete */
  doneFlags: boolean[]
  /** Optional click handler; parent validates and may block */
  onStepClick?: (index: number, step: FlowStep) => void
  className?: string
}

/**
 * Ticket/sale style horizontal step bar with done / current / missed / locked states.
 * "Missed" = a step left undone while a later step is already done — shown in amber with "!".
 */
export function FlowStepBar({ steps, doneFlags, onStepClick, className }: Props) {
  // Done = every required step done (optional ones may stay open)
  const allDone = doneFlags.length > 0 && doneFlags.every((d, i) => d || steps[i]?.optional)
  const missedSet = new Set(missedSteps(doneFlags, steps))
  const activeStep = nextStep(doneFlags, steps)

  return (
    <div className={cn('overflow-x-auto pb-1', className)}>
      <div className="flex min-w-max items-start gap-0 lg:min-w-0">
        {steps.map((s, i) => {
          const done = Boolean(doneFlags[i])
          const optional = Boolean(s.optional)
          const missed = missedSet.has(i)
          const current = i === activeStep && !allDone
          const locked = !done && !missed && !current && !optional
          return (
            <div key={s.key} className="flex items-start lg:min-w-0 lg:flex-1">
              <button
                type="button"
                disabled={!onStepClick}
                onClick={() => onStepClick?.(i, s)}
                className={cn(
                  'flex w-[7.5rem] flex-col items-center gap-1 px-1 text-center sm:w-[8.5rem] lg:w-auto lg:min-w-0 lg:flex-1',
                  onStepClick ? 'cursor-pointer' : 'cursor-default',
                )}
                title={missed ? `Missed — ${s.hint ?? s.label}` : (s.hint ?? s.label)}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition',
                    done && 'border-emerald-500 bg-emerald-500 text-white',
                    missed && 'border-amber-500 bg-amber-500/15 text-amber-600 ring-2 ring-amber-400/40 dark:text-amber-300',
                    current && 'border-[color:var(--color-accent-blue)] bg-[color:var(--color-accent-blue)] text-white',
                    locked && 'border-border bg-muted text-text-secondary',
                    optional && !done && 'border-dashed border-border bg-card text-text-secondary',
                  )}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : missed ? '!' : optional ? '–' : i + 1}
                </span>
                <span
                  className={cn(
                    'text-[11px] font-semibold leading-tight',
                    missed ? 'text-amber-700 dark:text-amber-300' : current ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {s.label}
                </span>
                {missed ? (
                  <span className="rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Missed
                  </span>
                ) : null}
                {s.hint ? (
                  <span className="line-clamp-2 text-[10px] leading-tight text-text-secondary/80">
                    {s.hint}
                  </span>
                ) : null}
              </button>
              {i < steps.length - 1 ? (
                <div
                  className={cn(
                    'mt-4 h-0.5 w-4 shrink-0 sm:w-6',
                    doneFlags[i] ? 'bg-emerald-500' : 'bg-border',
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
