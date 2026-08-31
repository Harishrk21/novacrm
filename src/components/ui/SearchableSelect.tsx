import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SearchableOption = {
  value: string
  label: string
  sublabel?: string
}

type Props = {
  label?: string
  value: string
  options: SearchableOption[]
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  className?: string
  emptyText?: string
}

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search and select…',
  error,
  className,
  emptyText = 'No matches',
}: Props) {
  const inputId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  )

  useEffect(() => {
    if (!open) {
      setQuery(selected ? selected.label : '')
    }
  }, [selected, open, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || (selected && query === selected.label)) return options.slice(0, 80)
    return options
      .filter((o) => {
        const hay = `${o.label} ${o.sublabel ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 80)
  }, [options, query, selected])

  return (
    <div ref={rootRef} className={cn('relative flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <input
          id={inputId}
          className={cn(
            'h-9 w-full rounded-[6px] border border-border bg-card py-2 pl-9 pr-16 text-sm text-text-primary outline-none transition focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20',
            error && 'border-accent-red',
          )}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onFocus={() => {
            setOpen(true)
            if (selected && query === selected.label) setQuery('')
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && filtered[0]) {
              e.preventDefault()
              onChange(filtered[0].value)
              setOpen(false)
            }
          }}
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {value ? (
            <button
              type="button"
              className="rounded p-1 text-text-secondary hover:bg-muted hover:text-text-primary"
              title="Clear"
              onClick={() => {
                onChange('')
                setQuery('')
                setOpen(true)
              }}
            >
              <X size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="rounded p-1 text-text-secondary hover:bg-muted"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle options"
          >
            <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
          </button>
        </div>
      </div>
      {error ? <p className="text-xs text-accent-red">{error}</p> : null}
      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-auto rounded-[8px] border border-border bg-card py-1 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-secondary">{emptyText}</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className={cn(
                  'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted',
                  o.value === value && 'bg-muted/70',
                )}
                onClick={() => {
                  onChange(o.value)
                  setQuery(o.label)
                  setOpen(false)
                }}
              >
                <span className="font-medium text-text-primary">{o.label}</span>
                {o.sublabel ? (
                  <span className="text-xs text-text-secondary">{o.sublabel}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
