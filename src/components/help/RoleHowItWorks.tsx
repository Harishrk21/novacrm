import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Package,
  PackageCheck,
  PackagePlus,
  PhoneCall,
  ShieldCheck,
  Stamp,
  Truck,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react'
import {
  isCompanyAdmin,
  isSalesExecutive,
  isServiceDesk,
  isServiceEngineer,
  isWarehouse,
  roleLabel,
} from '@/lib/roles'
import { cn } from '@/lib/utils'

export type HowItWorksVariant = 'full' | 'compact'

type Step = {
  title: string
  /** What you actually do, in one or two short sentences. */
  body: string
  /** Who / what happens next. */
  next?: string
  link?: { label: string; to: string }
  icon: LucideIcon
}

type Guide = {
  id: 'admin' | 'sales' | 'desk' | 'engineer' | 'warehouse'
  title: string
  job: string
  steps: Step[]
  rules: string[]
  notYours: string[]
  links: Array<{ label: string; to: string }>
  showCover: boolean
}

/* ── The company chain: each login does its part, then hands over ── */
const SALES_CHAIN = [
  { who: 'sales', label: 'Sales', does: 'Enquiry → follow-up → Ready to buy → requisition' },
  { who: 'admin', label: 'Admin', does: 'Accepts the requisition' },
  { who: 'warehouse', label: 'Warehouse', does: 'Stamping → stock out → DC → ship' },
  { who: 'sales', label: 'Sales', does: 'Collects balance → Mark sale complete' },
] as const
const SERVICE_CHAIN = [
  { who: 'desk', label: 'Service desk', does: 'Customer + machine → service ticket' },
  { who: 'engineer', label: 'Engineer', does: 'Accepts → work report → payment → complete' },
  { who: 'desk', label: 'Desk / Admin', does: 'Checks report & payment → Approve & close' },
] as const

