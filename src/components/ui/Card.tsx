import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  padding?: boolean
  id?: string
}

export function Card({ children, className, hover, padding = true, id }: CardProps) {
  return (
    <div
      id={id}
      className={cn(
        'rounded-[8px] border border-border bg-card shadow-[var(--shadow-card)]',
        hover && 'transition-shadow duration-150 hover:shadow-[var(--shadow-hover)]',
        padding && 'p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}
