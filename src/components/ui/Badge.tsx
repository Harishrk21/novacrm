import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

const colorMap: Record<string, string> = {
  blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  purple: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  gray: 'bg-muted text-text-secondary',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  indigo: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  cyan: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  slate: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
}

/** Solid chip for high-contrast status pills */
const solidMap: Record<string, string> = {
  blue: 'bg-sky-600 text-white',
  green: 'bg-emerald-600 text-white',
  red: 'bg-red-600 text-white',
  amber: 'bg-amber-500 text-white',
  purple: 'bg-violet-600 text-white',
  gray: 'bg-slate-500 text-white',
  orange: 'bg-orange-500 text-white',
  teal: 'bg-teal-600 text-white',
  indigo: 'bg-indigo-600 text-white',
  rose: 'bg-rose-600 text-white',
  cyan: 'bg-cyan-600 text-white',
  slate: 'bg-slate-600 text-white',
}

export type BadgeColor = keyof typeof colorMap

interface BadgeProps {
  children: ReactNode
  color?: BadgeColor
  className?: string
  /** Solid filled pill for status differentiation */
  solid?: boolean
}

export function Badge({ children, color = 'gray', className, solid }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        solid ? solidMap[color] ?? solidMap.gray : colorMap[color] ?? colorMap.gray,
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Distinct color per lead / sale-tracking stage */
export const leadStatusColor: Record<string, BadgeColor> = {
  NEW: 'indigo',
  CONTACTED: 'cyan',
  QUALIFIED: 'teal',
  DEMO: 'amber',
  CONVERTED: 'green',
  LOST: 'slate',
  UNQUALIFIED: 'rose',
}

export const leadSourceColor: Record<string, BadgeColor> = {
  WEB: 'blue',
  REFERRAL: 'green',
  COLD_CALL: 'amber',
  SOCIAL: 'purple',
  CAMPAIGN: 'orange',
  EVENT: 'cyan',
  PARTNER: 'teal',
  OTHER: 'gray',
}

export const dealStageColor: Record<string, BadgeColor> = {
  PROSPECT: 'blue',
  QUALIFIED: 'purple',
  PROPOSAL: 'amber',
  NEGOTIATION: 'orange',
  WON: 'green',
  LOST: 'red',
}

export const ticketPriorityColor: Record<string, BadgeColor> = {
  LOW: 'green',
  MEDIUM: 'amber',
  HIGH: 'orange',
  CRITICAL: 'red',
}

/** Ticket lifecycle colors — each state unique */
export const ticketStatusColor: Record<string, BadgeColor> = {
  OPEN: 'blue',
  IN_PROGRESS: 'amber',
  PENDING: 'orange',
  RESOLVED: 'purple',
  CLOSED: 'green',
}

export const slaColor: Record<string, BadgeColor> = {
  ON_TRACK: 'green',
  AT_RISK: 'amber',
  BREACHED: 'red',
}

export const activityStatusColor: Record<string, BadgeColor> = {
  PENDING: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'gray',
  OVERDUE: 'red',
}
