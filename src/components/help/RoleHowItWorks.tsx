import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Package,
  Phone,
  RefreshCw,
  Sparkles,
  Ticket,
  Users,
  Warehouse,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  isCompanyAdmin,
  isSalesExecutive,
  isServiceDesk,
  isServiceEngineer,
  isWarehouse,
  roleLabel,
} from '@/lib/roles'

export type HowItWorksVariant = 'full' | 'compact'

type Step = {
  title: string
  where: string
  to: string
  blurb: string
  icon: LucideIcon
}

type Tip = { title: string; body: string }

type Section = {
  title: string
  items: string[]
}

type AiTool = {
  name: string
  where: string
  does: string
}

type Guide = {
  id: string
  eyebrow: string
  title: string
  summary: string
  accent: 'sky' | 'emerald' | 'amber' | 'teal' | 'indigo' | 'rose'
  steps: Step[]
  youCan: string[]
  youCannot: string[]
  sections: Section[]
  aiTools: AiTool[]
  tips: Tip[]
  actions: Array<{ label: string; to: string; primary?: boolean }>
}

const ACCENT = {
  sky: {
    hero: 'from-[#0B1F3A] via-[#123456] to-[#1e4a7a]',
    chip: 'bg-sky-400/20 text-sky-100 ring-sky-300/30',
    step: 'from-sky-50 to-white border-sky-200/80 dark:from-sky-950/40 dark:to-card dark:border-sky-900/50',
    num: 'bg-sky-600 text-white',
    soft: 'bg-sky-50/80 border-sky-200/70 dark:bg-sky-950/30 dark:border-sky-900/40',
    link: 'text-sky-700 dark:text-sky-300',
  },
  emerald: {
    hero: 'from-emerald-950 via-emerald-900 to-teal-800',
    chip: 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/30',
    step: 'from-emerald-50 to-white border-emerald-200/80 dark:from-emerald-950/40 dark:to-card dark:border-emerald-900/50',
    num: 'bg-emerald-600 text-white',
    soft: 'bg-emerald-50/80 border-emerald-200/70 dark:bg-emerald-950/30 dark:border-emerald-900/40',
    link: 'text-emerald-700 dark:text-emerald-300',
  },
  amber: {
    hero: 'from-amber-950 via-amber-900 to-orange-800',
    chip: 'bg-amber-300/20 text-amber-50 ring-amber-200/30',
    step: 'from-amber-50 to-white border-amber-200/80 dark:from-amber-950/40 dark:to-card dark:border-amber-900/50',
    num: 'bg-amber-500 text-white',
    soft: 'bg-amber-50/80 border-amber-200/70 dark:bg-amber-950/30 dark:border-amber-900/40',
    link: 'text-amber-800 dark:text-amber-300',
  },
  teal: {
    hero: 'from-teal-950 via-teal-900 to-cyan-900',
    chip: 'bg-teal-300/20 text-teal-50 ring-teal-200/30',
    step: 'from-teal-50 to-white border-teal-200/80 dark:from-teal-950/40 dark:to-card dark:border-teal-900/50',
    num: 'bg-teal-600 text-white',
    soft: 'bg-teal-50/80 border-teal-200/70 dark:bg-teal-950/30 dark:border-teal-900/40',
    link: 'text-teal-800 dark:text-teal-300',
  },
  indigo: {
    hero: 'from-indigo-950 via-indigo-900 to-slate-800',
    chip: 'bg-indigo-300/20 text-indigo-50 ring-indigo-200/30',
    step: 'from-indigo-50 to-white border-indigo-200/80 dark:from-indigo-950/40 dark:to-card dark:border-indigo-900/50',
    num: 'bg-indigo-600 text-white',
    soft: 'bg-indigo-50/80 border-indigo-200/70 dark:bg-indigo-950/30 dark:border-indigo-900/40',
    link: 'text-indigo-700 dark:text-indigo-300',
  },
  rose: {
    hero: 'from-rose-950 via-rose-900 to-slate-800',
    chip: 'bg-rose-300/20 text-rose-50 ring-rose-200/30',
    step: 'from-rose-50 to-white border-rose-200/80 dark:from-rose-950/40 dark:to-card dark:border-rose-900/50',
    num: 'bg-rose-600 text-white',
    soft: 'bg-rose-50/80 border-rose-200/70 dark:bg-rose-950/30 dark:border-rose-900/40',
    link: 'text-rose-700 dark:text-rose-300',
  },
} as const

