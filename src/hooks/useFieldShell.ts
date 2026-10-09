import { useAuthStore } from '@/store/authStore'
import { isServiceEngineer } from '@/lib/roles'
import { useMediaQuery } from '@/hooks/useMediaQuery'

/**
 * Phone-first field shell for service engineers.
 * Desk / admin / sales keep the full CRM layout at all widths.
 * Engineers on md+ (tablet/laptop) also keep the desktop shell.
 */
export function useFieldShell(): boolean {
  const role = useAuthStore((s) => s.user?.role)
  const isPhone = useMediaQuery('(max-width: 767px)')
  return isServiceEngineer(role) && isPhone
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}
