import { cn } from '@/lib/utils'

/** Red callout when a required field/section is missing. */
export function MissingBanner({
  message,
  className,
}: {
  message: string
  className?: string
}) {
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
    el.classList.add('ring-2', 'ring-red-500', 'ring-offset-2')
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-red-500', 'ring-offset-2')
    }, 2600)
  }
  return false
}

export function sectionErrorClass(hasError: boolean) {
  return hasError
    ? 'border-red-400 ring-2 ring-red-400/40 dark:border-red-500'
    : ''
}
