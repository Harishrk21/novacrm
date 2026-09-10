import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '₹0'
  const n = Math.abs(value) < 0.005 ? 0 : value
  // Compact only for large dashboard figures — never round ₹3,500 → "₹4K"
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function formatCurrencyFull(value: number): string {
  if (!Number.isFinite(value)) return '₹0'
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

export function formatDate(date?: string | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'
  return format(d, 'MMM d, yyyy')
}

export function formatDateTime(date?: string | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'
  return format(d, 'MMM d, yyyy · h:mm a')
}

export function timeAgo(date?: string | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'
  return formatDistanceToNow(d, { addSuffix: true })
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('')
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()+]/g, '').replace(/^91/, '')
}

export function formatPhone(phone?: string): string {
  if (!phone) return '—'
  const n = normalizePhone(phone)
  if (n.length === 10) return `+91 ${n.slice(0, 5)} ${n.slice(5)}`
  return phone
}
