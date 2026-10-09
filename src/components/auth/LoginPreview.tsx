import { Shield, Users, Wrench } from 'lucide-react'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { HMS_COLORS, PLATFORM_LOGO_URL, PRODUCT_NAME } from '@/lib/branding'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/lib/formValidation'

const FEATURES = [
  { icon: Users, label: 'Customers & pipeline' },
  { icon: Wrench, label: 'Service & operations' },
  { icon: Shield, label: 'Secure company workspace' },
] as const

export type LoginPreviewProps = {
  mode?: 'workspace' | 'platform'
  companyName: string
  slug?: string
  logoUrl?: string | null
  palette?: ColorPalette | string
  accent?: string
  accentHover?: string
  tagline?: string
  supportLine?: string
  /** Compact card for onboarding / control panel */
  compact?: boolean
  className?: string
}

function resolveAccent(props: LoginPreviewProps): { accent: string; accentHover: string } {
  if (props.accent) {
    return { accent: props.accent, accentHover: props.accentHover || props.accent }
  }
  const key = props.palette as ColorPalette | undefined
  if (key && PALETTES[key]) {
    return { accent: PALETTES[key].accent, accentHover: PALETTES[key].accentHover }
  }
  return { accent: HMS_COLORS.redBright, accentHover: HMS_COLORS.redBold }
}

export function LoginPreview(props: LoginPreviewProps) {
  const {
    mode = 'workspace',
    companyName,
    slug,
    logoUrl,
    tagline,
    supportLine,
    compact = false,
    className,
  } = props
  const { accent, accentHover } = resolveAccent(props)
  const headline =
    tagline?.trim() ||
    (mode === 'platform' ? 'Onboard clients, plans & modules' : `Sign in to ${companyName}`)
  const sub =
    supportLine?.trim() ||
    (mode === 'platform'
      ? 'Create workspaces, assign modules, and manage seats.'
      : `Staff sign-in for ${companyName}.`)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-white/10 bg-[#111111] text-white shadow-lg',
        compact ? 'text-[11px]' : '',
        className,
      )}
      style={{ backgroundColor: HMS_COLORS.black }}
    >
      <div
        className={cn('grid', compact ? 'grid-cols-1' : 'sm:grid-cols-[1fr_1.05fr]')}
      >
        <div
          className={cn('relative flex flex-col justify-between', compact ? 'p-4' : 'p-6')}
          style={{
            background: `linear-gradient(145deg, ${HMS_COLORS.charcoal} 0%, ${HMS_COLORS.black} 55%, ${accent}22 100%)`,
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
            style={{ background: `linear-gradient(90deg, ${accent}, ${accentHover})` }}
          />
          <div>
            {logoUrl ? (
              <div>
                <div
                  className={cn(
                    'inline-flex max-w-full rounded-2xl bg-white shadow-lg ring-1 ring-white/10',
                    compact ? 'p-2.5' : 'p-3.5',
                  )}
                >
                  <img
                    src={assetUrl(logoUrl)}
                    alt={companyName}
                    className={cn(
                      'w-auto max-w-full object-contain',
                      compact ? 'h-14 max-w-[140px]' : 'h-24 max-w-[220px] sm:h-28',
                    )}
                  />
                </div>
                <div className={cn(compact ? 'mt-2.5' : 'mt-3.5')}>
                  <div className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>
                    {companyName}
                  </div>
                  {slug ? <div className="text-white/55">/{slug}</div> : null}
                </div>
              </div>
            ) : mode === 'platform' ? (
              <div>
                <div
                  className={cn(
                    'inline-flex max-w-full rounded-2xl bg-white shadow-lg ring-1 ring-white/10',
                    compact ? 'p-2.5' : 'p-3.5',
                  )}
                >
                  <img
                    src={PLATFORM_LOGO_URL}
                    alt={PRODUCT_NAME}
                    className={cn(
                      'w-auto max-w-full object-contain',
                      compact ? 'h-14 max-w-[140px]' : 'h-24 max-w-[220px] sm:h-28',
                    )}
                  />
                </div>
                <div className={cn(compact ? 'mt-2.5' : 'mt-3.5', 'text-white/55 text-xs')}>
                  Platform control plane
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'flex items-center justify-center rounded-xl font-bold text-white',
                    compact ? 'h-11 w-11 text-sm' : 'h-16 w-16 text-2xl',
                  )}
                  style={{ backgroundColor: accent }}
                >
                  {companyName.slice(0, 1).toUpperCase() || '?'}
                </div>
                <div>
                  <div className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>
                    {companyName}
                  </div>
                  {slug ? (
                    <div className="text-white/55">/{slug}</div>
                  ) : (
                    <div className="text-white/55">Company workspace</div>
                  )}
                </div>
              </div>
            )}
            <p className={cn('font-semibold leading-snug text-white', compact ? 'mt-4 text-sm' : 'mt-5 text-lg')}>
              {headline}
            </p>
            <p className={cn('leading-relaxed text-white/65', compact ? 'mt-1.5 text-[10px]' : 'mt-2 text-xs')}>
              {sub}
            </p>
          </div>
          {!compact && mode === 'workspace' ? (
            <ul className="mt-6 space-y-2">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 text-xs text-white/80">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${accent}33` }}
                  >
                    <Icon size={14} style={{ color: accent }} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {!compact ? (
          <div className="flex flex-col justify-center border-t border-white/10 p-6 sm:border-l sm:border-t-0">
            <div className="text-sm font-semibold">Sign in{slug ? ` · ${companyName}` : ''}</div>
            <div className="mt-1 text-xs text-white/50">Preview only — not a live form</div>
            <div className="mt-4 space-y-2.5">
              <div className="h-9 rounded-lg border border-white/15 bg-black/40 px-3 text-xs leading-9 text-white/35">
                staff@{slug || 'company'}.com
              </div>
              <div className="h-9 rounded-lg border border-white/15 bg-black/40 px-3 text-xs leading-9 text-white/35">
                ••••••••
              </div>
              <div
                className="flex h-10 items-center justify-center rounded-lg text-xs font-semibold text-white"
                style={{ backgroundColor: accent }}
              >
                Sign in
              </div>
            </div>
            {slug ? (
              <p className="mt-3 font-mono text-[10px] text-white/40">/login/{slug}</p>
            ) : null}
          </div>
        ) : (
          <div className="border-t border-white/10 px-4 py-3">
            <div
              className="flex h-8 items-center justify-center rounded-md text-[11px] font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              Sign in
            </div>
            {slug ? (
              <p className="mt-2 text-center font-mono text-[10px] text-white/40">/login/{slug}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
