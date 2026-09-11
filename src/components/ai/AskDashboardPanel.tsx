import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api, ApiClientError } from '@/lib/api'
import { useUIStore } from '@/store/uiStore'

const SUGGESTIONS = [
  { label: 'What needs attention today?', mode: 'ask' as const, q: 'What needs attention today?' },
  { label: 'Summarize overview (5 bullets)', mode: 'overview' as const, q: 'Summarize overview' },
  { label: 'Explain spikes', mode: 'spikes' as const, q: 'Explain spikes in SLA, ticket volume, outstanding balance' },
  { label: 'Sales & pipeline pulse', mode: 'ask' as const, q: 'How is sales conversion and open pipeline?' },
]

type AskResult = {
  answer: string
  bullets: string[]
  links: Array<{ label: string; to: string }>
  caution?: string
  model?: string
  cached?: boolean
  mode?: string
}

export function AskDashboardPanel({ range }: { range: string }) {
  const addToast = useUIStore((s) => s.addToast)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)

  async function ask(opts?: { q?: string; mode?: 'ask' | 'overview' | 'spikes' }) {
    const mode = opts?.mode ?? 'ask'
    const text = (opts?.q ?? question).trim()
    if (mode === 'ask' && text.length < 3) {
      addToast({ type: 'error', message: 'Ask a short question (at least 3 characters)' })
      return
    }
    setBusy(true)
    try {
      const data = await api.aiDashboardAsk({
        question: text || (mode === 'overview' ? 'Summarize overview' : 'Explain spikes'),
        range,
        mode,
      })
      setResult(data)
      if (mode === 'ask') setQuestion(text)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'AI request failed',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 via-white to-sky-50/80 shadow-[var(--shadow-card)] dark:border-indigo-900/50 dark:from-indigo-950/40 dark:via-card dark:to-sky-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-indigo-100/80 px-4 py-3 dark:border-indigo-900/40">
        <div>
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            <Sparkles size={16} /> Ask HMS
            <span className="rounded-full bg-indigo-600/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
              Analytics AI
            </span>
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            Overview & spikes are instant from live KPIs. Free-text Ask uses AI (falls back to KPIs if slow).
            Cached ~3 min. Verify before acting.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={busy}
              onClick={() => void ask({ q: s.q, mode: s.mode })}
              className="rounded-full border border-indigo-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-indigo-800 transition hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200"
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask()
              }
            }}
            placeholder="e.g. Why are SLAs high this month?"
            className="min-w-0 flex-1 rounded-[8px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-indigo-400"
            disabled={busy}
          />
          <Button onClick={() => void ask()} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {busy ? 'Thinking…' : 'Ask'}
          </Button>
        </div>

        {result ? (
          <div className="rounded-[10px] border border-border bg-card/90 p-3">
            <div className="mb-1 flex flex-wrap gap-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              {result.mode ? <span>Mode: {result.mode}</span> : null}
              {result.cached ? <span className="text-emerald-700 dark:text-emerald-300">Cached</span> : null}
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{result.answer}</p>
            {result.bullets?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                {result.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {result.caution ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{result.caution}</p>
            ) : null}
            {result.links?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {result.links.map((l) => (
                  <Link
                    key={l.to + l.label}
                    to={l.to}
                    className="rounded-[6px] border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
                  >
                    {l.label} →
                  </Link>
                ))}
              </div>
            ) : null}
            {result.model ? (
              <p className="mt-2 text-[10px] text-text-secondary">Model: {result.model}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
