import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, RefreshCw } from 'lucide-react'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { api, ApiClientError } from '@/lib/api'
import { useUIStore } from '@/store/uiStore'

type CloudStatus = {
  configured: boolean
  phoneNumberId: string | null
  businessAccountId: string | null
  appId: string | null
  apiVersion: string
  verifyTokenSet: boolean
  verifyToken?: string | null
  hasAppSecret: boolean
  webhookPath: string
  webhookUrlHint?: string
  note?: string
}

export function WhatsAppCloudPanel({ compact }: { compact?: boolean }) {
  const addToast = useUIStore((s) => s.addToast)
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await api.whatsappCloudStatus()
      setStatus(res)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load WhatsApp Cloud status',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendTest() {
    if (!testTo.trim()) {
      addToast({ type: 'error', message: 'Enter a mobile with country code, e.g. 919876543210' })
      return
    }
    setTesting(true)
    try {
      const res = await api.testWhatsAppCloud(testTo.trim())
      addToast({
        type: 'success',
        message: res.messageId ? `Test sent (${res.messageId})` : 'Test message sent',
      })
    } catch (err) {
      addToast({
        type: 'error',
        message:
          err instanceof ApiClientError
            ? err.message
            : 'Test failed — outside 24h window needs an approved template',
      })
    } finally {
      setTesting(false)
    }
  }

  function copyWebhook() {
    const url = status?.webhookUrlHint || status?.webhookPath || ''
    if (!url) return
    void navigator.clipboard.writeText(url).then(() => {
      addToast({ type: 'success', message: 'Webhook URL copied' })
    })
  }

  return (
    <Card className={compact ? 'p-4' : 'overflow-hidden p-0'}>
      {!compact && (
        <div className="bg-gradient-to-br from-[#075E54] via-[#128C7E] to-[#0B3D36] px-6 py-5 text-white">
          <div className="flex flex-wrap items-center gap-2">
            <WhatsAppIcon size={28} color="#fff" />
            <Badge color="green" className="bg-white/15 text-white">
              Meta Cloud API
            </Badge>
            {status?.configured ? (
              <Badge color="green" className="bg-emerald-400/20 text-emerald-100">
                Credentials loaded
              </Badge>
            ) : (
              <Badge color="amber" className="bg-amber-400/20 text-amber-50">
                Not configured
              </Badge>
            )}
          </div>
          <h2 className="mt-2 text-xl font-bold tracking-tight">WhatsApp Business (official)</h2>
          <p className="mt-1 max-w-2xl text-sm text-white/80">
            Ticket alerts and inbox replies use Meta&apos;s Cloud API from your server .env. Create Utility
            templates in WhatsApp Manager — until they are approved, session text only works inside the 24h
            customer window.
          </p>
        </div>
      )}

      <div className={compact ? 'space-y-3' : 'space-y-4 p-6'}>
        {compact && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <WhatsAppIcon size={22} />
              <div>
                <h3 className="font-semibold text-text-primary">Meta WhatsApp Cloud API</h3>
                <p className="text-sm text-text-secondary">Server credentials + webhook + test send</p>
              </div>
            </div>
            {status?.configured ? (
              <Badge color="green">Connected</Badge>
            ) : (
              <Badge color="amber">Setup needed</Badge>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-text-secondary">Checking Cloud API…</p>
        ) : status ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Phone number ID', status.phoneNumberId || '—'],
                ['WABA', status.businessAccountId || '—'],
                ['App ID', status.appId || '—'],
                ['API', status.apiVersion],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[8px] border border-border bg-surface px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</div>
                  <div className="mt-0.5 truncate font-mono text-sm text-text-primary">{value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
              <span className="inline-flex items-center gap-1">
                {status.verifyTokenSet ? (
                  <CheckCircle2 size={14} className="text-accent-green" />
                ) : null}
                Verify token {status.verifyTokenSet ? 'set' : 'missing'}
              </span>
              <span className="inline-flex items-center gap-1">
                {status.hasAppSecret ? (
                  <CheckCircle2 size={14} className="text-accent-green" />
                ) : null}
                App secret {status.hasAppSecret ? 'set' : 'missing'}
              </span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw size={14} /> Refresh
              </Button>
            </div>

            <div className="rounded-[8px] border border-border bg-surface p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Meta webhook callback URL
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="break-all text-sm text-text-primary">
                  {status.webhookUrlHint || status.webhookPath}
                </code>
                <Button variant="outline" size="sm" onClick={copyWebhook}>
                  <Copy size={14} /> Copy
                </Button>
              </div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Verify token
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="text-sm text-text-primary">{status.verifyToken || '—'}</code>
                {status.verifyToken ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(status.verifyToken || '').then(() => {
                        addToast({ type: 'success', message: 'Verify token copied' })
                      })
                    }}
                  >
                    <Copy size={14} /> Copy
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                In Meta Developer → WhatsApp → Configuration, paste the callback URL and verify token, then
                subscribe to <code>messages</code>. Localhost needs the public HTTPS tunnel URL above.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Input
                  id="wa-test-send"
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      Test send (your <span style={{ color: WA_GREEN }}>WhatsApp</span> number)
                    </span>
                  }
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="9198XXXXXXXX"
                />
              </div>
              <Button
                disabled={!status.configured || testing}
                onClick={() => void sendTest()}
                className="border-transparent text-white sm:mb-0.5"
                style={{ backgroundColor: WA_GREEN }}
              >
                <WhatsAppIcon size={16} color="#fff" /> {testing ? 'Sending…' : 'Send test'}
              </Button>
            </div>

            {status.note ? (
              <p className="flex gap-2 text-xs text-text-secondary">
                <WhatsAppIcon size={14} className="mt-0.5" />
                {status.note}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-text-secondary">Status unavailable.</p>
        )}
      </div>
    </Card>
  )
}
