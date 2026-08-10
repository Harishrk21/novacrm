export type ThemeMode = 'light' | 'dark'
export type ColorPalette = 'ocean' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate'

export const PALETTES: Record<
  ColorPalette,
  { label: string; description: string; accent: string; accentHover: string; chart: string[] }
> = {
  ocean: {
    label: 'Ocean Blue',
    description: 'Classic CRM blue — clear and professional',
    accent: '#2563EB',
    accentHover: '#1D4ED8',
    chart: ['#2563EB', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'],
  },
  emerald: {
    label: 'Emerald',
    description: 'Growth-focused green for sales teams',
    accent: '#059669',
    accentHover: '#047857',
    chart: ['#059669', '#2563EB', '#F59E0B', '#8B5CF6', '#EF4444', '#0EA5E9'],
  },
  violet: {
    label: 'Violet',
    description: 'Modern purple inspired by enterprise suites',
    accent: '#7C3AED',
    accentHover: '#6D28D9',
    chart: ['#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EC4899', '#06B6D4'],
  },
  amber: {
    label: 'Amber Gold',
    description: 'Warm accent for high-energy sales floors',
    accent: '#D97706',
    accentHover: '#B45309',
    chart: ['#D97706', '#2563EB', '#10B981', '#8B5CF6', '#EF4444', '#0EA5E9'],
  },
  rose: {
    label: 'Rose',
    description: 'Bold pink-red for customer success teams',
    accent: '#E11D48',
    accentHover: '#BE123C',
    chart: ['#E11D48', '#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4'],
  },
  slate: {
    label: 'Slate',
    description: 'Neutral enterprise look with sharp contrast',
    accent: '#334155',
    accentHover: '#1E293B',
    chart: ['#334155', '#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'],
  },
}

export function applyTheme(mode: ThemeMode, palette: ColorPalette) {
  const root = document.documentElement
  root.dataset.theme = mode
  root.dataset.palette = palette
  const p = PALETTES[palette]
  root.style.setProperty('--color-accent-blue', p.accent)
  root.style.setProperty('--color-sidebar-active', p.accent)
  root.style.setProperty('--accent-hover', p.accentHover)
  p.chart.forEach((c, i) => root.style.setProperty(`--chart-${i + 1}`, c))
}
