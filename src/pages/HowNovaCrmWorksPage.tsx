import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  CheckSquare,
  FileText,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Card } from '@/components/ui/Card'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin } from '@/lib/roles'

const ADMIN_FLOW = [
  { n: 1, title: 'Lead', where: 'Leads', to: '/leads', blurb: 'Capture enquiry → assign agent → qualify' },
  { n: 2, title: 'Convert', where: 'Lead drawer', to: '/leads', blurb: 'Creates Contact + Account + Deal' },
  { n: 3, title: 'Deal', where: 'Deals', to: '/deals', blurb: 'Move stages until Won or Lost' },
  { n: 4, title: 'Invoice', where: 'Invoices', to: '/erp/invoices', blurb: 'Only if Won — stock updates from DB' },
] as const

const EMPLOYEE_FLOW = [
  {
    n: 1,
    title: 'Get assigned',
    where: 'Admin assigns you',
    to: '/',
    blurb: 'Lead or activity lands on your Employee desk',
  },
  {
    n: 2,
    title: 'Open My Tasks',
    where: 'My Tasks',
    to: '/my-tasks',
    blurb: 'See due date, type, and linked lead/deal',
  },
  {
    n: 3,
    title: 'Do the work',
    where: 'Call / visit / follow-up',
    to: '/leads',
    blurb: 'Update the lead status after you contact them',
  },
  {
    n: 4,
    title: 'Mark complete',
    where: 'My Tasks',
    to: '/my-tasks',
    blurb: 'Optional notes → Mark complete → next task',
  },
] as const

