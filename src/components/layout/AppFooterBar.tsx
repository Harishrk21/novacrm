import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  CheckCheck,
  Hash,
  HelpCircle,
  MessageCircle,
  MessagesSquare,
  Mic,
  Minimize2,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Radio,
  Search,
  Send,
  Smile,
  Star,
  UserPlus,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

type Channel = Awaited<ReturnType<typeof api.teamChatChannels>>['items'][number]
type Message = Awaited<ReturnType<typeof api.teamChatMessages>>['items'][number]
type Teammate = Awaited<ReturnType<typeof api.teamChatTeammates>>['items'][number]
type ListTab = 'all' | 'people' | 'channels' | 'messages'
type QuickAction =
  | 'dm'
  | 'group'
  | 'invite'
  | 'call'
  | 'channel'
  | 'meet'
  | 'schedule'
  | 'live'

const LIST_TABS: { id: ListTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'channels', label: 'Channels' },
  { id: 'messages', label: 'Messages' },
]

function sameDay(a: string, b: string) {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (sameDay(iso, today.toISOString())) return 'Today'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (sameDay(iso, y.toISOString())) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function msgTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function TeamChatPanel() {
  const navigate = useNavigate()
  const open = useUIStore((s) => s.teamChatOpen)
  const footerTab = useUIStore((s) => s.teamChatTab)
  const listTab = useUIStore((s) => s.teamChatListTab)
  const channelId = useUIStore((s) => s.teamChatChannelId)
  const minimized = useUIStore((s) => s.teamChatMinimized)
  const close = useUIStore((s) => s.closeTeamChat)
  const closeChatWindowStore = useUIStore((s) => s.closeChatWindow)
  const setListTab = useUIStore((s) => s.setTeamChatListTab)
  const setChannelId = useUIStore((s) => s.setTeamChatChannelId)
  const setUnread = useUIStore((s) => s.setTeamChatUnread)
  const setMinimized = useUIStore((s) => s.setTeamChatMinimized)
  const addToast = useUIStore((s) => s.addToast)
  const me = useAuthStore((s) => s.user)

  const [channels, setChannels] = useState<Channel[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [teammates, setTeammates] = useState<Teammate[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [sending, setSending] = useState(false)
  const [openingChat, setOpeningChat] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [actionModal, setActionModal] = useState<QuickAction | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [channelName, setChannelName] = useState('')
  const [busyAction, setBusyAction] = useState(false)
  /** Keeps chat window open immediately before channels list refreshes */
  const [activeOverride, setActiveOverride] = useState<Channel | null>(null)

  const closeChatWindow = useCallback(() => {
    setActiveOverride(null)
    closeChatWindowStore()
  }, [closeChatWindowStore])

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const active = useMemo(() => {
    const fromList = channels.find((c) => c.id === channelId) ?? null
    if (fromList) return fromList
    if (activeOverride && activeOverride.id === channelId) return activeOverride
    return null
  }, [channels, channelId, activeOverride])

  const loadChannels = useCallback(async () => {
    if (!isTenantSession()) return
    try {
      const data = await api.teamChatChannels()
      setChannels(data.items ?? [])
      setUnread(data.unreadTotal ?? 0)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load team chats',
      })
    }
  }, [setUnread, addToast])

  const loadMessages = useCallback(
    async (id: string) => {
      setLoadingMsgs(true)
      try {
        const data = await api.teamChatMessages(id, { limit: 80 })
        setMessages(data.items ?? [])
        await loadChannels()
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof ApiClientError ? e.message : 'Failed to load messages',
        })
      } finally {
        setLoadingMsgs(false)
      }
    },
    [addToast, loadChannels],
  )

  const loadTeammates = useCallback(async () => {
    try {
      const data = await api.teamChatTeammates()
      setTeammates(data.items ?? [])
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load teammates',
      })
    }
  }, [addToast])

  useEffect(() => {
    if (!open || !isTenantSession()) return
    setLoadingList(true)
    void Promise.all([loadChannels(), loadTeammates()]).finally(() => setLoadingList(false))
  }, [open, loadChannels, loadTeammates])

  // Keep list tab in sync when footer icon changes while panel is open
  useEffect(() => {
    if (!open) return
    if (footerTab === 'channels') setListTab('channels')
    else if (footerTab === 'people') {
      setListTab('people')
      if (!search.startsWith('@')) setSearch('@')
    } else if (footerTab === 'chats' || footerTab === 'pins') {
      setListTab('all')
      if (search.startsWith('@')) setSearch('')
    } else if (footerTab === 'threads') setListTab('messages')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to footer tab
  }, [footerTab, open])

  useEffect(() => {
    if (!open || !channelId || minimized) return
    void loadMessages(channelId)
    const t = window.setInterval(() => void loadMessages(channelId), 15_000)
    return () => window.clearInterval(t)
  }, [open, channelId, minimized, loadMessages])

  useEffect(() => {
    if (!open) return
    const t = window.setInterval(() => void loadChannels(), 30_000)
    return () => window.clearInterval(t)
  }, [open, loadChannels])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open && channelId && !minimized) inputRef.current?.focus()
  }, [open, channelId, minimized])

  useEffect(() => {
    if (open) {
      // Focus search when opening Cliq Mini
      const t = window.setTimeout(() => searchRef.current?.focus(), 50)
      return () => window.clearTimeout(t)
    }
  }, [open, footerTab])

  // Sync footer tab → list tab + search hint for pins
  useEffect(() => {
    if (!open) return
    if (footerTab === 'pins') setSearch('')
  }, [footerTab, open])

  const atMode = search.trim().startsWith('@')
  const query = (atMode ? search.trim().slice(1) : search.trim()).toLowerCase()

  const filteredPeople = useMemo(() => {
    if (!query) return teammates
    return teammates.filter(
      (u) =>
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        u.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(query)),
    )
  }, [teammates, query])

  const filteredChannels = useMemo(() => {
    let list = channels.filter((c) => c.type === 'CHANNEL')
    if (footerTab === 'pins') list = channels.filter((c) => c.pinnedAt)
    if (!query || atMode) return list
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.description ?? '').toLowerCase().includes(query) ||
        c.slug.toLowerCase().includes(query),
    )
  }, [channels, query, atMode, footerTab])

  const filteredMessages = useMemo(() => {
    // Recent chats: DMs first, then anything with activity — fall back to all channels so the dock isn't empty
    let list = channels.filter((c) => c.type === 'DM' || c.lastMessage || c.unread > 0)
    if (!list.length) list = channels
    if (footerTab === 'pins') list = channels.filter((c) => c.pinnedAt)
    if (atMode) return []
    if (!query) return list
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.lastMessage?.body ?? '').toLowerCase().includes(query),
    )
  }, [channels, query, atMode, footerTab])

  const listItems = useMemo(() => {
    const effectiveTab: ListTab =
      footerTab === 'pins'
        ? 'all'
        : footerTab === 'threads'
          ? 'messages'
          : footerTab === 'channels'
            ? 'channels'
            : footerTab === 'people'
              ? 'people'
              : listTab

    if (atMode || effectiveTab === 'people') {
      return { kind: 'people' as const, people: filteredPeople, channels: [] as Channel[] }
    }
    if (effectiveTab === 'channels') {
      return { kind: 'channels' as const, people: [] as Teammate[], channels: filteredChannels }
    }
    if (effectiveTab === 'messages') {
      return { kind: 'messages' as const, people: [] as Teammate[], channels: filteredMessages }
    }
    // All — people + channels / recent chats (never empty when teammates or channels exist)
    const people = query || atMode ? filteredPeople : filteredPeople.slice(0, 8)
    const chatList = [
      ...filteredMessages,
      ...filteredChannels.filter((c) => !filteredMessages.some((m) => m.id === c.id)),
    ]
    return {
      kind: 'all' as const,
      people,
      channels: chatList.length ? chatList : channels,
    }
  }, [
    listTab,
    footerTab,
    atMode,
    query,
    filteredPeople,
    filteredChannels,
    filteredMessages,
    channels,
  ])

  async function openDm(userId: string) {
    if (openingChat) return
    setOpeningChat(true)
    try {
      const dm = await api.teamChatOpenDm(userId)
      const optimistic: Channel = {
        id: dm.id,
        type: 'DM',
        name: dm.name,
        slug: dm.slug,
        unread: 0,
        pinnedAt: null,
        lastMessageAt: null,
        lastMessage: null,
        peer: dm.peer
          ? { id: dm.peer.id, name: dm.peer.name, avatarUrl: dm.peer.avatarUrl }
          : null,
      }
      setActiveOverride(optimistic)
      setChannels((prev) => (prev.some((c) => c.id === dm.id) ? prev : [optimistic, ...prev]))
      setMessages([])
      setChannelId(dm.id)
      setMinimized(false)
      setSearch('')
      setQuickOpen(false)
      setActionModal(null)
      void loadChannels()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not open chat',
      })
    } finally {
      setOpeningChat(false)
    }
  }

  async function openChannel(id: string) {
    const ch = channels.find((c) => c.id === id) ?? null
    if (ch) setActiveOverride(ch)
    setMessages([])
    setChannelId(id)
    setMinimized(false)
    setSearch('')
  }

  async function send() {
    const text = draft.trim()
    if (!text || !channelId || sending) return
    setSending(true)
    try {
      const msg = await api.teamChatSend(channelId, text)
      setDraft('')
      setMessages((prev) => [...prev, msg])
      await loadChannels()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not send',
      })
    } finally {
      setSending(false)
    }
  }

  async function togglePin(id: string) {
    try {
      await api.teamChatPin(id)
      await loadChannels()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not pin',
      })
    }
  }

  function openQuickAction(action: QuickAction) {
    setQuickOpen(false)
    setPickerQuery('')
    setPickedIds([])
    setChannelName('')
    if (action === 'invite') {
      navigate('/users')
      addToast({ type: 'info', message: 'Invite teammates from Users' })
      return
    }
    if (action === 'call' || action === 'meet' || action === 'schedule' || action === 'live') {
      const labels: Record<string, string> = {
        call: 'Calls',
        meet: 'Meet Now',
        schedule: 'Schedule Meeting',
        live: 'Schedule Live Event',
      }
      addToast({
        type: 'info',
        message: `${labels[action]} — connect your calendar/VoIP in Setup to enable`,
      })
      return
    }
    setActionModal(action)
  }

  async function confirmAction() {
    if (!actionModal || busyAction) return
    setBusyAction(true)
    try {
      if (actionModal === 'dm') {
        const id = pickedIds[0]
        if (!id) return
        await openDm(id)
        return
      }
      if (actionModal === 'channel' || actionModal === 'group') {
        const name =
          channelName.trim() ||
          (actionModal === 'group'
            ? `Group · ${teammates
                .filter((t) => pickedIds.includes(t.id))
                .map((t) => t.name.split(' ')[0])
                .slice(0, 3)
                .join(', ')}`
            : '')
        if (!name) {
          addToast({ type: 'error', message: 'Enter a name' })
          return
        }
        const ch = await api.teamChatCreateChannel({
          name,
          description:
            actionModal === 'group'
              ? `Group with ${pickedIds.length} member${pickedIds.length === 1 ? '' : 's'}`
              : undefined,
        })
        // Open DMs with picked people as a friendly follow-up (channel is company-wide)
        setChannelId(String(ch.id))
        setMinimized(false)
        await loadChannels()
        setActionModal(null)
        addToast({
          type: 'success',
          message: actionModal === 'group' ? 'Group conversation created' : 'Channel created',
        })
      }
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Action failed',
      })
    } finally {
      setBusyAction(false)
    }
  }

  if (!open) return null

  const searchPlaceholder = atMode
    ? 'Search people…'
    : 'Search with @ for people, or channels…'

  const panel = (
    <>
      {/* Cliq Mini list dock — portaled to body so layout overflow cannot clip it */}
      <div className="pointer-events-none fixed bottom-10 left-2 z-[200] flex items-end gap-2 sm:left-3">
        <div className="pointer-events-auto relative flex h-[min(560px,calc(100vh-6.5rem))] w-[min(340px,calc(100vw-1rem))] flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card shadow-[0_-8px_40px_rgba(0,0,0,0.28)]">
          {/* Header */}
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text-primary">Team Chat</div>
              <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Available
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded p-1 text-text-secondary hover:bg-muted hover:text-text-primary"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* @ search */}
          <div className="shrink-0 border-b border-border px-2.5 py-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary"
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-lg border border-border bg-muted/50 py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none placeholder:text-text-secondary focus:border-[color:var(--color-accent-blue)]"
              />
            </div>
            {atMode && (
              <p className="mt-1.5 px-0.5 text-[11px] text-[color:var(--color-accent-blue)]">
                Searching people matching “{query || '…'}”
              </p>
            )}
          </div>

          {/* Tabs */}
          <div className="flex shrink-0 gap-0.5 border-b border-border px-2 pt-1">
            {LIST_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setListTab(t.id)
                  if (t.id === 'people' && !search.startsWith('@')) setSearch('@')
                  if (t.id !== 'people' && search.startsWith('@')) setSearch('')
                }}
                className={cn(
                  'relative flex-1 px-1 pb-2 pt-1.5 text-[12px] font-medium transition',
                  listTab === t.id
                    ? 'text-[color:var(--color-accent-blue)]'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {t.label}
                {listTab === t.id && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[color:var(--color-accent-blue)]" />
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-14">
            {loadingList && !teammates.length && !channels.length ? (
              <p className="px-3 py-8 text-center text-xs text-text-secondary">Loading…</p>
            ) : (
              <>
                {(listItems.kind === 'all' || listItems.kind === 'people') &&
                  listItems.people.length > 0 && (
                    <div className="px-1.5 py-1">
                      {listItems.kind === 'all' && (
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                          People
                        </p>
                      )}
                      {listItems.people.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => void openDm(u.id)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted"
                        >
                          <div className="relative">
                            <Avatar name={u.name} src={u.avatarUrl} size="md" />
                            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-card bg-emerald-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-text-primary">
                              {u.name}
                            </div>
                            <div className="truncate text-[11px] text-text-secondary">{u.email}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                {(listItems.kind === 'all' ||
                  listItems.kind === 'channels' ||
                  listItems.kind === 'messages') &&
                  listItems.channels.length > 0 && (
                    <div className="px-1.5 py-1">
                      {listItems.kind === 'all' && (
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                          {listTab === 'messages' ? 'Messages' : 'Channels & chats'}
                        </p>
                      )}
                      {listItems.channels.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => void openChannel(c.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted',
                            channelId === c.id && 'bg-[color:var(--color-accent-blue)]/10',
                          )}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-text-secondary">
                            {c.type === 'DM' ? (
                              <Avatar name={c.name} src={c.peer?.avatarUrl} size="md" />
                            ) : (
                              <Hash size={15} />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-[13px] font-medium text-text-primary">
                                {c.type === 'CHANNEL' ? `# ${c.name}` : c.name}
                              </span>
                              {c.pinnedAt && <Pin size={10} className="text-amber-500" />}
                            </div>
                            <div className="truncate text-[11px] text-text-secondary">
                              {c.lastMessage?.body ?? c.description ?? (c.type === 'DM' ? 'Direct message' : 'Channel')}
                            </div>
                          </div>
                          {c.unread > 0 && (
                            <span className="rounded-full bg-[color:var(--color-accent-blue)] px-1.5 text-[10px] font-semibold text-white">
                              {c.unread}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                {!listItems.people.length && !listItems.channels.length && (
                  <div className="px-4 py-10 text-center text-xs text-text-secondary">
                    {atMode
                      ? 'No people match that @ search'
                      : footerTab === 'pins'
                        ? 'Pin chats from the conversation window'
                        : 'Nothing here yet — try @name or create a channel'}
                  </div>
                )}
              </>
            )}
          </div>

          {/* FAB Quick Actions */}
          <div className="absolute bottom-3 left-3">
            <div className="relative">
              {quickOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-[61] cursor-default"
                    aria-label="Close quick actions"
                    onClick={() => setQuickOpen(false)}
                  />
                  <div className="absolute bottom-12 left-0 z-[62] w-64 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                    <div className="border-b border-border px-3 py-2">
                      <p className="text-[12px] font-semibold text-text-primary">Quick Actions</p>
                      <p className="text-[10px] text-text-secondary">
                        Use Team Chat to access these features
                      </p>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                      {(
                        [
                          { id: 'dm' as const, icon: MessageCircle, label: 'Send a Direct Message' },
                          { id: 'group' as const, icon: Users, label: 'Start a Group Conversation' },
                          { id: 'invite' as const, icon: UserPlus, label: 'Invite People' },
                          { id: 'call' as const, icon: Phone, label: 'Make a Call' },
                          { id: 'channel' as const, icon: Hash, label: 'Create a Channel' },
                          { id: 'meet' as const, icon: Video, label: 'Meet Now' },
                          { id: 'schedule' as const, icon: Calendar, label: 'Schedule Meeting' },
                          { id: 'live' as const, icon: Radio, label: 'Schedule Live Event' },
                        ] as const
                      ).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => openQuickAction(a.id)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-muted"
                        >
                          <a.icon size={15} className="shrink-0 text-text-secondary" />
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => setQuickOpen((v) => !v)}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-accent-blue)] text-white shadow-lg transition hover:brightness-110',
                  quickOpen && 'rotate-45',
                )}
                title="Quick Actions"
              >
                <Plus size={22} />
              </button>
            </div>
          </div>
        </div>

        {/* Floating chat window */}
        {channelId && active && !minimized && (
          <div className="pointer-events-auto flex h-[min(560px,calc(100vh-6.5rem))] w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card shadow-[0_-8px_40px_rgba(0,0,0,0.28)]">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
              {active.type === 'DM' ? (
                <Avatar name={active.name} src={active.peer?.avatarUrl} size="sm" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                  <Hash size={14} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-text-primary">
                  {active.name}
                </div>
                <div className="truncate text-[11px] text-text-secondary">
                  {active.type === 'DM' ? 'Direct message' : active.description || 'Channel'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void togglePin(active.id)}
                className={cn(
                  'rounded p-1.5 hover:bg-muted',
                  active.pinnedAt ? 'text-amber-500' : 'text-text-secondary',
                )}
                title={active.pinnedAt ? 'Unpin' : 'Pin'}
              >
                <Star size={14} fill={active.pinnedAt ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() =>
                  addToast({ type: 'info', message: 'Voice call — connect VoIP in Setup to enable' })
                }
                className="rounded p-1.5 text-text-secondary hover:bg-muted"
                title="Call"
              >
                <Phone size={14} />
              </button>
              <button
                type="button"
                onClick={() =>
                  addToast({ type: 'info', message: 'Video call — connect meeting provider in Setup' })
                }
                className="rounded p-1.5 text-text-secondary hover:bg-muted"
                title="Video"
              >
                <Video size={14} />
              </button>
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="rounded p-1.5 text-text-secondary hover:bg-muted"
                title="Minimize"
              >
                <Minimize2 size={14} />
              </button>
              <button
                type="button"
                onClick={closeChatWindow}
                className="rounded p-1.5 text-text-secondary hover:bg-muted"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {loadingMsgs && !messages.length ? (
                <p className="py-10 text-center text-xs text-text-secondary">Loading…</p>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-text-secondary">
                  <MessagesSquare size={28} className="opacity-40" />
                  <p className="text-sm">Say hello</p>
                  <p className="text-xs">Internal team discussion only</p>
                </div>
              ) : (
                messages.map((m, i) => {
                  const prev = messages[i - 1]
                  const showDay = !prev || !sameDay(prev.createdAt, m.createdAt)
                  const mine = m.sender.id === me?.id
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <div className="my-3 flex items-center justify-center">
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-text-secondary">
                            {dayLabel(m.createdAt)}
                          </span>
                        </div>
                      )}
                      <div className={cn('mb-2 flex', mine ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[78%] rounded-2xl px-3 py-1.5 text-[13px]',
                            mine
                              ? 'rounded-br-md bg-[color:var(--color-accent-blue)] text-white'
                              : 'rounded-bl-md bg-muted text-text-primary',
                          )}
                        >
                          {!mine && (
                            <div className="mb-0.5 text-[11px] font-medium opacity-80">
                              {m.sender.name}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap">{m.body}</div>
                          <div
                            className={cn(
                              'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
                              mine ? 'text-white/70' : 'text-text-secondary',
                            )}
                          >
                            {msgTime(m.createdAt)}
                            {mine && <CheckCheck size={12} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="shrink-0 border-t border-border px-2.5 py-2">
              <div className="flex items-end gap-1.5 rounded-xl border border-border bg-muted/40 px-2 py-1.5">
                <button
                  type="button"
                  className="mb-1 rounded p-1 text-text-secondary hover:bg-muted"
                  title="Attach"
                  onClick={() =>
                    addToast({ type: 'info', message: 'Attachments coming soon' })
                  }
                >
                  <Paperclip size={16} />
                </button>
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  rows={1}
                  placeholder="Message"
                  className="max-h-24 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[13px] text-text-primary outline-none placeholder:text-text-secondary"
                />
                <button
                  type="button"
                  className="mb-1 rounded p-1 text-text-secondary hover:bg-muted"
                  title="Emoji"
                  onClick={() => setDraft((d) => d + ' 🙂')}
                >
                  <Smile size={16} />
                </button>
                {draft.trim() ? (
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void send()}
                    className="mb-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--color-accent-blue)] text-white disabled:opacity-40"
                  >
                    <Send size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mb-1 rounded p-1 text-text-secondary hover:bg-muted"
                    title="Voice message"
                    onClick={() =>
                      addToast({ type: 'info', message: 'Voice messages coming soon' })
                    }
                  >
                    <Mic size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Minimized chat pill */}
        {channelId && active && minimized && (
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="pointer-events-auto mb-1 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-lg"
          >
            <Avatar name={active.name} src={active.peer?.avatarUrl} size="sm" />
            <span className="max-w-[140px] truncate text-[12px] font-medium">{active.name}</span>
            <X
              size={13}
              className="text-text-secondary"
              onClick={(e) => {
                e.stopPropagation()
                closeChatWindow()
              }}
            />
          </button>
        )}
      </div>

      {/* Action picker modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {actionModal === 'dm'
                    ? 'Send a Direct Message'
                    : actionModal === 'group'
                      ? 'Start a Group Conversation'
                      : 'Create a Channel'}
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {actionModal === 'dm'
                    ? 'Pick a teammate — search with @'
                    : actionModal === 'group'
                      ? 'Name the group and select members'
                      : 'Create a channel for your internal team'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="rounded p-1 text-text-secondary hover:bg-muted"
              >
                <X size={15} />
              </button>
            </div>

            {(actionModal === 'channel' || actionModal === 'group') && (
              <input
                autoFocus={actionModal === 'channel'}
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder={actionModal === 'group' ? 'Group name' : 'Channel name'}
                className="mb-2 h-9 w-full rounded-md border border-border bg-muted/40 px-3 text-sm outline-none focus:border-[color:var(--color-accent-blue)]"
              />
            )}

            {(actionModal === 'dm' || actionModal === 'group') && (
              <>
                <div className="relative mb-2">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary"
                  />
                  <input
                    autoFocus={actionModal === 'dm' || actionModal === 'group'}
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="@ search people"
                    className="h-9 w-full rounded-md border border-border bg-muted/40 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-[color:var(--color-accent-blue)]"
                  />
                </div>
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                  {teammates
                    .filter((u) => {
                      const q = pickerQuery.trim().replace(/^@/, '').toLowerCase()
                      if (!q) return true
                      return (
                        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                      )
                    })
                    .map((u) => {
                      const selected = pickedIds.includes(u.id)
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            if (actionModal === 'dm') setPickedIds([u.id])
                            else
                              setPickedIds((ids) =>
                                selected ? ids.filter((x) => x !== u.id) : [...ids, u.id],
                              )
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted',
                            selected && 'bg-[color:var(--color-accent-blue)]/12',
                          )}
                        >
                          <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{u.name}</div>
                            <div className="truncate text-[11px] text-text-secondary">{u.email}</div>
                          </div>
                          {selected && (
                            <CheckCheck size={14} className="text-[color:var(--color-accent-blue)]" />
                          )}
                        </button>
                      )
                    })}
                </div>
              </>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void confirmAction()}
                className="rounded-md bg-[color:var(--color-accent-blue)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {actionModal === 'dm' ? 'Message' : actionModal === 'group' ? 'Start' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return createPortal(panel, document.body)
}

export function TeamChatUnreadPoller() {
  const setUnread = useUIStore((s) => s.setTeamChatUnread)
  useEffect(() => {
    if (!isTenantSession()) return
    let alive = true
    const tick = async () => {
      try {
        const data = await api.teamChatChannels()
        if (alive) setUnread(data.unreadTotal)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const t = window.setInterval(tick, 20000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [setUnread])
  return null
}

export function AppFooterBar() {
  const open = useUIStore((s) => s.teamChatOpen)
  const tab = useUIStore((s) => s.teamChatTab)
  const unread = useUIStore((s) => s.teamChatUnread)
  const openTeamChat = useUIStore((s) => s.openTeamChat)
  const closeTeamChat = useUIStore((s) => s.closeTeamChat)
  const openHowItWorks = useUIStore((s) => s.openHowItWorks)

  function toggle(next: typeof tab) {
    if (open && tab === next) closeTeamChat()
    else openTeamChat(next)
  }

  const items: { id: typeof tab; label: string; icon: typeof Pin; badge?: number }[] = [
    { id: 'pins', label: 'My Pins', icon: Pin },
    { id: 'chats', label: 'Chats', icon: MessageCircle, badge: unread || undefined },
    { id: 'channels', label: 'Channels', icon: Hash },
    { id: 'threads', label: 'Threads', icon: MessagesSquare },
    { id: 'people', label: 'Contacts', icon: Users },
  ]

  return (
    <>
      <TeamChatUnreadPoller />
      <footer className="zcrm-footer relative z-[55] flex h-10 shrink-0 items-center gap-0.5 border-t border-border bg-card px-1.5 text-[12px] sm:gap-1 sm:px-2">
        {items.map((item) => {
          const Icon = item.icon
          const active = open && tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              className={cn(
                'relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 font-medium transition sm:px-2.5',
                active
                  ? 'bg-[color:var(--color-accent-blue)]/15 text-[color:var(--color-accent-blue)]'
                  : 'text-text-secondary hover:bg-muted hover:text-text-primary',
              )}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="ml-0.5 rounded-full bg-[color:var(--color-accent-blue)] px-1.5 text-[10px] font-semibold leading-4 text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-0.5">
          <span className="hidden items-center gap-1 px-1 text-[11px] text-text-secondary md:inline-flex">
            <Zap size={12} />
            Team Chat
          </span>
          <button
            type="button"
            onClick={openHowItWorks}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-[color:var(--color-accent-purple)]/90 px-2 text-[11px] font-semibold text-white hover:brightness-110"
            title="Help"
          >
            <HelpCircle size={12} />
            Help
          </button>
        </div>
      </footer>
      <TeamChatPanel />
    </>
  )
}
