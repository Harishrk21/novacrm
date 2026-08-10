import { Link } from 'react-router-dom'
import { Inbox, Link2, Mail, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useUIStore } from '@/store/uiStore'

/**
 * Email engagement in a real CRM (HubSpot / Salesforce / Zoho pattern):
 * 1. Each user connects their mailbox via OAuth (Gmail / Microsoft 365).
 * 2. CRM stores refresh tokens scoped to that user + tenant (never shares passwords).
 * 3. Sync job pulls threads; To/From/CC are matched to contacts & leads by email.
 * 4. Matched messages land on the contact/deal timeline as EMAIL activities.
 * 5. Compose from CRM sends via the connected mailbox (SMTP/Graph/Gmail API).
 * 6. Opens/clicks (optional) use tracking pixels / link wrappers for engagement stats.
 *
 * NovaCRM currently shows the connect UX only — mailbox OAuth + sync is the next build.
 */
export function EmailsPage() {
  const addToast = useUIStore((s) => s.addToast)
  return (
    <div className="space-y-5">
      <PageHeader
        title="Emails"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Emails' }]}
        actions={
          <Button
            variant="outline"
            onClick={() =>
              addToast({
                type: 'info',
                message: 'Connect Gmail or Outlook in Settings → Integrations (OAuth coming next)',
              })
            }
          >
            <Link2 size={16} /> Connect mailbox
          </Button>
        }
      />

      <PageTip moduleKey="crm.emails" />

      <Card className="flex min-h-[320px] items-center justify-center">
        <EmptyState
          icon={<Mail size={26} />}
          title="No mailbox connected"
          subtitle="In a production CRM, you connect Gmail or Outlook once; threads then sync onto contacts and deals automatically."
          actionLabel="Open Integrations"
          onAction={() => {
            window.location.href = '/settings'
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
            OAuth per user (Gmail / Microsoft 365). Tokens stay with the tenant user — CRM never stores the mailbox password.
          </p>
        </Card>
        <Card>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[8px] bg-emerald-50 text-accent-green">
            <Inbox size={18} />
          </div>
          <div className="font-semibold">2. Sync & match</div>
          <p className="mt-1 text-sm text-text-secondary">
            Inbox/sent sync matches To/From to CRM contacts and leads, then logs an EMAIL activity on that record’s timeline.
          </p>
        </Card>
        <Card>
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[8px] bg-amber-50 text-accent-amber">
            <Send size={18} />
          </div>
          <div className="font-semibold">3. Send from CRM</div>
          <p className="mt-1 text-sm text-text-secondary">
            Compose from a contact or deal; send through the connected mailbox so replies stay in the same thread and CRM history.
          </p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Same idea as WhatsApp + AskMeister</div>
          <p className="mt-1 text-sm text-text-secondary">
            Channel connected → conversations linked to people → logged as engagement. Email uses OAuth sync instead of a WhatsApp gateway.
          </p>
        </div>
        <Link to="/settings">
          <Button variant="outline" size="sm">
            <RefreshCw size={14} /> Configure
          </Button>
        </Link>
      </Card>
    </div>
  )
}

export default EmailsPage