function guideForRole(role?: string | null): Guide {
  if (isCompanyAdmin(role) || role === 'MANAGER') {
    return {
      id: 'admin',
      eyebrow: roleLabel(role),
      title: 'Complete admin guide',
      summary:
        'You have full company power: analytics, service, sales, ERP, users, and AI. CRM issues proforma only — final GST tax invoices and collections stay in Tally.',
      accent: 'sky',
      steps: [
        {
          title: 'Analytics command centre',
          where: 'Home / Dashboard',
          to: '/',
          blurb:
            'Tabs: Overview, Service, Sales, Leads, Pipeline, Activity, Stock & billing, Team. All figures are live from the database.',
          icon: LayoutDashboard,
        },
        {
          title: 'Ask HMS (AI)',
          where: 'Dashboard → Ask HMS',
          to: '/',
          blurb:
            'NL Q&A, Summarize overview (5 bullets), Explain spikes (SLA / tickets / outstanding). Answers deep-link into the app. Cached ~3 minutes.',
          icon: Sparkles,
        },
        {
          title: 'Service operations',
          where: 'Tickets · AMC · Stamping · Customers',
          to: '/tickets',
          blurb:
            'Assign engineers, clear SLA, collect balances, complete jobs, AMC/Non-AMC, stamping due. Customer 360 + Ticket AI on detail pages.',
          icon: Ticket,
        },
        {
          title: 'Sales → billing handoff',
          where: 'Sale tracking · Proforma',
          to: '/sale-tracking',
          blurb:
            'Enquiries → demo + DC → daily updates → Ready to buy / Not interested. Convert notifies warehouse. Proforma in CRM; GST in Tally.',
          icon: Briefcase,
        },
        {
          title: 'ERP & people',
          where: 'Inventory · Products · Users',
          to: '/erp/inventory',
          blurb:
            'Serial stock, demo inventory, products, proformas, purchase orders. Users & Roles set each login POV.',
          icon: Warehouse,
        },
        {
          title: 'Company settings',
          where: 'Settings · Reports · Emails',
          to: '/settings',
          blurb: 'Integrations (WhatsApp), revenue targets, reports, emails. Notifications for sale-ready / SLA events.',
          icon: ClipboardList,
        },
      ],
      youCan: [
        'See every module and every POV’s data',
        'Assign / reassign tickets and approve completions',
        'Manage users & roles, products, inventory, proformas',
        'Use Ask HMS, Ticket AI, Sales AI, Billing AI, Customer AI',
        'Set company settings, reports, and integrations',
      ],
      youCannot: [
        'Issue a final GST tax invoice inside CRM (that stays in Tally)',
        'Skip human review when applying AI suggestions',
      ],
      sections: [
        {
          title: 'Service loop (Excel SERVICE → CRM)',
          items: [
            'Customer (shop) → Machines on customer → Service ticket',
            'Statuses: OPEN → IN PROGRESS → PENDING → RESOLVED / CLOSED',
            'Money: payment, advance, OD, balance outstanding on open jobs',
            'AMC / stamping / next due live on the machine record',
          ],
        },
        {
          title: 'Sales loop',
          items: [
            'Sale tracking: Pending → Demo → Converted / Closed',
            'Demo issue picks family → industry → machine → serial; DC auto-created',
            'Daily Day 1…N updates; admin sees board + notifications',
            'Ready to buy → customer + asset; billing notified for proforma',
            'Not interested → stock returns; lead closed',
          ],
        },
        {
          title: 'Billing rule (HMS)',
          items: [
            'CRM = proforma (PI-) estimate / advance document',
            'Tally = final GST tax invoice + collections',
            'Warehouse & billing login owns proforma day-to-day; you can too',
          ],
        },
      ],
      aiTools: [
        {
          name: 'Ask HMS',
          where: 'Analytics home',
          does: 'Ask questions, 5-bullet overview, explain spikes, deep links',
        },
        {
          name: 'Ticket AI',
          where: 'Any ticket detail',
          does: 'Priority/category, summary, similar jobs, next-due wording, polish, WhatsApp draft',
        },
        {
          name: 'Sales AI',
          where: 'Demo enquiry',
          does: 'Coach, draft daily update, follow-up tone, ready-to-buy handoff checklist',
        },
        {
          name: 'Billing / Stock AI',
          where: 'Proforma · Upload · Demo inventory',
          does: 'Draft PI notes, OCR field fill (review), explain demo unit status',
        },
        {
          name: 'Customer AI',
          where: 'Customer profile',
          does: '360 summary, machines due/stamping, next-visit questions',
        },
        {
          name: 'Notification AI',
          where: 'Notifications',
          does: 'Shorten / clarify / simplify titles (display only)',
        },
      ],
      tips: [
        { title: 'Live DB', body: 'Dashboard numbers are computed from your database — not sample data.' },
        { title: 'AI = suggest', body: 'Every AI action is suggest → Apply / confirm. Nothing auto-assigns, converts, or marks paid.' },
        { title: 'Team alerts', body: 'Convert / ready-to-buy notifies admin + warehouse for proforma.' },
        { title: 'Full guide', body: 'This page is your map; home compact cards link here for the full POV.' },
      ],
      actions: [
        { label: 'Analytics + Ask HMS', to: '/', primary: true },
        { label: 'Tickets', to: '/tickets' },
        { label: 'Sale tracking', to: '/sale-tracking' },
        { label: 'Proforma invoices', to: '/erp/invoices' },
        { label: 'Users & roles', to: '/users' },
      ],
    }
  }

  if (isWarehouse(role)) {
    return {
      id: 'warehouse',
      eyebrow: 'Warehouse & billing',
      title: 'Complete warehouse & billing guide',
      summary:
        'You own serial stock, demo returns/DC, catalog, customers for billing context, and CRM proforma invoices. Final GST tax invoices and payment collection are done in Tally — not in this CRM.',
      accent: 'teal',
      steps: [
        {
          title: 'Home workspace',
          where: 'Home',
          to: '/',
          blurb: 'Shortcuts to Inventory, Demo inventory, Proforma invoices, Products. Read How it works for this POV.',
          icon: LayoutDashboard,
        },
        {
          title: 'Serial stock',
          where: 'Inventory',
          to: '/erp/inventory',
          blurb: 'Track units by warehouse (MAIN, STORE, EXECUTIVE, STAMPING). Statuses: in stock, demo, sold, etc.',
          icon: Package,
        },
        {
          title: 'Demo + DC',
          where: 'Inventory → Demo',
          to: '/erp/inventory?tab=demo',
          blurb:
            'See units out on demo with delivery challan numbers. Return / ready-to-buy when sales closes the loop. Stock AI can explain a unit in plain language.',
          icon: ClipboardList,
        },
        {
          title: 'Proforma (CRM)',
          where: 'Proforma invoices',
          to: '/erp/invoices',
          blurb:
            'Create PI when notified of a sale. Pick customer → product → serial. Print proforma. Creating PI marks serial sold in CRM.',
          icon: FileText,
        },
        {
          title: 'Upload / OCR',
          where: 'Proforma → Upload copy',
          to: '/erp/invoices',
          blurb: 'Archive Tally/paper copies. OCR assist can suggest fields — you review every value before save.',
          icon: Sparkles,
        },
        {
          title: 'Final bill in Tally',
          where: 'Outside CRM',
          to: '/erp/invoices',
          blurb: 'Raise GST tax invoice and collect payment in Tally. CRM never replaces Tally billing.',
          icon: CheckCircle2,
        },
      ],
      youCan: [
        'Inventory, products, demo stock, proforma create/print/status',
        'Customers lookup for billing',
        'Notifications for sale-ready / convert',
        'Billing AI, OCR assist, Stock AI, Customer AI',
      ],
      youCannot: [
        'Users & roles, full analytics reports, purchase orders (admin)',
        'Sale tracking ownership (sales/admin)',
        'Service ticket admin queues / AMC admin (unless also given access)',
        'Create final GST tax invoices inside CRM',
      ],
      sections: [
        {
          title: 'When a sale is ready',
          items: [
            'Notification: “Sale ready for proforma” / demo closed ready',
            'Open Proforma → New → customer + product + serial',
            'Print PI for customer; track Sent / Paid status in CRM if useful',
            'Issue GST invoice in Tally separately',
          ],
        },
        {
          title: 'Demo return paths',
          items: [
            'Not interested → return serial to stock; enquiry closed',
            'Ready to buy → customer created; you raise proforma',
            'DC stays on the demo record for print/reprint',
          ],
        },
      ],
      aiTools: [
        {
          name: 'Billing AI',
          where: 'New proforma',
          does: 'Draft notes / line description — Apply then review',
        },
        {
          name: 'OCR assist',
          where: 'Upload copy',
          does: 'Suggest document no. / date / amount from pasted text',
        },
        {
          name: 'Stock AI',
          where: 'Demo inventory',
          does: 'Explain demo unit status in plain English',
        },
        {
          name: 'Customer AI',
          where: 'Customer profile',
          does: 'Billing context / machines / visit questions',
        },
      ],
      tips: [
        { title: 'PI ≠ tax invoice', body: 'Printed CRM document is proforma. GST bill = Tally.' },
        { title: 'Never invent GST', body: 'AI must not invent invoice numbers or tax amounts — you confirm.' },
        { title: 'Serials matter', body: 'Always pick the correct serial on the proforma line so stock updates.' },
        { title: 'Notifications', body: 'Watch Notifications for convert / ready-to-buy alerts.' },
      ],
      actions: [
        { label: 'Inventory', to: '/erp/inventory', primary: true },
        { label: 'Proforma invoices', to: '/erp/invoices' },
        { label: 'Demo stock', to: '/erp/inventory?tab=demo' },
        { label: 'Products', to: '/erp/products' },
        { label: 'Customers', to: '/contacts' },
      ],
    }
  }

  if (isSalesExecutive(role)) {
    return {
      id: 'sales',
      eyebrow: 'Sales executive',
      title: 'Complete sales executive guide',
      summary:
        'You own enquiries and demos end-to-end until convert or close. You do not raise GST invoices. Warehouse raises CRM proforma; Tally is final billing.',
      accent: 'emerald',
      steps: [
        {
          title: 'Home',
          where: 'Home',
          to: '/',
          blurb: 'Pending, active demos, need today’s update, converted counts. Jump into Sale tracking.',
          icon: LayoutDashboard,
        },
        {
          title: 'New enquiry',
          where: 'Sale tracking → New',
          to: '/sale-tracking?open=1',
          blurb:
            'Customer name/phone/company. If demo: family → industry → machine → serial from stock.',
          icon: Users,
        },
        {
          title: 'Issue demo + DC',
          where: 'Enquiry detail',
          to: '/sale-tracking?status=DEMO',
          blurb:
            'Issuing a serial moves stock to DEMO and creates delivery challan (DC-xxxxx). Print/view DC anytime.',
          icon: Package,
        },
        {
          title: 'Daily updates',
          where: 'Enquiry → Day notes',
          to: '/sale-tracking?status=DEMO',
          blurb:
            'Post Day 1, Day 2… Admin sees updates + notifications. Sales AI can draft the note — you post it.',
          icon: RefreshCw,
        },
        {
          title: 'Close: ready / not interested',
          where: 'Return / convert',
          to: '/sale-tracking',
          blurb:
            'Ready to buy → convert + customer; billing notified. Not interested → return stock; lead Closed/Lost.',
          icon: CheckCircle2,
        },
        {
          title: 'After convert',
          where: 'Customers',
          to: '/contacts',
          blurb:
            'Prospect becomes a customer with the sold machine. You do not create the final GST bill — billing/Tally does.',
          icon: FileText,
        },
      ],
      youCan: [
        'Sale tracking (own enquiries), issue demo, DC print, daily updates',
        'Convert / return demo outcomes',
        'Customers (post-convert) and notifications',
        'Sales AI coach on demo enquiries; Customer AI on profiles',
      ],
      youCannot: [
        'Raise final GST invoices or own proforma billing UI',
        'Assign service engineers or run full company analytics',
        'Users & roles / company settings',
        'Invent serials or prices — use catalog stock only',
      ],
      sections: [
        {
          title: 'Statuses you use',
          items: [
            'Pending (NEW) — enquiry opened',
            'Demo — serial out; post daily updates',
            'Converted — sold / ready to buy closed',
            'Closed (LOST) — not interested / returned',
          ],
        },
        {
          title: 'Handoff to billing',
          items: [
            'Ready to buy notifies admin + warehouse',
            'They create CRM proforma (PI)',
            'GST tax invoice is raised in Tally outside CRM',
          ],
        },
      ],
      aiTools: [
        {
          name: 'Sales AI — Coach me today',
          where: 'Demo enquiry',
          does: 'Why to call / what to say next from Day notes',
        },
        {
          name: 'Sales AI — Draft daily update',
          where: 'Demo enquiry',
          does: 'Turns short bullets into a Day note — Apply then Post',
        },
        {
          name: 'Sales AI — Follow-up tone',
          where: 'Demo enquiry',
          does: 'Ready vs not-interested messaging suggestions',
        },
        {
          name: 'Sales AI — Ready handoff',
          where: 'Demo enquiry',
          does: 'Checklist for billing handoff (proforma / Tally reminder)',
        },
      ],
      tips: [
        { title: 'Post updates daily', body: 'Home highlights demos missing today’s note.' },
        { title: 'DC is automatic', body: 'No manual challan number — print from enquiry or demo inventory.' },
        { title: 'AI never converts', body: 'Coach only. You click Ready to buy / Not interested yourself.' },
        { title: 'Prospects stay aside', body: 'Demo contacts are not full Customers until convert.' },
      ],
      actions: [
        { label: 'New enquiry', to: '/sale-tracking?open=1', primary: true },
        { label: 'Active demos', to: '/sale-tracking?status=DEMO' },
        { label: 'All sale tracking', to: '/sale-tracking' },
        { label: 'Customers', to: '/contacts' },
      ],
    }
  }

  if (isServiceDesk(role)) {
    return {
      id: 'desk',
      eyebrow: 'Service desk',
      title: 'Complete service desk guide',
      summary:
        'You take calls and create jobs. Same as the paper SERVICE register: Customer → Machine → Service job. Admin assigns the field engineer. You do not own ERP billing.',
      accent: 'indigo',
      steps: [
        {
          title: 'Home queue',
          where: 'Home',
          to: '/',
          blurb: 'Open, active queue, overdue SLA, unassigned counts. Create ticket or open the list.',
          icon: LayoutDashboard,
        },
        {
          title: 'Find / add customer',
          where: 'Customers',
          to: '/contacts',
          blurb: 'Search by name or phone first. Add shop address, phones, WhatsApp. Use Customer AI for 360 context.',
          icon: Users,
        },
        {
          title: 'Confirm machine',
          where: 'Customer → Machines',
          to: '/contacts',
          blurb: 'Weighing / billing / CCTV. AMC or Non-AMC, next due, stamping. Repeat visit = same machine + new ticket.',
          icon: Wrench,
        },
        {
          title: 'Create ticket',
          where: 'New ticket',
          to: '/tickets?open=1',
          blurb:
            'Complaint, OD, payment, advance, priority, channel. Ticket opens as OPEN. Ticket AI can suggest priority/category — you confirm.',
          icon: Ticket,
        },
        {
          title: 'Track until done',
          where: 'Tickets',
          to: '/tickets',
          blurb:
            'Follow OPEN → IN PROGRESS → RESOLVED / CLOSED. Admin assigns engineer. You can add notes; do not invent payments.',
          icon: ClipboardList,
        },
        {
          title: 'Customer follow-up',
          where: 'Ticket / Customer',
          to: '/contacts',
          blurb: 'Next due stays on the machine. Use Customer AI for what to ask on the next call.',
          icon: Phone,
        },
      ],
      youCan: [
        'Create tickets, manage customer/machine records you need for intake',
        'View ticket queue and add internal notes',
        'Ticket AI (suggest), Customer AI, Notification AI',
        'Notifications for your role',
      ],
      youCannot: [
        'Assign field engineers (admin/manager)',
        'Raise proforma / GST invoices or manage inventory',
        'Sale tracking ownership',
        'Users & roles / company-wide analytics',
        'Auto-complete or mark tickets paid via AI',
      ],
      sections: [
        {
          title: 'Paper SERVICE → CRM mapping',
          items: [
            'Shop row → Customer',
            'Scale / machine columns → Machines tab',
            'Job / payment / advance / OD → Ticket',
            'Executive / received by → assignment & notes',
          ],
        },
        {
          title: 'Good intake checklist',
          items: [
            'Correct phone + address',
            'Right machine selected (or added)',
            'Clear complaint text for the engineer',
            'Payment / advance / OD if known',
            'Priority realistic (Ticket AI can suggest)',
          ],
        },
      ],
      aiTools: [
        {
          name: 'Ticket AI — triage',
          where: 'Ticket detail',
          does: 'Suggest priority + category + summary; Apply then save',
        },
        {
          name: 'Ticket AI — similar jobs',
          where: 'Ticket detail',
          does: 'Hints from past jobs on same customer',
        },
        {
          name: 'Ticket AI — next-due / AMC wording',
          where: 'Ticket detail',
          does: 'Draft wording — human confirms dates',
        },
        {
          name: 'Customer AI',
          where: 'Customer profile',
          does: '360 summary, machines due, visit questions',
        },
      ],
      tips: [
        { title: 'Never skip customer search', body: 'Duplicates create messy history — search phone first.' },
        { title: 'AI never assigns', body: 'Suggestions only. Admin picks the engineer.' },
        { title: 'One machine, many jobs', body: 'Next visit = new ticket on the same machine.' },
        { title: 'WhatsApp', body: 'Outbound customer WhatsApp is usually after work/payment — polish then human send.' },
      ],
      actions: [
        { label: 'New ticket', to: '/tickets?open=1', primary: true },
        { label: 'All tickets', to: '/tickets' },
        { label: 'Customers', to: '/contacts' },
        { label: 'Home', to: '/' },
      ],
    }
  }

  if (isServiceEngineer(role)) {
    return {
      id: 'engineer',
      eyebrow: 'Field engineer',
      title: 'Complete field engineer guide',
      summary:
        'You only see jobs assigned to you. Work by SLA, log day notes / visits, then Complete service. You do not mark company-wide billing or invent invoices.',
      accent: 'rose',
      steps: [
        {
          title: 'My home / tickets',
          where: 'Home · My tickets',
          to: '/tickets',
          blurb: 'Queue sorted by SLA. Breached / soonest due first. Open a job to start.',
          icon: Ticket,
        },
        {
          title: 'Read context',
          where: 'Customer · Machines',
          to: '/contacts',
          blurb: 'Check past jobs and machine history before travel. Customer AI can summarize.',
          icon: Users,
        },
        {
          title: 'Start work',
          where: 'Job detail',
          to: '/tickets',
          blurb: 'Start → In progress. Use Ticket AI for on-site checklist and SLA risk one-liner.',
          icon: Wrench,
        },
        {
          title: 'Day notes / visits',
          where: 'Job detail → Day notes',
          to: '/tickets',
          blurb: 'Log what you did. Polish day notes with AI, then save. Admin can see why a job is taking longer.',
          icon: ClipboardList,
        },
        {
          title: 'Customer message',
          where: 'Job detail',
          to: '/tickets',
          blurb: 'Draft WhatsApp with AI — send only after you (or desk/admin) approve. Never invent amounts.',
          icon: Phone,
        },
        {
          title: 'Complete service',
          where: 'Complete service',
          to: '/tickets',
          blurb: 'Mark resolved when done. Balance / next due stay on the machine. You do not auto-mark paid via AI.',
          icon: CheckCircle2,
        },
      ],
      youCan: [
        'Work assigned tickets only',
        'Add notes, visits, day notes; complete service',
        'Look up customers/machines for context',
        'My Tasks; Ticket AI + Customer AI (suggest only)',
      ],
      youCannot: [
        'See the full company ticket queue',
        'Assign jobs to others or manage users',
        'Create proforma / GST invoices or change inventory',
        'Auto-complete or mark paid using AI',
      ],
      sections: [
        {
          title: 'On-site order',
          items: [
            'Confirm shop + machine serial/capacity',
            'Start work on the ticket',
            'Log parts / findings in day notes',
            'Complete service when finished',
            'Leave next-due / stamping notes if relevant (confirm with desk)',
          ],
        },
        {
          title: 'SLA discipline',
          items: [
            'Red / breached jobs first',
            'Use SLA risk one-liner to stay aware',
            'If blocked, add a clear note so desk/admin can help',
          ],
        },
      ],
      aiTools: [
        {
          name: 'Polish day notes',
          where: 'Ticket detail',
          does: 'Clean job update from rough notes — Apply into visit notes',
        },
        {
          name: 'Draft WhatsApp',
          where: 'Ticket detail',
          does: 'Customer message draft — human must approve before send',
        },
        {
          name: 'On-site checklist',
          where: 'Ticket detail',
          does: 'What to check for this issue type',
        },
        {
          name: 'SLA risk one-liner',
          where: 'Ticket detail',
          does: 'Short risk line from due / breach fields',
        },
      ],
      tips: [
        { title: 'Mine only', body: 'If a job is missing, ask desk/admin to assign it — you will not see unassigned work.' },
        { title: 'AI never closes', body: 'You still tap Complete service yourself.' },
        { title: 'Facts only', body: 'Do not let AI invent spare prices or payment amounts.' },
        { title: 'My Tasks', body: 'Follow-up calls/tasks assigned to you live under My Tasks.' },
      ],
      actions: [
        { label: 'My tickets', to: '/tickets', primary: true },
        { label: 'Home', to: '/' },
        { label: 'My tasks', to: '/my-tasks' },
        { label: 'Customers', to: '/contacts' },
      ],
    }
  }

  return {
    id: 'employee',
    eyebrow: roleLabel(role) || 'Team member',
    title: 'Complete team member guide',
    summary: 'Focused workspace for assigned tickets and tasks. Ask your company admin if you need a different role (desk, sales, warehouse, engineer).',
    accent: 'amber',
    steps: [
      {
        title: 'Home',
        where: 'Home',
        to: '/',
        blurb: 'See open work and SLA pressure for your assignments.',
        icon: LayoutDashboard,
      },
      {
        title: 'My tickets',
        where: 'My Tickets',
        to: '/tickets',
        blurb: 'Open and update jobs assigned to you.',
        icon: Ticket,
      },
      {
        title: 'My tasks',
        where: 'My Tasks',
        to: '/my-tasks',
        blurb: 'Close follow-ups and calls assigned to you.',
        icon: ClipboardList,
      },
      {
        title: 'Customers',
        where: 'Customers',
        to: '/contacts',
        blurb: 'Shop + machine history when you need context.',
        icon: Users,
      },
    ],
    youCan: ['Work assigned tickets/tasks', 'Look up customers', 'Read How it works for your login'],
    youCannot: ['Company admin settings, ERP billing, or other roles’ queues unless granted'],
    sections: [
      {
        title: 'Need more access?',
        items: ['Ask company admin → Users & Roles to switch you to Desk, Sales, Warehouse, or Engineer.'],
      },
    ],
    aiTools: [
      {
        name: 'Customer AI / Ticket AI',
        where: 'If your role allows those screens',
        does: 'Suggest-only helpers — never auto-complete payments',
      },
    ],
    tips: [
      { title: 'Ask admin', body: 'Role changes are managed under Users & Roles by company admin.' },
    ],
    actions: [
      { label: 'My tickets', to: '/tickets', primary: true },
      { label: 'My tasks', to: '/my-tasks' },
      { label: 'Customers', to: '/contacts' },
    ],
  }
}

