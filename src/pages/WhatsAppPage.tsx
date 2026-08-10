import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCheck,
  ExternalLink,
  Link2,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  Unplug,
  UserRound,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { useAskMeisterStore } from '@/store/askMeisterStore'
import { useUIStore } from '@/store/uiStore'
import { cn, formatPhone, timeAgo } from '@/lib/utils'

export function WhatsAppPage() {
  const addToast = useUIStore((s) => s.addToast)
  const connected = useAskMeisterStore((s) => s.connected)
  const workspaceUrl = useAskMeisterStore((s) => s.workspaceUrl)
  const workspaceName = useAskMeisterStore((s) => s.workspaceName)
  const apiKey = useAskMeisterStore((s) => s.apiKey)
  const phoneNumberId = useAskMeisterStore((s) => s.phoneNumberId)
  const lastSyncedAt = useAskMeisterStore((s) => s.lastSyncedAt)
  const conversations = useAskMeisterStore((s) => s.conversations)
  const messages = useAskMeisterStore((s) => s.messages)
  const activeConversationId = useAskMeisterStore((s) => s.activeConversationId)
  const connect = useAskMeisterStore((s) => s.connect)
  const disconnect = useAskMeisterStore((s) => s.disconnect)
  const setActiveConversation = useAskMeisterStore((s) => s.setActiveConversation)
  const sendMessage = useAskMeisterStore((s) => s.sendMessage)
  const syncFromAskMeister = useAskMeisterStore((s) => s.syncFromAskMeister)

  const [url, setUrl] = useState(workspaceUrl || 'https://app.askmeister.com')
  const [key, setKey] = useState(apiKey)
  const [name, setName] = useState(workspaceName || 'AskMeister Production')
  const [phoneId, setPhoneId] = useState(phoneNumberId)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')

  const active = conversations.find((c) => c.id === activeConversationId)
  const thread = useMemo(
    () =>
      messages
        .filter((m) => m.conversationId === activeConversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages, activeConversationId],
  )
  const filtered = conversations
    .filter(
      (c) =>
        !filter ||
        c.contactName.toLowerCase().includes(filter.toLowerCase()) ||
        c.phone.includes(filter),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const unreadTotal = conversations.reduce((s, c) => s + c.unread, 0)

  function handleConnect() {
    const ok = connect({
      workspaceUrl: url,
      apiKey: key,
      workspaceName: name,
      phoneNumberId: phoneId,
    })
    if (ok) addToast({ type: 'success', message: 'AskMeister WhatsApp connected' })
    else addToast({ type: 'error', message: 'Enter a valid AskMeister API key (min 8 chars)' })
  }

  function handleSend() {
    if (!draft.trim()) return
    sendMessage(draft)
    setDraft('')
    addToast({ type: 'success', message: 'Message sent via AskMeister' })
  }

  if (!connected) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="WhatsApp"
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'WhatsApp' }]}
        />
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="overflow-hidden p-0">
            <div className="bg-gradient-to-br from-[#128C7E] via-[#075E54] to-[#0F172A] px-6 py-8 text-white">
              <Badge color="green" className="mb-3 bg-white/15 text-white">
                AskMeister integration
              </Badge>
              <h2 className="text-2xl font-bold tracking-tight">Connect your AskMeister WhatsApp inbox</h2>
              <p className="mt-2 max-w-xl text-sm text-white/80">
                NovaCRM syncs conversations from your AskMeister dashboard. Agents reply here — messages
                route through AskMeister to WhatsApp Business, and every send is logged on the contact timeline.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  ['1', 'Connect workspace', 'Paste AskMeister API key + workspace URL'],
                  ['2', 'Sync contacts', 'Match chats to CRM contacts by phone'],
                  ['3', 'Reply in CRM', 'Two-way inbox with activity logging'],
                ].map(([n, t, d]) => (
                  <div key={n} className="rounded-[8px] bg-white/10 p-3 backdrop-blur">
                    <div className="text-xs font-bold text-emerald-200">Step {n}</div>
                    <div className="mt-1 text-sm font-semibold">{t}</div>
                    <div className="mt-1 text-xs text-white/70">{d}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4 p-6">
              <Input
                label="AskMeister workspace URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://app.askmeister.com"
              />
              <Input
                label="Workspace name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="AskMeister Production"
              />
              <Input
                label="API key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="am_live_••••••••"
              />
              <Input
                label="WhatsApp phone number ID"
                value={phoneId}
                onChange={(e) => setPhoneId(e.target.value)}
                placeholder="Optional — AskMeister number ID"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleConnect}>
                  <Link2 size={16} /> Connect AskMeister
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setKey('am_demo_novacrm_key')
                    setName('AskMeister Demo')
                    addToast({ type: 'info', message: 'Demo credentials filled — click Connect' })
                  }}
                >
                  Use demo credentials
                </Button>
                <a
                  href="https://app.askmeister.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-[6px] px-3 text-sm text-accent-blue hover:underline"
                >
                  Open AskMeister <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-md font-semibold">What gets synced</h3>
            <ul className="mt-4 space-y-3 text-sm text-text-secondary">
              <li className="flex gap-2">
                <MessageCircle size={16} className="mt-0.5 text-accent-green" />
                Inbound & outbound WhatsApp messages as CRM activities
              </li>
              <li className="flex gap-2">
                <Phone size={16} className="mt-0.5 text-accent-blue" />
                Auto-link chats to Contacts / Leads by phone number
              </li>
              <li className="flex gap-2">
                <UserRound size={16} className="mt-0.5 text-accent-purple" />
                Open the linked contact 360° record from any conversation
              </li>
              <li className="flex gap-2">
                <RefreshCw size={16} className="mt-0.5 text-accent-amber" />
                Manual sync pulls the latest AskMeister inbox state
              </li>
            </ul>
            <div className="mt-6 rounded-[8px] border border-border bg-surface p-4 text-xs text-text-secondary">
              Production tip: create a dedicated AskMeister API key for NovaCRM with inbox read/send
              scopes. Webhooks can later push realtime events to <code>/api/integrations/whatsapp/webhook</code>.
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="WhatsApp"
        count={conversations.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'WhatsApp' }]}
        actions={
          <>
            <Badge color="green">AskMeister connected</Badge>
            {unreadTotal > 0 && <Badge color="amber">{unreadTotal} unread</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                syncFromAskMeister()
                addToast({ type: 'success', message: 'Synced from AskMeister' })
              }}
            >
              <RefreshCw size={14} /> Sync
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                disconnect()
                addToast({ type: 'info', message: 'AskMeister disconnected' })
              }}
            >
              <Unplug size={14} /> Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {workspaceName} · Last sync {lastSyncedAt ? timeAgo(lastSyncedAt) : 'just now'} ·{' '}
          <a href={workspaceUrl} target="_blank" rel="noreferrer" className="text-accent-blue hover:underline">
            Open AskMeister dashboard
          </a>
        </p>
      </PageHeader>

      <PageTip moduleKey="engagement.whatsapp" />

      <Card padding={false} className="grid min-h-[620px] overflow-hidden lg:grid-cols-[300px_1fr]">
        <aside className="border-r border-border">
          <div className="border-b border-border p-3">
            <Input
              placeholder="Search chats..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveConversation(c.id)}
                className={cn(
                  'flex w-full gap-3 border-b border-border px-3 py-3 text-left transition-colors duration-150',
                  activeConversationId === c.id ? 'bg-accent-blue/10' : 'hover:bg-surface',
                )}
              >
                <Avatar name={c.contactName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.contactName}</span>
                    <span className="shrink-0 text-[10px] text-text-secondary">{timeAgo(c.updatedAt)}</span>
                  </div>
                  <div className="truncate text-xs text-text-secondary">{c.lastMessage}</div>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-[10px] text-text-secondary">{formatPhone(c.phone)}</span>
                    {c.unread > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-green px-1 text-[10px] font-bold text-white">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {!filtered.length && (
              <EmptyState title="No conversations" subtitle="Sync AskMeister or wait for new messages." />
            )}
          </div>
        </aside>

        <section className="flex min-h-[620px] flex-col bg-surface">
          {active ? (
            <>
              <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={active.contactName} size="md" />
                  <div>
                    <div className="font-semibold">{active.contactName}</div>
                    <div className="text-xs text-text-secondary">{formatPhone(active.phone)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {active.tags.map((t) => (
                    <Badge key={t} color="amber">
                      {t}
                    </Badge>
                  ))}
                  {active.contactId && (
                    <Link to={`/contacts/${active.contactId}`}>
                      <Button variant="outline" size="sm">
                        <UserRound size={14} /> Open contact
                      </Button>
                    </Link>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {thread.map((m) => (
                  <div
                    key={m.id}
                    className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[75%] rounded-[10px] px-3 py-2 text-sm shadow-sm',
                        m.direction === 'outbound'
                          ? 'rounded-br-sm bg-accent-blue text-white'
                          : 'rounded-bl-sm border border-border bg-card text-text-primary',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <div
                        className={cn(
                          'mt-1 flex items-center justify-end gap-1 text-[10px]',
                          m.direction === 'outbound' ? 'text-white/70' : 'text-text-secondary',
                        )}
                      >
                        {timeAgo(m.createdAt)}
                        {m.direction === 'outbound' && <CheckCheck size={12} />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border bg-card p-3">
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="Type a WhatsApp reply…"
                    className="h-10 flex-1 rounded-[6px] border border-border bg-surface px-3 text-base outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  />
                  <Button onClick={handleSend}>
                    <Send size={16} /> Send
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-text-secondary">
                  Messages are delivered through AskMeister and logged as WhatsApp activities in NovaCRM.
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<MessageCircle size={24} />}
                title="Select a conversation"
                subtitle="Choose a chat from your AskMeister-synced inbox."
              />
            </div>
          )}
        </section>
      </Card>
    </div>
  )
}

export default WhatsAppPage
