import { cn } from '@/lib/utils'
import { PLATFORM_LOGO_URL, PRODUCT_NAME } from '@/lib/branding'

type BrandLogoProps = {
  className?: string
  /** compact = icon-ish height for topbar/sidebar; hero = larger for login */
  size?: 'sm' | 'md' | 'lg' | 'hero'
  alt?: string
}

const heights = {
  sm: 'h-8',
  md: 'h-9',
  lg: 'h-11',
  hero: 'h-20 sm:h-24',
} as const

export function BrandLogo({ className, size = 'md', alt = PRODUCT_NAME }: BrandLogoProps) {
  return (
    <img
      src={PLATFORM_LOGO_URL}
      alt={alt}
      className={cn('w-auto object-contain', heights[size], className)}
      draggable={false}
    />
  )
}
