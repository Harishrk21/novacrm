import { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { formatPhone } from '@/lib/utils'
import { cn } from '@/lib/utils'

export type ContactPick = {
  id: string
  name: string
  customerCode?: string | null
  phone?: string | null
  mobile?: string | null
  accountId?: string | null
  email?: string | null
}

type Props = {
  label?: string
  valueId: string
  selected?: ContactPick | null
  onSelect: (contact: ContactPick | null) => void
  error?: string
  className?: string
}

function labelFor(c: ContactPick) {
  const code = c.customerCode ? `${c.customerCode} · ` : ''
  const phone = formatPhone(String(c.phone || c.mobile || ''))
  return phone ? `${code}${c.name} · ${phone}` : `${code}${c.name}`
}

export function ContactPicker({
  label = 'Customer *',
  valueId,
  selected,
  onSelect,
  error,
  className,
}: Props) {
  const inputId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<ContactPick[]>([])

  useEffect(() => {
    if (selected?.id === valueId && selected) {
      setQuery(labelFor(selected))
    } else if (!valueId) {
      setQuery('')
    }
  }, [selected, valueId])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    // Don't search while showing a fully selected label with no edit intent —
    // if query matches selected label, wait for user to change it
    if (selected && q === labelFor(selected)) {
      setHits([])
      return
    }
    if (q.length < 2) {
      setHits([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true)
        try {
          const res = await api.contacts({ search: q, limit: 20 })
          if (cancelled) return
          setHits(
            (res.items ?? []).map((row) => ({
              id: String(row.id),
              name: String(row.name),
              customerCode: row.customerCode ? String(row.customerCode) : null,
              phone: row.phone ? String(row.phone) : null,
              mobile: row.mobile ? String(row.mobile) : null,
              accountId: row.accountId ? String(row.accountId) : null,
              email: row.email ? String(row.email) : null,
            })),
          )
        } catch {
          if (!cancelled) setHits([])
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, open, selected])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Prefill label when only id is known (deep link)
  useEffect(() => {
    if (!valueId || selected?.id === valueId) return
    let cancelled = false
    void (async () => {
      try {
        const row = await api.getContact(valueId)
        if (cancelled) return
        const pick: ContactPick = {
          id: String(row.id),
          name: String(row.name),
          customerCode: row.customerCode ? String(row.customerCode) : null,
          phone: row.phone ? String(row.phone) : null,
          mobile: row.mobile ? String(row.mobile) : null,
          accountId: row.accountId ? String(row.accountId) : null,
          email: row.email ? String(row.email) : null,
        }
        onSelect(pick)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [valueId, selected?.id, onSelect])

  return (
    <div ref={rootRef} className={cn('relative flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <input
          id={inputId}
          className={cn(
            'h-9 w-full rounded-[6px] border border-border bg-card py-0 pl-9 pr-9 text-base text-text-primary outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20',
            error && 'border-accent-red focus:border-accent-red focus:ring-accent-red/20',
          )}
          placeholder="Search CUS-ID, name, or phone…"
          value={query}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (valueId) onSelect(null)
          }}
        />
        {valueId || query ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
            aria-label="Clear customer"
            onClick={() => {
              setQuery('')
              setHits([])
              onSelect(null)
              setOpen(false)
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {error ? <span className="text-xs text-accent-red">{error}</span> : null}
      {open && query.trim().length >= 2 && (!selected || query !== labelFor(selected)) ? (
        <ul className="absolute top-[calc(100%+4px)] z-30 max-h-56 w-full overflow-auto rounded-[8px] border border-border bg-card py-1 shadow-lg">
          {loading ? (
            <li className="px-3 py-2 text-sm text-text-secondary">Searching…</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-secondary">
              No customers found. Create the contact first under Contacts.
            </li>
          ) : (
            hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-surface"
                  onClick={() => {
                    onSelect(c)
                    setQuery(labelFor(c))
                    setOpen(false)
                  }}
                >
                  <span className="font-medium text-text-primary">
                    {c.customerCode ? (
                      <span className="mr-1.5 font-mono text-xs text-accent-blue">{c.customerCode}</span>
                    ) : null}
                    {c.name}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {[formatPhone(String(c.phone || c.mobile || '')), c.email].filter(Boolean).join(' · ') ||
                      'No phone'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      <p className="text-xs text-text-secondary">Type at least 2 characters — results load from the database.</p>
    </div>
  )
}
