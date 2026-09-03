const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

export type ApiError = { code: string; message: string; details?: unknown }

export class ApiClientError extends Error {
  code: string
  details?: unknown
  status: number
  constructor(status: number, error: ApiError) {
    super(error.message)
    this.status = status
    this.code = error.code
    this.details = error.details
  }
}

type TokenBundle = {
  accessToken: string
  refreshToken?: string
  kind: 'platform' | 'tenant'
}

const TOKEN_KEY = 'novacrm-auth'

export function getAuth(): TokenBundle | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as TokenBundle) : null
  } catch {
    return null
  }
}

export function setAuth(bundle: TokenBundle | null) {
  if (!bundle) localStorage.removeItem(TOKEN_KEY)
  else localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle))
}

export function isTenantSession() {
  return getAuth()?.kind === 'tenant'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number) {
  return status === 503 || status === 502 || status === 504 || status === 429
}

/** Retry transient DB pool / network failures so lists don't flash empty. */
async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 4): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options)
      if (isRetryableStatus(res.status) && attempt < maxAttempts - 1) {
        await sleep(350 * (attempt + 1))
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts - 1) {
        await sleep(350 * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed after retries')
}

async function refreshAccessToken(): Promise<string | null> {
  const auth = getAuth()
  if (!auth?.refreshToken) return null
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  })
  if (!res.ok) {
    setAuth(null)
    return null
  }
  const json = (await res.json()) as {
    success: boolean
    data: { accessToken: string; refreshToken?: string }
  }
  setAuth({
    ...auth,
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken ?? auth.refreshToken,
  })
  return json.data.accessToken
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  if (!options.skipAuth) {
    const auth = getAuth()
    if (auth?.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  }

  let res = await fetchWithRetry(`${API_BASE}${path}`, { ...options, headers })

  if (res.status === 401 && !options.skipAuth) {
    const next = await refreshAccessToken()
    if (next) {
      headers.set('Authorization', `Bearer ${next}`)
      res = await fetchWithRetry(`${API_BASE}${path}`, { ...options, headers })
    } else {
      setAuth(null)
      try {
        localStorage.removeItem('novacrm-auth-user')
      } catch {
        /* ignore */
      }
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login')
      }
    }
  }

  const json = (await res.json().catch(() => null)) as
    | { success: true; data: T; meta?: unknown; message?: string }
    | { success: false; message?: string; error?: ApiError; details?: unknown }
    | null

  if (!res.ok || !json || json.success === false) {
    const message =
      (json && 'error' in json && json.error?.message) ||
      (json && 'message' in json && json.message) ||
      `Request failed (${res.status})`
    const code = (json && 'error' in json && json.error?.code) || 'REQUEST_FAILED'
    if (isRetryableStatus(res.status)) {
      throw new ApiClientError(res.status, {
        code,
        message:
          res.status === 503
            ? 'Database is busy — wait a moment and try again.'
            : message,
        details: json && 'details' in json ? json.details : undefined,
      })
    }
    throw new ApiClientError(res.status, {
      code,
      message,
      details: json && 'details' in json ? json.details : undefined,
    })
  }

  return json.data
}

