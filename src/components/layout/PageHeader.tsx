import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

interface PageHeaderProps {
  title: string
  count?: number
  breadcrumbs?: { label: string; to?: string }[]
  actions?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, count, breadcrumbs, actions, children }: PageHeaderProps) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-sm text-text-secondary">
          {breadcrumbs.map((b, i) => (
            <span key={b.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} />}
              {b.to ? (
                <Link to={b.to} className="hover:text-accent-blue">
                  {b.label}
                </Link>
              ) : (
                <span className="text-text-primary">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-text-primary">{title}</h1>
          {count !== undefined && (
            <span className="rounded-[4px] bg-slate-100 px-2 py-0.5 text-sm font-medium text-text-secondary">
              {count}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
