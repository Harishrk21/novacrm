import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Filter, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SystemFilterId =
  | 'all'
  | 'phone'
  | 'machines'
  | 'openJobs'
  | 'noMachines'
  | 'recent'

export type ContactFilterState = {
  system: SystemFilterId
  accountId: string
  ownerUserId: string
  city: string
  hasEmail: boolean
  hasWhatsapp: boolean
}

type FieldOption = { id: string; label: string }

type Props = {
  open: boolean
  width: number
  onWidthChange: (w: number) => void
  onClose: () => void
  filters: ContactFilterState
  onChange: (next: ContactFilterState) => void
  accounts: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  showOwner?: boolean
  counts?: {
    all: number
    phone: number
    machines: number
    openJobs: number
    noMachines: number
    recent?: number
  }
}

const MIN_W = 220
const MAX_W = 420

function Accordion({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border/70">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 transition-transform', open ? 'rotate-0' : '-rotate-90')}
        />
      </button>
      {open ? <div className="px-2 pb-2.5">{children}</div> : null}
    </div>
  )
}

function CheckRow({
  checked,
  label,
  count,
  onChange,
}: {
  checked: boolean
  label: string
  count?: number
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary hover:bg-muted/50">
      <input
        type="checkbox"
        className="size-3.5 rounded border-border accent-[var(--color-accent-blue)]"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' ? (
        <span className="tabular-nums text-[11px] text-text-secondary">{count}</span>
      ) : null}
    </label>
  )
}

export function ContactFilterSidebar({
  open,
  width,
  onWidthChange,
  onClose,
  filters,
  onChange,
  accounts,
  users,
  showOwner = true,
  counts,
}: Props) {
  const [filterSearch, setFilterSearch] = useState('')
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: width }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return
      const next = Math.min(
        MAX_W,
        Math.max(MIN_W, dragRef.current.startW + (e.clientX - dragRef.current.startX)),
      )
      onWidthChange(next)
    },
    [onWidthChange],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('nova.contacts.filterWidth', String(width))
    } catch {
      /* ignore */
    }
  }, [width])

  const q = filterSearch.trim().toLowerCase()
  const match = (label: string) => !q || label.toLowerCase().includes(q)

  const systemItems: Array<{ id: SystemFilterId; label: string; count?: number }> = [
    { id: 'all', label: 'All customers', count: counts?.all },
    { id: 'phone', label: 'With phone', count: counts?.phone },
    { id: 'machines', label: 'With machines', count: counts?.machines },
    { id: 'noMachines', label: 'No machines yet', count: counts?.noMachines },
    { id: 'openJobs', label: 'Open service jobs', count: counts?.openJobs },
    { id: 'recent', label: 'Added this month', count: counts?.recent },
  ]

  const fieldItems = useMemo(() => {
    const rows: FieldOption[] = [
      { id: 'hasEmail', label: 'Has email' },
      { id: 'hasWhatsapp', label: 'Has WhatsApp' },
      { id: 'city', label: 'Area / city' },
      { id: 'account', label: 'Company / account' },
      ...(showOwner ? [{ id: 'owner', label: 'Executive / owner' }] : []),
    ]
    return rows.filter((r) => !q || r.label.toLowerCase().includes(q))
  }, [q, showOwner])

  if (!open) return null

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-card"
      style={{ width }}
      aria-label="Filter customers"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
          <Filter size={14} className="text-accent-blue" />
          Filter customers by
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-text-secondary hover:bg-muted hover:text-text-primary"
          onClick={onClose}
          aria-label="Close filters"
        >
          <X size={14} />
        </button>
      </div>

      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search filters"
            className="h-8 w-full rounded-md border border-border bg-muted/40 pl-8 pr-2 text-xs outline-none focus:border-accent-blue"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Accordion title="System defined filters">
          {systemItems
            .filter((s) => match(s.label))
            .map((s) => (
              <CheckRow
                key={s.id}
                checked={filters.system === s.id}
                label={s.label}
                count={s.count}
                onChange={() =>
                  onChange({
                    ...filters,
                    system: filters.system === s.id && s.id !== 'all' ? 'all' : s.id,
                  })
                }
              />
            ))}
        </Accordion>

        <Accordion title="Filter by fields">
          {fieldItems.map((f) => {
            if (f.id === 'hasEmail') {
              return (
                <CheckRow
                  key={f.id}
                  checked={filters.hasEmail}
                  label={f.label}
                  onChange={() => onChange({ ...filters, hasEmail: !filters.hasEmail })}
                />
              )
            }
            if (f.id === 'hasWhatsapp') {
              return (
                <CheckRow
                  key={f.id}
                  checked={filters.hasWhatsapp}
                  label={f.label}
                  onChange={() => onChange({ ...filters, hasWhatsapp: !filters.hasWhatsapp })}
                />
              )
            }
            if (f.id === 'city') {
              return (
                <div key={f.id} className="px-2 py-1.5">
                  <div className="mb-1 text-xs text-text-secondary">{f.label}</div>
                  <input
                    value={filters.city}
                    onChange={(e) => onChange({ ...filters, city: e.target.value })}
                    placeholder="e.g. Anna Nagar"
                    className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-accent-blue"
                  />
                </div>
              )
            }
            if (f.id === 'account') {
              return (
                <div key={f.id} className="px-2 py-1.5">
                  <div className="mb-1 text-xs text-text-secondary">{f.label}</div>
                  <select
                    value={filters.accountId}
                    onChange={(e) => onChange({ ...filters, accountId: e.target.value })}
                    className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-accent-blue"
                  >
                    <option value="">All companies</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }
            if (f.id === 'owner' && showOwner) {
              return (
                <div key={f.id} className="px-2 py-1.5">
                  <div className="mb-1 text-xs text-text-secondary">{f.label}</div>
                  <select
                    value={filters.ownerUserId}
                    onChange={(e) => onChange({ ...filters, ownerUserId: e.target.value })}
                    className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-accent-blue"
                  >
                    <option value="">All executives</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }
            return null
          })}
        </Accordion>
      </div>

      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          className="w-full rounded-md px-2 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-soft"
          onClick={() =>
            onChange({
              system: 'all',
              accountId: '',
              ownerUserId: '',
              city: '',
              hasEmail: false,
              hasWhatsapp: false,
            })
          }
        >
          Clear all filters
        </button>
      </div>

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize filter panel"
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-accent-blue/40 active:bg-accent-blue/60"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </aside>
  )
}

export function loadFilterWidth(defaultWidth = 280) {
  try {
    const raw = localStorage.getItem('nova.contacts.filterWidth')
    const n = raw ? Number(raw) : defaultWidth
    if (Number.isFinite(n) && n >= MIN_W && n <= MAX_W) return n
  } catch {
    /* ignore */
  }
  return defaultWidth
}