function guideForRole(role?: string | null): Guide {
  if (isServiceEngineer(role)) {
    return {
      id: 'engineer',
      title: 'Field engineer',
      job: 'Pick up service jobs, fix the machine at the customer’s site, write what you found and did, collect payment if it is chargeable, and mark the job complete.',
      steps: [
        {
          title: 'Accept a job',
          body: 'Open jobs wait in “Ready to accept”. Accept one — the first engineer to accept gets it. Admin or desk can also assign a job to you.',
          next: 'The job moves to your list and the desk sees who took it.',
          link: { label: 'Ready to accept', to: '/tickets?queue=awaiting' },
          icon: ClipboardList,
        },
        {
          title: 'Check the customer and machine',
          body: 'Before you travel, open the job: customer address, the machine, its cover (Guarantee / AMC / chargeable) and its past service.',
          link: { label: 'My jobs', to: '/tickets' },
          icon: Users,
        },
        {
          title: 'Start work',
          body: 'At the site, press Start work. The job shows “In progress” for the desk.',
          icon: Wrench,
        },
        {
          title: 'Write the work report',
          body: 'After every visit add an entry: what you found, what you did, readings, and what is next. You cannot complete a job without at least one entry.',
          next: 'The desk prints the service report from your entries.',
          icon: ClipboardCheck,
        },
        {
          title: 'Payment',
          body: 'Under Guarantee or AMC → tick “Free job”. Otherwise enter the amount and mark paid: Cash, or UPI / bank with the reference number and a photo of the receipt.',
          icon: CreditCard,
        },
        {
          title: 'Mark complete',
          body: 'Press Complete service. The job goes to the desk for approval.',
          next: 'Desk or admin checks the report and payment, then closes the job.',
          icon: CheckCircle2,
        },
      ],
      rules: [
        'No work report entry → you cannot mark the job complete.',
        'A chargeable job needs payment (or the Free job tick) before it can be completed.',
        'UPI / bank payments need the reference number and a receipt photo.',
        'Spare parts you fit are recorded on the job so the stock stays right.',
      ],
      notYours: ['Assigning jobs to others', 'Closing jobs (desk / admin approve)', 'Stock, bills and users'],
      links: [
        { label: 'Ready to accept', to: '/tickets?queue=awaiting' },
        { label: 'My jobs', to: '/tickets' },
        { label: 'Customers', to: '/contacts' },
        { label: 'Spare parts', to: '/spare-parts' },
      ],
      showCover: true,
    }
  }
  if (isServiceDesk(role)) {
    return {
      id: 'desk',
      title: 'Service desk',
      job: 'Take the customer’s call, log the service job on the right machine, keep jobs moving, and approve & close them once the engineer is done.',
      steps: [
        {
          title: 'Find or add the customer',
          body: 'Search by name, phone or CUS number. New caller → add the customer with mobile and full address (area matters for engineers).',
          link: { label: 'Customers', to: '/contacts' },
          icon: UserPlus,
        },
        {
          title: 'Make sure the machine is on file',
          body: 'Machines bought from HMS are added automatically when warehouse ships them. A machine bought elsewhere → add it as an outside machine (model, serial, where from).',
          icon: Package,
        },
        {
          title: 'Create the service ticket',
          body: 'Pick the customer and the machine, the job type (Breakdown, Installation, AMC visit, Stamping), priority and what the customer said.',
          next: 'Engineers see it in “Ready to accept”.',
          link: { label: 'New service ticket', to: '/tickets?open=1&job=service' },
          icon: ClipboardList,
        },
        {
          title: 'Watch the queue',
          body: 'Tabs show Awaiting accept, In progress and Pending approval. If nobody accepts, assign an engineer.',
          link: { label: 'Service tickets', to: '/tickets' },
          icon: Wrench,
        },
        {
          title: 'Approve & close',
          body: 'When the engineer marks complete, check the work report and the payment, then Approve & close. Print the service report or receipt if the customer wants one.',
          icon: CheckCircle2,
        },
        {
          title: 'Call customers who are due',
          body: 'AMC & Service lists machines due for service or renewal and the ones that can move to AMC. Stamping lists weighing machines due for stamping.',
          link: { label: 'AMC & Service', to: '/amc' },
          icon: Stamp,
        },
      ],
      rules: [
        'Always pick the machine on the ticket — that is how the customer page shows which machine was serviced.',
        'A job can only be closed after the engineer completes it with a work report.',
        'Jobs under Guarantee or AMC are free; outside / NGC machines are chargeable.',
      ],
      notYours: ['Sales enquiries and stock out', 'Users and company settings'],
      links: [
        { label: 'Service tickets', to: '/tickets' },
        { label: 'Customers', to: '/contacts' },
        { label: 'AMC & Service', to: '/amc' },
        { label: 'Stamping', to: '/stamping' },
      ],
      showCover: true,
    }
  }
  if (isWarehouse(role)) {
    return {
      id: 'warehouse',
      title: 'Warehouse & billing',
      job: 'Keep stock right: receive new stock, release machines for approved sales (stamping, stock out, delivery challan, ship) and handle demo units and proformas.',
      steps: [
        {
          title: 'See what to release',
          body: 'When admin accepts a sale you get a bell alert and it appears in Approved releases.',
          link: { label: 'Approved releases', to: '/erp/releases' },
          icon: ClipboardList,
        },
        {
          title: 'Stamping (weighing machines)',
          body: 'For each weighing machine say whether stamping is needed and record the stamp date and number. Other machines: No.',
          icon: Stamp,
        },
        {
          title: 'Stock out — pick the serial',
          body: 'For each product on the sale, pick the unit by serial and Reduce. Only the ordered models are allowed.',
          next: 'The machine is added to the customer with its Guarantee date.',
          icon: PackageCheck,
        },
        {
          title: 'Delivery challan → ship',
          body: 'When every product is reduced, create the delivery challan and press Ready to ship.',
          next: 'Sales collects the balance and closes the sale.',
          link: { label: 'Delivery challans', to: '/erp/delivery-challans' },
          icon: Truck,
        },
        {
          title: 'Add stock when goods arrive',
          body: 'Stock → Add stock: product, quantity, supplier, invoice. Weighing machines get their HMS ID automatically; others need a starting serial.',
          link: { label: 'Stock', to: '/erp/stock' },
          icon: PackagePlus,
        },
        {
          title: 'Demo units and proformas',
          body: 'Issue demo units to sales and take them back. Create proforma invoices in the CRM — the final GST bill is made in Tally.',
          link: { label: 'Proforma invoices', to: '/erp/invoices' },
          icon: FileText,
        },
      ],
      rules: [
        'Nothing leaves stock before admin accepts the sale.',
        'Ready to ship only after every ordered machine is reduced.',
        'Every add / reduce is kept in stock history.',
      ],
      notYours: ['Sales enquiries and service jobs', 'Users and company settings'],
      links: [
        { label: 'Approved releases', to: '/erp/releases' },
        { label: 'Stock', to: '/erp/stock' },
        { label: 'Products', to: '/erp/products' },
        { label: 'Delivery challans', to: '/erp/delivery-challans' },
      ],
      showCover: false,
    }
  }
  if (isSalesExecutive(role)) {
    return {
      id: 'sales',
      title: 'Sales desk',
      job: 'Turn enquiries into sales: follow up, confirm what the customer buys, send it for approval, collect the money and close the sale.',
      steps: [
        {
          title: 'New enquiry',
          body: 'Customer name, mobile, area, the machines they want, expected amount and the next follow-up date.',
          link: { label: 'New enquiry', to: '/sale-tracking?open=1' },
          icon: UserPlus,
        },
        {
          title: 'Follow up',
          body: 'Log every call or visit. Due follow-ups show in “My due today” and the Workqueue. Need a demo? Take a demo unit from stock and post day-wise updates.',
          link: { label: 'Workqueue', to: '/workqueue' },
          icon: PhoneCall,
        },
        {
          title: 'Ready to buy',
          body: 'When the customer confirms, press Ready to buy. The customer and company are created.',
          icon: CheckCircle2,
        },
        {
          title: 'Payment + requisition',
          body: 'Record the total and any advance, then send the requisition.',
          next: 'Admin accepts it and the warehouse is alerted automatically.',
          icon: CreditCard,
        },
        {
          title: 'Track the release',
          body: 'The sale shows warehouse progress: stamping, stock out, delivery challan, shipped.',
          icon: Truck,
        },
        {
          title: 'Collect balance → Mark sale complete',
          body: 'When the balance due is ₹0, press Mark sale complete. The sale moves to Closed · sold.',
          next: 'The machines now sit on the customer’s page with their Guarantee.',
          link: { label: 'My leads', to: '/sale-tracking' },
          icon: ShieldCheck,
        },
      ],
      rules: [
        'Requisition only after Ready to buy.',
        'Mark sale complete only after stock out, shipping and ₹0 balance.',
        'A proforma can be made any time; the final GST bill is made in Tally.',
      ],
      notYours: ['Accepting requisitions (admin)', 'Stock out and shipping (warehouse)', 'Service jobs'],
      links: [
        { label: 'My leads', to: '/sale-tracking' },
        { label: 'Workqueue', to: '/workqueue' },
        { label: 'Customers', to: '/contacts' },
        { label: 'Proforma invoices', to: '/erp/invoices' },
      ],
      showCover: true,
    }
  }
  // Company admin / manager
  return {
    id: 'admin',
    title: isCompanyAdmin(role) ? 'Admin' : roleLabel(role),
    job: 'See the whole business, approve what needs approval, step in where work is stuck, and pull any report you need.',
    steps: [
      {
        title: 'Start on the Dashboard',
        body: 'The top tiles show what needs you: sales awaiting accept, jobs nobody took, jobs to approve & close, money outstanding.',
        link: { label: 'Dashboard', to: '/' },
        icon: BarChart3,
      },
      {
        title: 'Accept sales requisitions',
        body: 'Check the customer, products and payment, then Accept.',
        next: 'The warehouse is alerted to release the stock.',
        link: { label: 'Awaiting accept', to: '/sale-tracking?queue=requisitions' },
        icon: ClipboardCheck,
      },
      {
        title: 'Keep service moving',
        body: 'Assign jobs that no engineer accepted, and Approve & close completed jobs after checking the work report and payment.',
        link: { label: 'Service tickets', to: '/tickets' },
        icon: Wrench,
      },
      {
        title: 'Ask anything, download it',
        body: 'Reports → Ask HMS: type a question like “salespeople with more than 2 sales this month” and get a table you can download in Excel.',
        link: { label: 'Reports', to: '/reports' },
        icon: FileText,
      },
      {
        title: 'Team, products and settings',
        body: 'Add or switch off logins, keep the product catalogue and company details (GSTIN, address, letterhead) right.',
        link: { label: 'Users & Roles', to: '/users' },
        icon: Users,
      },
    ],
    rules: [
      'Sales stock out only happens after your accept.',
      'Jobs close only after the engineer’s work report — you or the desk approve.',
      'CRM makes proformas; the final GST bill is made in Tally.',
    ],
    notYours: [],
    links: [
      { label: 'Dashboard', to: '/' },
      { label: 'Reports', to: '/reports' },
      { label: 'Customers', to: '/contacts' },
      { label: 'Settings', to: '/settings' },
    ],
    showCover: true,
  }
}

