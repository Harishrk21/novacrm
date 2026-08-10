import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCrmStore } from '@/store/crmStore'
import { normalizePhone } from '@/lib/utils'

export interface WaMessage {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  body: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  createdAt: string
}

export interface WaConversation {
  id: string
  phone: string
  contactName: string
  contactId?: string
  lastMessage: string
  unread: number
  updatedAt: string
  tags: string[]
}

interface AskMeisterState {
  connected: boolean
  workspaceUrl: string
  apiKey: string
  workspaceName: string
  phoneNumberId: string
  lastSyncedAt?: string
  conversations: WaConversation[]
  messages: WaMessage[]
  activeConversationId?: string
  connect: (input: { workspaceUrl: string; apiKey: string; workspaceName?: string; phoneNumberId?: string }) => boolean
  disconnect: () => void
  setActiveConversation: (id?: string) => void
  sendMessage: (body: string) => void
  markRead: (conversationId: string) => void
  syncFromAskMeister: () => void
}

const demoConversations = (): { conversations: WaConversation[]; messages: WaMessage[] } => {
  const contacts = useCrmStore.getState().contacts
  const pick = (i: number) => contacts[i] ?? contacts[0]
  const c1 = pick(0)
  const c2 = pick(1)
  const c3 = pick(2)
  const conversations: WaConversation[] = [
    {
      id: 'wa-1',
      phone: c1?.phone ?? '+91 98765 43210',
      contactName: c1?.name ?? 'Sundar Kumar',
      contactId: c1?.id,
      lastMessage: 'Can you share the revised quotation?',
      unread: 2,
      updatedAt: new Date(Date.now() - 12 * 60000).toISOString(),
      tags: ['Hot lead'],
    },
    {
      id: 'wa-2',
      phone: c2?.phone ?? '+91 98840 22110',
      contactName: c2?.name ?? 'Customer',
      contactId: c2?.id,
      lastMessage: 'Thanks, will confirm by tomorrow.',
      unread: 0,
      updatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      tags: [],
    },
    {
      id: 'wa-3',
      phone: c3?.phone ?? '+91 90000 11122',
      contactName: c3?.name ?? 'Prospect',
      contactId: c3?.id,
      lastMessage: 'Is onboarding support included?',
      unread: 1,
      updatedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
      tags: ['Support'],
    },
  ]
  const messages: WaMessage[] = [
    {
      id: 'wm-1',
      conversationId: 'wa-1',
      direction: 'inbound',
      body: 'Hi, following up on our demo yesterday.',
      status: 'read',
      createdAt: new Date(Date.now() - 40 * 60000).toISOString(),
    },
    {
      id: 'wm-2',
      conversationId: 'wa-1',
      direction: 'outbound',
      body: 'Hello! Sharing the proposal link shortly.',
      status: 'read',
      createdAt: new Date(Date.now() - 35 * 60000).toISOString(),
    },
    {
      id: 'wm-3',
      conversationId: 'wa-1',
      direction: 'inbound',
      body: 'Can you share the revised quotation?',
      status: 'delivered',
      createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
    },
    {
      id: 'wm-4',
      conversationId: 'wa-2',
      direction: 'outbound',
      body: 'Reminder: kickoff call tomorrow at 11 AM.',
      status: 'read',
      createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    },
    {
      id: 'wm-5',
      conversationId: 'wa-2',
      direction: 'inbound',
      body: 'Thanks, will confirm by tomorrow.',
      status: 'read',
      createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    },
    {
      id: 'wm-6',
      conversationId: 'wa-3',
      direction: 'inbound',
      body: 'Is onboarding support included?',
      status: 'delivered',
      createdAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    },
  ]
  return { conversations, messages }
}

