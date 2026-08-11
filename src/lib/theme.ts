export type ThemeMode = 'light' | 'dark'
export type ColorPalette = 'ocean' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate'

export type PaletteTokens = {
  surface: string
  card: string
  muted: string
  border: string
  textPrimary: string
  textSecondary: string
  sidebarBg: string
  sidebarText: string
  /** Soft wash behind main content / panels */
  wash: string
  accentSoft: string
  panelFrom: string
  panelTo: string
}

export type PaletteDef = {
  label: string
  description: string
  accent: string
  accentHover: string
  chart: string[]
  light: PaletteTokens
  dark: PaletteTokens
}

/** Harmonized UI kits — accent + backgrounds that belong together. */
export const PALETTES: Record<ColorPalette, PaletteDef> = {
  ocean: {
    label: 'Ocean Blue',
    description: 'Cool blues — calm workspace with crisp cards',
    accent: '#2563EB',
    accentHover: '#1D4ED8',
    chart: ['#2563EB', '#38BDF8', '#0EA5E9', '#6366F1', '#10B981', '#F59E0B'],
    light: {
      surface: '#EAF3FF',
      card: '#FFFFFF',
      muted: '#D8E9FF',
      border: '#BFD8F6',
      textPrimary: '#0B1F3A',
      textSecondary: '#4B6A8A',
      sidebarBg: '#0B1F3A',
      sidebarText: '#A8C4E0',
      wash: 'linear-gradient(165deg, #EAF3FF 0%, #F5F9FF 45%, #EEF6FF 100%)',
      accentSoft: 'rgba(37, 99, 235, 0.12)',
      panelFrom: '#DBEAFE',
      panelTo: '#F0F9FF',
    },
    dark: {
      surface: '#07111F',
      card: '#0F1C2E',
      muted: '#15253A',
      border: '#243B57',
      textPrimary: '#E8F1FF',
      textSecondary: '#8BA3C0',
      sidebarBg: '#050D18',
      sidebarText: '#8BA3C0',
      wash: 'linear-gradient(165deg, #07111F 0%, #0A1628 50%, #0C1A30 100%)',
      accentSoft: 'rgba(56, 189, 248, 0.16)',
      panelFrom: '#12243A',
      panelTo: '#0F1C2E',
    },
  },
  emerald: {
    label: 'Emerald',
    description: 'Fresh greens — growth feel with soft mint fields',
    accent: '#059669',
    accentHover: '#047857',
    chart: ['#059669', '#34D399', '#0D9488', '#2563EB', '#F59E0B', '#8B5CF6'],
    light: {
      surface: '#EAFBF4',
      card: '#FFFFFF',
      muted: '#D5F5E8',
      border: '#B2E6D0',
      textPrimary: '#06281D',
      textSecondary: '#3D6B58',
      sidebarBg: '#052E24',
      sidebarText: '#9AD4C0',
      wash: 'linear-gradient(165deg, #EAFBF4 0%, #F4FDF9 45%, #ECFDF5 100%)',
      accentSoft: 'rgba(5, 150, 105, 0.12)',
      panelFrom: '#D1FAE5',
      panelTo: '#ECFDF5',
    },
    dark: {
      surface: '#061612',
      card: '#0C221B',
      muted: '#123028',
      border: '#1E4639',
      textPrimary: '#E6FBF3',
      textSecondary: '#86B8A6',
      sidebarBg: '#031510',
      sidebarText: '#86B8A6',
      wash: 'linear-gradient(165deg, #061612 0%, #0A1C16 50%, #0C221B 100%)',
      accentSoft: 'rgba(52, 211, 153, 0.14)',
      panelFrom: '#123028',
      panelTo: '#0C221B',
    },
  },
  violet: {
    label: 'Violet',
    description: 'Modern purple — soft lilac canvas, sharp accents',
    accent: '#7C3AED',
    accentHover: '#6D28D9',
    chart: ['#7C3AED', '#A78BFA', '#6366F1', '#EC4899', '#10B981', '#F59E0B'],
    light: {
      surface: '#F3EEFF',
      card: '#FFFFFF',
      muted: '#E8DEFF',
      border: '#D4C4F7',
      textPrimary: '#1A0B33',
      textSecondary: '#5B4A7A',
      sidebarBg: '#1E1035',
      sidebarText: '#C4B5E8',
      wash: 'linear-gradient(165deg, #F3EEFF 0%, #FAF7FF 45%, #F5F0FF 100%)',
      accentSoft: 'rgba(124, 58, 237, 0.12)',
      panelFrom: '#EDE9FE',
      panelTo: '#F5F3FF',
    },
    dark: {
      surface: '#10081C',
      card: '#1A102C',
      muted: '#25183C',
      border: '#3A2858',
      textPrimary: '#F3ECFF',
      textSecondary: '#B2A0D4',
      sidebarBg: '#0C0616',
      sidebarText: '#B2A0D4',
      wash: 'linear-gradient(165deg, #10081C 0%, #160E26 50%, #1A102C 100%)',
      accentSoft: 'rgba(167, 139, 250, 0.16)',
      panelFrom: '#25183C',
      panelTo: '#1A102C',
    },
  },
  amber: {
    label: 'Amber Gold',
    description: 'Warm sand & gold — energetic sales floor',
    accent: '#D97706',
    accentHover: '#B45309',
    chart: ['#D97706', '#F59E0B', '#EA580C', '#2563EB', '#10B981', '#8B5CF6'],
    light: {
      surface: '#FFF7E8',
      card: '#FFFFFF',
      muted: '#FFEDC9',
      border: '#F5D98A',
      textPrimary: '#2A1A05',
      textSecondary: '#7A5A28',
      sidebarBg: '#1C1408',
      sidebarText: '#E0C48A',
      wash: 'linear-gradient(165deg, #FFF7E8 0%, #FFFBF2 45%, #FFF8EB 100%)',
      accentSoft: 'rgba(217, 119, 6, 0.14)',
      panelFrom: '#FEF3C7',
      panelTo: '#FFFBEB',
    },
    dark: {
      surface: '#140F06',
      card: '#1F170A',
      muted: '#2A1F0E',
      border: '#423116',
      textPrimary: '#FFF4D9',
      textSecondary: '#C9AE70',
      sidebarBg: '#0E0A04',
      sidebarText: '#C9AE70',
      wash: 'linear-gradient(165deg, #140F06 0%, #1A1308 50%, #1F170A 100%)',
      accentSoft: 'rgba(245, 158, 11, 0.16)',
      panelFrom: '#2A1F0E',
      panelTo: '#1F170A',
    },
  },
  rose: {
    label: 'Rose',
    description: 'Soft blush fields with bold rose accents',
    accent: '#E11D48',
    accentHover: '#BE123C',
    chart: ['#E11D48', '#FB7185', '#F43F5E', '#2563EB', '#10B981', '#F59E0B'],
    light: {
      surface: '#FFF1F4',
      card: '#FFFFFF',
      muted: '#FFE0E7',
      border: '#F9C2CF',
      textPrimary: '#2A0A14',
      textSecondary: '#7A4555',
      sidebarBg: '#2A0A14',
      sidebarText: '#E8A8B8',
      wash: 'linear-gradient(165deg, #FFF1F4 0%, #FFF8FA 45%, #FFF3F6 100%)',
      accentSoft: 'rgba(225, 29, 72, 0.12)',
      panelFrom: '#FFE4E6',
      panelTo: '#FFF1F2',
    },
    dark: {
      surface: '#16070C',
      card: '#220E15',
      muted: '#30141D',
      border: '#4A1F2C',
      textPrimary: '#FFE8EE',
      textSecondary: '#D49AAB',
      sidebarBg: '#100508',
      sidebarText: '#D49AAB',
      wash: 'linear-gradient(165deg, #16070C 0%, #1C0A11 50%, #220E15 100%)',
      accentSoft: 'rgba(251, 113, 133, 0.16)',
      panelFrom: '#30141D',
      panelTo: '#220E15',
    },
  },
  slate: {
    label: 'Slate',
    description: 'Neutral enterprise — cool gray with sharp contrast',
    accent: '#475569',
    accentHover: '#334155',
    chart: ['#475569', '#64748B', '#2563EB', '#10B981', '#F59E0B', '#8B5CF6'],
    light: {
      surface: '#F1F5F9',
      card: '#FFFFFF',
      muted: '#E2E8F0',
      border: '#CBD5E1',
      textPrimary: '#0F172A',
      textSecondary: '#64748B',
      sidebarBg: '#0F172A',
      sidebarText: '#94A3B8',
      wash: 'linear-gradient(165deg, #F1F5F9 0%, #F8FAFC 50%, #F1F5F9 100%)',
      accentSoft: 'rgba(71, 85, 105, 0.12)',
      panelFrom: '#E2E8F0',
      panelTo: '#F8FAFC',
    },
    dark: {
      surface: '#020617',
      card: '#0F172A',
      muted: '#1E293B',
      border: '#334155',
      textPrimary: '#F8FAFC',
      textSecondary: '#94A3B8',
      sidebarBg: '#020617',
      sidebarText: '#94A3B8',
      wash: 'linear-gradient(165deg, #020617 0%, #0B1220 50%, #0F172A 100%)',
      accentSoft: 'rgba(148, 163, 184, 0.14)',
      panelFrom: '#1E293B',
      panelTo: '#0F172A',
    },
  },
}

