import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  MessageCircle,
  Package,
  Ticket,
  Users,
  Wrench,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Card } from '@/components/ui/Card'
import { useAuthStore } from '@/store/authStore'
import { isCompanyAdmin } from '@/lib/roles'

/** Excel SERVICE register → NovaCRM (primary daily loop) */
const SERVICE_FLOW = [
  {
    n: 1,
    title: 'Customer',
    where: 'Customers',
    to: '/contacts',
    blurb: 'Shop name, street, door, area, pin, phone, location',
  },
  {
    n: 2,
    title: 'Machine',
    where: 'Customer → Machines',
    to: '/contacts',
    blurb: 'Weighing / billing / CCTV — AMC or Non-AMC, next due, AMC end, reminders',
  },
  {
    n: 3,
    title: 'Service job',
    where: 'Service tickets',
    to: '/tickets',
    blurb: 'OD, payment, advance, balance; delivered-by can wait until after delivery',
  },
  {
    n: 4,
    title: 'Complete & paid',
    where: 'Job detail',
    to: '/tickets',
    blurb: 'Complete service → Mark paid fully → download job sheet PDF + WhatsApp',
  },
] as const

const EMPLOYEE_FLOW = [
  {
    n: 1,
    title: 'My jobs',
    where: 'Home / My Tickets',
    to: '/tickets',
    blurb: 'Open queue — pick the next service job',
  },
  {
    n: 2,
    title: 'Check customer',
    where: 'Customers',
    to: '/contacts',
    blurb: 'Machines + past jobs before you start',
  },
  {
    n: 3,
    title: 'Update job',
    where: 'Job detail',
    to: '/tickets',
    blurb: 'Start work → notes → waiting if needed',
  },
  {
    n: 4,
    title: 'Mark resolved',
    where: 'Complete service',
    to: '/tickets',
    blurb: 'Balance stays on record; next due stays on the machine',
  },
] as const