/* ── Cover rules: GC / NGC / AMC / outside / stamping ── */
const COVER = [
  {
    code: 'GC',
    name: 'Guarantee',
    tone: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    applies: 'Every machine sold by HMS (any brand) — 12 months from the sale.',
    means: 'Service and spare parts free. Tick “Free job” on the ticket.',
  },
  {
    code: 'NGC',
    name: 'After guarantee',
    tone: 'border-slate-500/40 bg-slate-500/10 text-text-primary',
    applies: 'Automatically once the 12-month guarantee ends.',
    means: 'Service and spare parts are chargeable.',
  },
  {
    code: 'AMC',
    name: 'Annual maintenance contract',
    tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    applies: 'Weighing machines only. 1-year contract, renewable — after the guarantee ends, or any time for existing weighing customers (also outside machines).',
    means: '2 free service visits a year (every 6 months). Spare parts are charged.',
  },
  {
    code: 'Outside',
    name: 'Bought elsewhere',
    tone: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    applies: 'Machines the customer bought from another dealer.',
    means: 'No guarantee from HMS — chargeable, unless it is a weighing machine on AMC.',
  },
  {
    code: 'Stamping',
    name: 'Legal stamping',
    tone: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    applies: 'Weighing machines only — renewed every year (quarters A–D).',
    means: 'Separate from GC / AMC. Logged as a Stamping job; the next due date is tracked on the machine.',
  },
] as const

