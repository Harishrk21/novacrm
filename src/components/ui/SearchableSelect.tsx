import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, X } from 'lucide-react'
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
  /** Allow typing a new value (Enter or “Use …” row) — for suppliers, names, etc. */
  allowCreate?: boolean
  createLabel?: (query: string) => string
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
  allowCreate = false,
  createLabel = (q) => `Use “${q}”`,
}: Props) {
  const inputId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuBox, setMenuBox] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  )

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      const menu = document.getElementById(`${inputId}-menu`)
      if (menu?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, inputId])

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null)
      return
    }
    const place = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const width = Math.max(r.width, 280)
      const left = Math.min(r.left, window.innerWidth - width - 8)
      const spaceBelow = window.innerHeight - r.bottom - 12
      const spaceAbove = r.top - 12
      const preferBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove
      const maxHeight = Math.min(360, Math.max(160, preferBelow ? spaceBelow : spaceAbove))
      const top = preferBelow
        ? r.bottom + 4
        : Math.max(8, r.top - maxHeight - 4)
      setMenuBox({ top, left: Math.max(8, left), width, maxHeight })
    }
    place()
    // Focus search after paint
    requestAnimationFrame(() => searchRef.current?.focus())
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const hay = `${o.label} ${o.sublabel ?? ''} ${o.value}`.toLowerCase()
      return hay.includes(q)
    })
  }, [options, query])

  const canCreate = useMemo(() => {
    if (!allowCreate) return false
    const q = query.trim()
    if (!q) return false
    const lower = q.toLowerCase()
    return !options.some(
      (o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower,
    )
  }, [allowCreate, options, query])

  const pick = (o: SearchableOption) => {
    onChange(o.value)
    setOpen(false)
    setQuery('')
  }

  const pickCreate = () => {
    const q = query.trim()
    if (!q) return
    onChange(q)
    setOpen(false)
    setQuery('')
  }

  const menu =
    open && menuBox
      ? createPortal(
          <div
            id={`${inputId}-menu`}
            className="fixed z-[240] flex flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
            style={{
              top: menuBox.top,
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
            }}
          >
            <div className="shrink-0 border-b border-border p-2">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary"
                />
                <input
                  ref={searchRef}
                  className="h-9 w-full rounded-[6px] border border-border bg-muted/40 py-2 pl-8 pr-3 text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
                  placeholder={placeholder}
                  value={query}
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setOpen(false)
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (canCreate && filtered.length === 0) pickCreate()
                      else if (filtered[0]) pick(filtered[0])
                      else if (canCreate) pickCreate()
                    }
                  }}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {canCreate ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={pickCreate}
                >
                  <span className="mt-0.5 w-4 shrink-0 text-accent-blue">+</span>
                  <span className="min-w-0 flex-1 font-medium text-accent-blue">
                    {createLabel(query.trim())}
                  </span>
                </button>
              ) : null}
              {filtered.length === 0 && !canCreate ? (
                <div className="px-3 py-3 text-sm text-text-secondary">{emptyText}</div>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                      o.value === value && 'bg-muted/70',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-accent-blue">
                      {o.value === value ? <Check size={14} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-text-primary">{o.label}</span>
                      {o.sublabel ? (
                        <span className="block text-xs text-text-secondary">{o.sublabel}</span>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-text-secondary">
              {filtered.length} of {options.length}
              {query.trim() ? ' match' : ''}
              {allowCreate ? ' · type to add' : ''}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={cn('relative flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      ) : null}
      <div className="relative flex gap-1">
        <button
          ref={triggerRef}
          id={inputId}
          type="button"
          className={cn(
            'flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-[6px] border border-border bg-card px-3 text-left text-sm outline-none transition focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20',
            error && 'border-accent-red',
            !selected && 'text-text-secondary',
          )}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="truncate">
            {selected
              ? selected.label
              : value
                ? value
                : placeholder}
          </span>
          <ChevronDown size={14} className={cn('shrink-0 text-text-secondary', open && 'rotate-180')} />
        </button>
        {value ? (
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-border text-text-secondary hover:bg-muted hover:text-text-primary"
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
      </div>
      {selected?.sublabel ? (
        <p className="truncate text-xs text-text-secondary">{selected.sublabel}</p>
      ) : null}
      {error ? <p className="text-xs text-accent-red">{error}</p> : null}
      {menu}
    </div>
  )
}