export function HowNovaCrmWorksPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = isCompanyAdmin(role)

  if (!isAdmin) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl flex-col gap-4 pb-4">
        <PageHeader
          title="How service desk works"
          breadcrumbs={[{ label: 'My work', to: '/' }, { label: 'How it works' }]}
        />
        <PageTip moduleKey="crm.help" />

        <p className="text-sm text-text-secondary">
          Same as the paper <strong className="text-text-primary">SERVICE</strong> register:{' '}
          <strong className="text-text-primary">Customer → Machine → Service job</strong>. Complete the job
          when work is done.
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

        <Card>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Ticket size={16} className="text-accent-blue" /> Example — HMS Enterprises
          </h2>
          <ol className="space-y-2 text-sm text-text-secondary">
            <li>
              <span className="font-medium text-text-primary">1.</span> Find/create customer HMS in{' '}
              <Link to="/contacts" className="text-accent-blue hover:underline">
                Customers
              </Link>
            </li>
            <li>
              <span className="font-medium text-text-primary">2.</span> Add machine{' '}
              <strong className="text-text-primary">WEIGHING SCALE 20KG</strong> on Machines tab
            </li>
            <li>
              <span className="font-medium text-text-primary">3.</span> New service job — payment ₹1200, advance
              ₹500, balance ₹700, your name as received
            </li>
            <li>
              <span className="font-medium text-text-primary">4.</span> Open the job → Start work →{' '}
              <strong className="text-text-primary">Complete service</strong>
            </li>
          </ol>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              Next visit: same customer + same machine → only a new service job.
            </p>
            <Link
              to="/tickets"
              className="inline-flex items-center gap-1 rounded-[6px] bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Ticket size={14} /> My Tickets
            </Link>
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
        Built around your Excel <strong className="text-text-primary">SERVICE</strong> sheet:{' '}
        <strong className="text-text-primary">Customer → Machine → Service job</strong>. Sales (Leads /
        Deals) stays secondary for new enquiries.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICE_FLOW.map((step, i) => (
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
                {i < SERVICE_FLOW.length - 1 ? (
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
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Day-1 checklist (Excel → CRM)</h2>
          <ol className="space-y-2 text-sm text-text-secondary">
            <li>
              <span className="font-medium text-text-primary">1.</span>{' '}
              <Link to="/contacts" className="text-accent-blue hover:underline">
                Customers
              </Link>{' '}
              — shop + address + phone
            </li>
            <li>
              <span className="font-medium text-text-primary">2.</span> Customer detail →{' '}
              <strong className="text-text-primary">Machines</strong> — scale / billing / CCTV
            </li>
            <li>
              <span className="font-medium text-text-primary">3.</span>{' '}
              <Link to="/tickets" className="text-accent-blue hover:underline">
                New service job
              </Link>{' '}
              — stamping, OD, payment, advance, executives, next due
            </li>
            <li>
              <span className="font-medium text-text-primary">4.</span> Open job → work →{' '}
              <span className="text-accent-green">Resolved</span>
            </li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1">
              <Users size={12} /> Customer = shop
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1">
              <Package size={12} /> Machine = asset
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1">
              <Wrench size={12} /> Job = Excel row
            </span>
          </div>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/40">
          <div className="mb-2 flex items-center gap-2 text-accent-green">
            <CheckCircle2 size={18} />
            <h2 className="font-semibold">After you create a job</h2>
          </div>
          <ol className="space-y-2 text-sm text-text-secondary">
            <li>
              <strong className="text-text-primary">Open</strong> — job appears on list + dashboard
            </li>
            <li>
              <strong className="text-text-primary">Click the job</strong> — detail: money, machine,
              executives, notes
            </li>
            <li>
              <strong className="text-text-primary">Start work</strong> → In progress
            </li>
            <li>
              <strong className="text-text-primary">Complete service</strong> → Resolved; next due stays on
              machine; WhatsApp only if connected in Settings → Integrations
            </li>
          </ol>
          <Link
            to="/tickets"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-blue hover:underline"
          >
            <Ticket size={14} /> Open service jobs →
          </Link>
        </Card>

        <Card className="border-border bg-surface/50">
          <div className="mb-2 flex items-center gap-2 text-text-primary">
            <Building2 size={18} />
            <h2 className="font-semibold">Accounts vs Activities</h2>
          </div>
          <p className="mb-2 text-sm leading-relaxed text-text-secondary">
            <strong className="text-text-primary">Accounts</strong> = company / GST billing entity (optional).
            Day-to-day service uses <strong className="text-text-primary">Customers</strong> + machines.
          </p>
          <p className="text-sm leading-relaxed text-text-secondary">
            <strong className="text-text-primary">Activities</strong> = calls, meetings, tasks for follow-up
            (sales or reminders). Not required for a walk-in service job.
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            WhatsApp inbox lives under{' '}
            <Link to="/settings" className="text-accent-blue hover:underline">
              Settings → Integrations
            </Link>
            .
          </p>
          <Link
            to="/leads"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-blue hover:underline"
          >
            <Briefcase size={14} /> Sales leads (secondary) →
          </Link>
        </Card>
      </div>

      <Card className="shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Admin</span> — service dashboard + assign jobs.{' '}
            <span className="font-medium text-text-primary">Agent</span> — My Tickets → Complete service.
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/"
              className="rounded-[6px] bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Service dashboard
            </Link>
            <Link
              to="/tickets"
              className="inline-flex items-center gap-1 rounded-[6px] border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
            >
              <Ticket size={14} /> Jobs
            </Link>
            <Link
              to="/contacts"
              className="inline-flex items-center gap-1 rounded-[6px] border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
            >
              <Users size={14} /> Customers
            </Link>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1 rounded-[6px] border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
            >
              <MessageCircle size={14} /> WhatsApp settings
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default HowNovaCrmWorksPage