function Steps({ steps, compact }: { steps: Step[]; compact?: boolean }) {
  return (
    <ol className="relative space-y-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-blue text-sm font-semibold text-white">
              {i + 1}
            </span>
            {i < steps.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className={cn('min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-3', compact && 'py-2.5')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <s.icon size={15} className="text-accent-blue" /> {s.title}
              </h4>
              {s.link ? (
                <Link
                  to={s.link.to}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-blue hover:underline"
                >
                  {s.link.label} <ArrowRight size={12} />
                </Link>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{s.body}</p>
            {s.next ? (
              <p className="mt-1.5 text-xs text-text-primary">
                <span className="font-semibold">Next:</span> {s.next}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

function Chain({ title, chain, me }: { title: string; chain: ReadonlyArray<{ who: string; label: string; does: string }>; me: Guide['id'] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-text-secondary">{title}</div>
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        {chain.map((c, i) => {
          const mine = c.who === me || (me === 'admin' && c.who === 'admin')
          return (
            <div key={`${c.label}-${i}`} className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className={cn(
                  'min-w-0 flex-1 rounded-lg border px-3 py-2',
                  mine ? 'border-accent-blue bg-accent-blue/10' : 'border-border bg-card',
                )}
              >
                <div className={cn('text-xs font-semibold', mine ? 'text-accent-blue' : 'text-text-primary')}>
                  {c.label}
                  {mine ? ' · you' : ''}
                </div>
                <div className="text-[11px] leading-snug text-text-secondary">{c.does}</div>
              </div>
              {i < chain.length - 1 ? <ArrowRight size={14} className="hidden shrink-0 text-text-secondary md:block" /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * "How it works" for the signed-in login: their job in one line, their steps in order (with a button
 * to the right screen and who gets the work next), where they sit in the company chain, the rules the
 * app enforces, and what GC / NGC / AMC / stamping mean.
 */
export function RoleHowItWorks({ role, variant = 'full' }: { role?: string | null; variant?: HowItWorksVariant }) {
  const g = guideForRole(role)
  const compact = variant === 'compact'
  const showSales = g.id !== 'desk' && g.id !== 'engineer'
  const showService = g.id !== 'sales' && g.id !== 'warehouse'

  return (
    <div className="space-y-5">
      {/* Your job */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent-blue">{g.title}</div>
        <p className="mt-1 max-w-3xl text-base leading-relaxed text-text-primary">{g.job}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {g.links.map((l, i) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                i === 0
                  ? 'border-accent-blue bg-accent-blue text-white hover:brightness-110'
                  : 'border-border text-text-primary hover:border-accent-blue/50',
              )}
            >
              {l.label} <ArrowRight size={13} />
            </Link>
          ))}
        </div>
      </section>

      <div className={cn('grid gap-5', !compact && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
        {/* Your steps */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Your work, step by step</h3>
          <Steps steps={g.steps} compact={compact} />
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-text-primary">The app checks these for you</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-text-secondary">
              {g.rules.map((r) => (
                <li key={r} className="flex gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
          {g.notYours.length ? (
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-text-primary">Handled by other logins</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                {g.notYours.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {/* Where you fit */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-text-primary">Where your work fits</h3>
        {showSales ? <Chain title="A sale" chain={SALES_CHAIN} me={g.id} /> : null}
        {showService ? <Chain title="A service job" chain={SERVICE_CHAIN} me={g.id} /> : null}
      </section>

      {/* Cover rules */}
      {g.showCover ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-text-primary">GC, NGC, AMC and stamping — what applies to which machine</h3>
          <p className="mt-0.5 text-xs text-text-secondary">Shown on every machine as its cover, and used to decide if a service job is free.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {COVER.map((c) => (
              <div key={c.code} className="rounded-lg border border-border p-3">
                <span className={cn('inline-block rounded-md border px-2 py-0.5 text-xs font-bold', c.tone)}>{c.code}</span>
                <div className="mt-1.5 text-sm font-semibold text-text-primary">{c.name}</div>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                  <span className="font-medium text-text-primary">For: </span>
                  {c.applies}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                  <span className="font-medium text-text-primary">Means: </span>
                  {c.means}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function resolveHowItWorksRole(role?: string | null) {
  return guideForRole(role).id
}
