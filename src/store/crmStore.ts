import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Account,
  Activity,
  Contact,
  Deal,
  DealStage,
  Lead,
  LeadStatus,
  Note,
  Notification,
  Ticket,
  TicketMessage,
  User,
} from '@/types'
import usersData from '@/data/users.json'
import leadsData from '@/data/leads.json'
import contactsData from '@/data/contacts.json'
import accountsData from '@/data/accounts.json'
import dealsData from '@/data/deals.json'
import activitiesData from '@/data/activities.json'
import ticketsData from '@/data/tickets.json'
import notificationsData from '@/data/notifications.json'
import notesData from '@/data/notes.json'
import ticketMessagesData from '@/data/ticketMessages.json'

const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

type RawTicketMessage = {
  id: string
  ticketId: string
  contactId?: string | null
  userId?: string | null
  message: string
  isInternal: boolean
  createdAt: string
}

const seedUsers = usersData as unknown as User[]
const seedMessages: TicketMessage[] = (ticketMessagesData as RawTicketMessage[]).map((m) => ({
  id: m.id,
  ticketId: m.ticketId,
  content: m.message,
  isInternal: m.isInternal,
  authorId: m.userId ?? undefined,
  authorName: m.userId
    ? seedUsers.find((u) => u.id === m.userId)?.name ?? 'Agent'
    : 'Customer',
  attachments: [],
  createdAt: m.createdAt,
}))

interface CrmState {
  users: User[]
  leads: Lead[]
  contacts: Contact[]
  accounts: Account[]
  deals: Deal[]
  activities: Activity[]
  tickets: Ticket[]
  notifications: Notification[]
  notes: Note[]
  ticketMessages: TicketMessage[]

  addLead: (lead: Pick<Lead, 'name'> & Partial<Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>>) => Lead
  updateLead: (id: string, patch: Partial<Lead>) => void
  deleteLead: (id: string) => void
  deleteLeads: (ids: string[]) => void
  assignLeads: (ids: string[], userId: string) => void
  setLeadStatus: (id: string, status: LeadStatus) => void
  convertLead: (leadId: string, dealName?: string, stage?: DealStage) => { contact: Contact; account?: Account; deal: Deal }

  addContact: (contact: Pick<Contact, 'name'> & Partial<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>>) => Contact
  updateContact: (id: string, patch: Partial<Contact>) => void
  deleteContact: (id: string) => void

  addAccount: (account: Pick<Account, 'name'> & Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt'>>) => Account
  updateAccount: (id: string, patch: Partial<Account>) => void
  deleteAccount: (id: string) => void

  addDeal: (deal: Pick<Deal, 'name'> & Partial<Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>>) => Deal
  updateDeal: (id: string, patch: Partial<Deal>) => void
  deleteDeal: (id: string) => void
  moveDealStage: (id: string, stage: DealStage) => void

  addActivity: (activity: Pick<Activity, 'title'> & Partial<Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>>) => Activity
  updateActivity: (id: string, patch: Partial<Activity>) => void
  deleteActivity: (id: string) => void
  completeActivity: (id: string) => void

  addTicket: (ticket: Pick<Ticket, 'subject'> & Partial<Omit<Ticket, 'id' | 'ticketNo' | 'createdAt' | 'updatedAt'>>) => Ticket
  updateTicket: (id: string, patch: Partial<Ticket>) => void
  deleteTicket: (id: string) => void
  addTicketMessage: (message: Pick<TicketMessage, 'ticketId' | 'content'> & Partial<Omit<TicketMessage, 'id' | 'createdAt'>>) => TicketMessage
  closeTicket: (id: string) => void

  addNote: (note: Pick<Note, 'content'> & Partial<Omit<Note, 'id' | 'createdAt' | 'updatedAt'>>) => Note
  markNotificationsRead: (userId: string) => void
  markNotificationRead: (id: string) => void
  resetDemoData: () => void
}

const seed = () => ({
  users: seedUsers,
  leads: leadsData as unknown as Lead[],
  contacts: contactsData as unknown as Contact[],
  accounts: accountsData as unknown as Account[],
  deals: dealsData as unknown as Deal[],
  activities: activitiesData as unknown as Activity[],
  tickets: ticketsData as unknown as Ticket[],
  notifications: notificationsData as unknown as Notification[],
  notes: notesData as unknown as Note[],
  ticketMessages: seedMessages,
})

export const useCrmStore = create<CrmState>()(
  persist(
    (set, get) => ({
      ...seed(),

      addLead: (input) => {
        const lead: Lead = {
          country: 'India',
          tags: [],
          source: 'WEB',
          status: 'NEW',
          score: 40,
          createdById: 'user-1',
          ...input,
          id: id('lead'),
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ leads: [lead, ...s.leads] }))
        return lead
      },
      updateLead: (leadId, patch) =>
        set((s) => ({
          leads: s.leads.map((l) => (l.id === leadId ? { ...l, ...patch, updatedAt: now() } : l)),
        })),
      deleteLead: (leadId) => set((s) => ({ leads: s.leads.filter((l) => l.id !== leadId) })),
      deleteLeads: (ids) => set((s) => ({ leads: s.leads.filter((l) => !ids.includes(l.id)) })),
      assignLeads: (ids, userId) =>
        set((s) => ({
          leads: s.leads.map((l) => (ids.includes(l.id) ? { ...l, assignedToId: userId, updatedAt: now() } : l)),
        })),
      setLeadStatus: (leadId, status) => get().updateLead(leadId, { status }),
      convertLead: (leadId, dealName, stage = 'PROSPECT') => {
        const lead = get().leads.find((l) => l.id === leadId)
        if (!lead) throw new Error('Lead not found')
        let account = get().accounts.find((a) => a.name === lead.company)
        if (!account && lead.company) {
          account = get().addAccount({
            name: lead.company,
            city: lead.city,
            state: lead.state,
            phone: lead.phone,
            email: lead.email,
            ownerId: lead.assignedToId,
          })
        }
        const contact = get().addContact({
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          city: lead.city,
          state: lead.state,
          accountId: account?.id,
          ownerId: lead.assignedToId,
          tags: lead.tags,
        })
        const deal = get().addDeal({
          name: dealName || `${lead.company ?? lead.name} — Opportunity`,
          value: 100000,
          stage,
          priority: 'MEDIUM',
          probability: stage === 'PROSPECT' ? 20 : 40,
          contactId: contact.id,
          accountId: account?.id,
          ownerId: lead.assignedToId,
          expectedCloseDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        })
        get().updateLead(leadId, { status: 'CONVERTED' })
        return { contact, account, deal }
      },

      addContact: (input) => {
        const contact: Contact = {
          country: 'India',
          tags: [],
          ...input,
          id: id('con'),
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ contacts: [contact, ...s.contacts] }))
        return contact
      },
      updateContact: (contactId, patch) =>
        set((s) => ({
          contacts: s.contacts.map((c) => (c.id === contactId ? { ...c, ...patch, updatedAt: now() } : c)),
        })),
      deleteContact: (contactId) => set((s) => ({ contacts: s.contacts.filter((c) => c.id !== contactId) })),

