import { Link } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'

/** Shown when a signed-in user hits a route their role/areas cannot open. */
export function AccessDenied({
  title = 'You do not have access',
  hint = 'Ask your company admin if you need this area turned on for your account.',
}: {
  title?: string
  hint?: string
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-text-secondary">
        <ShieldOff size={28} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-text-secondary">{hint}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/"
          className="inline-flex h-9 items-center justify-center rounded-[6px] bg-accent-blue px-4 text-base font-medium text-white hover:opacity-90"
        >
          Go home
        </Link>
        <Link
          to="/workqueue"
          className="inline-flex h-9 items-center justify-center rounded-[6px] border border-border bg-card px-4 text-base font-medium text-text-primary hover:bg-surface"
        >
          Open workqueue
        </Link>
      </div>
    </div>
  )
}
