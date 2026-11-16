import { useState } from 'react'
import { Check, MessageSquare, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatServiceId } from '@/lib/serviceId'
import { serviceCategoryLabel } from '@/lib/serviceFlow'
import { useUIStore } from '@/store/uiStore'

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** The text a staff member can send the customer from their own phone (SMS / email / any app). */
export function customerMessage(ticket: Row, companyName: string): string {
  const cf = (ticket.customFields && typeof ticket.customFields === 'object' ? ticket.customFields : {}) as Row
  const contact = (ticket.contact ?? {}) as Row
  const asset = (ticket.asset ?? {}) as Row
  const notes = Array.isArray(cf.dayNotes) ? (cf.dayNotes as Row[]) : []
  const last = notes.length ? notes[notes.length - 1] : null
  const done = last ? str(last.done ?? last.note) : ''
  const total = Number(ticket.paymentTotal ?? 0) || 0
  const advance = Number(ticket.advanceAmount ?? 0) || 0
  const paid = str(ticket.paymentStatus) === 'PAID'
  const due = Math.max(0, total - advance)
  const status = str(ticket.status)
  const first = str(contact.name).split(' ')[0] || 'Sir/Madam'
  const job = formatServiceId(ticket.ticketNo != null ? str(ticket.ticketNo) : undefined)
  const machine = [str(asset.name), asset.serialNo ? `(${str(asset.serialNo)})` : ''].filter(Boolean).join(' ')

  const lines = [
    `Dear ${first},`,
    `${serviceCategoryLabel(cf.category)} ${job}${machine ? ` for your ${machine}` : ''} is ${
      status === 'CLOSED' || status === 'RESOLVED' ? 'completed' : 'in progress'
    }.`,
    done ? `Work done: ${done}` : '',
    cf.freeJob ? 'Charges: Nil (covered under guarantee / AMC).' : total ? (paid ? `Amount paid: ${inr(total)}. Thank you.` : `Amount due: ${inr(due)}.`) : '',
    `— ${companyName}`,
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * HMS has no WhatsApp / SMS account, so nothing is sent automatically. This lets the desk or engineer
 * send the update from their own phone: the phone's share sheet (SMS, email, any app), a direct SMS
 * link, or copy the text on a computer.
 */
export function ShareWithCustomer({ ticket, companyName }: { ticket: Row; companyName: string }) {
  const addToast = useUIStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)
  const text = customerMessage(ticket, companyName)
  const phone = str(((ticket.contact ?? {}) as Row).phone).replace(/[^\d+]/g, '')

  async function share() {
    try {
      if (typeof navigator.share === 'function' && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
      addToast({ type: 'success', message: 'Message copied — paste it into SMS or email' })
    } catch {
      /* user closed the share sheet */
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => void share()} title={text}>
        {copied ? <Check size={16} /> : <Share2 size={16} />} {copied ? 'Copied' : 'Share with customer'}
      </Button>
      {phone ? (
        <a
          href={`sms:${phone}?body=${encodeURIComponent(text)}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-border px-3 text-sm font-medium text-text-primary hover:border-accent-blue/50 md:hidden"
        >
          <MessageSquare size={16} /> SMS
        </a>
      ) : null}
    </>
  )
}
