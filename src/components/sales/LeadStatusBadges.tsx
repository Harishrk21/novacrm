import { Badge } from '@/components/ui/Badge'
import { leadOutcome, leadOutcomeMeta, leadStage, leadStageMeta } from '@/lib/leadStage'

/**
 * One consistent lead status everywhere: Closed / Lost, or — while open — the automatic stage.
 */
export function LeadStatusBadges({
  lead,
  activities,
  hasRequisition,
  showOpen = false,
}: {
  lead: Record<string, unknown>
  activities?: Array<Record<string, unknown>>
  hasRequisition?: boolean
  /** Also show an "Open" badge before the stage (detail header). */
  showOpen?: boolean
}) {
  const outcome = leadOutcome(lead)
  if (outcome !== 'OPEN') {
    const m = leadOutcomeMeta(outcome)
    return (
      <Badge color={m.color} solid>
        {m.label}
      </Badge>
    )
  }
  const stage = leadStageMeta(leadStage(lead, { activities, hasRequisition }))
  return (
    <>
      {showOpen ? <Badge color="blue">Open</Badge> : null}
      <Badge color={stage.color} solid>
        {stage.label}
      </Badge>
    </>
  )
}
