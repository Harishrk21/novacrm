import { Info, Lightbulb, AlertTriangle, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

type TipType = 'TIP' | 'NOTE' | 'WARNING' | 'BEST_PRACTICE'

interface FeatureTipProps {
  title: string
  body: string
  tipType?: TipType
  className?: string
  dismissible?: boolean
  onDismiss?: () => void
}

const styles: Record<TipType, { icon: typeof Info; wrap: string; iconColor: string }> = {
  TIP: { icon: Lightbulb, wrap: 'border-accent-blue/30 bg-accent-blue/5', iconColor: 'text-accent-blue' },
  NOTE: { icon: Info, wrap: 'border-border bg-muted', iconColor: 'text-text-secondary' },
  WARNING: { icon: AlertTriangle, wrap: 'border-accent-amber/40 bg-accent-amber/10', iconColor: 'text-accent-amber' },
  BEST_PRACTICE: { icon: Star, wrap: 'border-accent-green/30 bg-accent-green/5', iconColor: 'text-accent-green' },
}

/** Tip / note banner shown on every major CRM & ERP section */
export function FeatureTip({
  title,
  body,
  tipType = 'TIP',
  className,
  dismissible,
  onDismiss,
}: FeatureTipProps) {
  const meta = styles[tipType]
  const Icon = meta.icon
  return (
    <div className={cn('mb-4 flex gap-3 rounded-[8px] border px-4 py-3', meta.wrap, className)}>
      <Icon size={18} className={cn('mt-0.5 shrink-0', meta.iconColor)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-text-secondary">{body}</p>
      </div>
      {dismissible && (
        <button onClick={onDismiss} className="text-xs text-text-secondary hover:text-text-primary">
          Dismiss
        </button>
      )}
    </div>
  )
}

/** Default tips when API not connected yet */
export const DEFAULT_TIPS: Record<string, { title: string; body: string; tipType: TipType }> = {
  'crm.dashboard': {
    title: 'Service desk first',
    body: 'Start on Service desk: open tickets, SLA breaches, resolved today. Sales / Leads tabs stay available below for pipeline work.',
    tipType: 'TIP',
  },
  'crm.leads': {
    title: 'Leads → Demo → Sold',
    body: 'Statuses: Pending, Demo, Converted, Not interested. Choosing Demo asks for a serial — that unit leaves stock until convert marks it sold.',
    tipType: 'TIP',
  },
  'crm.contacts': {
    title: 'Contacts',
    body: 'Store buyers and decision-makers here. Click a row for the full customer profile.',
    tipType: 'TIP',
  },
  'crm.deals': {
    title: 'Pipeline Kanban',
    body: 'Drag cards between stages. Mark Lost with a reason so reports show where deals drop off for your industry.',
    tipType: 'BEST_PRACTICE',
  },
  'crm.tickets': {
    title: 'Service tickets first',
    body: 'Find the customer in Contacts, review purchase history, open a service ticket, assign an agent. Completing the ticket can WhatsApp the customer automatically.',
    tipType: 'TIP',
  },
  'erp.products': {
    title: 'Products & SKUs',
    body: 'Create SKUs with industry attributes (capacity, HSN, unit). Enable Track Inventory for physical goods.',
    tipType: 'TIP',
  },
  'erp.inventory': {
    title: 'Serial stock',
    body: 'Add stock per unique serial + stamping date. History shows in/out and demo issues. Catalog products are models; inventory holds physical pieces.',
    tipType: 'TIP',
  },
  'erp.invoices': {
    title: 'Invoicing tip',
    body: 'Prefer creating invoices from Sales Orders so CRM deals, stock and payments stay in sync.',
    tipType: 'TIP',
  },
  'erp.purchase_orders': {
    title: 'Purchase orders',
    body: 'Raise POs against vendors, receive stock into a warehouse, then match supplier bills to payments.',
    tipType: 'NOTE',
  },
  'engagement.whatsapp': {
    title: 'AskMeister WhatsApp',
    body: 'Connect your AskMeister API key. Chats auto-link to contacts by phone; replies are logged as WhatsApp activities.',
    tipType: 'TIP',
  },
  'platform.tenants': {
    title: 'Creating a client',
    body: 'Pick a Business Category first. Modules, terminology, pipeline and custom fields are applied automatically — then fine-tune per client.',
    tipType: 'BEST_PRACTICE',
  },
  'crm.accounts': {
    title: 'Accounts = companies',
    body: 'Store GSTIN, city and billing details on the account. Invoices and deals link here — open a row for the full company 360°.',
    tipType: 'TIP',
  },
  'crm.activities': {
    title: 'Activities = follow-ups',
    body: 'Create a call/task and assign an agent. It appears on their My Work and in admin Team work. Mark completed when done.',
    tipType: 'TIP',
  },
  'crm.emails': {
    title: 'Email inbox',
    body: 'Connect a mailbox in Settings → Integrations. Threads will attach to contacts and deals once OAuth is enabled.',
    tipType: 'NOTE',
  },
  'crm.reports': {
    title: 'Live reports',
    body: 'Charts use your workspace data (leads, deals, revenue). Change the date range, then Export CSV for sharing.',
    tipType: 'TIP',
  },
  'crm.settings': {
    title: 'Workspace settings',
    body: 'Set company profile, sales targets, pipeline stages and lead sources. Targets drive the dashboard revenue gauge.',
    tipType: 'TIP',
  },
  'crm.users': {
    title: 'Team seats',
    body: 'Add agents so you can assign leads and tasks. Each login sees only their assigned work on My Work.',
    tipType: 'BEST_PRACTICE',
  },
  'crm.employee': {
    title: 'Your service queue',
    body: 'My Tickets come first — work by SLA, then Complete service so the customer gets a WhatsApp. Leads and tasks stay secondary under Sales.',
    tipType: 'TIP',
  },
  'crm.help': {
    title: 'Service → done',
    body: 'Contact history → Service ticket → Work → Resolved → WhatsApp. Sales leads are secondary under the Sales menu.',
    tipType: 'TIP',
  },
  'settings.custom_fields': {
    title: 'Custom fields',
    body: 'Add only fields your industry needs. Mark critical buyer details as Required so agents cannot skip them.',
    tipType: 'NOTE',
  },
}
