/**
 * Engineer work report (stored as ticket customFields.dayNotes for backward compatibility).
 * Each entry says what was found and what was changed, so the service desk can build the
 * service report from it (auto-filled, editable).
 */

export type WorkOutcome = 'CONTINUE' | 'WAITING_PARTS' | 'WAITING_CUSTOMER' | 'DONE'

export const WORK_OUTCOMES: Array<{ value: WorkOutcome; label: string; color: string }> = [
  { value: 'CONTINUE', label: 'Continue next visit', color: 'blue' },
  { value: 'WAITING_PARTS', label: 'Waiting for parts', color: 'amber' },
  { value: 'WAITING_CUSTOMER', label: 'Waiting for customer', color: 'purple' },
  { value: 'DONE', label: 'Work finished', color: 'green' },
]

export type WorkEntry = {
  id: string
  day: number
  date: string
  at: string
  byUserId: string | null
  byName: string
  /** Fault / condition found on site */
  found: string
  /** Work done — what was repaired, adjusted, replaced */
  done: string
  /** Readings, calibration, test results */
  readings: string
  /** Recommendation / next action */
  next: string
  outcome: WorkOutcome | null
  /** Plain-text summary (older entries only have this) */
  note: string
  /** Before / after photos (uploaded image URLs) */
  photos: string[]
}

const s = (v: unknown) => (v == null ? '' : String(v).trim())

/** Accepts both new structured entries and the old free-text day notes. */
export function normalizeWorkEntries(raw: unknown): WorkEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r0, i) => {
    const r = (r0 && typeof r0 === 'object' ? r0 : {}) as Record<string, unknown>
    const outcome = WORK_OUTCOMES.some((o) => o.value === r.outcome) ? (r.outcome as WorkOutcome) : null
    const structured = Boolean(s(r.found) || s(r.done) || s(r.readings) || s(r.next))
    return {
      id: s(r.id) || `n-${i}`,
      day: Number(r.day) || i + 1,
      date: s(r.date),
      at: s(r.at ?? r.createdAt),
      byUserId: r.byUserId ? String(r.byUserId) : null,
      byName: s(r.byName) || 'Engineer',
      found: s(r.found),
      // Old notes become "work done" so the desk still gets them in the report
      done: structured ? s(r.done) : s(r.note ?? r.text),
      readings: s(r.readings),
      next: s(r.next),
      outcome,
      note: s(r.note ?? r.text),
      photos: Array.isArray(r.photos) ? (r.photos as unknown[]).map((p) => String(p)).filter(Boolean) : [],
    }
  })
}

/** One-line plain text for timelines / old readers. */
export function workEntrySummary(e: Pick<WorkEntry, 'found' | 'done' | 'readings' | 'next'>): string {
  return [
    e.found && `Found: ${e.found}`,
    e.done && `Done: ${e.done}`,
    e.readings && `Readings: ${e.readings}`,
    e.next && `Next: ${e.next}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function dayLabel(e: WorkEntry): string {
  const d = e.at || e.date
  if (!d) return `Day ${e.day}`
  const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d)
  if (Number.isNaN(dt.getTime())) return `Day ${e.day}`
  return `Day ${e.day} (${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})`
}

/**
 * Draft text for the service report: issues = customer complaint + what was found on site;
 * work done = each visit's changes, readings and the final recommendation.
 */
export function serviceReportDraft(
  entries: WorkEntry[],
  complaint: string,
): { issues: string; workDone: string } {
  const found = entries.map((e) => e.found).filter(Boolean)
  const issues = [complaint.trim(), found.length ? `Found on site: ${found.join('; ')}` : '']
    .filter(Boolean)
    .join('\n')

  const multi = entries.length > 1
  const blocks = entries
    .filter((e) => e.done || e.readings)
    .map((e) => {
      const lines = [e.done, e.readings && `Readings: ${e.readings}`].filter(Boolean)
      return multi ? `${dayLabel(e)}: ${lines.join(' — ')}` : lines.join('\n')
    })
  const lastNext = [...entries].reverse().find((e) => e.next)?.next
  const workDone = [...blocks, lastNext ? `Recommendation: ${lastNext}` : ''].filter(Boolean).join('\n')
  return { issues, workDone }
}