/** Compact strip for dashboard homes + full page for /help */
export function RoleHowItWorks({
  role,
  variant = 'full',
}: {
  role?: string | null
  variant?: HowItWorksVariant
}) {
  const guide = guideForRole(role)
  const a = ACCENT[guide.accent]

  if (variant === 'compact') {
    return (
      <section className={`overflow-hidden rounded-[14px] border bg-gradient-to-br ${a.step} shadow-[var(--shadow-card)]`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-inherit/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary ring-1 ring-black/5 dark:bg-white/10">
                <BookOpen size={11} /> How it works
              </span>
              <span className={`text-[11px] font-semibold ${a.link}`}>{guide.eyebrow}</span>
            </div>
            <h2 className="mt-1.5 text-sm font-semibold tracking-tight text-text-primary">{guide.title}</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-text-secondary">{guide.summary}</p>
          </div>
          <Link
            to="/help"
            className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${a.link} hover:underline`}
          >
            Full guide <ArrowRight size={12} />
          </Link>
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {guide.steps.slice(0, 6).map((step, i) => {
            const Icon = step.icon
            return (
              <Link
                key={step.title}
                to={step.to}
                className="group rounded-[10px] border border-border/80 bg-card/90 p-3 transition hover:border-accent-blue/40 hover:shadow-[var(--shadow-hover)]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${a.num}`}
                  >
                    {i + 1}
                  </span>
                  <Icon size={15} className="shrink-0 text-text-secondary" />
                  <span className="truncate text-sm font-semibold text-text-primary group-hover:text-accent-blue">
                    {step.title}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 text-[11px] leading-snug text-text-secondary">{step.blurb}</p>
              </Link>
            )
          })}
        </div>

        {guide.aiTools.length > 0 ? (
          <div className="border-t border-inherit/60 px-4 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              <Sparkles size={11} /> AI on your screens
            </div>
            <div className="flex flex-wrap gap-1.5">
              {guide.aiTools.map((t) => (
                <span
                  key={t.name}
                  className="rounded-full border border-border bg-card/80 px-2.5 py-1 text-[11px] text-text-secondary"
                  title={`${t.where}: ${t.does}`}
                >
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <div className="space-y-5 pb-6">
      <div className={`overflow-hidden rounded-[16px] bg-gradient-to-br ${a.hero} text-white shadow-[var(--shadow-hover)]`}>
        <div className="relative px-5 py-7 sm:px-8 sm:py-9">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-20 right-20 h-40 w-40 rounded-full bg-white/5"
            aria-hidden
          />
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${a.chip}`}>
            <BookOpen size={12} /> {guide.eyebrow} · complete POV guide
          </span>
          <h1 className="mt-3 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">{guide.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/80">{guide.summary}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {guide.actions.map((act) => (
              <Link
                key={act.to + act.label}
                to={act.to}
                className={
                  act.primary
                    ? 'inline-flex items-center gap-1.5 rounded-[8px] bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 hover:bg-sky-50'
                    : 'inline-flex items-center gap-1.5 rounded-[8px] border border-white/25 bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/15'
                }
              >
                {act.label}
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className={`rounded-[12px] border p-4 ${a.soft}`}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <CheckCircle2 size={16} className={a.link} /> You can
          </div>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            {guide.youCan.map((item) => (
              <li key={item} className="flex gap-2">
                <span className={`${a.link} mt-0.5`}>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-[12px] border border-rose-200/80 bg-rose-50/70 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-200">
            <XCircle size={16} /> You cannot / outside this login
          </div>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            {guide.youCannot.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-0.5 text-rose-600">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">
          Your flow · {guide.steps.length} steps
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {guide.steps.map((step, i) => {
            const Icon = step.icon
            return (
              <Link key={step.title} to={step.to} className="group">
                <div
                  className={`h-full rounded-[14px] border bg-gradient-to-br p-4 shadow-[var(--shadow-card)] transition group-hover:shadow-[var(--shadow-hover)] ${a.step}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-[10px] text-sm font-bold ${a.num}`}
                    >
                      {i + 1}
                    </span>
                    <Icon size={18} className="text-text-secondary opacity-70" />
                  </div>
                  <div className="mt-3 text-base font-semibold text-text-primary group-hover:text-accent-blue">
                    {step.title}
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                    {step.where}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.blurb}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {guide.sections.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {guide.sections.map((sec) => (
            <div key={sec.title} className="rounded-[12px] border border-border bg-card p-4 shadow-[var(--shadow-card)]">
              <h3 className="text-sm font-semibold text-text-primary">{sec.title}</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-text-secondary">
                {sec.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className={`${a.link}`}>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {guide.aiTools.length > 0 ? (
        <div className={`rounded-[14px] border p-4 ${a.soft}`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Sparkles size={16} className={a.link} />
            AI tools for this login (suggest → confirm)
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {guide.aiTools.map((tool) => (
              <div key={tool.name} className="rounded-[10px] border border-border/80 bg-card/90 px-3 py-2.5">
                <div className="text-sm font-semibold text-text-primary">{tool.name}</div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  {tool.where}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{tool.does}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-text-secondary">
            AI never auto-assigns, auto-converts, invents GST invoice numbers, or marks paid. Always review before Apply /
            send.
          </p>
        </div>
      ) : null}

      {guide.tips.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {guide.tips.map((tip) => (
            <div key={tip.title} className={`rounded-[12px] border p-4 ${a.soft}`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <CheckCircle2 size={16} className={a.link} />
                {tip.title}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{tip.body}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function resolveHowItWorksRole(role?: string | null) {
  return guideForRole(role).id
}