export function HowNovaCrmWorksPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = isCompanyAdmin(role)

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl flex-col gap-4 pb-4">
        <PageHeader
          title="How your Employee desk works"
          breadcrumbs={[{ label: 'My work', to: '/' }, { label: 'How it works' }]}
        />
        <PageTip moduleKey="crm.help" />

        <p className="text-sm text-text-secondary">
          You are on the <strong className="text-text-primary">employee desk</strong> — not the company
          analytics dashboard. You only see leads, deals, tickets, and tasks assigned to you.
        </p>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {EMPLOYEE_FLOW.map((step, i) => (
            <Link key={step.n} to={step.to} className="group">
              <Card className="h-full transition hover:border-accent-blue/40">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-blue text-xs font-bold text-white">
                    {step.n}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-text-primary group-hover:text-accent-blue">{step.title}</div>
                    <div className="text-[11px] text-text-secondary">{step.where}</div>
                  </div>
                  {i < EMPLOYEE_FLOW.length - 1 ? (
                    <ArrowRight className="ml-auto hidden shrink-0 text-text-secondary lg:block" size={14} />
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-text-secondary">{step.blurb}</p>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <CheckSquare size={16} className="text-accent-blue" /> Your daily loop
            </h2>
            <ol className="space-y-2 text-sm text-text-secondary">
              <li>
                <span className="font-medium text-text-primary">1.</span> Open{' '}
                <Link to="/" className="text-accent-blue hover:underline">
                  My Work
                </Link>{' '}
                — focus task is on top
              </li>
              <li>
                <span className="font-medium text-text-primary">2.</span> Go to{' '}
                <Link to="/my-tasks" className="text-accent-blue hover:underline">
                  My Tasks
                </Link>{' '}
                for the full open queue
              </li>
              <li>
                <span className="font-medium text-text-primary">3.</span> Work the linked{' '}
                <Link to="/leads" className="text-accent-blue hover:underline">
                  My Leads
                </Link>
              </li>
              <li>
                <span className="font-medium text-text-primary">4.</span> Click{' '}
                <strong className="text-text-primary">Mark complete</strong> (add notes if useful)
              </li>
              <li>
                <span className="font-medium text-text-primary">5.</span> Next pending task becomes your focus
              </li>
            </ol>
          </Card>

          <Card className="border-sky-200 bg-sky-50/50">
            <h2 className="mb-2 font-semibold text-text-primary">What you will not see</h2>
            <ul className="space-y-1.5 text-sm text-text-secondary">
              <li>Company sales charts / Reports</li>
              <li>Other agents’ leads or tasks</li>
              <li>Products, inventory, purchase orders, invoices</li>
              <li>Users & roles management</li>
            </ul>
            <p className="mt-3 text-xs text-text-secondary">
              Those stay on the <strong>company admin</strong> login (e.g. demo@precisionscales.in).
            </p>
          </Card>
        </div>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Empty queue? Ask your admin to assign a lead to you — a follow-up task is created automatically.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/my-tasks"
                className="inline-flex items-center gap-1 rounded-[6px] bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <CheckSquare size={14} /> Open My Tasks
              </Link>
              <Link
                to="/"
                className="rounded-[6px] border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
              >
                My Work home
              </Link>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl flex-col gap-4 pb-4">
      <PageHeader
        title="How NovaCRM works"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'How it works' }]}
      />

      <PageTip moduleKey="crm.help" />

      <p className="text-sm text-text-secondary">
        Company admin path: enquiry → assign agent → deal → invoice. Agents work from their own Employee desk
        (My Tasks), not this analytics dashboard.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ADMIN_FLOW.map((step, i) => (
          <Link key={step.n} to={step.to} className="group">
            <Card className="h-full transition hover:border-accent-blue/40">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-blue text-xs font-bold text-white">
                  {step.n}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-text-primary group-hover:text-accent-blue">{step.title}</div>
                  <div className="text-[11px] text-text-secondary">{step.where}</div>
                </div>
                {i < ADMIN_FLOW.length - 1 ? (
                  <ArrowRight className="ml-auto hidden shrink-0 text-text-secondary lg:block" size={14} />
                ) : null}
              </div>
              <p className="mt-2 text-sm text-text-secondary">{step.blurb}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Admin checklist</h2>
          <ol className="space-y-2 text-sm text-text-secondary">
            <li>
              <span className="font-medium text-text-primary">1.</span> Add lead →{' '}
              <strong className="text-text-primary">assign an agent</strong> (creates their follow-up task)
            </li>
            <li>
              <span className="font-medium text-text-primary">2.</span> Track progress on Dashboard → Team work
            </li>
            <li>
              <span className="font-medium text-text-primary">3.</span> When qualified → Convert lead
            </li>
            <li>
              <span className="font-medium text-text-primary">4.</span> Move deal on{' '}
              <Link to="/deals" className="text-accent-blue hover:underline">
                Deals
              </Link>
            </li>
            <li>
              <span className="font-medium text-text-primary">5.</span> If{' '}
              <span className="text-accent-green">Won</span> → Create invoice
            </li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1">
              <Users size={12} /> Contact = person
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1">
              <Building2 size={12} /> Account = company
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1">
              <Briefcase size={12} /> Deal = opportunity
            </span>
          </div>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/40">
          <div className="mb-2 flex items-center gap-2 text-accent-green">
            <CheckCircle2 size={18} />
            <h2 className="font-semibold">Won path</h2>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            Deal → <strong className="text-text-primary">Won</strong> → Create invoice → add products → stock
            deducts → download PDF.
          </p>
          <Link
            to="/erp/invoices"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-blue hover:underline"
          >
            <FileText size={14} /> Open invoices →
          </Link>
        </Card>

        <Card className="border-red-200 bg-red-50/40">
          <div className="mb-2 flex items-center gap-2 text-accent-red">
            <XCircle size={18} />
            <h2 className="font-semibold">Lost path</h2>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            Deal → <strong className="text-text-primary">Lost</strong> + reason → stop. No invoice.
          </p>
          <Link
            to="/deals"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-blue hover:underline"
          >
            <Briefcase size={14} /> Open deals →
          </Link>
        </Card>
      </div>

      <Card className="shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Admin</span> — this dashboard + assign work.{' '}
            <span className="font-medium text-text-primary">Agent</span> — separate Employee desk → My Tasks →
            Mark complete.
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/"
              className="rounded-[6px] bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Dashboard
            </Link>
            <Link
              to="/leads"
              className="inline-flex items-center gap-1 rounded-[6px] border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
            >
              <UserPlus size={14} /> Assign a lead
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default HowNovaCrmWorksPage
