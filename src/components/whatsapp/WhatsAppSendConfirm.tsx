import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { WhatsAppIcon, WhatsAppWord, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'

export type WhatsAppConfirmPayload = {
  title: string
  /** Who receives + which template */
  lines: string[]
  /** Optional short preview note */
  note?: string
}

type Props = {
  open: boolean
  payload: WhatsAppConfirmPayload | null
  busy?: boolean
  onCancel: () => void
  /** Save / continue and send WhatsApp templates */
  onConfirmSend: () => void
  /** Save / continue without sending WhatsApp */
  onConfirmSkip: () => void
}

/**
 * Shown before any CRM action that can fire a Meta Utility template.
 * User must choose Send or Skip so dashboard POV always knows.
 */
export function WhatsAppSendConfirm({
  open,
  payload,
  busy,
  onCancel,
  onConfirmSend,
  onConfirmSkip,
}: Props) {
  if (!payload) return null
  return (
    <Modal
      open={open}
      onClose={onCancel}
      icon={<WhatsAppIcon size={28} />}
      title={payload.title}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <WhatsAppWord size={14} />
          <span>will only send if you choose Send below</span>
        </span>
      }
      size="sm"
      accent="emerald"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" disabled={busy} onClick={onConfirmSkip}>
            Continue without message
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirmSend}
            className="border-transparent text-white"
            style={{ backgroundColor: WA_GREEN }}
          >
            <WhatsAppIcon size={16} color="#fff" />{' '}
            {busy ? 'Working…' : 'Send WhatsApp & continue'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-text-secondary">
        <p className="inline-flex flex-wrap items-center gap-1.5 font-medium text-text-primary">
          This activity can notify via <WhatsAppWord size={15} />:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          {payload.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {payload.note ? (
          <p className="rounded-[8px] border border-border bg-surface px-3 py-2 text-xs">{payload.note}</p>
        ) : null}
      </div>
    </Modal>
  )
}
