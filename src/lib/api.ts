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
  options: RequestInit & { skipAuth?: boolean; noRetry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  if (!options.skipAuth) {
    const auth = getAuth()
    if (auth?.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`)
  }

  // AI endpoints: no multi-retry — Gemini/DB waits already feel long
  const attempts = options.noRetry || path.startsWith('/ai/') ? 1 : 4
  let res = await fetchWithRetry(`${API_BASE}${path}`, { ...options, headers }, attempts)

  if (res.status === 401 && !options.skipAuth) {
    const next = await refreshAccessToken()
    if (next) {
      headers.set('Authorization', `Bearer ${next}`)
      res = await fetchWithRetry(`${API_BASE}${path}`, { ...options, headers }, attempts)
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
          (json && 'message' in json && typeof json.message === 'string' && json.message) ||
          (res.status === 503
            ? 'Database is busy — wait a moment and try again.'
            : message),
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
      user: {
        id: string
        name: string
        email: string
        phone?: string | null
        avatarUrl?: string | null
        role: string
        tenantId: string
        tenantSlug?: string
        tenantName?: string
        branding?: {
          palette?: string
          locked?: boolean
          accent?: string
          accentHover?: string
          sidebarBg?: string
        } | null
        kind: string
      }
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

  analytics: (params?: {
    range?: string
    from?: string
    to?: string
    assigneeId?: string
    sourceId?: string
    ticketStatus?: string
    leadStatus?: string
    city?: string
  }) =>
    apiFetch<{
      range: string
      from?: string
      to?: string
      filters?: Record<string, string | null>
      generatedAt?: string
      salesTargets?: { revenueTarget: number; targetPeriod: string; currency: string }
      kpis: Record<string, number>
      leadsByStatus: Array<{ name: string; value: number }>
      leadsBySource: Array<{ name: string; leads: number }>
      leadsByOwner?: Array<{
        id: string
        name: string
        total: number
        pending: number
        demo: number
        converted: number
        conversionRate: number
      }>
      leadMonthly?: Array<{ month: string; created: number; converted: number }>
      performers?: Array<{
        id: string
        name: string
        ticketsOpen: number
        ticketsResolved: number
        leadsConverted: number
        leadsTotal: number
        serviceCollected: number
        score: number
      }>
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
      enquiryByStatus?: Array<{ name: string; value: number; code?: string }>
      stockByStatus?: Array<{ name: string; value: number }>
      attentionTickets?: Array<{
        id: string
        ticketNo: number
        subject: string
        status: string
        priority: string
        slaDueAt?: string | null
        slaBreached?: boolean
        balanceDue?: number
      }>
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
      byCity: Array<{ city: string; accounts: number; leads: number; tickets?: number; revenue: number }>
      byIndustry: Array<{ name: string; value: number }>
      monthlyRevenue: Array<{ month: string; proforma?: number; servicePaid?: number; current?: number; last?: number }>
      activityMonthly?: Array<{ month: string; completed: number; pending: number; total: number }>
      activityByType: Array<{ name: string; value: number }>
      recentActivities: Array<Record<string, unknown>>
      recentLeads: Array<Record<string, unknown>>
      users: Array<{ id: string; name: string }>
      sources?: Array<{ id: string; name: string }>
      cities?: string[]
    }>(`/analytics/summary${qs(params ?? {})}`),

  aiDashboardAsk: (body: { question: string; range?: string; mode?: 'ask' | 'overview' | 'spikes' }) =>
    apiFetch<{
      answer: string
      bullets: string[]
      links: Array<{ label: string; to: string }>
      caution?: string
      model?: string
      range?: string
      mode?: string
      generatedAt?: string
      cached?: boolean
    }>('/ai/dashboard-ask', { method: 'POST', body: JSON.stringify(body) }),

  aiTicketAssist: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/ai/ticket-assist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aiSalesAssist: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/ai/sales-assist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aiWarehouseAssist: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/ai/warehouse-assist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aiCustomerAssist: (body: { contactId: string; action?: string }) =>
    apiFetch<Record<string, unknown>>('/ai/customer-assist', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  aiPolish: (body: { text: string; action?: string; target?: string }) =>
    apiFetch<{ result: string; caution?: string; bullets?: string[]; model?: string; cached?: boolean }>(
      '/ai/polish',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  aiMapCustomerImport: (body: {
    headers: string[]
    sampleRows?: Array<Record<string, unknown>>
    kind?: 'sales' | 'service'
  }) =>
    apiFetch<{
      mapping: Record<string, string | null>
      usedAi?: boolean
      model?: string | null
      notes?: string
      fields?: string[]
    }>('/ai/map-customer-import', { method: 'POST', body: JSON.stringify(body) }),

  aiMapStockImport: (body: {
    kind: 'machines' | 'sparesBilling' | 'sparesWeighing'
    headers: string[]
    sampleRows?: Array<Record<string, unknown>>
  }) =>
    apiFetch<{
      mapping: Record<string, string | null>
      usedAi?: boolean
      model?: string | null
      notes?: string
      fields?: string[]
      kind?: string
    }>('/ai/map-stock-import', { method: 'POST', body: JSON.stringify(body) }),

  importStock: (body: {
    kind: 'machines' | 'sparesBilling' | 'sparesWeighing'
    rows: Array<Record<string, unknown>>
  }) =>
    apiFetch<{
      created: number
      skipped: number
      errors: Array<{ row: number; message: string }>
    }>('/inventory/import', { method: 'POST', body: JSON.stringify(body) }),

  platformStats: () => apiFetch<Record<string, unknown>>('/platform/dashboard/stats'),
  listTenants: () => apiFetch<unknown[]>('/platform/tenants'),
  createTenant: (body: Record<string, unknown>) =>
    apiFetch<unknown>('/platform/tenants', { method: 'POST', body: JSON.stringify(body) }),
  updateTenant: (id: string, body: Record<string, unknown>) =>
    apiFetch<unknown>(`/platform/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suspendTenant: (id: string) =>
    apiFetch<unknown>(`/platform/tenants/${id}/suspend`, { method: 'POST', body: '{}' }),
  reactivateTenant: (id: string) =>
    apiFetch<unknown>(`/platform/tenants/${id}/reactivate`, { method: 'POST', body: '{}' }),
  resetTenantAdminPassword: (id: string, password: string) =>
    apiFetch<{ adminEmail: string; temporaryPassword: string }>(
      `/platform/tenants/${id}/reset-admin-password`,
      { method: 'POST', body: JSON.stringify({ password }) },
    ),
  listTenantUsers: (id: string) =>
    apiFetch<{
      tenant: { id: string; name: string; slug: string }
      loginPath: string
      users: Array<{
        id: string
        name: string
        email: string
        phone?: string | null
        status: string
        roleCode: string
        roleName: string
        temporaryPassword?: string | null
        lastLoginAt?: string | null
        createdAt: string
        inventoryAreas?: {
          machines: boolean
          sparesBilling: boolean
          sparesWeighing: boolean
        }
      }>
    }>(`/platform/tenants/${id}/users`),
  setTenantUserPassword: (tenantId: string, userId: string, password: string) =>
    apiFetch<{ id: string; email: string; temporaryPassword: string; roleCode: string }>(
      `/platform/tenants/${tenantId}/users/${userId}/password`,
      { method: 'POST', body: JSON.stringify({ password }) },
    ),
  setTenantUserInventoryAreas: (
    tenantId: string,
    userId: string,
    inventoryAreas: {
      machines: boolean
      sparesBilling: boolean
      sparesWeighing: boolean
    },
  ) =>
    apiFetch<{
      id: string
      email: string
      inventoryAreas: {
        machines: boolean
        sparesBilling: boolean
        sparesWeighing: boolean
      }
    }>(`/platform/tenants/${tenantId}/users/${userId}/inventory-areas`, {
      method: 'PATCH',
      body: JSON.stringify({ inventoryAreas }),
    }),
  setTenantModules: (id: string, modulesEnabled: Record<string, boolean>) =>
    apiFetch<unknown[]>(`/platform/tenants/${id}/modules`, {
      method: 'POST',
      body: JSON.stringify({ modulesEnabled }),
    }),
  listPlans: () =>
    apiFetch<{
      plans: Array<{
        code: string
        label: string
        maxUsers: number
        modules: Record<string, boolean>
        features: Record<string, boolean>
      }>
      subscriptionPacks: Array<{
        code: string
        label: string
        description: string
        defaultMaxUsers: number
        modules: Record<string, boolean>
      }>
    }>('/platform/plans'),
  applyTenantPack: (id: string, subscriptionPack: 'SALES' | 'SALES_INVENTORY' | 'HMS_FULL') =>
    apiFetch<unknown>(`/platform/tenants/${id}/apply-pack`, {
      method: 'POST',
      body: JSON.stringify({ subscriptionPack }),
    }),
  listCategories: () => apiFetch<unknown[]>('/platform/business-categories'),
  createCategory: (body: Record<string, unknown>) =>
    apiFetch<unknown>('/platform/business-categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    apiFetch<unknown>(`/platform/business-categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteCategory: (id: string) =>
    apiFetch<unknown>(`/platform/business-categories/${id}`, { method: 'DELETE' }),
  listPlatformTips: (all = false) =>
    apiFetch<
      Array<{
        id: string
        moduleKey: string
        sectionKey: string
        title: string
        body: string
        tipType: string
        sortOrder: number
        isActive: boolean
      }>
    >(`/platform/tips${all ? '?all=1' : ''}`),
  createPlatformTip: (body: Record<string, unknown>) =>
    apiFetch<unknown>('/platform/tips', { method: 'POST', body: JSON.stringify(body) }),
  updatePlatformTip: (id: string, body: Record<string, unknown>) =>
    apiFetch<unknown>(`/platform/tips/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePlatformTip: (id: string) =>
    apiFetch<unknown>(`/platform/tips/${id}`, { method: 'DELETE' }),

  /** Public workspace branding for /login/:slug (no auth). */
  publicWorkspace: (slug: string) =>
    apiFetch<{
      name: string
      slug: string
      code: string
      status: string
      logoUrl?: string | null
      city?: string | null
      branding: {
        palette: string
        locked: boolean
        accent?: string
        accentHover?: string
        sidebarBg?: string
        loginTagline?: string
      }
    }>(`/public/workspace/${encodeURIComponent(slug)}`, { skipAuth: true }),

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
      users: Array<{
        id: string
        name: string
        email: string
        phone?: string | null
        roleCode?: string | null
        roleName?: string | null
        avatarUrl?: string | null
      }>
      warehouses: Array<{ id: string; name: string; code: string; isDefault?: boolean }>
      categories: Array<{ id: string; name: string; code: string; parentId?: string | null }>
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
  verifyLead: (
    id: string,
    body?: {
      verified?: boolean
      serviceType?: 'SALES' | 'SERVICE' | 'STAMPING' | 'RENTAL'
      area?: string | null
      enquiryValue?: number | string | null
      requirement?: string | null
      name?: string
      phone?: string | null
    },
  ) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify(body ?? { verified: true }),
    }),
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
  returnLeadDemo: (
    id: string,
    body?: { notes?: string; outcome?: 'NOT_INTERESTED' | 'READY_TO_BUY'; stageId?: string },
  ) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/return-demo`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  addLeadDemoUpdate: (id: string, body: { note: string; updateDate?: string }) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/demo-update`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  statusLead: (id: string, status: string) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  // Sales requisitions (admin sign-off before stock release)
  requisitions: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Page<Record<string, unknown>>>(`/requisitions${qs(params)}`),
  getRequisition: (id: string) => apiFetch<Record<string, unknown>>(`/requisitions/${id}`),
  getRequisitionByLead: (leadId: string) =>
    apiFetch<Record<string, unknown> | null>(`/requisitions/by-lead/${leadId}`),
  submitRequisition: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/requisitions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveRequisition: (id: string) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/approve`, {
      method: 'POST',
      body: '{}',
    }),
  rejectRequisition: (id: string, reason: string) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  fulfillRequisition: (
    id: string,
    body?: {
      unitPrice?: number
      taxPercent?: number
      notes?: string
      markShipped?: boolean
      stockUnitId?: string
    },
  ) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  shipRequisition: (id: string) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/ship`, {
      method: 'POST',
      body: '{}',
    }),
  createRequisitionDeliveryChallan: (id: string, body?: { notes?: string | null }) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/delivery-challan`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  notifyRequisitionInventory: (id: string) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/notify-inventory`, {
      method: 'POST',
      body: '{}',
    }),
  recordRequisitionStamping: (
    id: string,
    body: {
      stockUnitId?: string | null
      stampingRequired?: boolean
      stampingDate?: string | null
      nextDueDate?: string | null
      vcNumber?: string | null
      plateNo?: string | null
      lines?: Array<{
        label: string
        stampingRequired: boolean
        stampingDate?: string | null
        nextDueDate?: string | null
      }>
    },
  ) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/stamping`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  requisitionPaymentNote: (id: string, body: { note: string; amount?: number }) =>
    apiFetch<Record<string, unknown>>(`/requisitions/${id}/payment-note`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createLeadTicket: (
    id: string,
    body?: {
      category?: string
      subject?: string
      description?: string
      priority?: string
      area?: string | null
      assetId?: string | null
    },
  ) =>
    apiFetch<{ ticket: Record<string, unknown>; lead: Record<string, unknown>; enquiryId?: string }>(
      `/leads/${id}/create-ticket`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),
  prepareLeadHandoff: (id: string, body?: { area?: string | null }) =>
    apiFetch<{
      serviceType: string
      contactId: string | null
      leadId: string
      enquiryId?: string
      alreadyLinked?: boolean
      href: string
      serviceTicketId?: string
      rentalAgreementId?: string
      lead?: Record<string, unknown>
    }>(`/leads/${id}/prepare-handoff`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  linkLeadTicket: (id: string, ticketId: string) =>
    apiFetch<Record<string, unknown>>(`/leads/${id}/link-ticket`, {
      method: 'POST',
      body: JSON.stringify({ ticketId }),
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
  importContacts: (body: {
    rows: Array<Record<string, unknown>>
    source?: 'SALES' | 'SERVICE'
  }) =>
    apiFetch<{
      created: number
      merged: number
      machinesAdded: number
      machinesSkippedDuplicate?: number
      skipped: number
      errors: Array<{ row: number; message: string }>
    }>('/contacts/import', { method: 'POST', body: JSON.stringify(body) }),

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
  claimTicket: (id: string) =>
    apiFetch<Record<string, unknown>>(`/tickets/${id}/claim`, { method: 'POST', body: '{}' }),
  updateTicket: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown> & { whatsapp?: { notified: boolean; reason?: string; fallbackWaLink?: string | null } }>(
      `/tickets/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    ),
  markTicketPaid: (
    id: string,
    body: {
      paymentMethod: 'CASH' | 'UPI' | 'NEFT' | 'RTGS' | 'CHEQUE' | 'CARD' | 'OTHER'
      paymentReference?: string | null
      paymentProofUrl?: string | null
      sendWhatsApp?: boolean
      paymentTotal?: number
      advanceAmount?: number
    },
  ) =>
    apiFetch<
      Record<string, unknown> & {
        whatsapp?: { notified: boolean; reason?: string; fallbackWaLink?: string | null }
        invoice?: Record<string, unknown> | null
        invoiceError?: string | null
      }
    >(`/tickets/${id}/mark-paid`, { method: 'POST', body: JSON.stringify(body) }),
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

  /** Quantity stock for weighing/billing spare parts (separate from machine serial stock). */
  spareStockItems: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/spare-stock/items${qs(params)}`),
  createSpareStockItem: (body: {
    machineFamily: 'WEIGHING' | 'BILLING'
    name: string
    partCode?: string | null
    unit?: string
  }) =>
    apiFetch<Record<string, unknown>>('/spare-stock/items', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSpareStockItem: (
    id: string,
    body: {
      machineFamily?: 'WEIGHING' | 'BILLING'
      name?: string
      partCode?: string | null
      unit?: string
      isActive?: boolean
    },
  ) =>
    apiFetch<Record<string, unknown>>(`/spare-stock/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  receiveSpareStock: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/spare-stock/receive', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  issueSpareStock: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/spare-stock/issue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  spareStockHistory: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/spare-stock/history${qs(params)}`),
  spareStockMonthly: (params: {
    year?: number
    month?: number
    machineFamily?: 'WEIGHING' | 'BILLING'
    sparePartId?: string
  }) =>
    apiFetch<{
      year: number
      month: number
      machineFamily: string | null
      items: Array<Record<string, unknown>>
      totals: { opening: number; received: number; issued: number; closing: number }
    }>(`/spare-stock/monthly${qs(params)}`),

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
  /** Fast stock page bootstrap — one request instead of products+units+vendors+brands+lookups+users */
  inventoryWorkspace: () =>
    apiFetch<{
      products: Array<Record<string, unknown>>
      units: Array<Record<string, unknown>>
      vendors: Array<Record<string, unknown>>
      brands: Array<Record<string, unknown>>
      warehouses: Array<{ id: string; name: string; code?: string }>
      spares: Array<Record<string, unknown>>
      users: Array<Record<string, unknown>>
    }>('/inventory/workspace'),
  adjustStock: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stockUnits: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/inventory/units${qs(params)}`),
  /** Sale + demo delivery challans archive */
  deliveryChallans: () =>
    apiFetch<
      Array<{
        purpose: 'SALE' | 'DEMO'
        number: string
        date: string
        customerName: string
        company?: string | null
        phone?: string | null
        productName?: string | null
        reqNumber?: string | null
        leadId?: string | null
        requisitionId?: string | null
        stockUnitId?: string | null
        challan: Record<string, unknown>
      }>
    >('/inventory/delivery-challans'),
  /** Units added + receipt headers for a date range (Excel / PDF) */
  inventoryExport: (params: {
    from: string
    to: string
    warehouseId?: string
    productId?: string
  }) =>
    apiFetch<{
      from: string
      to: string
      generatedAt: string
      truncated: boolean
      summary: {
        unitsAdded: number
        unitsInExport: number
        receipts: number
        totalValue: number
      }
      units: Array<Record<string, unknown>>
      receipts: Array<Record<string, unknown>>
    }>(`/inventory/export${qs(params)}`),
  getStockUnit: (id: string) => apiFetch<Record<string, unknown>>(`/inventory/units/${id}`),
  addStockUnit: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/inventory/units', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  receiveStockBatch: (body: Record<string, unknown>) =>
    apiFetch<{ receiptId: string; quantity: number; units: Array<Record<string, unknown>> }>(
      '/inventory/receipts',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  previewHmsUniqIds: (body: { productId: string; quantity: number }) =>
    apiFetch<string[]>('/inventory/uniq-ids/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  inventoryBrands: (params?: { all?: boolean }) =>
    apiFetch<Array<Record<string, unknown>>>(
      `/inventory/brands${params?.all ? '?all=1' : ''}`,
    ),
  createInventoryBrand: (body: { name: string; code?: string | null }) =>
    apiFetch<Record<string, unknown>>('/inventory/brands', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateInventoryBrand: (
    id: string,
    body: { name?: string; code?: string | null; isActive?: boolean },
  ) =>
    apiFetch<Record<string, unknown>>(`/inventory/brands/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteInventoryBrand: (id: string) =>
    apiFetch<null>(`/inventory/brands/${id}`, { method: 'DELETE' }),
  updateStockUnit: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  reduceStockUnit: (
    id: string,
    notesOrBody?:
      | string
      | null
      | {
          notes?: string | null
          reason?: string | null
          purpose?: 'SALE' | 'DEMO' | null
          issuedToUserId?: string | null
          contactId?: string | null
        },
  ) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}/reduce`, {
      method: 'POST',
      body: JSON.stringify(
        typeof notesOrBody === 'object' && notesOrBody !== null
          ? notesOrBody
          : { notes: notesOrBody ?? null },
      ),
    }),
  returnDemoUnit: (
    id: string,
    body?: {
      notes?: string
      outcome?: 'NOT_INTERESTED' | 'READY_TO_BUY'
      stageId?: string
      sendWhatsApp?: boolean
    },
  ) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}/return-demo`, {
      method: 'POST',
      body: JSON.stringify(
        typeof body === 'string' || body === undefined
          ? { notes: typeof body === 'string' ? body : undefined }
          : body ?? {},
      ),
    }),
  stampStockUnit: (id: string, stampingDate: string, notes?: string) =>
    apiFetch<Record<string, unknown>>(`/inventory/units/${id}/stamp`, {
      method: 'POST',
      body: JSON.stringify({ stampingDate, notes: notes || undefined }),
    }),
  inventoryHistory: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/inventory/history${qs(params)}`),

  rentals: (params?: Record<string, string | number | undefined>) =>
    apiFetch<Array<Record<string, unknown>>>(`/rentals${qs(params)}`),
  rentalSummary: () =>
    apiFetch<{ active: number; overdue: number; returnedThisMonth: number }>('/rentals/summary'),
  issueRental: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/rentals', { method: 'POST', body: JSON.stringify(body) }),
  returnRental: (id: string, notes?: string) =>
    apiFetch<Record<string, unknown>>(`/rentals/${id}/return`, {
      method: 'POST',
      body: JSON.stringify({ notes: notes ?? null }),
    }),

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
  updateVendor: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/purchase-orders/vendors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteVendor: (id: string) =>
    apiFetch<null>(`/purchase-orders/vendors/${id}`, { method: 'DELETE' }),
  vendors: () => apiFetch<Array<Record<string, unknown>>>('/purchase-orders/vendors'),

  listUsers: () =>
    apiFetch<{
      maxUsers: number | null
      used: number
      remaining: number | null
      unlimited?: boolean
      items: Array<{
        id: string
        name: string
        email: string
        phone?: string | null
        avatarUrl?: string | null
        status: string
        lastLoginAt?: string | null
        createdAt?: string
        role?: { id: string; code: string; name: string } | null
        employee?: {
          id: string
          employeeCode: string
          department?: string | null
          designation?: string | null
          joinDate?: string | null
          salary?: number | null
          notes?: string | null
          status?: string
        } | null
      }>
    }>('/users'),
  getUser: (id: string) => apiFetch<Record<string, unknown>>(`/users/${id}`),
  createUser: (body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteUser: (id: string) => apiFetch<null>(`/users/${id}`, { method: 'DELETE' }),

  notifications: (params?: { limit?: number; unreadOnly?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.unreadOnly) q.set('unreadOnly', 'true')
    const qs = q.toString()
    return apiFetch<{
      unreadCount: number
      items: Array<{
        id: string
        title: string
        message: string
        type: string
        entityType?: string | null
        entityId?: string | null
        isRead: boolean
        readAt?: string | null
        createdAt: string
        href?: string
      }>
    }>(`/notifications${qs ? `?${qs}` : ''}`)
  },
  markNotificationRead: (id: string) =>
    apiFetch<{ id: string; isRead: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () =>
    apiFetch<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) =>
    apiFetch<{ id: string; deleted: boolean }>(`/notifications/${id}`, { method: 'DELETE' }),
  clearAllNotifications: () =>
    apiFetch<{ deleted: number }>('/notifications/clear-all', { method: 'POST' }),

  teamChatChannels: () =>
    apiFetch<{
      items: Array<{
        id: string
        type: 'CHANNEL' | 'DM'
        name: string
        slug: string
        description?: string | null
        isDefault?: boolean
        pinnedAt?: string | null
        unread: number
        lastMessageAt?: string | null
        lastMessage?: { id: string; body: string; senderId: string; createdAt: string } | null
        peer?: { id: string; name: string; avatarUrl?: string | null; status?: string } | null
      }>
      unreadTotal: number
    }>('/team-chat/channels'),
  teamChatCreateChannel: (body: { name: string; description?: string }) =>
    apiFetch<Record<string, unknown>>('/team-chat/channels', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  teamChatOpenDm: (userId: string) =>
    apiFetch<{
      id: string
      type: string
      name: string
      slug: string
      peer?: { id: string; name: string; avatarUrl?: string | null }
    }>('/team-chat/dms', { method: 'POST', body: JSON.stringify({ userId }) }),
  teamChatMessages: (
    channelId: string,
    params?: { limit?: number; before?: string; parentId?: string },
  ) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.before) q.set('before', params.before)
    if (params?.parentId) q.set('parentId', params.parentId)
    const qs = q.toString()
    return apiFetch<{
      items: Array<{
        id: string
        body: string
        parentId?: string | null
        createdAt: string
        sender: { id: string; name: string; avatarUrl?: string | null }
        replyCount: number
      }>
    }>(`/team-chat/channels/${channelId}/messages${qs ? `?${qs}` : ''}`)
  },
  teamChatSend: (channelId: string, body: string, parentId?: string | null) =>
    apiFetch<{
      id: string
      body: string
      parentId?: string | null
      createdAt: string
      sender: { id: string; name: string; avatarUrl?: string | null }
      replyCount: number
    }>(`/team-chat/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, parentId: parentId ?? null }),
    }),
  teamChatPin: (channelId: string) =>
    apiFetch<{ id: string; pinned: boolean }>(`/team-chat/channels/${channelId}/pin`, {
      method: 'POST',
      body: '{}',
    }),
  teamChatThreads: () =>
    apiFetch<{
      items: Array<{
        id: string
        channelId: string
        channelName: string
        body: string
        createdAt: string
        lastReplyAt: string
        sender: { id: string; name: string; avatarUrl?: string | null }
        lastReply: {
          body: string
          sender: { id: string; name: string; avatarUrl?: string | null }
          createdAt: string
        }
      }>
    }>('/team-chat/threads'),
  teamChatTeammates: () =>
    apiFetch<{
      items: Array<{
        id: string
        name: string
        email: string
        avatarUrl?: string | null
        status: string
      }>
    }>('/team-chat/teammates'),

  whatsappCloudStatus: () =>
    apiFetch<{
      configured: boolean
      phoneNumberId: string | null
      businessAccountId: string | null
      appId: string | null
      apiVersion: string
      verifyTokenSet: boolean
      verifyToken?: string | null
      hasAppSecret: boolean
      webhookPath: string
      webhookUrlHint?: string
      note?: string
      source?: 'tenant' | 'env'
      environment?: string
      publicApiUrl?: string | null
    }>('/integrations/whatsapp/cloud/status'),
  saveWhatsAppCloudConfig: (body: {
    token: string
    phoneNumberId: string
    verifyToken?: string
    businessAccountId?: string
    appId?: string
    appSecret?: string
    apiVersion?: string
  }) =>
    apiFetch<Record<string, unknown>>('/integrations/whatsapp/cloud/config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  testWhatsAppCloud: (to: string) =>
    apiFetch<{ ok: boolean; messageId?: string; provider: string }>(
      '/integrations/whatsapp/cloud/test',
      { method: 'POST', body: JSON.stringify({ to }) },
    ),

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
  tenantModules: () =>
    apiFetch<
      Array<{
        id: string
        moduleKey: string
        moduleGroup: string
        label: string
        isEnabled: boolean
        sortOrder: number
      }>
    >('/tenants/modules'),
  updateMyTenant: (body: Record<string, unknown>) =>
    apiFetch<{
      id: string
      name: string
      settings?: Record<string, unknown> | null
    }>('/tenants/me', { method: 'PATCH', body: JSON.stringify(body) }),

  demoDataStatus: () =>
    apiFetch<{
      loaded: boolean
      pack: string
      counts: {
        accounts: number
        contacts: number
        customerAssets: number
        leads: number
        tickets: number
        activities: number
        vendors: number
        sparePartItems: number
        spareStockTxns: number
        stockUnits: number
        teamMessages: number
      }
    }>('/tenants/demo-data'),

  loadDemoData: () =>
    apiFetch<{
      loaded: boolean
      pack: string
      alreadyLoaded: boolean
      counts: {
        accounts: number
        contacts: number
        customerAssets: number
        leads: number
        tickets: number
        activities: number
        vendors: number
        sparePartItems: number
        spareStockTxns: number
        stockUnits: number
        teamMessages: number
      }
    }>('/tenants/demo-data/load', { method: 'POST', body: '{}' }),

  removeDemoData: () =>
    apiFetch<{
      loaded: boolean
      pack: string
      counts: {
        accounts: number
        contacts: number
        customerAssets: number
        leads: number
        tickets: number
        activities: number
        vendors: number
        sparePartItems: number
        spareStockTxns: number
        stockUnits: number
        teamMessages: number
      }
    }>('/tenants/demo-data/remove', { method: 'POST', body: '{}' }),

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
