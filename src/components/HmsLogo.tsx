import { cn } from '@/lib/utils'
import { APP_NAME, HMS_LOGO_DARK_URL, HMS_LOGO_URL } from '@/lib/branding'

type HmsLogoProps = {
  className?: string
  /** compact = header; hero = login panel */
  size?: 'sm' | 'md' | 'lg' | 'hero'
  alt?: string
  /** dark = always on a dark surface (sidebar); auto = follow light/dark theme; light = light surface */
  tone?: 'auto' | 'dark' | 'light'
}

const heights = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
  hero: 'h-16 sm:h-20',
} as const

export function HmsLogo({ className, size = 'md', alt = APP_NAME, tone = 'auto' }: HmsLogoProps) {
  const base = cn('w-auto max-w-full object-contain object-left', heights[size], className)
  if (tone !== 'auto') {
    return (
      <img src={tone === 'dark' ? HMS_LOGO_DARK_URL : HMS_LOGO_URL} alt={alt} className={base} draggable={false} />
    )
  }
  return (
    <>
      <img src={HMS_LOGO_URL} alt={alt} className={cn(base, 'dark:hidden')} draggable={false} />
      <img src={HMS_LOGO_DARK_URL} alt={alt} className={cn(base, 'hidden dark:block')} draggable={false} />
    </>
  )
}
