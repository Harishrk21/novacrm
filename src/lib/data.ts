import { useCrmStore } from '@/store/crmStore'
import { normalizePhone } from '@/lib/utils'

export function getUsers() {
  return useCrmStore.getState().users
}
export function getLeads() {
  return useCrmStore.getState().leads
}
export function getContacts() {
  return useCrmStore.getState().contacts
}
export function getAccounts() {
  return useCrmStore.getState().accounts
}
export function getDeals() {
  return useCrmStore.getState().deals
}
export function getActivities() {
  return useCrmStore.getState().activities
}
export function getTickets() {
  return useCrmStore.getState().tickets
}
export function getNotifications() {
  return useCrmStore.getState().notifications
}
export function getNotes() {
  return useCrmStore.getState().notes
}
export function getTicketMessages() {
  return useCrmStore.getState().ticketMessages
}

/** Live getters — prefer useCrmStore in React components */
export const users = new Proxy([] as ReturnType<typeof getUsers>, {
  get(_t, prop) {
    const list = getUsers()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const leads = new Proxy([] as ReturnType<typeof getLeads>, {
  get(_t, prop) {
    const list = getLeads()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const contacts = new Proxy([] as ReturnType<typeof getContacts>, {
  get(_t, prop) {
    const list = getContacts()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const accounts = new Proxy([] as ReturnType<typeof getAccounts>, {
  get(_t, prop) {
    const list = getAccounts()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const deals = new Proxy([] as ReturnType<typeof getDeals>, {
  get(_t, prop) {
    const list = getDeals()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const activities = new Proxy([] as ReturnType<typeof getActivities>, {
  get(_t, prop) {
    const list = getActivities()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const tickets = new Proxy([] as ReturnType<typeof getTickets>, {
  get(_t, prop) {
    const list = getTickets()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const notifications = new Proxy([] as ReturnType<typeof getNotifications>, {
  get(_t, prop) {
    const list = getNotifications()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const notes = new Proxy([] as ReturnType<typeof getNotes>, {
  get(_t, prop) {
    const list = getNotes()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export const ticketMessages = new Proxy([] as ReturnType<typeof getTicketMessages>, {
  get(_t, prop) {
    const list = getTicketMessages()
    const value = Reflect.get(list, prop)
    return typeof value === 'function' ? value.bind(list) : value
  },
})

export function getUser(id?: string | null) {
  if (!id) return undefined
  return useCrmStore.getState().users.find((u) => u.id === id)
}

export function getContact(id?: string | null) {
  if (!id) return undefined
  return useCrmStore.getState().contacts.find((c) => c.id === id)
}

export function getAccount(id?: string | null) {
  if (!id) return undefined
  return useCrmStore.getState().accounts.find((a) => a.id === id)
}

export function getDeal(id?: string | null) {
  if (!id) return undefined
  return useCrmStore.getState().deals.find((d) => d.id === id)
}

export function getLead(id?: string | null) {
  if (!id) return undefined
  return useCrmStore.getState().leads.find((l) => l.id === id)
}

export function lookupContactByPhone(phone: string) {
  const n = normalizePhone(phone)
  const { contacts: cts, leads: lds } = useCrmStore.getState()
  const contact = cts.find(
    (c) =>
      (c.phone && normalizePhone(c.phone).includes(n)) ||
      (c.mobile && normalizePhone(c.mobile).includes(n)),
  )
  if (contact) return { found: true as const, contact }
  const lead = lds.find((l) => l.phone && normalizePhone(l.phone).includes(n))
  return { found: false as const, lead: lead ?? null }
}

export function globalSearch(q: string) {
  const query = q.trim().toLowerCase()
  const state = useCrmStore.getState()
  if (!query) {
    return { contacts: [], leads: [], deals: [], accounts: [], tickets: [] }
  }
  return {
    contacts: state.contacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email?.toLowerCase().includes(query) ||
          c.phone?.includes(query) ||
          c.mobile?.includes(query),
      )
      .slice(0, 5),
    leads: state.leads
      .filter(
        (l) =>
          l.name.toLowerCase().includes(query) ||
          l.email?.toLowerCase().includes(query) ||
          l.phone?.includes(query) ||
          l.company?.toLowerCase().includes(query),
      )
      .slice(0, 5),
    deals: state.deals.filter((d) => d.name.toLowerCase().includes(query)).slice(0, 5),
    accounts: state.accounts
      .filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          a.industry?.toLowerCase().includes(query),
      )
      .slice(0, 5),
    tickets: state.tickets
      .filter(
        (t) =>
          t.subject.toLowerCase().includes(query) ||
          String(t.ticketNo).includes(query),
      )
      .slice(0, 5),
  }
}
