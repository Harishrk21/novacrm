import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

const colorMap: Record<string, string> = {
  blue: 'bg-accent-blue/10 text-accent-blue',
  green: 'bg-accent-green/10 text-accent-green',
  red: 'bg-accent-red/10 text-accent-red',
  amber: 'bg-accent-amber/10 text-accent-amber',
  purple: 'bg-accent-purple/10 text-accent-purple',
  gray: 'bg-muted text-text-secondary',
  orange: 'bg-orange-500/10 text-orange-500',
}

interface BadgeProps {
  children: ReactNode
  color?: keyof typeof colorMap
  className?: string
}

export function Badge({ children, color = 'gray', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        colorMap[color],
        className,
      )}
    >
      {children}
    </span>
  )
}

export const leadStatusColor: Record<string, keyof typeof colorMap> = {
  NEW: 'blue',
  CONTACTED: 'amber',
  QUALIFIED: 'green',
  UNQUALIFIED: 'gray',
  LOST: 'red',
  CONVERTED: 'purple',
}

export const leadSourceColor: Record<string, keyof typeof colorMap> = {
  WEB: 'blue',
  REFERRAL: 'green',
  COLD_CALL: 'amber',
  SOCIAL: 'purple',
  CAMPAIGN: 'orange',
  EVENT: 'blue',
  PARTNER: 'green',
  OTHER: 'gray',
}

export const dealStageColor: Record<string, keyof typeof colorMap> = {
  PROSPECT: 'blue',
  QUALIFIED: 'purple',
  PROPOSAL: 'amber',
  NEGOTIATION: 'orange',
  WON: 'green',
  LOST: 'red',
}

export const ticketPriorityColor: Record<string, keyof typeof colorMap> = {
  LOW: 'green',
  MEDIUM: 'amber',
  HIGH: 'orange',
  CRITICAL: 'red',
}

export const ticketStatusColor: Record<string, keyof typeof colorMap> = {
  OPEN: 'blue',
  IN_PROGRESS: 'amber',
  PENDING: 'orange',
  RESOLVED: 'green',
  CLOSED: 'gray',
}

export const slaColor: Record<string, keyof typeof colorMap> = {
  ON_TRACK: 'green',
  AT_RISK: 'amber',
  BREACHED: 'red',
}

export const activityStatusColor: Record<string, keyof typeof colorMap> = {
  PENDING: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'gray',
  OVERDUE: 'red',
}
