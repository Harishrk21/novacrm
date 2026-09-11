import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import {
  indianMobileLocal,
  isValidIndianMobile,
  type IndianMobileValue,
} from '@/lib/phoneIndia'

type Props = {
  label?: ReactNode
  value?: IndianMobileValue
  onChange: (localDigits: string) => void
  error?: string
  id?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  hint?: string
}

/** India (+91) mobile — user types 10 digits only; country code is fixed. */
export function PhoneInput({
  label,
  value,
  onChange,
  error,
  id,
  required,
  disabled,
  placeholder = '98765 43210',
  className,
  hint,
}: Props) {
  const inputId =
    id ??
    (typeof label === 'string' ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
  const local = indianMobileLocal(value)
  const incomplete = local.length > 0 && local.length < 10
  const invalidComplete = local.length === 10 && !isValidIndianMobile(local)
  const showHintError = incomplete || invalidComplete

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
          {required ? ' *' : null}
        </label>
      ) : null}
      <div
        className={cn(
          'flex h-9 overflow-hidden rounded-[6px] border border-border bg-card transition-all duration-150 focus-within:border-accent-blue focus-within:ring-2 focus-within:ring-accent-blue/20',
          (error || showHintError) &&
            'border-red-500 focus-within:border-red-500 focus-within:ring-red-500/25',
          disabled && 'opacity-60',
        )}
      >
        <span className="flex shrink-0 items-center gap-1 border-r border-border bg-muted/60 px-2.5 text-sm font-semibold tabular-nums text-text-primary">
          <span className="text-[10px] font-bold uppercase tracking-wide text-text-secondary">
            IN
          </span>
          +91
        </span>
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          disabled={disabled}
          placeholder={placeholder}
          value={local}
          aria-invalid={Boolean(error || showHintError)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
            onChange(digits)
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-base tabular-nums text-text-primary outline-none placeholder:text-slate-400"
        />
      </div>
      {error ? (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          Missing — {error}
        </span>
      ) : incomplete ? (
        <span className="text-xs text-text-secondary">Enter 10-digit mobile number</span>
      ) : invalidComplete ? (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          Mobile must be 10 digits starting with 6–9
        </span>
      ) : hint ? (
        <span className="text-xs text-text-secondary">{hint}</span>
      ) : null}
    </div>
  )
}
