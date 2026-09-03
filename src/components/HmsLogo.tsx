import { cn } from '@/lib/utils'
import { APP_NAME } from '@/lib/branding'

type HmsLogoProps = {
  className?: string
  /** compact = header; hero = login panel */
  size?: 'sm' | 'md' | 'lg' | 'hero'
  alt?: string
}

const heights = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
  hero: 'h-16 sm:h-20',
} as const

export function HmsLogo({ className, size = 'md', alt = APP_NAME }: HmsLogoProps) {
  return (
    <img
      src="/hms-logo.png"
      alt={alt}
      className={cn('w-auto max-w-full object-contain object-left', heights[size], className)}
      draggable={false}
    />
  )
}
