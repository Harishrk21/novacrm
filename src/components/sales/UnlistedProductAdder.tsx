import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/**
 * "Not in catalogue?" — lets sales record products the customer asked for that are not
 * listed yet. Any number can be added; each becomes a removable "not listed" chip.
 */
export function UnlistedProductAdder({
  search,
  noMatches,
  onAdd,
}: {
  /** Current catalogue search text — offered as a one-click add when nothing matches. */
  search: string
  noMatches: boolean
  onAdd: (name: string) => void
}) {
  const [draft, setDraft] = useState('')
  const typed = search.trim()

  function add(raw: string) {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name) return
    onAdd(name.slice(0, 120))
    setDraft('')
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
      {noMatches ? (
        <button
          type="button"
          onClick={() => add(typed)}
          className="mb-2 flex w-full items-center gap-2 rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-left text-sm font-medium text-amber-800 transition hover:bg-amber-400/20 dark:text-amber-200"
        >
          <Plus size={14} className="shrink-0" />
          <span className="min-w-0 truncate">
            No match in catalogue — add “{typed}” as a not-listed product
          </span>
        </button>
      ) : null}
      <div className="text-xs font-medium text-text-primary">Not in the catalogue?</div>
      <p className="text-[11px] text-text-secondary">
        Type what the customer asked for and press Add — add as many as needed.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder="e.g. 60 kg platform scale with printer"
          maxLength={120}
          aria-label="Product not in catalogue"
          className="h-9 min-w-0 flex-1 rounded-[6px] border border-border bg-card px-3 text-sm text-text-primary outline-none placeholder:text-text-secondary/70 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
        />
        <Button type="button" size="sm" variant="outline" disabled={!draft.trim()} onClick={() => add(draft)}>
          <Plus size={14} /> Add
        </Button>
      </div>
    </div>
  )
}