export const useAskMeisterStore = create<AskMeisterState>()(
  persist(
    (set, get) => ({
      connected: false,
      workspaceUrl: 'https://app.askmeister.com',
      apiKey: '',
      workspaceName: '',
      phoneNumberId: '',
      conversations: [],
      messages: [],
      activeConversationId: undefined,

      connect: ({ workspaceUrl, apiKey, workspaceName, phoneNumberId }) => {
        if (!apiKey.trim() || apiKey.trim().length < 8) return false
        const demo = demoConversations()
        // Link conversations to contacts by phone when possible
        const contacts = useCrmStore.getState().contacts
        const conversations = demo.conversations.map((c) => {
          const match = contacts.find(
            (ct) =>
              (ct.phone && normalizePhone(ct.phone) === normalizePhone(c.phone)) ||
              (ct.mobile && normalizePhone(ct.mobile) === normalizePhone(c.phone)),
          )
          return match
            ? { ...c, contactId: match.id, contactName: match.name, phone: match.phone ?? c.phone }
            : c
        })
        set({
          connected: true,
          workspaceUrl: workspaceUrl || 'https://app.askmeister.com',
          apiKey: apiKey.trim(),
          workspaceName: workspaceName || 'AskMeister Workspace',
          phoneNumberId: phoneNumberId || 'askmeister-primary',
          lastSyncedAt: new Date().toISOString(),
          conversations,
          messages: demo.messages,
          activeConversationId: conversations[0]?.id,
        })
        return true
      },

      disconnect: () =>
        set({
          connected: false,
          apiKey: '',
          lastSyncedAt: undefined,
          conversations: [],
          messages: [],
          activeConversationId: undefined,
        }),

      setActiveConversation: (conversationId) => {
        set({ activeConversationId: conversationId })
        if (conversationId) get().markRead(conversationId)
      },

      markRead: (conversationId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, unread: 0 } : c,
          ),
        })),

      sendMessage: (body) => {
        const text = body.trim()
        const conversationId = get().activeConversationId
        if (!text || !conversationId || !get().connected) return
        const msg: WaMessage = {
          id: `wm-${Date.now()}`,
          conversationId,
          direction: 'outbound',
          body: text,
          status: 'sent',
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          messages: [...s.messages, msg],
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: text, updatedAt: msg.createdAt, unread: 0 }
              : c,
          ),
        }))

        // Log as CRM activity + auto-reply simulation
        const conv = get().conversations.find((c) => c.id === conversationId)
        useCrmStore.getState().addActivity({
          type: 'WHATSAPP',
          title: `WhatsApp to ${conv?.contactName ?? 'contact'}`,
          description: text,
          status: 'COMPLETED',
          contactId: conv?.contactId,
          assignedToId: 'user-1',
          completedAt: msg.createdAt,
        })

        window.setTimeout(() => {
          if (get().activeConversationId !== conversationId) return
          const reply: WaMessage = {
            id: `wm-${Date.now()}-r`,
            conversationId,
            direction: 'inbound',
            body: 'Got it — thanks! (synced via AskMeister)',
            status: 'delivered',
            createdAt: new Date().toISOString(),
          }
          set((s) => ({
            messages: [...s.messages, reply],
            conversations: s.conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    lastMessage: reply.body,
                    updatedAt: reply.createdAt,
                    unread: s.activeConversationId === conversationId ? 0 : c.unread + 1,
                  }
                : c,
            ),
          }))
        }, 1600)
      },

      syncFromAskMeister: () => {
        if (!get().connected) return
        const demo = demoConversations()
        set({
          lastSyncedAt: new Date().toISOString(),
          conversations: demo.conversations,
          messages: [...get().messages.filter((m) => m.id.startsWith('wm-') && m.id.includes('-')), ...demo.messages]
            .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i),
        })
      },
    }),
    {
      name: 'novacrm-askmeister',
      partialize: (s) => ({
        connected: s.connected,
        workspaceUrl: s.workspaceUrl,
        apiKey: s.apiKey,
        workspaceName: s.workspaceName,
        phoneNumberId: s.phoneNumberId,
        lastSyncedAt: s.lastSyncedAt,
        conversations: s.conversations,
        messages: s.messages,
        activeConversationId: s.activeConversationId,
      }),
    },
  ),
)
