import { cn } from '@/lib/utils'
import { PRODUCT_NAME, PLATFORM_LOGO_URL } from '@/lib/branding'

type MeisterLogoProps = {
  size?: 'sm' | 'md' | 'lg' | 'hero' | 'display'
  /** Extra CSS text — usually off; the PNG already includes the wordmark. */
  showWordmark?: boolean
  className?: string
  dark?: boolean
}

const SIZES = {
  sm: { img: 'h-8', word: 'text-sm' },
  md: { img: 'h-11', word: 'text-base' },
  lg: { img: 'h-14', word: 'text-lg' },
  hero: { img: 'h-28 sm:h-32', word: 'text-2xl' },
  display: { img: 'h-36 sm:h-44 md:h-52', word: 'text-3xl' },
} as const

/** Meister brand lockup for platform surfaces. */
export function MeisterLogo({
  size = 'md',
  showWordmark = false,
  className,
  dark = false,
}: MeisterLogoProps) {
  const s = SIZES[size]
  const src = PLATFORM_LOGO_URL || '/meister-logo.png'

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <img
        src={src}
        alt={PRODUCT_NAME}
        className={cn(
          'w-auto object-contain',
          s.img,
          // Soft plate only when sitting on dark chrome (sidebar)
          dark && 'rounded-lg bg-white p-1.5',
        )}
      />
      {showWordmark ? (
        <div
          className={cn(
            'font-[family-name:var(--font-meister-display)] font-semibold tracking-tight',
            s.word,
            dark ? 'text-white' : 'text-slate-900',
          )}
        >
          {PRODUCT_NAME}
        </div>
      ) : null}
    </div>
  )
}
