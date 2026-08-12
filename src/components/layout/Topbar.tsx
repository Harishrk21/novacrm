import { useState, useRef, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  HelpCircle,
  Search,
  Menu,
  User,
  Settings,
  LogOut,
  CheckCheck,
  Moon,
  Sun,
  Palette,
} from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useNotificationsStore } from '@/store/notificationsStore'
import { Avatar } from '@/components/ui/Avatar'
import { BrandLogo } from '@/components/BrandLogo'
import { api, isTenantSession } from '@/lib/api'
import { timeAgo, formatCurrency, formatPhone, cn } from '@/lib/utils'
import { PALETTES, type ColorPalette } from '@/lib/theme'

type SearchHit = { id: string; primary: string; secondary?: string; type: string }

export function Topbar() {
  const navigate = useNavigate()
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const themeMode = useUIStore((s) => s.themeMode)
  const palette = useUIStore((s) => s.palette)
  const toggleThemeMode = useUIStore((s) => s.toggleThemeMode)
  const setPalette = useUIStore((s) => s.setPalette)
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const displayName = authUser?.name ?? 'User'
  const workspace = authUser?.tenantName ?? authUser?.tenantSlug ?? 'Workspace'
  const userId = authUser?.id ?? ''

  const notifs = useNotificationsStore((s) => s.items)
  const loadNotifs = useNotificationsStore((s) => s.load)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)

  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  const searchRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifs.filter((n) => !n.isRead).length

  useEffect(() => {
    if (!userId || !isTenantSession()) return
    void loadNotifs(userId, authUser?.role)
    const id = window.setInterval(() => void loadNotifs(userId, authUser?.role), 45000)
    return () => window.clearInterval(id)
  }, [userId, authUser?.role, loadNotifs])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpen(false)
      if (notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false)
      if (avatarRef.current && !avatarRef.current.contains(t)) setAvatarOpen(false)
      if (paletteRef.current && !paletteRef.current.contains(t)) setPaletteOpen(false)
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
              primary: `#${String(t.ticketNo ?? '')} ${String(t.subject ?? '')}`,
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
      navigate('/login', { replace: true })
      setLoggingOut(false)
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      <button
        className="rounded-[6px] p-1.5 text-text-secondary hover:bg-slate-100 lg:hidden"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        <Menu size={20} />
      </button>

      <div className="flex items-center">
        <BrandLogo size="sm" className="max-w-[120px] lg:max-w-[140px]" />
      </div>

      <div ref={searchRef} className="relative mx-auto w-full max-w-xl">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setSearchOpen(true)
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search customers by name or phone…"
          className="h-9 w-full rounded-[6px] border border-border bg-surface pl-9 pr-3 text-base outline-none transition-all duration-150 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
        />
        {searchOpen && search.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-[8px] border border-border bg-card shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
            {searching ? (
              <div className="p-4 text-center text-sm text-text-secondary">Searching…</div>
            ) : hits.length === 0 ? (
              <div className="p-3">
                <div className="mb-2 px-1 text-center text-sm text-text-secondary">No customers found</div>
                <button
                  type="button"
                  className="w-full rounded-[8px] border border-dashed border-accent-blue/40 bg-accent-blue/5 px-3 py-2.5 text-left text-sm font-medium text-accent-blue hover:bg-accent-blue/10"
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
          <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-[8px] border border-border bg-card p-3 text-sm text-text-secondary shadow-md">
            Type at least 2 characters…
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleThemeMode}
          className="rounded-[6px] p-2 text-text-secondary hover:bg-muted transition-colors duration-150"
          title={themeMode === 'light' ? 'Switch to night mode' : 'Switch to day mode'}
        >
          {themeMode === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

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

        <div ref={notifRef} className="relative">
          <button
            onClick={() => {
              setNotifOpen(!notifOpen)
              if (!notifOpen && userId) void loadNotifs(userId, authUser?.role)
            }}
            className="relative rounded-[6px] p-2 text-text-secondary hover:bg-muted transition-colors duration-150"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-red px-1 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-[8px] border border-border bg-card shadow-[var(--shadow-hover)]">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-md font-semibold">Notifications</span>
                {notifs.length > 0 && (
                  <button
                    className="flex items-center gap-1 text-xs text-accent-blue hover:underline"
                    onClick={() => userId && markAllRead(userId)}
                  >
                    <CheckCheck size={12} /> Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifs.length === 0 ? (
                  <div className="p-6 text-center text-sm text-text-secondary">
                    No notifications. Assigned leads, open tasks, and tickets appear here.
                  </div>
                ) : (
                  notifs.slice(0, 12).map((n) => (
                    <button
                      key={n.id}
                      className={cn(
                        'flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-surface',
                        !n.isRead && 'border-l-2 border-l-accent-blue bg-accent-blue/5',
                      )}
                      onClick={() => {
                        if (userId) markRead(n.id, userId)
                        setNotifOpen(false)
                        if (n.href) navigate(n.href)
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary">{n.title}</div>
                        <div className="truncate text-xs text-text-secondary">{n.message}</div>
                        <div className="mt-1 text-xs text-text-secondary">{timeAgo(n.createdAt)}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <Link
          to="/help"
          className="rounded-[6px] p-2 text-text-secondary hover:bg-muted transition-colors duration-150"
          title="How NovaCRM works"
          aria-label="How NovaCRM works"
        >
          <HelpCircle size={18} />
        </Link>

        <div ref={avatarRef} className="relative ml-1">
          <button
            type="button"
            onClick={() => setAvatarOpen((open) => !open)}
            className="flex items-center gap-2 rounded-full border border-transparent px-1 py-0.5 hover:border-border"
            aria-label="Account menu"
          >
            <Avatar name={displayName} src={authUser?.avatarUrl} size="sm" />
            <span className="hidden max-w-[120px] truncate text-left text-xs leading-tight sm:block">
              <span className="block font-semibold text-text-primary">{displayName}</span>
              <span className="block text-text-secondary">{workspace}</span>
            </span>
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
              <Link
                to="/help"
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface"
                onClick={() => setAvatarOpen(false)}
              >
                <HelpCircle size={14} /> How it works
              </Link>
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
