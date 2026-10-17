import { Link } from 'react-router-dom'
import { Inbox, Link2, Mail, Send, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Mailbox OAuth sync is not wired yet. This screen explains the product model
 * and routes admins to Settings → Integrations (honest empty state — no fake Connect).
 */
export function EmailsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Emails"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Emails' }]}
        actions={
          <Link to="/settings?tab=Integrations">
            <Button variant="outline">
              <Link2 size={16} /> Open Integrations
            </Button>
          </Link>
        }
      />

      <PageTip moduleKey="crm.emails" />

      <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
        <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
          Mailbox sync is not available yet
        </p>
        <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/70">
          Gmail / Outlook OAuth and thread sync are planned. Connecting a flag in Settings does not
          sync email today — use WhatsApp (Meta Cloud) for live messaging.
        </p>
      </Card>

      <Card className="flex min-h-[280px] items-center justify-center">
        <EmptyState
          icon={<Mail size={26} />}
          title="No mailbox connected"
          subtitle="When OAuth ships, each user will connect Gmail or Outlook once; threads will match contacts and log as EMAIL activities."
          actionLabel="Go to Integrations"
          onAction={() => {
            window.location.assign('/settings?tab=Integrations')
          }}
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[8px] bg-blue-50 text-accent-blue">
            <ShieldCheck size={18} />
          </div>
          <div className="font-semibold">1. Connect</div>
          <p className="mt-1 text-sm text-text-secondary">
            OAuth per user (Gmail / Microsoft 365). Tokens stay with the tenant user.
          </p>
        </Card>
        <Card>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[8px] bg-emerald-50 text-accent-green">
            <Inbox size={18} />
          </div>
          <div className="font-semibold">2. Sync & match</div>
          <p className="mt-1 text-sm text-text-secondary">
            Inbox/sent sync matches To/From to CRM contacts and leads.
          </p>
        </Card>
        <Card>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[8px] bg-amber-50 text-accent-amber">
            <Send size={18} />
          </div>
          <div className="font-semibold">3. Send from CRM</div>
          <p className="mt-1 text-sm text-text-secondary">
            Compose from a contact or deal through the connected mailbox.
          </p>
        </Card>
      </div>
    </div>
  )
}

export default EmailsPage