export function applyTheme(mode: ThemeMode, palette: ColorPalette) {
  const root = document.documentElement
  root.dataset.theme = mode
  root.dataset.palette = palette
  const def = PALETTES[palette]
  const t = mode === 'dark' ? def.dark : def.light

  root.style.setProperty('--color-accent-blue', def.accent)
  root.style.setProperty('--color-sidebar-active', def.accent)
  root.style.setProperty('--accent-hover', def.accentHover)
  root.style.setProperty('--color-accent-soft', t.accentSoft)
  root.style.setProperty('--color-panel-from', t.panelFrom)
  root.style.setProperty('--color-panel-to', t.panelTo)
  root.style.setProperty('--color-surface', t.surface)
  root.style.setProperty('--color-card', t.card)
  root.style.setProperty('--color-muted', t.muted)
  root.style.setProperty('--color-border', t.border)
  root.style.setProperty('--color-text-primary', t.textPrimary)
  root.style.setProperty('--color-text-secondary', t.textSecondary)
  root.style.setProperty('--color-sidebar-bg', t.sidebarBg)
  root.style.setProperty('--color-sidebar-text', t.sidebarText)
  root.style.setProperty('--app-wash', t.wash)

  def.chart.forEach((c, i) => root.style.setProperty(`--chart-${i + 1}`, c))
}
