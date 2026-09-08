import { useState, type ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useUIStore } from '@/store/uiStore'
import { ApiClientError } from '@/lib/api'

type AssistResult = Record<string, unknown> & {
  disclaimer?: string
  caution?: string
  cached?: boolean
  model?: string
}

export function AiAssistCard({
  title,
  subtitle,
  actions,
  onApply,
}: {
  title: string
  subtitle?: string
  actions: Array<{
    id: string
    label: string
    run: () => Promise<AssistResult>
  }>
  onApply?: (actionId: string, result: AssistResult) => void
}) {
  const addToast = useUIStore((s) => s.addToast)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<AssistResult | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)

  async function run(a: (typeof actions)[number]) {
    setBusyId(a.id)
    try {
      const data = await a.run()
      setResult(data)
      setLastAction(a.id)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'AI request failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  const bullets = Array.isArray(result?.bullets) ? (result!.bullets as string[]) : []
  const checklist = Array.isArray(result?.checklist) ? (result!.checklist as string[]) : []
  const flags = Array.isArray(result?.flags) ? (result!.flags as string[]) : []
  const visitQuestions = Array.isArray(result?.visitQuestions)
    ? (result!.visitQuestions as string[])
    : []

  const primaryText =
    (typeof result?.answer === 'string' && result.answer) ||
    (typeof result?.summary === 'string' && result.summary) ||
    (typeof result?.polished === 'string' && result.polished) ||
    (typeof result?.message === 'string' && result.message) ||
    (typeof result?.updateText === 'string' && result.updateText) ||
    (typeof result?.result === 'string' && result.result) ||
    (typeof result?.notes === 'string' && result.notes) ||
    (typeof result?.suggestedNextDueNote === 'string' && result.suggestedNextDueNote) ||
    ''

  return (
    <div className="rounded-[12px] border border-indigo-200/80 bg-gradient-to-br from-indigo-50/60 to-white p-4 dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-card">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            <Sparkles size={15} /> {title}
          </div>
          {subtitle ? <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        {result?.cached ? (
          <span className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
            Cached
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant="outline"
            disabled={busyId != null}
            onClick={() => void run(a)}
          >
            {busyId === a.id ? <Loader2 size={14} className="animate-spin" /> : null}
            {a.label}
          </Button>
        ))}
      </div>

      {result ? (
        <div className="mt-3 space-y-2 rounded-[8px] border border-border bg-card/90 p-3 text-sm">
          {primaryText ? (
            <p className="whitespace-pre-wrap leading-relaxed text-text-primary">{primaryText}</p>
          ) : null}
          {typeof result.priority === 'string' ? (
            <p className="text-xs text-text-secondary">
              Suggested priority: <strong>{String(result.priority)}</strong>
              {result.category ? <> · category: <strong>{String(result.category)}</strong></> : null}
            </p>
          ) : null}
          {typeof result.lineDescription === 'string' ? (
            <p className="text-xs text-text-secondary">Line: {String(result.lineDescription)}</p>
          ) : null}
          {typeof result.amcWording === 'string' ? (
            <p className="text-xs text-text-secondary">AMC wording: {String(result.amcWording)}</p>
          ) : null}
          {bullets.length ? (
            <ul className="list-disc space-y-1 pl-5 text-text-secondary">
              {bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {checklist.length ? (
            <div>
              <div className="text-xs font-semibold text-text-secondary">Checklist</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-text-secondary">
                {checklist.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {Array.isArray(result.checklist) === false && Array.isArray((result as { checklist?: unknown }).checklist)
            ? null
            : null}
          {flags.length ? (
            <ul className="list-disc space-y-1 pl-5 text-amber-800 dark:text-amber-300">
              {flags.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {visitQuestions.length ? (
            <div>
              <div className="text-xs font-semibold text-text-secondary">Ask on next visit</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-text-secondary">
                {visitQuestions.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {typeof result.readyTone === 'string' || typeof result.notInterestedTone === 'string' ? (
            <div className="space-y-1 text-xs text-text-secondary">
              {result.readyTone ? <p>Ready tone: {String(result.readyTone)}</p> : null}
              {result.notInterestedTone ? (
                <p>Not interested tone: {String(result.notInterestedTone)}</p>
              ) : null}
            </div>
          ) : null}
          {result.caution || result.disclaimer ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {String(result.caution || result.disclaimer)}
            </p>
          ) : null}
          {onApply && lastAction ? (
            <div className="pt-1">
              <Button
                size="sm"
                onClick={() => {
                  onApply(lastAction, result)
                  addToast({ type: 'success', message: 'Suggestion applied — review fields' })
                }}
              >
                Apply suggestion
              </Button>
            </div>
          ) : null}
          {result.model ? (
            <p className="text-[10px] text-text-secondary">Model: {String(result.model)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function AiHint({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] text-text-secondary">
      <Sparkles className="mr-1 inline" size={11} />
      {children}
    </p>
  )
}
