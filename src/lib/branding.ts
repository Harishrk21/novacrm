/** Client-facing product name (browser tab, login, sidebar) — flagship demo tenant. */
export const APP_NAME = 'HMS Enterprises'

export const APP_TAGLINE = 'Weighing scales · Service · Stamping · AMC'

/** Meister product name (platform console, favicon title, default marketing). */
export const PRODUCT_NAME = 'Meister CRM+ERP'

/** @deprecated Use PRODUCT_NAME — kept for existing imports. */
export const PLATFORM_NAME = PRODUCT_NAME

export const PLATFORM_TAGLINE = 'Smarter Business. Together.'

/** Dedicated platform admin login path (not a tenant slug). */
export const PLATFORM_LOGIN_PATH = '/login/admin'

/** Full Meister lockup (icon + wordmark + tagline) — public/meister-logo.png */
export const PLATFORM_LOGO_URL = '/meister-logo.png'

/** Icon-only mark for favicons, PWA, and tight chrome — public/meister-mark.jpg */
export const PLATFORM_MARK_URL = '/meister-mark.jpg'

/** Meister brand accents for /login/admin — matches meister-logo.png */
export const MEISTER_COLORS = {
  blue: '#1B6BFF',
  blueHover: '#1557D6',
  navy: '#0A1F44',
  orange: '#F5A623',
  ink: '#0B1220',
  mist: '#F4F7FC',
  paper: '#FFFFFF',
  cyan: '#1B6BFF',
} as const

/** Clarifies company app vs platform control plane. */
export const APP_COMPANY_LINE =
  'Company workspace for HMS Enterprises — service, stamping, sales & stock. Platform admins onboard clients from /login/admin.'

/** Slugs reserved for platform routes — cannot be used as client login paths. */
export const RESERVED_LOGIN_SLUGS = [
  'admin',
  'platform',
  'login',
  'api',
  'www',
  'app',
  'console',
  'meister',
] as const

/** HMS brand palette (from official logo). */
export const HMS_COLORS = {
  redBright: '#E31E24',
  redBold: '#B91C1C',
  redDark: '#7D2426',
  black: '#0A0A0A',
  charcoal: '#141414',
  slate: '#1C1C1E',
  white: '#FFFFFF',
  muted: '#A3A3A3',
} as const
