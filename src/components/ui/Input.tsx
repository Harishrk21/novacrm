import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'h-9 w-full rounded-[6px] border border-border bg-card px-3 text-base text-text-primary placeholder:text-slate-400 outline-none transition-all duration-150 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20',
          error && 'border-accent-red focus:border-accent-red focus:ring-accent-red/20',
          className,
        )}
        {...props}
      />
      {error && <span className="text-xs text-accent-red">{error}</span>}
    </div>
  )
}
