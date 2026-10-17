import { cn } from '@/lib/utils'

/** Callout when a required field/section needs attention. */
export function MissingBanner({
  message,
  className,
  /** `guide` = calm amber (full-page wizards). `alert` = classic red. */
  tone = 'alert',
  title,
}: {
  message: string
  className?: string
  tone?: 'alert' | 'guide'
  title?: string
}) {
  if (tone === 'guide') {
    return (
      <div
        role="status"
        className={cn(
          'rounded-xl border border-sky-200/90 bg-sky-50/90 px-4 py-3 text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/35 dark:text-sky-50',
          className,
        )}
      >
        <p className="text-sm font-semibold">{title ?? 'Please complete this step'}</p>
        <p className="mt-0.5 text-sm leading-relaxed opacity-90">{message}</p>
      </div>
    )
  }
  return (
    <div
      role="alert"
      className={cn(
        'rounded-[8px] border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-100',
        className,
      )}
    >
      Missing — {message}
    </div>
  )
}

export type FieldCheck = {
  key: string
  sectionId: string
  ok: boolean
  message: string
}

/** Collect errors, scroll to first missing section, return false if any fail. */
export function focusFirstMissing(
  checks: FieldCheck[],
  setErrors: (errs: Record<string, string>) => void,
  opts?: { ring?: 'red' | 'sky' },
): boolean {
  const errs: Record<string, string> = {}
  let firstSection: string | null = null
  for (const c of checks) {
    if (c.ok) continue
    errs[c.key] = c.message
    if (!firstSection) firstSection = c.sectionId
  }
  setErrors(errs)
  if (!firstSection) return true
  const el = document.getElementById(firstSection)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const ring =
      opts?.ring === 'sky'
        ? (['ring-2', 'ring-sky-400', 'ring-offset-2'] as const)
        : (['ring-2', 'ring-red-500', 'ring-offset-2'] as const)
    el.classList.add(...ring)
    window.setTimeout(() => {
      el.classList.remove(...ring)
    }, 2600)
  }
  return false
}

export function sectionErrorClass(hasError: boolean, tone: 'alert' | 'guide' = 'alert') {
  if (!hasError) return ''
  if (tone === 'guide') {
    return 'border-sky-300 ring-2 ring-sky-300/35 dark:border-sky-600'
  }
  return 'border-red-400 ring-2 ring-red-400/40 dark:border-red-500'
}
