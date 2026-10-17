import { Link } from 'react-router-dom'
import { Home, Search } from 'lucide-react'

/** Shown for unknown tenant routes instead of silently dumping the user on Home. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-text-secondary">
        <Search size={28} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-text-primary">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-text-secondary">
        That link does not match any screen in this workspace. Check the URL, or go back to your
        home dashboard.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] bg-accent-blue px-4 text-base font-medium text-white hover:opacity-90"
        >
          <Home size={16} /> Go home
        </Link>
        <Link
          to="/workqueue"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] border border-border bg-card px-4 text-base font-medium text-text-primary hover:bg-surface"
        >
          Open workqueue
        </Link>
      </div>
    </div>
  )
}

export default NotFoundPage
