import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [ticket, setTicket] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setTicket(await api.getTicket(id))
    } catch {
      setTicket(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function updateStatus(status: string) {
    if (!id) return
    try {
      setTicket(await api.updateTicket(id, { status }))
      addToast({ type: 'success', message: 'Ticket updated' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Update failed' })
    }
  }

  async function sendMessage() {
    if (!id || !message.trim()) return
    try {
      await api.addTicketMessage(id, { content: message.trim() })
      setMessage('')
      await load()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Message failed' })
    }
  }

  if (loading) return <Card className="p-6 text-sm text-text-secondary">Loading ticket…</Card>
  if (!ticket) {
    return (
      <EmptyState
        title="Ticket not found"
        subtitle="It may have been deleted."
        actionLabel="Back"
        onAction={() => navigate('/tickets')}
      />
    )
  }

  const messages = (ticket.messages as Array<Record<string, unknown>>) ?? []
  const cf = (ticket.customFields as Record<string, unknown>) ?? {}

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => navigate('/tickets')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <h1 className="text-xl font-semibold">
          #{String(ticket.ticketNo)} — {String(ticket.subject)}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <p className="mb-4 whitespace-pre-wrap text-sm text-text-primary">{String(ticket.description)}</p>
          <h2 className="mb-2 text-sm font-semibold text-text-secondary">Conversation</h2>
          <ul className="mb-4 space-y-3">
            {messages.length === 0 && <li className="text-sm text-text-secondary">No replies yet.</li>}
            {messages.map((m) => (
              <li key={String(m.id)} className="rounded-lg border border-border p-3 text-sm">
                <div className="mb-1 flex justify-between text-xs text-text-secondary">
                  <span>{String(m.authorName)}</span>
                  <span>{m.createdAt ? formatDate(String(m.createdAt)) : ''}</span>
                </div>
                <p>{String(m.content)}</p>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="Add a reply…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button onClick={() => void sendMessage()}>Send</Button>
          </div>
        </Card>

        <Card className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-text-secondary">Status</div>
            <Select
              value={String(ticket.status)}
              onChange={(e) => void updateStatus(e.target.value)}
              options={['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED'].map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </div>
          <div>
            <div className="text-xs text-text-secondary">Priority</div>
            <Badge color="amber">{String(ticket.priority)}</Badge>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Category</div>
            <div>{String(cf.category ?? '—')}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">Channel</div>
            <div>{String(cf.channel ?? '—')}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">SLA due</div>
            <div>{ticket.slaDueAt ? formatDate(String(ticket.slaDueAt)) : '—'}</div>
          </div>
          {ticket.contactId ? (
            <Link className="text-accent-blue hover:underline" to={`/contacts/${ticket.contactId}`}>
              View contact
            </Link>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
