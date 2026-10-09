import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FlowStep = {
  key: string
  label: string
  hint?: string
}

type Props = {
  steps: readonly FlowStep[] | FlowStep[]
  /** Parallel to steps — true when that step is complete */
  doneFlags: boolean[]
  /** Optional click handler; parent validates and may block */
  onStepClick?: (index: number, step: FlowStep) => void
  className?: string
}

/** Ticket/sale style horizontal step bar with done / current / locked states */
export function FlowStepBar({ steps, doneFlags, onStepClick, className }: Props) {
  let activeStep = 0
  for (let i = 0; i < doneFlags.length; i++) {
    if (doneFlags[i]) activeStep = i
    else {
      activeStep = i
      break
    }
  }
  if (doneFlags.length && doneFlags.every(Boolean)) activeStep = doneFlags.length - 1

  return (
    <div className={cn('overflow-x-auto pb-1', className)}>
      <div className="flex min-w-max items-start gap-0">
        {steps.map((s, i) => {
          const done = Boolean(doneFlags[i])
          const current = i === activeStep && !doneFlags.every(Boolean)
          const locked = i > activeStep
          return (
            <div key={s.key} className="flex items-start">
              <button
                type="button"
                disabled={!onStepClick}
                onClick={() => onStepClick?.(i, s)}
                className={cn(
                  'flex w-[7.5rem] flex-col items-center gap-1 px-1 text-center sm:w-[8.5rem]',
                  onStepClick ? 'cursor-pointer' : 'cursor-default',
                )}
                title={s.hint ?? s.label}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition',
                    done && 'border-emerald-500 bg-emerald-500 text-white',
                    current && !done && 'border-[color:var(--color-accent-blue)] bg-[color:var(--color-accent-blue)] text-white',
                    locked && 'border-border bg-muted text-text-secondary',
                    !done && !current && !locked && 'border-border bg-card text-text-secondary',
                  )}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'text-[11px] font-semibold leading-tight',
                    current ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  {s.label}
                </span>
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
