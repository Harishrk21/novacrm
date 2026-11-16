import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  BookOpen,
  Clock,
  ClipboardList,
  Home,
  ListTodo,
  LogOut,
  MoreHorizontal,
  Settings,
  Ticket,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmModal } from '@/components/ui/Modal'
import { useAuthStore } from '@/store/authStore'
import { tenantLoginPath } from '@/lib/lastTenantSlug'
import { useUIStore } from '@/store/uiStore'
import { useNotificationsStore } from '@/store/notificationsStore'
import { useModulesStore } from '@/store/modulesStore'
import { api } from '@/lib/api'

/** App-style bottom bar for engineers on a phone: the 3 things they do all day + More. */
type Tab = { to: string; label: string; icon: typeof Home }

const MORE_LINKS = [
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/workqueue', label: 'Tasks & reminders', icon: ListTodo },
  { to: '/spare-parts', label: 'Spare parts', icon: Wrench },
  { to: '/service-reports', label: 'Service reports', icon: ClipboardList },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/help', label: 'How it works', icon: BookOpen },
  { to: '/settings', label: 'Profile', icon: Settings },
] as const

export function FieldBottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const authUser = useAuthStore((s) => s.user)
  const addToast = useUIStore((s) => s.addToast)
  const unread = useNotificationsStore((s) => s.unreadCount)
  const [moreOpen, setMoreOpen] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)

  const onTicketDetail = /^\/tickets\/[^/]+/.test(location.pathname)
  const moduleOn = useModulesStore((s) => s.enabled)
  useModulesStore((s) => s.modules)
  const attendanceOn = Boolean(authUser?.attendanceEnabled) || moduleOn('hr.attendance', false)
  const [readyCount, setReadyCount] = useState(0)
  // Badge on Jobs: open jobs waiting for an engineer to accept
  useEffect(() => {
    let alive = true
    const tick = () =>
      void api
        .tickets({ status: 'OPEN', assignedToId: 'unassigned', claimable: 1, limit: 1 })
        .then((r) => alive && setReadyCount(Number(r.meta?.total ?? r.items?.length ?? 0)))
        .catch(() => undefined)
    tick()
    const t = window.setInterval(tick, 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [location.pathname])
  const TABS: Tab[] = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/tickets', label: 'Jobs', icon: Ticket },
    ...(attendanceOn
      ? [{ to: `/attendance?returnUrl=${encodeURIComponent(`${window.location.origin}/`)}`, label: 'Attendance', icon: Clock }]
      : []),
    { to: '#more', label: 'More', icon: MoreHorizontal },
  ]

  async function handleLogout() {
    setLogoutConfirmOpen(false)
    setMoreOpen(false)
    try {
      await logout()
      addToast({ type: 'success', message: 'Signed out' })
    } finally {
      navigate(tenantLoginPath(authUser?.tenantSlug), { replace: true })
    }
  }

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-text-primary">More</div>
              <button
                type="button"
                className="rounded-lg p-2 text-text-secondary hover:bg-muted"
                onClick={() => setMoreOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <nav className="grid gap-1 p-3">
              {MORE_LINKS.map(({ to, label, icon: Icon }) => (
                <button
                  key={to}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false)
                    navigate(to)
                  }}
                  className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-text-primary hover:bg-muted"
                >
                  <Icon size={20} className="text-text-secondary" />
                  <span className="flex-1">{label}</span>
                  {to === '/notifications' && unread > 0 ? (
                    <span className="rounded-full bg-accent-red px-2 py-0.5 text-[11px] font-semibold text-white">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  setLogoutConfirmOpen(true)
                }}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-accent-red hover:bg-muted"
              >
                <LogOut size={20} />
                Sign out
              </button>
            </nav>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => void handleLogout()}
        title="Log out?"
        body="Are you sure you want to log out?"
        confirmLabel="Log out"
      />

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Field navigation"
      >
        <ul className={cn('grid h-16', TABS.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
          {TABS.map((tab) => {
            const Icon = tab.icon
            if (tab.to === '#more') {
              return (
                <li key="more" className="flex">
                  <button
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    className={cn(
                      'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                      moreOpen ? 'text-[color:var(--color-accent-blue)]' : 'text-text-secondary',
                    )}
                  >
                    <Icon size={22} strokeWidth={2} />
                    More
                  </button>
                </li>
              )
            }
            const jobsActive =
              tab.to === '/tickets' &&
              (location.pathname === '/tickets' || onTicketDetail)
            return (
              <li key={tab.to} className="flex">
                <NavLink
                  to={tab.to}
                  end={tab.to === '/'}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                      isActive || jobsActive
                        ? 'text-[color:var(--color-accent-blue)]'
                        : 'text-text-secondary',
                    )
                  }
                >
                  <span className="relative">
                    <Icon size={22} strokeWidth={2} />
                    {tab.to === '/tickets' && readyCount > 0 ? (
                      <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-accent-red px-1 text-center text-[10px] font-bold leading-[18px] text-white">
                        {readyCount > 9 ? '9+' : readyCount}
                      </span>
                    ) : null}
                  </span>
                  {tab.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