function qs(params?: Record<string, string | number | undefined | null>) {
  if (!params) return ''
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export type Page<T> = { items: T[]; meta?: { total: number; page: number; limit: number } }

export const api = {
  platformLogin: (email: string, password: string) =>
    apiFetch<{
      accessToken: string
      refreshToken: string
      user: { id: string; name: string; email: string; role: string; kind: string }
    }>('/auth/platform/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    }),
  tenantLogin: (payload: {
    email: string
    password: string
    tenantSlug?: string
    tenantCode?: string
  }) =>
    apiFetch<{
      accessToken: string
      refreshToken: string
      user: { id: string; name: string; email: string; role: string; tenantId: string; tenantSlug?: string; kind: string }
    }>('/auth/login', { method: 'POST', body: JSON.stringify(payload), skipAuth: true }),
  me: () => apiFetch<Record<string, unknown>>('/auth/me'),
  updateProfile: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    apiFetch<{ ok: boolean }>('/auth/me/password', { method: 'POST', body: JSON.stringify(body) }),
  meWithRetry: async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await apiFetch<Record<string, unknown>>('/auth/me')
      } catch (err) {
        const retryable =
          err instanceof ApiClientError && (isRetryableStatus(err.status) || err.status === 0)
        if (retryable && attempt < 2) {
          await sleep(600 * (attempt + 1))
          continue
        }
        throw err
      }
    }
    throw new Error('Session check failed')
  },
  logout: (refreshToken?: string) =>
    apiFetch<null>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      skipAuth: !refreshToken,
    }),

  analytics: (range?: string) =>
    apiFetch<{
      range: string
      salesTargets?: { revenueTarget: number; targetPeriod: string; currency: string }
      kpis: Record<string, number>
      leadsByStatus: Array<{ name: string; value: number }>
      leadsBySource: Array<{ name: string; leads: number }>
      ticketsByStatus: Array<{ name: string; value: number }>
      ticketsByPriority: Array<{ name: string; value: number }>
      ticketsByCategory: Array<{ name: string; value: number }>
      ticketsByAssignee: Array<{
        id: string
        name: string
        total: number
        open: number
        resolved: number
        breached: number
      }>
      ticketMonthly: Array<{ month: string; created: number; resolved: number; breached: number }>
      funnel: Array<{
        stage: string
        code: string
        count: number
        value: number
        conversion: number
        width: string
        color?: string | null
        isWon?: boolean
        isLost?: boolean
      }>
      team: Array<{
        id: string
        name: string
        deals: number
        wonDeals: number
        revenue: number
        win: number
        openValue: number
      }>
      byCity: Array<{ city: string; accounts: number; leads: number; revenue: number }>
      byIndustry: Array<{ name: string; value: number }>
      monthlyRevenue: Array<{ month: string; current: number; last: number }>
      activityMonthly?: Array<{ month: string; completed: number; pending: number; total: number }>
      activityByType: Array<{ name: string; value: number }>
      recentActivities: Array<Record<string, unknown>>
      recentLeads: Array<Record<string, unknown>>
      users: Array<{ id: string; name: string }>
    }>(`/analytics/summary${qs({ range })}`),

  platformStats: () => apiFetch<Record<string, unknown>>('/platform/dashboard/stats'),
  listTenants: () => apiFetch<unknown[]>('/platform/tenants'),
  createTenant: (body: Record<string, unknown>) =>
    apiFetch<unknown>('/platform/tenants', { method: 'POST', body: JSON.stringify(body) }),
  updateTenant: (id: string, body: Record<string, unknown>) =>
    apiFetch<unknown>(`/platform/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suspendTenant: (id: string) =>
    apiFetch<unknown>(`/platform/tenants/${id}/suspend`, { method: 'POST', body: '{}' }),
  listCategories: () => apiFetch<unknown[]>('/platform/business-categories'),
  listPlatformTips: () => apiFetch<unknown[]>('/platform/tips'),

  tips: (moduleKey: string) =>
    apiFetch<Array<{ title: string; body: string; tipType?: string; type?: string }>>(
      `/tips/${encodeURIComponent(moduleKey)}`,
    ),

  lookups: () =>
    apiFetch<{
      sources: Array<{ id: string; name: string; code: string; colorHex?: string | null }>
      stages: Array<{
        id: string
        name: string
        code: string
        probability: number
        colorHex?: string | null
        sortOrder?: number
      }>
      users: Array<{ id: string; name: string; email: string; avatarUrl?: string | null }>
      warehouses: Array<{ id: string; name: string; code: string; isDefault?: boolean }>
      categories: Array<{ id: string; name: string; code: string }>
      accounts: Array<{ id: string; name: string; phone?: string; email?: string }>
      contacts: Array<{ id: string; name: string; phone?: string; email?: string; accountId?: string }>
      products: Array<{
        id: string
        sku: string
        name: string
        salePrice: string | number
        purchasePrice: string | number
        unit: string
        taxPercent: string | number
        imageUrl?: string | null
        productType?: string | null
        attributes?: Record<string, unknown> | null
      }>
      vendors: Array<{ id: string; name: string }>
    }>('/meta/lookups'),

  // Leads
  leads: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/leads${qs(params)}`),
  getLead: (id: string) => apiFetch<Record<string, unknown>>(`/leads/${id}`),
  createLead: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/leads', { method: 'POST', body: JSON.stringify(body) }),
  updateLead: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLead: (id: string) => apiFetch<null>(`/leads/${id}`, { method: 'DELETE' }),
  convertLead: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  issueLeadDemo: (id: string, stockUnitId: string) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/issue-demo`, {
      method: 'POST',
      body: JSON.stringify({ stockUnitId }),
    }),
  returnLeadDemo: (id: string, notes?: string) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/return-demo`, {
      method: 'POST',
      body: JSON.stringify({ notes: notes || undefined }),
    }),

  // Contacts
  contacts: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/contacts${qs(params)}`),
  getContact: (id: string) => apiFetch<Record<string, unknown>>(`/contacts/${id}`),
  createContact: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/contacts', { method: 'POST', body: JSON.stringify(body) }),
  updateContact: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteContact: (id: string) => apiFetch<null>(`/contacts/${id}`, { method: 'DELETE' }),
  contactsLookup: (phone: string) =>
    apiFetch<unknown[]>(`/contacts/phone-lookup?phone=${encodeURIComponent(phone)}`),
  addContactNote: (id: string, content: string) =>
    apiFetch<Record<string, unknown>>(`/contacts/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  updateContactNote: (id: string, noteId: string, content: string) =>
    apiFetch<Record<string, unknown>>(`/contacts/${id}/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteContactNote: (id: string, noteId: string) =>
    apiFetch<null>(`/contacts/${id}/notes/${noteId}`, { method: 'DELETE' }),

  // Accounts
  accounts: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/accounts${qs(params)}`),
  getAccount: (id: string) => apiFetch<Record<string, unknown>>(`/accounts/${id}`),
  createAccount: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: string) => apiFetch<null>(`/accounts/${id}`, { method: 'DELETE' }),

  // Deals
  deals: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/deals${qs(params)}`),
  dealsPipeline: () =>
    apiFetch<
      Array<{
        id: string
        name: string
        code: string
        colorHex?: string
        probability: number
        sortOrder: number
        isWon?: boolean
        isLost?: boolean
      }>
    >('/deals/pipeline'),
  getDeal: (id: string) => apiFetch<Record<string, unknown>>(`/deals/${id}`),
  createDeal: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/deals', { method: 'POST', body: JSON.stringify(body) }),
  updateDeal: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/deals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteDeal: (id: string) => apiFetch<null>(`/deals/${id}`, { method: 'DELETE' }),
  moveDeal: (id: string, stageId: string, lostReason?: string) =>
    apiFetch<Record<string, unknown>>(`/deals/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ stageId, lostReason }),
    }),

  // Activities
  activities: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/activities${qs(params)}`),
  createActivity: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/activities', { method: 'POST', body: JSON.stringify(body) }),
  updateActivity: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  completeActivity: (id: string) =>
    apiFetch<Record<string, unknown>>(`/activities/${id}/complete`, {
      method: 'POST',
      body: '{}',
    }),
  deleteActivity: (id: string) => apiFetch<null>(`/activities/${id}`, { method: 'DELETE' }),

  // Tickets
  tickets: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/tickets${qs(params)}`),
  ticketsSummary: () =>
    apiFetch<{
      open: number
      activeQueue?: number
      overdue: number
      unassigned: number
      resolvedToday: number
      byStatus: Record<string, number>
      balanceOutstanding?: number
      machinesDueSoon?: number
    }>('/tickets/summary'),
  getTicket: (id: string) => apiFetch<Record<string, unknown>>(`/tickets/${id}`),
  createTicket: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/tickets', { method: 'POST', body: JSON.stringify(body) }),
  updateTicket: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown> & { whatsapp?: { notified: boolean; reason?: string; fallbackWaLink?: string | null } }>(
      `/tickets/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),
  markTicketPaid: (id: string) =>
    apiFetch<
      Record<string, unknown> & {
        whatsapp?: { notified: boolean; reason?: string; fallbackWaLink?: string | null }
        invoice?: Record<string, unknown> | null
        invoiceError?: string | null
      }
    >(`/tickets/${id}/mark-paid`, { method: 'POST' }),
  sendTicketPaymentDue: (id: string) =>
    apiFetch<Record<string, unknown> & { whatsapp?: { notified: boolean; reason?: string; fallbackWaLink?: string | null } }>(
      `/tickets/${id}/payment-due`,
      { method: 'POST' },
    ),
  createTicketInvoice: (id: string) =>
    apiFetch<
      Record<string, unknown> & {
        whatsapp?: { notified: boolean; reason?: string; fallbackWaLink?: string | null }
        invoice?: Record<string, unknown>
      }
    >(`/tickets/${id}/invoice`, { method: 'POST' }),
  addTicketMessage: (id: string, body: { content: string; isInternal?: boolean }) =>
    apiFetch<Record<string, unknown>>(`/tickets/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteTicket: (id: string) => apiFetch<null>(`/tickets/${id}`, { method: 'DELETE' }),

  // Customer machines (service assets)
  assets: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/assets${qs(params)}`),
  getAsset: (id: string) => apiFetch<Record<string, unknown>>(`/assets/${id}`),
  createAsset: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/assets', { method: 'POST', body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAsset: (id: string) => apiFetch<null>(`/assets/${id}`, { method: 'DELETE' }),

  spareParts: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/spare-parts${qs(params)}`),
  getSparePart: (id: string) => apiFetch<Record<string, unknown>>(`/spare-parts/${id}`),
  createSparePart: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/spare-parts', { method: 'POST', body: JSON.stringify(body) }),
  updateSparePart: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/spare-parts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSparePart: (id: string) => apiFetch<null>(`/spare-parts/${id}`, { method: 'DELETE' }),

  // Products / inventory / invoices / POs
  products: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/products${qs(params)}`),
  getProduct: (id: string) => apiFetch<Record<string, unknown>>(`/products/${id}`),
  createProduct: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProduct: (id: string) => apiFetch<null>(`/products/${id}`, { method: 'DELETE' }),
  inventory: () => apiFetch<Array<Record<string, unknown>>>('/inventory/levels'),
  adjustStock: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stockUnits: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/inventory/units${qs(params)}`),
  getStockUnit: (id: string) => apiFetch<Record<string, unknown>>(`/inventory/units/${id}`),
  addStockUnit: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/inventory/units', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateStockUnit: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  returnDemoUnit: (id: string, notes?: string) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}/return-demo`, {
      method: 'POST',
      body: JSON.stringify({ notes: notes || undefined }),
    }),
  stampStockUnit: (id: string, stampingDate: string, notes?: string) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}/stamp`, {
      method: 'POST',
      body: JSON.stringify({ stampingDate, notes: notes || undefined }),
    }),
  inventoryHistory: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/inventory/history${qs(params)}`),
  invoices: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/invoices${qs(params)}`),
  getInvoice: (id: string) => apiFetch<Record<string, unknown>>(`/invoices/${id}`),
  createInvoice: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/invoices', { method: 'POST', body: JSON.stringify(body) }),
  updateInvoiceStatus: (id: string, body: { status: string; amountPaid?: number }) =>
    apiFetch<Record<string, unknown>>(`/invoices/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  purchaseOrders: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/purchase-orders${qs(params)}`),
  createPurchaseOrder: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getPurchaseOrder: (id: string) => apiFetch<Record<string, unknown>>(`/purchase-orders/${id}`),
  receivePurchaseOrder: (id: string, lines: Array<{ lineId: string; quantity: number }>) =>
    apiFetch<Record<string, unknown>>(`/purchase-orders/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify({ lines }),
    }),
  createVendor: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/purchase-orders/vendors', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  vendors: () => apiFetch<Array<Record<string, unknown>>>('/purchase-orders/vendors'),

  listUsers: () =>
    apiFetch<{
      maxUsers: number
      used: number
      remaining: number
      items: Array<{
        id: string
        name: string
        email: string
        phone?: string | null
        avatarUrl?: string | null
        status: string
        lastLoginAt?: string | null
        role?: { id: string; code: string; name: string } | null
      }>
    }>('/users'),
  createUser: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteUser: (id: string) => apiFetch<null>(`/users/${id}`, { method: 'DELETE' }),

  uploadImage: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const auth = getAuth()
    const headers = new Headers()
    if (auth?.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
    const res = await fetch(`${API_BASE}/uploads/image`, { method: 'POST', headers, body: form })
    const json = (await res.json().catch(() => null)) as
      | { success: true; data: { url: string; filename: string } }
      | { success: false; message?: string }
      | null
    if (!res.ok || !json || json.success === false) {
      throw new ApiClientError(res.status, {
        code: 'UPLOAD_FAILED',
        message: (json && 'message' in json && json.message) || 'Upload failed',
      })
    }
    return json.data
  },
  uploadFile: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const auth = getAuth()
    const headers = new Headers()
    if (auth?.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
    const res = await fetch(`${API_BASE}/uploads/file`, { method: 'POST', headers, body: form })
    const json = (await res.json().catch(() => null)) as
      | {
          success: true
          data: { url: string; filename: string; originalName?: string; mimeType?: string; size?: number }
        }
      | { success: false; message?: string }
      | null
    if (!res.ok || !json || json.success === false) {
      throw new ApiClientError(res.status, {
        code: 'UPLOAD_FAILED',
        message: (json && 'message' in json && json.message) || 'Upload failed',
      })
    }
    return json.data
  },

  myTenant: () =>
    apiFetch<{
      id: string
      name: string
      slug: string
      email?: string | null
      phone?: string | null
      addressLine1?: string | null
      city?: string | null
      state?: string | null
      postalCode?: string | null
      country?: string | null
      gstin?: string | null
      currency?: string
      timezone?: string
      website?: string | null
      settings?: Record<string, unknown> | null
    }>('/tenants/me'),
  updateMyTenant: (body: Record<string, unknown>) =>
    apiFetch<{
      id: string
      name: string
      settings?: Record<string, unknown> | null
    }>('/tenants/me', { method: 'PATCH', body: JSON.stringify(body) }),

  createStage: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/meta/stages', { method: 'POST', body: JSON.stringify(body) }),
  updateStage: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/meta/stages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  createSource: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/meta/sources', { method: 'POST', body: JSON.stringify(body) }),
  updateSource: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/meta/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSource: (id: string) =>
    apiFetch<null>(`/meta/sources/${id}`, { method: 'DELETE' }),
}

export async function isApiOnline(): Promise<boolean> {
  try {
    const base = API_BASE.replace(/\/api$/, '')
    const res = await fetch(`${base}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

export function num(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}
