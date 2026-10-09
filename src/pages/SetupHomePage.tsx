import { Link, Navigate } from 'react-router-dom'
import {
  BarChart3,
  Building2,
  Database,
  Download,
  GitBranch,
  Layers,
  Mail,
  MessageCircle,
  Palette,
  Shield,
  Sparkles,
  Target,
  Trash2,
  Upload,
  UserCog,
  Workflow,
  Zap,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin } from '@/lib/roles'

/**
 * Zoho-style Setup Home — dense category panels with deep-links into Settings / Users.
 */
const SETUP_PANELS: Array<{
  title: string
  icon: typeof Palette
  items: Array<{ title: string; to: string }>
}> = [
  {
    title: 'General',
    icon: Building2,
    items: [
      { title: 'Company', to: '/settings?tab=Company' },
      { title: 'Profile & appearance', to: '/settings?tab=Profile' },
      { title: 'Users & roles', to: '/users' },
    ],
  },
  {
    title: 'Security control',
    icon: Shield,
    items: [
      { title: 'Roles & permissions', to: '/users' },
      { title: 'Company settings', to: '/settings?tab=Company' },
    ],
  },
  {
    title: 'Channels',
    icon: MessageCircle,
    items: [
      { title: 'WhatsApp / integrations', to: '/settings?tab=Integrations' },
      { title: 'Email templates', to: '/settings?tab=Email%20Templates' },
      { title: 'Emails inbox', to: '/emails' },
    ],
  },
  {
    title: 'Customization',
    icon: Layers,
    items: [
      { title: 'Pipeline stages', to: '/settings?tab=Pipeline%20Stages' },
      { title: 'Lead sources', to: '/settings?tab=Lead%20Sources' },
      { title: 'Sales targets', to: '/settings?tab=Sales%20Targets' },
    ],
  },
  {
    title: 'Automation',
    icon: Workflow,
    items: [
      { title: 'Automation rules', to: '/settings?tab=Automation' },
      { title: 'WhatsApp reminders', to: '/settings?tab=Integrations' },
    ],
  },
  {
    title: 'Data administration',
    icon: Database,
    items: [
      { title: 'Import customers', to: '/contacts?import=1' },
      { title: 'Export & reports', to: '/reports' },
      { title: 'Recycle / soft-delete', to: '/settings?tab=Company' },
    ],
  },
  {
    title: 'Analytics',
    icon: BarChart3,
    items: [
      { title: 'Dashboards & KPIs', to: '/' },
      { title: 'Reports', to: '/reports' },
      { title: 'Sales targets', to: '/settings?tab=Sales%20Targets' },
    ],
  },
  {
    title: 'Experience',
    icon: Sparkles,
    items: [
      { title: 'How it works', to: '/help' },
      { title: 'Workqueue', to: '/workqueue' },
    ],
  },
]

export function SetupHomePage() {
  const role = useAuthStore((s) => s.user?.role)
  if (!isCompanyAdmin(role)) {
    return <Navigate to="/settings" replace />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Setup"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Setup' }]}
      />
      <p className="max-w-3xl text-sm text-text-secondary">
        Configure your workspace like a CRM control panel — users, channels, pipelines, and automation.
        Service tickets, AMC, stamping, and stock stay in the main menu.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {SETUP_PANELS.map((panel) => {
          const Icon = panel.icon
          return (
            <section
              key={panel.title}
              className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <div className="mb-3 flex items-center gap-2.5 border-b border-border pb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-blue)]">
                  <Icon size={16} strokeWidth={1.75} />
                </div>
                <h2 className="text-sm font-semibold text-text-primary">{panel.title}</h2>
              </div>
              <ul className="space-y-1">
                {panel.items.map((item) => (
                  <li key={item.to + item.title}>
                    <Link
                      to={item.to}
                      className="block rounded-md px-2 py-1.5 text-[13px] text-text-secondary transition-colors hover:bg-muted hover:text-[color:var(--color-accent-blue)]"
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2 pt-1 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Upload size={12} /> Import
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Download size={12} /> Export
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Zap size={12} /> Reminders hourly
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Target size={12} /> Targets
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Trash2 size={12} /> Soft-delete
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <GitBranch size={12} /> Pipelines
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Mail size={12} /> Channels
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <UserCog size={12} /> Users
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
          <Palette size={12} /> Appearance
        </span>
      </div>
    </div>
  )
}

export default SetupHomePage