      addAccount: (input) => {
        const account: Account = {
          country: 'India',
          ...input,
          id: id('acc'),
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ accounts: [account, ...s.accounts] }))
        return account
      },
      updateAccount: (accountId, patch) =>
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, ...patch, updatedAt: now() } : a)),
        })),
      deleteAccount: (accountId) => set((s) => ({ accounts: s.accounts.filter((a) => a.id !== accountId) })),

      addDeal: (input) => {
        const deal: Deal = {
          value: 0,
          stage: 'PROSPECT',
          priority: 'MEDIUM',
          probability: 20,
          daysInStage: 0,
          ...input,
          id: id('deal'),
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ deals: [deal, ...s.deals] }))
        return deal
      },
      updateDeal: (dealId, patch) =>
        set((s) => ({
          deals: s.deals.map((d) => (d.id === dealId ? { ...d, ...patch, updatedAt: now() } : d)),
        })),
      deleteDeal: (dealId) => set((s) => ({ deals: s.deals.filter((d) => d.id !== dealId) })),
      moveDealStage: (dealId, stage) => {
        const patch: Partial<Deal> = { stage, daysInStage: 0 }
        if (stage === 'WON' || stage === 'LOST') patch.closedAt = now()
        if (stage === 'WON') patch.probability = 100
        if (stage === 'LOST') patch.probability = 0
        get().updateDeal(dealId, patch)
      },

      addActivity: (input) => {
        const activity: Activity = {
          type: 'TASK',
          status: 'PENDING',
          ...input,
          id: id('act'),
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ activities: [activity, ...s.activities] }))
        return activity
      },
      updateActivity: (activityId, patch) =>
        set((s) => ({
          activities: s.activities.map((a) =>
            a.id === activityId ? { ...a, ...patch, updatedAt: now() } : a,
          ),
        })),
      deleteActivity: (activityId) =>
        set((s) => ({ activities: s.activities.filter((a) => a.id !== activityId) })),
      completeActivity: (activityId) =>
        get().updateActivity(activityId, { status: 'COMPLETED', completedAt: now() }),

      addTicket: (input) => {
        const ticketNo = Math.max(1000, ...get().tickets.map((t) => t.ticketNo)) + 1
        const ticket: Ticket = {
          description: '',
          priority: 'MEDIUM',
          status: 'OPEN',
          slaStatus: 'ON_TRACK',
          slaBreached: false,
          ...input,
          id: id('ticket'),
          ticketNo,
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ tickets: [ticket, ...s.tickets] }))
        return ticket
      },
      updateTicket: (ticketId, patch) =>
        set((s) => ({
          tickets: s.tickets.map((t) => (t.id === ticketId ? { ...t, ...patch, updatedAt: now() } : t)),
        })),
      deleteTicket: (ticketId) => set((s) => ({ tickets: s.tickets.filter((t) => t.id !== ticketId) })),
      addTicketMessage: (input) => {
        const message: TicketMessage = {
          isInternal: false,
          authorName: 'Agent',
          attachments: [],
          ...input,
          id: id('tmsg'),
          createdAt: now(),
        }
        set((s) => ({ ticketMessages: [...s.ticketMessages, message] }))
        return message
      },
      closeTicket: (ticketId) =>
        get().updateTicket(ticketId, { status: 'CLOSED', closedAt: now() }),

      addNote: (input) => {
        const note: Note = {
          isPinned: false,
          createdById: 'user-1',
          ...input,
          id: id('note'),
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ notes: [note, ...s.notes] }))
        return note
      },
      markNotificationsRead: (userId) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.userId === userId ? { ...n, isRead: true, readAt: now() } : n,
          ),
        })),
      markNotificationRead: (notifId) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === notifId ? { ...n, isRead: true, readAt: now() } : n,
          ),
        })),
      resetDemoData: () => set(seed()),
    }),
    {
      name: 'novacrm-data',
      version: 1,
    },
  ),
)
