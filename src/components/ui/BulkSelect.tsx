import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { Eye, Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

/** Header / row checkbox for bulk selection */
export function SelectCheckbox({
  checked,
  indeterminate,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate) && !checked
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'h-4 w-4 cursor-pointer rounded border-border text-accent-blue accent-[var(--color-accent-blue)]',
        className,
      )}
      {...props}
    />
  )
}

export function IconActionButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick?.(e)
      }}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-text-secondary transition hover:bg-muted hover:text-text-primary disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function ViewIconButton({
  onClick,
  label = 'View',
}: {
  onClick: () => void
  label?: string
}) {
  return (
    <IconActionButton label={label} onClick={onClick} className="hover:text-accent-blue">
      <Eye size={16} />
    </IconActionButton>
  )
}

export function EditIconButton({
  onClick,
  label = 'Edit',
}: {
  onClick: () => void
  label?: string
}) {
  return (
    <IconActionButton label={label} onClick={onClick} className="hover:text-accent-blue">
      <Pencil size={16} />
    </IconActionButton>
  )
}

export function DeleteIconButton({
  onClick,
  label = 'Delete',
  disabled,
}: {
  onClick: () => void
  label?: string
  disabled?: boolean
}) {
  return (
    <IconActionButton
      label={label}
      disabled={disabled}
      onClick={onClick}
      className="hover:bg-red-50 hover:text-accent-red"
    >
      <Trash2 size={16} />
    </IconActionButton>
  )
}

/** Sticky bar when rows are selected */
export function BulkActionBar({
  count,
  noun = 'item',
  onClear,
  onDelete,
  busy,
  extra,
}: {
  count: number
  noun?: string
  onClear: () => void
  onDelete?: () => void
  busy?: boolean
  extra?: ReactNode
}) {
  if (count <= 0) return null
  const label = count === 1 ? noun : `${noun}s`
  return (
    <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-accent-blue/30 bg-blue-50/90 px-4 py-2.5 shadow-sm backdrop-blur">
      <span className="text-sm font-medium text-text-primary">
        {count} {label} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {extra}
        {onDelete ? (
          <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
            <Trash2 size={14} /> Delete selected
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          <X size={14} /> Clear
        </Button>
      </div>
    </div>
  )
}
