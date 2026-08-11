export type UserRole = 'ADMIN' | 'MANAGER' | 'AGENT' | 'READ_ONLY'
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'INVITED'

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'UNQUALIFIED' | 'LOST' | 'CONVERTED'
export type LeadSource = 'WEB' | 'REFERRAL' | 'COLD_CALL' | 'SOCIAL' | 'CAMPAIGN' | 'EVENT' | 'PARTNER' | 'OTHER'

export type DealStage = 'PROSPECT' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST'
export type DealPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export type ActivityType = 'CALL' | 'EMAIL' | 'MEETING' | 'TASK' | 'NOTE' | 'WHATSAPP'
export type ActivityStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'OVERDUE'

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED'
export type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED'

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  avatar?: string
  role: UserRole
  status: UserStatus
  timezone: string
  lastLoginAt?: string
  createdAt: string
}

export interface Lead {
  id: string
  name: string
  email?: string
  phone?: string
  company?: string
  website?: string
  address?: string
  city?: string
  state?: string
  country: string
  source: LeadSource
  status: LeadStatus
  score: number
  description?: string
  tags: string[]
  assignedToId?: string
  createdById: string
  lastActivityAt?: string
  createdAt: string
  updatedAt: string
}

export interface Account {
  id: string
  name: string
  industry?: string
  website?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  state?: string
  country: string
  description?: string
  logo?: string
  ownerId?: string
  createdAt: string
  updatedAt: string
}

export interface Contact {
  id: string
  customerNo?: number
  customerCode?: string
  name: string
  email?: string
  phone?: string
  mobile?: string
  title?: string
  department?: string
  street?: string
  doorNo?: string
  area?: string
  pincode?: string
  location?: string
  address?: string
  city?: string
  state?: string
  country: string
  tags: string[]
  description?: string
  accountId?: string
  ownerId?: string
  createdAt: string
  updatedAt: string
}

export type MachineType =
  | 'WEIGHING'
  | 'BILLING'
  | 'CCM'
  | 'CCTV'
  | 'BIOMETRIC'
  | 'PAPER_SHREDDER'
  | 'PAPER_ROLL'
  | 'OTHER'

export type ServicePlan = 'AMC' | 'NON_AMC'
export type JobPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID'

export interface CustomerAsset {
  id: string
  contactId: string
  machineType: MachineType
  name: string
  capacity?: string | null
  accuracy?: string | null
  platformSize?: string | null
  model?: string | null
  serialNo?: string | null
  servicePlan?: ServicePlan
  amcEndDate?: string | null
  remindersEnabled?: boolean
  stampingDate?: string | null
  nextDueDate?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface Deal {
  id: string
  name: string
  value: number
  stage: DealStage
  priority: DealPriority
  probability: number
  expectedCloseDate?: string
  closedAt?: string
  description?: string
  lostReason?: string
  contactId?: string
  accountId?: string
  ownerId?: string
  daysInStage: number
  createdAt: string
  updatedAt: string
}

export interface Activity {
  id: string
  type: ActivityType
  title: string
  description?: string
  status: ActivityStatus
  scheduledAt?: string
  completedAt?: string
  duration?: number
  outcome?: string
  leadId?: string
  contactId?: string
  dealId?: string
  accountId?: string
  assignedToId?: string
  createdAt: string
  updatedAt: string
}

export interface Ticket {
  id: string
  ticketNo: number
  subject: string
  description: string
  priority: TicketPriority
  status: TicketStatus
  slaStatus: SlaStatus
  slaBreached: boolean
  slaDueAt?: string | null
  resolvedAt?: string
  closedAt?: string
  contactId?: string
  accountId?: string
  productId?: string
  assetId?: string | null
  stampingDate?: string | null
  nextDueDate?: string | null
  odAmount?: number
  paymentTotal?: number
  advanceAmount?: number
  balanceDue?: number
  paymentStatus?: JobPaymentStatus
  paidAt?: string | null
  receivedByUserId?: string | null
  deliveredByUserId?: string | null
  assignedToId?: string
  customFields?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface TicketMessage {
  id: string
  ticketId: string
  content: string
  isInternal: boolean
  authorId?: string
  authorName: string
  attachments: string[]
  createdAt: string
}

export interface Note {
  id: string
  content: string
  isPinned: boolean
  leadId?: string
  contactId?: string
  dealId?: string
  ticketId?: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface Notification {
  id: string
  userId: string
  title: string
  message: string
  type: string
  entityType?: string
  entityId?: string
  isRead: boolean
  readAt?: string
  createdAt: string
}

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
}
