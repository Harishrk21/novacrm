import { useState, useRef, useEffect, useMemo } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Bell,
  HelpCircle,
  Search,
  Menu,
  User,
  Settings,
  LogOut,
  CheckCheck,
  Trash2,
  Moon,
  Sun,
  Palette,
  Plus,
} from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import {
  NOTIFICATION_ARRIVED_EVENT,
  useNotificationsStore,
} from '@/store/notificationsStore'
import { Avatar } from '@/components/ui/Avatar'
import { api, isTenantSession } from '@/lib/api'
import { timeAgo, formatCurrency, formatPhone, cn } from '@/lib/utils'
import { PALETTES, type ColorPalette } from '@/lib/theme'
import { APP_NAME } from '@/lib/branding'
import { formatServiceId } from '@/lib/serviceId'
import { canAccessProformaInvoices } from '@/lib/roles'
import { BlockSkeleton } from '@/components/ui/Skeleton'

type SearchHit = { id: string; primary: string; secondary?: string; type: string }

type TopbarProps = {
  /** Engineer phone shell — compact header, no sidebar toggle */
  fieldShell?: boolean
}

export function Topbar({ fieldShell = false }: TopbarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const themeMode = useUIStore((s) => s.themeMode)
  const palette = useUIStore((s) => s.palette)
  const toggleThemeMode = useUIStore((s) => s.toggleThemeMode)
  const setPalette = useUIStore((s) => s.setPalette)
  const addToast = useUIStore((s) => s.addToast)
  const openHowItWorks = useUIStore((s) => s.openHowItWorks)
  const authUser = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const brandingLocked = authUser?.branding?.locked === true
  const displayName = authUser?.name ?? 'User'
  const workspace = authUser?.tenantName ?? authUser?.tenantSlug ?? APP_NAME
  const userId = authUser?.id ?? ''

  const unreadCountStore = useNotificationsStore((s) => s.unreadCount)
  const loadNotifs = useNotificationsStore((s) => s.load)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)
  const clearOne = useNotificationsStore((s) => s.clearOne)
  const clearAll = useNotificationsStore((s) => s.clearAll)
  const notifs = useNotificationsStore((s) => s.items)

  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [bellPulse, setBellPulse] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  const searchRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLDivElement>(null)

  const unreadCount = unreadCountStore || notifs.filter((n) => !n.isRead).length

  useEffect(() => {
    if (!userId || !isTenantSession()) return
    void loadNotifs(userId, authUser?.role)
    const id = window.setInterval(() => void loadNotifs(userId, authUser?.role), 60_000)
    return () => window.clearInterval(id)
  }, [userId, authUser?.role, loadNotifs])

  useEffect(() => {
    if (!userId || !isTenantSession()) return
    let cleanup: (() => void) | undefined
    const unlock = () => {
      void import('@/lib/notificationSound').then(({ unlockNotificationSound }) => {
        unlockNotificationSound()
      })
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
    // One gesture unlocks the .wav for later alerts (browser autoplay policy)
    document.addEventListener('pointerdown', unlock)
    document.addEventListener('keydown', unlock)
    void import('@/store/notificationsStore').then(({ connectNotificationsSocket }) => {
      cleanup = connectNotificationsSocket()
    })
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
      cleanup?.()
    }
  }, [userId])

  // Auto-open bell + toast whenever any new notification arrives (live or poll)
  useEffect(() => {
    if (!userId || !isTenantSession()) return
    const onArrived = (ev: Event) => {
      const detail = (ev as CustomEvent<{ title?: string; message?: string }>).detail
      setNotifOpen(true)
      setBellPulse(true)
      window.setTimeout(() => setBellPulse(false), 1800)
      addToast({
        type: 'info',
        title: 'New notification',
        message: detail?.title || 'You have a new alert',
      })
    }
    window.addEventListener(NOTIFICATION_ARRIVED_EVENT, onArrived)
    return () => window.removeEventListener(NOTIFICATION_ARRIVED_EVENT, onArrived)
  }, [userId, addToast])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false)
      if (notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false)
      if (avatarRef.current && !avatarRef.current.contains(t)) setAvatarOpen(false)
      if (paletteRef.current && !paletteRef.current.contains(t)) setPaletteOpen(false)
      if (createRef.current && !createRef.current.contains(t)) setCreateOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2 || !isTenantSession()) {
      setHits([])
      setSearching(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true)
        try {
          // Prefer customers + tickets (name / phone). Don't fail whole search if one API errors.
          const settled = await Promise.allSettled([
            api.contacts({ limit: 10, search: q }),
            api.tickets({ limit: 8, search: q }),
            api.deals({ limit: 5, search: q }),
          ])
          if (cancelled) return
          const contacts =
            settled[0].status === 'fulfilled' ? (settled[0].value.items ?? []) : []
          const tickets =
            settled[1].status === 'fulfilled' ? (settled[1].value.items ?? []) : []
          const deals =
            settled[2].status === 'fulfilled' ? (settled[2].value.items ?? []) : []

          const next: SearchHit[] = [
            ...contacts.map((c) => ({
              id: String(c.id),
              type: 'contact',
              primary: [c.customerCode ? String(c.customerCode) : null, String(c.name)]
                .filter(Boolean)
                .join(' · '),
              secondary:
                formatPhone(String(c.phone ?? c.mobile ?? '')) ||
                (c.city ? String(c.city) : undefined),
            })),
            ...tickets.map((t) => ({
              id: String(t.id),
              type: 'ticket',
              primary: `${formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)} ${String(t.subject ?? '')}`,
              secondary: String(t.status ?? ''),
            })),
            ...deals.map((d) => ({
              id: String(d.id),
              type: 'deal',
              primary: String(d.name),
              secondary: formatCurrency(Number(d.amount ?? 0)),
            })),
          ]
          setHits(next)
        } catch {
          if (!cancelled) setHits([])
        } finally {
          if (!cancelled) setSearching(false)
        }
      })()
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search])

  const grouped = useMemo(() => {
    const g: Record<string, SearchHit[]> = {
      contact: [],
      ticket: [],
      deal: [],
    }
    for (const h of hits) g[h.type]?.push(h)
    return g
  }, [hits])

  const goToEntity = (type: string, id: string) => {
    setSearchOpen(false)
    setSearch('')
    const paths: Record<string, string> = {
      contact: `/contacts/${id}`,
      deal: `/deals/${id}`,
      ticket: `/tickets/${id}`,
    }
    navigate(paths[type] ?? '/')
  }

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    setAvatarOpen(false)
    try {
      await logout()
      addToast({ type: 'success', message: 'Signed out' })
    } finally {
      navigate(authUser?.tenantSlug ? `/login/${authUser.tenantSlug}` : '/login', { replace: true })
      setLoggingOut(false)
    }
  }

  const fieldTitle =
    location.pathname === '/'
      ? 'My work'
      : location.pathname.startsWith('/workqueue')
        ? 'Queue'
        : location.pathname.startsWith('/tickets/')
          ? 'Job'
          : location.pathname.startsWith('/tickets')
            ? 'My jobs'
            : location.pathname.startsWith('/notifications')
              ? 'Alerts'
              : location.pathname.startsWith('/spare-parts')
                ? 'Spares'
                : location.pathname.startsWith('/contacts')
                  ? 'Contacts'
                  : location.pathname.startsWith('/settings')
                    ? 'Profile'
                    : 'Field'

  return (
    <header
      className={cn(
        'zcrm-topbar flex shrink-0 items-center gap-3 border-b border-border bg-card/95 px-3 backdrop-blur sm:px-4',
        fieldShell ? 'h-12 pt-[env(safe-area-inset-top)]' : 'h-14',
      )}
    >
      {!fieldShell ? (
        <button
          className="rounded-lg p-1.5 text-text-secondary hover:bg-muted lg:hidden"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <Menu size={20} />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <img src="/hms-logo.png" alt="" className="h-7 w-auto object-contain" draggable={false} />
          <h1 className="truncate text-[16px] font-semibold tracking-tight text-text-primary">
            {fieldTitle}
          </h1>
        </div>
      )}

      {!fieldShell && location.pathname === '/workqueue' && (
        <h1 className="hidden shrink-0 text-[17px] font-semibold tracking-tight text-text-primary sm:block">
          Workqueue
        </h1>
      )}

      <div
        ref={searchRef}
        className={cn(
          'relative mx-auto w-full max-w-2xl',
          fieldShell && 'hidden sm:block',
        )}
      >
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setSearchOpen(true)
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search records…"
          className="h-9 w-full rounded-full border border-border bg-muted/70 pl-9 pr-3 text-[13px] text-text-primary outline-none transition-all duration-150 placeholder:text-text-secondary focus:border-[color:var(--color-accent-blue)] focus:bg-card focus:ring-2 focus:ring-[color:var(--color-accent-blue)]/25"
        />
        {searchOpen && search.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-[var(--shadow-hover)]">
            {searching ? (
              <div className="p-3">
                <BlockSkeleton lines={4} className="p-0" />
              </div>
            ) : hits.length === 0 ? (
              <div className="p-3">
                <div className="mb-2 px-1 text-center text-sm text-text-secondary">No records found</div>
                <button
                  type="button"
                  className="w-full rounded-lg border border-dashed border-[color:var(--color-accent-blue)]/40 bg-[color:var(--color-accent-soft)] px-3 py-2.5 text-left text-sm font-medium text-[color:var(--color-accent-blue)] hover:opacity-90"
                  onClick={() => {
                    const q = encodeURIComponent(search.trim())
                    setSearchOpen(false)
                    navigate(`/contacts?open=1&q=${q}`)
                    setSearch('')
                  }}
                >
                  + Add customer “{search.trim()}”
                </button>
              </div>
            ) : (
              <>
                {(['contact', 'ticket', 'deal'] as const).map((key) =>
                  grouped[key].length ? (
                    <ResultGroup
                      key={key}
                      title={key === 'contact' ? 'CUSTOMERS' : key === 'ticket' ? 'TICKETS' : 'DEALS'}
                    >
                      {grouped[key].map((item) => (
                        <ResultItem
                          key={`${key}-${item.id}`}
                          onClick={() => goToEntity(key, item.id)}
                          primary={item.primary}
                          secondary={item.secondary}
                        />
                      ))}
                    </ResultGroup>
                  ) : null,
                )}
              </>
            )}
          </div>
        )}
        {searchOpen && search.trim().length > 0 && search.trim().length < 2 ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 rounded-xl border border-border bg-card p-3 text-sm text-text-secondary shadow-md">
            Type at least 2 characters…
          </div>
        ) : null}
      </div>

      <div className={cn('flex items-center gap-0.5', fieldShell && 'ml-auto')}>
        {!fieldShell ? (
          <div ref={createRef} className="relative">
            <button
              type="button"
              onClick={() => setCreateOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--color-accent-blue)] text-white shadow-sm transition hover:opacity-90"
              title="Quick create"
              aria-label="Quick create"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
            {createOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-[var(--shadow-hover)]">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                  Quick create
                </div>
                {[
                  { to: '/tickets?open=1', label: 'Service ticket' },
                  { to: '/sale-tracking?open=1', label: 'Sale enquiry' },
                  { to: '/contacts?open=1', label: 'Customer' },
                  ...(canAccessProformaInvoices(authUser?.role)
                    ? [{ to: '/erp/invoices?open=1', label: 'Proforma invoice' }]
                    : []),
                ].map((row) => (
                  <button
                    key={row.to}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setCreateOpen(false)
                      navigate(row.to)
                    }}
                  >
                    <Plus size={14} className="text-[color:var(--color-accent-blue)]" />
                    {row.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!fieldShell ? (
          <button
            onClick={toggleThemeMode}
            className="rounded-lg p-2 text-text-secondary transition-colors duration-150 hover:bg-muted"
            title={themeMode === 'light' ? 'Switch to night mode' : 'Switch to day mode'}
          >
            {themeMode === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        ) : null}

        {!fieldShell && !brandingLocked ? (
        <div ref={paletteRef} className="relative">
          <button
            onClick={() => setPaletteOpen(!paletteOpen)}
            className="rounded-[6px] p-2 text-text-secondary hover:bg-muted transition-colors duration-150"
            title="Dashboard color palette"
          >
            <Palette size={18} />
          </button>
          {paletteOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-[12px] border border-border bg-card p-3 shadow-[var(--shadow-hover)]">
              <div className="mb-1 text-sm font-semibold text-text-primary">Color palette</div>
              <p className="mb-3 text-xs text-text-secondary">
                Background, cards, sidebar and accents change together
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(PALETTES) as ColorPalette[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPalette(key)
                      setPaletteOpen(false)
                    }}
                    className={cn(
                      'rounded-[10px] border p-2.5 text-left transition-all duration-150',
                      palette === key
                        ? 'border-accent-blue ring-2 ring-accent-blue/20'
                        : 'border-border hover:border-accent-blue/40',
                    )}
                  >
                    <div
                      className="mb-2 h-9 overflow-hidden rounded-md border border-border"
                      style={{ background: PALETTES[key].light.wash }}
                    >
                      <div className="flex h-full">
                        <div className="w-1/4" style={{ background: PALETTES[key].light.sidebarBg }} />
                        <div className="m-1 flex-1 rounded-sm" style={{ background: PALETTES[key].light.card }} />
                      </div>
                    </div>
                    <div className="mb-1.5 flex gap-1">
                      {PALETTES[key].chart.slice(0, 4).map((c) => (
                        <span key={c} className="h-2.5 flex-1 rounded-full" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="text-xs font-semibold text-text-primary">{PALETTES[key].label}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        ) : null}

        <div ref={notifRef} className="relative">
          <button
            onClick={() => {
              setNotifOpen(!notifOpen)
              if (!notifOpen && userId) void loadNotifs(userId, authUser?.role)
            }}
            className={cn(
              'relative rounded-[6px] p-2 text-text-secondary hover:bg-muted transition-colors duration-150',
              bellPulse && 'animate-notif-bell text-accent-blue',
            )}
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={18} className={bellPulse ? 'origin-top animate-notif-bell' : undefined} />
            {unreadCount > 0 && (
              <span
                className={cn(
                  'absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-red px-1 text-[10px] font-bold text-white',
                  bellPulse && 'animate-ping-once',
                )}
              >
                {unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div
              className={cn(
                'absolute right-0 top-full z-50 mt-1 w-80 rounded-[8px] border border-border bg-card shadow-[var(--shadow-hover)]',
                bellPulse && 'ring-2 ring-accent-blue/40',
              )}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-md font-semibold">Notifications</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-text-secondary hover:text-text-primary hover:underline"
                    title="Toggle notification sound"
                    onClick={() => {
                      void import('@/lib/notificationSound').then(
                        ({
                          isNotificationSoundEnabled,
                          setNotificationSoundEnabled,
                          playNotificationBell,
                        }) => {
                          const next = !isNotificationSoundEnabled()
                          setNotificationSoundEnabled(next)
                          if (next) playNotificationBell()
                          addToast({
                            type: 'success',
                            message: next ? 'Notification sound on' : 'Notification sound off',
                          })
                        },
                      )
                    }}
                  >
                    Sound
                  </button>
                  {notifs.length > 0 && (
                    <>
                      <button
                        className="flex items-center gap-1 text-xs text-accent-blue hover:underline"
                        onClick={() => userId && markAllRead(userId)}
                      >
                        <CheckCheck size={12} /> Mark all read
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-accent-red hover:underline"
                        title="Clear all notifications"
                        onClick={() => {
                          void clearAll().then(() => {
                            addToast({ type: 'success', message: 'All notifications cleared' })
                          })
                        }}
                      >
                        <Trash2 size={12} /> Clear all
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifs.length === 0 ? (
                  <div className="p-6 text-center text-sm text-text-secondary">
                    No notifications yet. Ticket updates for your role appear here.
                  </div>
                ) : (
                  notifs.slice(0, 12).map((n) => (
                    <div
                      key={n.id}
                      className={cn(
                        'flex w-full items-center gap-2 border-b border-border px-3 py-2 transition-colors duration-150 hover:bg-surface',
                        !n.isRead && 'border-l-2 border-l-accent-blue bg-accent-blue/5',
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          if (userId) void markRead(n.id, userId)
                          setNotifOpen(false)
                          navigate(n.href || '/notifications')
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {n.title}
                          </div>
                          <span className="shrink-0 text-[10px] text-text-secondary">
                            {timeAgo(n.createdAt)}
                          </span>
                        </div>
                        <div className="truncate text-xs text-text-secondary">{n.message}</div>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-[6px] p-1.5 text-text-secondary hover:bg-muted hover:text-accent-red"
                        title="Clear notification"
                        aria-label="Clear notification"
                        onClick={(e) => {
                          e.stopPropagation()
                          void clearOne(n.id)
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-border px-4 py-2">
                <Link
                  to="/notifications"
                  className="block text-center text-xs font-medium text-accent-blue hover:underline"
                  onClick={() => setNotifOpen(false)}
                >
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {!fieldShell ? (
          <button
            type="button"
            onClick={() => openHowItWorks()}
            className="rounded-[6px] p-2 text-text-secondary hover:bg-muted transition-colors duration-150"
            title="How HMS Enterprises works"
            aria-label="How HMS Enterprises works"
          >
            <HelpCircle size={18} />
          </button>
        ) : null}

        <div ref={avatarRef} className="relative ml-1">
          <button
            type="button"
            onClick={() => setAvatarOpen((open) => !open)}
            className="flex items-center gap-2 rounded-full border border-transparent px-1 py-0.5 hover:border-border"
            aria-label="Account menu"
          >
            <Avatar name={displayName} src={authUser?.avatarUrl} size="sm" />
            {!fieldShell ? (
              <span className="hidden max-w-[120px] truncate text-left text-xs leading-tight sm:block">
                <span className="block font-semibold text-text-primary">{displayName}</span>
                <span className="block text-text-secondary">{workspace}</span>
              </span>
            ) : null}
          </button>
          {avatarOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[8px] border border-border bg-card py-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
              <div className="border-b border-border px-3 py-2">
                <div className="truncate text-sm font-semibold">{displayName}</div>
                <div className="truncate text-xs text-text-secondary">{authUser?.email ?? ''}</div>
              </div>
              <Link
                to="/settings"
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface"
                onClick={() => setAvatarOpen(false)}
              >
                <User size={14} /> Profile
              </Link>
              <Link
                to="/settings"
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface"
                onClick={() => setAvatarOpen(false)}
              >
                <Settings size={14} /> Settings
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface"
                onClick={() => {
                  setAvatarOpen(false)
                  openHowItWorks()
                }}
              >
                <HelpCircle size={14} /> How it works
              </button>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-accent-red hover:bg-surface disabled:opacity-60"
              >
                <LogOut size={14} /> {loggingOut ? 'Signing out…' : 'Logout'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border last:border-0">
      <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-text-secondary">{title}</div>
      {children}
    </div>
  )
}

function ResultItem({
  primary,
  secondary,
  onClick,
}: {
  primary: string
  secondary?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface"
    >
      <span className="text-sm font-medium text-text-primary">{primary}</span>
      {secondary && <span className="text-xs text-text-secondary">{secondary}</span>}
    </button>
  )
}
