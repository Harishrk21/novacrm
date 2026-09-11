import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CircleDollarSign,
  Download,
  Edit3,
  Eye,
  Loader2,
  Mail,
  MapPin,
  Package,
  Phone,
  ShoppingBag,
  Sparkles,
  TicketCheck,
  TicketPlus,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, ticketStatusColor } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'
import { formatServiceId } from '@/lib/serviceId'
import { Input } from '@/components/ui/Input'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Modal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { SparePartsPanel } from '@/components/contacts/SparePartsPanel'
import { AiAssistCard } from '@/components/ai/AiAssistCard'
import { Select } from '@/components/ui/Select'
import { api, ApiClientError, num } from '@/lib/api'
import { ASSET_ORIGIN_OPTIONS, isThirdPartyOrigin } from '@/lib/assetOrigin'
import { formatCurrency, formatDate, formatPhone } from '@/lib/utils'
import { indianMobileLocal, toStoredIndianMobile } from '@/lib/phoneIndia'
import { firstError, validateContactForm } from '@/lib/formValidation'
import { useUIStore } from '@/store/uiStore'

type Tab = 'Overview' | 'Products' | 'Tickets' | 'Notes'

const MACHINE_TYPES = [
  { value: 'WEIGHING', label: 'Weighing machine' },
  { value: 'BILLING', label: 'Billing machine' },
  { value: 'CCM', label: 'CCM' },
  { value: 'CCTV', label: 'CCTV' },
  { value: 'BIOMETRIC', label: 'Biometric' },
  { value: 'PAPER_SHREDDER', label: 'Paper shredder' },
  { value: 'PAPER_ROLL', label: 'Paper roll' },
  { value: 'OTHER', label: 'Other' },
]

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [contact, setContact] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [machineOpen, setMachineOpen] = useState(false)
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [savingMachine, setSavingMachine] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyResult, setHistoryResult] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    mobile2: '',
    mobile3: '',
    whatsapp: '',
    landline: '',
    buildingName: '',
    street: '',
    doorNo: '',
    area: '',
    pincode: '',
    landmark: '',
    gpsLocation: '',
    city: '',
    state: '',
    accountId: '',
    ownerUserId: '',
    description: '',
  })
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const emptyMachineForm = {
    machineType: 'WEIGHING',
    name: '',
    capacity: '',
    accuracy: '',
    platformSize: '',
    model: '',
    serialNo: '',
    origin: 'SOLD_BY_US',
    servicePlan: 'NON_AMC',
    amcStartDate: '',
    amcEndDate: '',
    remindersEnabled: true,
    stampingDate: '',
    nextDueDate: '',
    notes: '',
  }
  const [machineForm, setMachineForm] = useState(emptyMachineForm)

  function openAddMachine() {
    setEditingMachineId(null)
    setMachineForm(emptyMachineForm)
    setMachineOpen(true)
  }

  function openEditMachine(a: Record<string, unknown>) {
    setEditingMachineId(String(a.id))
    setMachineForm({
      machineType: String(a.machineType ?? 'WEIGHING'),
      name: String(a.name ?? ''),
      capacity: String(a.capacity ?? ''),
      accuracy: String(a.accuracy ?? ''),
      platformSize: String(a.platformSize ?? ''),
      model: String(a.model ?? ''),
      serialNo: String(a.serialNo ?? ''),
      origin: String(a.origin ?? 'SOLD_BY_US'),
      servicePlan: String(a.servicePlan ?? 'NON_AMC'),
      amcStartDate: a.amcStartDate ? String(a.amcStartDate).slice(0, 10) : '',
      amcEndDate: a.amcEndDate ? String(a.amcEndDate).slice(0, 10) : '',
      remindersEnabled: a.remindersEnabled !== false,
      stampingDate: a.stampingDate ? String(a.stampingDate).slice(0, 10) : '',
      nextDueDate: a.nextDueDate ? String(a.nextDueDate).slice(0, 10) : '',
      notes: String(a.notes ?? ''),
    })
    setMachineOpen(true)
  }

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [row, lookups] = await Promise.all([api.getContact(id), api.lookups()])
      setContact(row)
      setAccounts(lookups.accounts)
      setUsers(lookups.users)
      const custom = (row.customFields as Record<string, unknown> | null) ?? {}
      setForm({
        name: String(row.name ?? ''),
        email: String(row.email ?? ''),
        phone: String(row.phone ?? ''),
        mobile: indianMobileLocal(String(row.mobile ?? row.phone ?? '')),
        mobile2: indianMobileLocal(String(custom.mobile_2 ?? '')),
        mobile3: indianMobileLocal(String(custom.mobile_3 ?? '')),
        whatsapp: indianMobileLocal(String(custom.whatsapp ?? '')),
        landline: String(custom.landline ?? ''),
        buildingName: String(custom.building_name ?? ''),
        street: String(row.street ?? ''),
        doorNo: String(row.doorNo ?? ''),
        area: String(row.area ?? ''),
        pincode: String(row.pincode ?? ''),
        landmark: String(row.location ?? ''),
        gpsLocation: String(custom.gps_location ?? ''),
        city: String(row.city ?? ''),
        state: String(row.state ?? ''),
        accountId: String(row.accountId ?? ''),
        ownerUserId: String(row.ownerUserId ?? ''),
        description: String(row.description ?? ''),
      })
    } catch {
      setContact(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function saveEdit() {
    if (!id) return
    const nextErrors = validateContactForm({
      name: form.name,
      email: form.email,
      phone: form.phone,
      mobile: form.mobile,
      country: 'IN',
      landline: form.landline,
      whatsapp: form.whatsapp,
      mobile2: form.mobile2,
      mobile3: form.mobile3,
    })
    if (Object.keys(nextErrors).length) {
      addToast({ type: 'error', message: firstError(nextErrors) })
      return
    }
    try {
      const prevCustom =
        contact?.customFields && typeof contact.customFields === 'object'
          ? (contact.customFields as Record<string, unknown>)
          : {}
      const mobileStored = toStoredIndianMobile(form.mobile)
      const waStored = toStoredIndianMobile(form.whatsapp) || mobileStored
      const updated = await api.updateContact(id, {
        name: form.name,
        email: form.email || null,
        phone: form.landline.trim() || mobileStored || waStored,
        mobile: mobileStored,
        street: form.street || null,
        doorNo: form.doorNo || null,
        area: form.area || null,
        pincode: form.pincode || null,
        location: form.landmark || null,
        city: form.city || null,
        state: form.state || null,
        accountId: form.accountId || null,
        ownerUserId: form.ownerUserId || null,
        description: form.description || null,
        customFields: {
          ...prevCustom,
          building_name: form.buildingName.trim() || null,
          landline: form.landline.trim() || null,
          mobile_2: toStoredIndianMobile(form.mobile2),
          mobile_3: toStoredIndianMobile(form.mobile3),
          whatsapp: waStored,
          gps_location: form.gpsLocation.trim() || null,
        },
      })
      setContact(updated)
      setEditOpen(false)
      addToast({ type: 'success', message: 'Customer updated' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Update failed',
      })
    }
  }

  function downloadPurchasesCsv() {
    if (!contact) return
    const invs = (contact.invoices as Array<Record<string, unknown>>) ?? []
    const products = ((contact.purchaseSummary as { productsBought?: Array<Record<string, unknown>> })
      ?.productsBought ?? []) as Array<{
      name?: string
      sku?: string
      qty?: number
      amount?: number
    }>
    const lines = [
      ['Type', 'Reference', 'Date', 'SKU', 'Item', 'Qty', 'Amount', 'Status'].join(','),
      ...products.map((p) =>
        [
          'Product',
          '',
          '',
          csvEscape(String(p.sku ?? '')),
          csvEscape(String(p.name ?? '')),
          String(p.qty ?? 0),
          String(p.amount ?? 0),
          '',
        ].join(','),
      ),
      ...invs.map((inv) =>
        [
          'Invoice',
          csvEscape(String(inv.invoiceNumber ?? '')),
          inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : '',
          '',
          '',
          '',
          String(num(inv.grandTotal)),
          csvEscape(String(inv.status ?? '')),
        ].join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${String(contact.customerCode || contact.name || 'customer').replace(/\s+/g, '_')}_purchases.csv`
    a.click()
    URL.revokeObjectURL(url)
    addToast({ type: 'success', message: 'Purchases CSV downloaded' })
  }

  async function addNote() {
    if (!id || !noteDraft.trim()) return
    setNoteBusy(true)
    try {
      await api.addContactNote(id, noteDraft.trim())
      setNoteDraft('')
      addToast({ type: 'success', message: 'Note added' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not add note',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  async function saveNoteEdit() {
    if (!id || !editingNoteId || !editingNoteText.trim()) return
    setNoteBusy(true)
    try {
      await api.updateContactNote(id, editingNoteId, editingNoteText.trim())
      setEditingNoteId(null)
      setEditingNoteText('')
      addToast({ type: 'success', message: 'Note updated' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update note',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  async function deleteNote(noteId: string) {
    if (!id) return
    setNoteBusy(true)
    try {
      await api.deleteContactNote(id, noteId)
      addToast({ type: 'success', message: 'Note deleted' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete note',
      })
    } finally {
      setNoteBusy(false)
    }
  }

  async function saveMachine() {
    if (!id || !machineForm.name.trim()) {
      addToast({ type: 'error', message: 'Machine name is required' })
      return
    }
    if (machineForm.servicePlan === 'AMC' && !machineForm.amcStartDate && !machineForm.amcEndDate) {
      addToast({ type: 'error', message: 'Set AMC start and/or end date' })
      return
    }
    if (
      machineForm.servicePlan === 'AMC' &&
      machineForm.amcStartDate &&
      machineForm.amcEndDate &&
      machineForm.amcEndDate < machineForm.amcStartDate
    ) {
      addToast({ type: 'error', message: 'AMC end date must be on or after start date' })
      return
    }
    setSavingMachine(true)
    try {
      const body = {
        machineType: machineForm.machineType,
        name: machineForm.name.trim(),
        capacity: machineForm.capacity || null,
        accuracy: machineForm.accuracy || null,
        platformSize: machineForm.platformSize || null,
        model: machineForm.model || null,
        serialNo: machineForm.serialNo || null,
        origin: machineForm.origin,
        servicePlan: machineForm.servicePlan,
        amcStartDate: machineForm.servicePlan === 'AMC' ? machineForm.amcStartDate || null : null,
        amcEndDate: machineForm.servicePlan === 'AMC' ? machineForm.amcEndDate || null : null,
        remindersEnabled: machineForm.remindersEnabled,
        stampingDate: machineForm.stampingDate || null,
        nextDueDate: machineForm.nextDueDate || null,
        notes: machineForm.notes || null,
      }
      if (editingMachineId) {
        await api.updateAsset(editingMachineId, body)
        addToast({ type: 'success', message: 'Machine updated' })
      } else {
        await api.createAsset({ contactId: id, ...body })
        addToast({ type: 'success', message: 'Machine saved' })
      }
      setMachineOpen(false)
      setEditingMachineId(null)
      setMachineForm(emptyMachineForm)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save machine',
      })
    } finally {
      setSavingMachine(false)
    }
  }

  async function runCustomerHistorySummary() {
    if (!contact?.id && !id) return
    const contactId = String(contact?.id ?? id)
    setHistoryOpen(true)
    setHistoryBusy(true)
    setHistoryResult(null)
    try {
      const data = await api.aiCustomerAssist({ contactId, action: 'summarize' })
      setHistoryResult(data)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not load AI history summary',
      })
      setHistoryOpen(false)
    } finally {
      setHistoryBusy(false)
    }
  }

  if (loading) {
    return <Card className="p-8 text-sm text-text-secondary">Loading contact…</Card>
  }

  if (!contact) {
    return (
      <Card>
        <EmptyState
          icon={<UserRound size={26} />}
          title="Contact not found"
          subtitle="This contact may have been removed or the link is incorrect."
          actionLabel="Back to contacts"
          onAction={() => navigate('/contacts')}
        />
      </Card>
    )
  }

  const account = contact.account as Record<string, unknown> | null | undefined
  const deals = (contact.deals as Array<Record<string, unknown>>) ?? []
  const tickets = (contact.tickets as Array<Record<string, unknown>>) ?? []
  const notes = (contact.notes as Array<Record<string, unknown>>) ?? []
  const invoices = (contact.invoices as Array<Record<string, unknown>>) ?? []
  const purchaseSummary = (contact.purchaseSummary as {
    invoiceCount: number
    totalBilled: number
    totalPaid: number
    productsBought: Array<{ id: string; sku: string; name: string; qty: number; amount: number; imageUrl?: string | null }>
  }) ?? { invoiceCount: 0, totalBilled: 0, totalPaid: 0, productsBought: [] }
  const custom = (contact.customFields as Record<string, unknown> | null) ?? {}

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => navigate('/contacts')}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => void runCustomerHistorySummary()}>
          <Sparkles size={16} /> History summary
        </Button>
        <Button
          onClick={() =>
            navigate(
              `/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1${
                contact.accountId ? `&accountId=${encodeURIComponent(String(contact.accountId))}` : ''
              }`,
            )
          }
        >
          <TicketPlus size={16} /> New service ticket
        </Button>
        <Button variant="outline" onClick={() => setEditOpen((v) => !v)}>
          <Edit3 size={16} /> {editOpen ? 'Close form' : 'Edit'}
        </Button>
      </div>

      <div className="mb-5" id="customer-ai">
        <AiAssistCard
          title="Customer AI"
          subtitle="History summary · machines due · visit questions. Verify dates on the profile."
          actions={[
            {
              id: 'summarize',
              label: 'History summary',
              run: () => api.aiCustomerAssist({ contactId: String(contact.id), action: 'summarize' }),
            },
            {
              id: 'machines_due',
              label: 'Machines due / stamping',
              run: () => api.aiCustomerAssist({ contactId: String(contact.id), action: 'machines_due' }),
            },
            {
              id: 'visit_questions',
              label: 'What to ask next visit',
              run: () =>
                api.aiCustomerAssist({ contactId: String(contact.id), action: 'visit_questions' }),
            },
          ]}
        />
      </div>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Customer history summary"
        subtitle={String(contact.name)}
        size="md"
        accent="violet"
        footer={
          <Button variant="outline" onClick={() => setHistoryOpen(false)}>
            Close
          </Button>
        }
      >
        {historyBusy ? (
          <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
            <Loader2 size={16} className="animate-spin" /> Reading tickets, machines, parts & invoices…
          </div>
        ) : historyResult ? (
          <div className="space-y-3 text-sm">
            {typeof historyResult.answer === 'string' ? (
              <p className="whitespace-pre-wrap leading-relaxed text-text-primary">
                {historyResult.answer}
              </p>
            ) : null}
            {Array.isArray(historyResult.bullets) && historyResult.bullets.length ? (
              <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                {(historyResult.bullets as string[]).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {Array.isArray(historyResult.flags) && historyResult.flags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {(historyResult.flags as string[]).map((f) => (
                  <Badge key={f} color="amber">
                    {f}
                  </Badge>
                ))}
              </div>
            ) : null}
            {Array.isArray(historyResult.visitQuestions) && historyResult.visitQuestions.length ? (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-text-secondary">
                  Next visit
                </div>
                <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                  {(historyResult.visitQuestions as string[]).map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {typeof historyResult.disclaimer === 'string' ? (
              <p className="text-xs text-text-secondary">{historyResult.disclaimer}</p>
            ) : null}
          </div>
        ) : (
          <p className="py-6 text-sm text-text-secondary">No summary yet.</p>
        )}
      </Modal>

      <FormPanel
        open={editOpen}
        accent="theme"
        eyebrow="Customers"
        title="Edit customer"
        subtitle="Company, address, phones, WhatsApp, GPS and executive."
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setEditOpen(false)} />
            <Button type="submit" form="edit-contact-form">
              Save changes
            </Button>
          </>
        }
      >
        <form
          id="edit-contact-form"
          onSubmit={(e) => {
            e.preventDefault()
            void saveEdit()
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Input
            label="Company / shop / customer name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="sm:col-span-2 lg:col-span-3"
          />
          <Input label="Door number" value={form.doorNo} onChange={(e) => setForm({ ...form, doorNo: e.target.value })} />
          <Input label="Street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
          <Input
            label="Building name"
            value={form.buildingName}
            onChange={(e) => setForm({ ...form, buildingName: e.target.value })}
          />
          <Input label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="PIN code" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
          <Input
            label="Landmark"
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
            className="sm:col-span-2"
          />
          <Input
            label="Landline number"
            value={form.landline}
            onChange={(e) => setForm({ ...form, landline: e.target.value, phone: e.target.value })}
            placeholder="Optional landline"
          />
          <PhoneInput
            label="Mobile number 1"
            required
            value={form.mobile}
            onChange={(mobile) => setForm({ ...form, mobile })}
            hint="India (+91) — enter 10 digits only"
          />
          <PhoneInput
            label="Mobile number 2"
            value={form.mobile2}
            onChange={(mobile2) => setForm({ ...form, mobile2 })}
          />
          <PhoneInput
            label="Mobile number 3"
            value={form.mobile3}
            onChange={(mobile3) => setForm({ ...form, mobile3 })}
          />
          <PhoneInput
            id="contact-whatsapp"
            label={
              <span className="inline-flex items-center gap-1.5">
                <WhatsAppIcon size={14} />
                <span style={{ color: WA_GREEN }}>WhatsApp number</span>
              </span>
            }
            value={form.whatsapp}
            onChange={(whatsapp) => setForm({ ...form, whatsapp })}
            hint="Defaults to mobile 1 if empty"
          />
          <Input label="Email ID" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input
            label="GPS location"
            value={form.gpsLocation}
            onChange={(e) => setForm({ ...form, gpsLocation: e.target.value })}
            className="sm:col-span-2 lg:col-span-3"
          />
          <Select
            label="Lead — name of the executive"
            value={form.ownerUserId}
            onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
            options={[{ value: '', label: 'Select executive' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Select
            label="Account (optional)"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'Select account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>
      </FormPanel>

      <FormPanel
        open={machineOpen}
        accent="theme"
        eyebrow="Products"
        title={editingMachineId ? 'Edit product / machine' : 'Add product / machine'}
        subtitle="Segregate clearly: Sold by us vs Outside (repair/stamping). AMC only after inspection — set start + end. Stamp dates come from engineer after a stamping job."
        onClose={() => {
          setMachineOpen(false)
          setEditingMachineId(null)
        }}
        footer={
          <>
            <FormPanelCancel
              onClick={() => {
                setMachineOpen(false)
                setEditingMachineId(null)
              }}
            />
            <Button disabled={savingMachine} onClick={() => void saveMachine()}>
              {savingMachine ? 'Saving…' : editingMachineId ? 'Save changes' : 'Save machine'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3 rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-xs text-text-secondary">
            <strong className="text-text-primary">How to store:</strong> pick origin first → identity
            (type/name/serial) → plan (Non-AMC or AMC after inspect) → stamping validity is filled by
            the engineer when a stamping ticket is completed (you can correct history here if needed).
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Select
              label="1. Machine origin *"
              value={machineForm.origin}
              onChange={(e) => {
                const origin = e.target.value
                setMachineForm({
                  ...machineForm,
                  origin,
                  ...(origin === 'THIRD_PARTY' && machineForm.servicePlan === 'AMC'
                    ? {}
                    : origin === 'THIRD_PARTY'
                      ? {}
                      : {}),
                })
              }}
              options={ASSET_ORIGIN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {ASSET_ORIGIN_OPTIONS.find((o) => o.value === machineForm.origin)?.hint}
            </p>
          </div>
          <Select
            label="2. Machine type"
            value={machineForm.machineType}
            onChange={(e) => setMachineForm({ ...machineForm, machineType: e.target.value })}
            options={MACHINE_TYPES}
          />
          <Input
            label="Machine name *"
            placeholder="WEIGHING SCALE 20KG"
            value={machineForm.name}
            onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
            className="lg:col-span-2"
          />
          <Input label="Capacity" placeholder="20KG / CAP" value={machineForm.capacity} onChange={(e) => setMachineForm({ ...machineForm, capacity: e.target.value })} />
          <Input label="Accuracy" placeholder="ACC" value={machineForm.accuracy} onChange={(e) => setMachineForm({ ...machineForm, accuracy: e.target.value })} />
          <Input label="Platform size" value={machineForm.platformSize} onChange={(e) => setMachineForm({ ...machineForm, platformSize: e.target.value })} />
          <Input label="Model" value={machineForm.model} onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })} />
          <Input label="Serial number" value={machineForm.serialNo} onChange={(e) => setMachineForm({ ...machineForm, serialNo: e.target.value })} />
          <div className="sm:col-span-2 lg:col-span-3 rounded-[10px] border border-emerald-200/70 bg-emerald-50/50 px-3 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
              3. AMC (after inspection)
            </div>
            <p className="mb-3 text-xs text-text-secondary">
              Customer wants AMC → create an inspect / service ticket first → if machine is fit, enroll
              AMC with start + end dates here (or use Add AMC on the product card).
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Service plan"
                value={machineForm.servicePlan}
                onChange={(e) => setMachineForm({ ...machineForm, servicePlan: e.target.value })}
                options={[
                  { value: 'NON_AMC', label: 'Non-AMC (no contract yet)' },
                  { value: 'AMC', label: 'AMC (enrolled after inspect)' },
                ]}
              />
              {machineForm.servicePlan === 'AMC' ? (
                <>
                  <Input
                    label="AMC start date *"
                    type="date"
                    value={machineForm.amcStartDate}
                    onChange={(e) => setMachineForm({ ...machineForm, amcStartDate: e.target.value })}
                  />
                  <Input
                    label="AMC end date *"
                    type="date"
                    value={machineForm.amcEndDate}
                    onChange={(e) => setMachineForm({ ...machineForm, amcEndDate: e.target.value })}
                  />
                </>
              ) : null}
            </div>
          </div>
          {machineForm.machineType === 'WEIGHING' ? (
            <div className="sm:col-span-2 lg:col-span-3 rounded-[10px] border border-violet-200/70 bg-violet-50/50 px-3 py-3 dark:border-violet-900/40 dark:bg-violet-950/20">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                4. Stamping (engineer-owned)
              </div>
              <p className="mb-3 text-xs text-text-secondary">
                After a stamping ticket, the engineer enters stamp date + valid till. Those values
                sync here automatically. Edit only to correct history.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Last stamp date (engineer)"
                  type="date"
                  value={machineForm.stampingDate}
                  onChange={(e) => setMachineForm({ ...machineForm, stampingDate: e.target.value })}
                />
                <Input
                  label="Stamping valid till"
                  type="date"
                  value={machineForm.nextDueDate}
                  onChange={(e) => setMachineForm({ ...machineForm, nextDueDate: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <Input label="Notes" value={machineForm.notes} onChange={(e) => setMachineForm({ ...machineForm, notes: e.target.value })} className="sm:col-span-2 lg:col-span-3" />
        </div>
      </FormPanel>

      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={String(contact.name)} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text-primary">{String(contact.name)}</h1>
            <p className="mt-1 font-mono text-sm font-semibold text-accent-blue">
              {contact.customerCode ? String(contact.customerCode) : 'Customer ID pending'}
            </p>
            <p className="text-sm text-text-secondary">
              {[contact.title, contact.department].filter(Boolean).join(' · ') || 'No title set'}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {contact.phone || contact.mobile ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={14} /> {formatPhone(String(contact.phone || contact.mobile))}
                </span>
              ) : null}
              {contact.email ? (
                <span className="inline-flex items-center gap-1.5">
                  <Mail size={14} /> {String(contact.email)}
                </span>
              ) : null}
              {contact.city || contact.state ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} /> {[contact.city, contact.state].filter(Boolean).join(', ')}
                </span>
              ) : null}
              {account ? (
                <Link
                  to={`/accounts/${account.id}`}
                  className="inline-flex items-center gap-1.5 text-accent-blue hover:underline"
                >
                  <Building2 size={14} /> {String(account.name)}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div className="rounded-[10px] bg-emerald-50 px-4 py-3 text-accent-green">
              <ShoppingBag size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{purchaseSummary.invoiceCount}</div>
              <div className="text-xs opacity-80">Invoices</div>
            </div>
            <div className="rounded-[10px] bg-blue-50 px-4 py-3 text-accent-blue">
              <CircleDollarSign size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{formatCurrency(purchaseSummary.totalBilled)}</div>
              <div className="text-xs opacity-80">Total spend</div>
            </div>
            <div className="rounded-[10px] bg-violet-50 px-4 py-3 text-accent-purple">
              <Briefcase size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{deals.length}</div>
              <div className="text-xs opacity-80">Deals</div>
            </div>
            <div className="rounded-[10px] bg-amber-50 px-4 py-3 text-accent-amber">
              <TicketCheck size={16} className="mx-auto mb-1" />
              <div className="text-lg font-semibold">{tickets.length}</div>
              <div className="text-xs opacity-80">Tickets</div>
            </div>
          </div>
        </div>
      </Card>

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'Overview', label: 'Overview' },
          {
            id: 'Products',
            label: 'Products',
            count: ((contact.assets as Array<unknown>) ?? []).length,
          },
          { id: 'Tickets', label: 'Tickets', count: tickets.length },
          { id: 'Notes', label: 'Notes', count: notes.length },
        ]}
      />

      {tab === 'Overview' && (
        <ContactAnalytics
          contact={contact}
          custom={custom}
          deals={deals}
          tickets={tickets}
          invoices={invoices}
          productsBought={purchaseSummary.productsBought}
          totalPaid={purchaseSummary.totalPaid}
          totalBilled={purchaseSummary.totalBilled}
        />
      )}

      {tab === 'Products' && (
        <>
        <Card className="mb-4 border-sky-200/60 bg-sky-50/40 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
          <p className="text-sm font-medium text-text-primary">Customer products — how to read this</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text-secondary">
            <li>
              <strong>Sold by us</strong> = HMS installed base. <strong>Outside</strong> = brought only
              for repair / stamping (not our sale).
            </li>
            <li>
              <strong>Stamping</strong> = last stamp date + <em>valid till</em> (engineer fills after a
              stamping ticket).
            </li>
            <li>
              <strong>AMC</strong> = only after inspect. Use Inspect job → then Enroll AMC with start /
              end.
            </li>
            <li>
              <strong>Spare parts</strong> = parts changed on each machine (logged by engineer on the
              service ticket). Expand per machine below — no separate Parts tab.
            </li>
          </ul>
        </Card>

        {(() => {
          const all = ((contact.assets as Array<Record<string, unknown>>) ?? [])
          const sold = all.filter((a) => !isThirdPartyOrigin(a.origin ? String(a.origin) : null))
          const outside = all.filter((a) => isThirdPartyOrigin(a.origin ? String(a.origin) : null))
          const daysUntil = (dateStr?: string | null) => {
            if (!dateStr) return null
            const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
            if (Number.isNaN(d.getTime())) return null
            const today = new Date()
            today.setHours(12, 0, 0, 0)
            return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
          }
          const renderMachine = (a: Record<string, unknown>, kind: 'sold' | 'outside') => {
            const validTill = a.nextDueDate ? String(a.nextDueDate).slice(0, 10) : ''
            const lastStamp = a.stampingDate ? String(a.stampingDate).slice(0, 10) : ''
            const dueDays = daysUntil(validTill)
            const amcEndDays = daysUntil(a.amcEndDate ? String(a.amcEndDate) : null)
            const onAmc = a.servicePlan === 'AMC'
            return (
              <div
                key={String(a.id)}
                className="rounded-[12px] border border-border bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-text-primary">{String(a.name)}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-text-secondary">
                      <Badge color={kind === 'outside' ? 'amber' : 'blue'}>
                        {kind === 'outside' ? 'Outside — repair / stamping' : 'Sold by us'}
                      </Badge>
                      <Badge color="gray">{String(a.machineType ?? '').replaceAll('_', ' ')}</Badge>
                      {a.serialNo ? (
                        <span className="font-mono text-text-primary">S/N {String(a.serialNo)}</span>
                      ) : null}
                      {a.capacity ? <span>· {String(a.capacity)}</span> : null}
                      {a.model ? <span>· {String(a.model)}</span> : null}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[10px] border border-violet-200/70 bg-violet-50/40 px-3 py-3 dark:border-violet-900/40 dark:bg-violet-950/20">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                      Stamping (engineer)
                    </div>
                    {String(a.machineType) === 'WEIGHING' || lastStamp || validTill ? (
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">Last stamp</dt>
                          <dd className="font-medium">{lastStamp ? formatDate(lastStamp) : 'Not stamped yet'}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">Valid till</dt>
                          <dd className="font-semibold text-text-primary">
                            {validTill ? formatDate(validTill) : '—'}
                          </dd>
                        </div>
                        {dueDays != null ? (
                          <div className="pt-1">
                            {dueDays < 0 ? (
                              <Badge color="red">Overdue {Math.abs(dueDays)}d</Badge>
                            ) : dueDays <= 30 ? (
                              <Badge color="amber">Due in {dueDays}d</Badge>
                            ) : (
                              <Badge color="green">Valid · {dueDays}d left</Badge>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-text-secondary">
                            Opens a stamping job — engineer enters dates after verification.
                          </p>
                        )}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-text-secondary">Not a weighing unit — stamping N/A.</p>
                    )}
                  </div>

                  <div className="rounded-[10px] border border-emerald-200/70 bg-emerald-50/40 px-3 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                      AMC (after inspect)
                    </div>
                    {onAmc ? (
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">Plan</dt>
                          <dd>
                            <Badge color="green">AMC active</Badge>
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">Start</dt>
                          <dd className="font-medium">
                            {a.amcStartDate ? formatDate(String(a.amcStartDate)) : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-text-secondary">End</dt>
                          <dd className="font-medium">
                            {a.amcEndDate ? formatDate(String(a.amcEndDate)) : '—'}
                          </dd>
                        </div>
                        {amcEndDays != null ? (
                          <div className="pt-1">
                            {amcEndDays < 0 ? (
                              <Badge color="red">AMC expired</Badge>
                            ) : amcEndDays <= 60 ? (
                              <Badge color="amber">Renew in {amcEndDays}d</Badge>
                            ) : (
                              <Badge color="green">{amcEndDays}d left</Badge>
                            )}
                          </div>
                        ) : null}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-text-secondary">
                        Non-AMC. Want contract? Run an <strong>inspect</strong> job, then enroll with
                        start + end dates.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=Stamping&open=1`,
                      )
                    }
                  >
                    Stamping job
                  </Button>
                  {!onAmc ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate(
                            `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=${encodeURIComponent('AMC visit')}&open=1`,
                          )
                        }
                      >
                        Inspect for AMC
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          openEditMachine({
                            ...a,
                            servicePlan: 'AMC',
                            amcStartDate: a.amcStartDate || new Date().toISOString().slice(0, 10),
                          })
                        }}
                      >
                        Enroll AMC
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(
                          `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&category=${encodeURIComponent('AMC visit')}&open=1`,
                        )
                      }
                    >
                      AMC visit job
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/tickets?contactId=${encodeURIComponent(String(contact.id))}&assetId=${encodeURIComponent(String(a.id))}&open=1`,
                      )
                    }
                  >
                    Repair job
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEditMachine(a)}>
                    <Edit3 size={14} /> Edit
                  </Button>
                </div>

                <div className="mt-3">
                  <SparePartsPanel
                    contactId={String(contact.id)}
                    contactName={String(contact.name)}
                    fixedAssetId={String(a.id)}
                    fixedAssetLabel={`${String(a.name)}${a.serialNo ? ` · ${String(a.serialNo)}` : ''}`}
                    title="Parts changed on this machine"
                    collapsible
                    defaultOpen={false}
                    readOnly
                  />
                </div>
              </div>
            )
          }

          if (all.length === 0) {
            return (
              <Card padding={false}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="text-sm font-semibold">Products / machines</div>
                  <Button size="sm" onClick={openAddMachine}>
                    Add product
                  </Button>
                </div>
                <EmptyState
                  icon={<Package size={22} />}
                  title="No products yet"
                  subtitle="Add machines clearly as Sold by us or Outside (repair / stamping only)."
                  actionLabel="Add product"
                  onAction={openAddMachine}
                />
              </Card>
            )
          }

          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-text-secondary">
                  {sold.length} sold by us · {outside.length} outside / stamping-repair
                </p>
                <Button size="sm" onClick={openAddMachine}>
                  Add product
                </Button>
              </div>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">
                  Sold by us <span className="font-normal text-text-secondary">({sold.length})</span>
                </h3>
                {sold.length === 0 ? (
                  <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
                    No HMS-sold machines on this customer yet.
                  </p>
                ) : (
                  sold.map((a) => renderMachine(a, 'sold'))
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">
                  Outside — repair / stamping only{' '}
                  <span className="font-normal text-text-secondary">({outside.length})</span>
                </h3>
                <p className="text-xs text-text-secondary">
                  Not purchased from HMS. Customer brought the unit for service or government
                  stamping only.
                </p>
                {outside.length === 0 ? (
                  <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
                    No outside machines on file.
                  </p>
                ) : (
                  outside.map((a) => renderMachine(a, 'outside'))
                )}
              </section>
            </div>
          )
        })()}

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text-primary">Purchase / invoice history</p>
            <Button variant="outline" size="sm" onClick={downloadPurchasesCsv}>
              <Download size={14} /> Download CSV
            </Button>
          </div>
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Products from our invoices
            </h2>
            {purchaseSummary.productsBought.length === 0 ? (
              <EmptyState
                icon={<CircleDollarSign size={22} />}
                title="No purchases yet"
                subtitle="Invoices billed to this customer appear here (Sold by us)."
              />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-text-secondary">
                  <tr>
                    {['Product', 'SKU', 'Qty', 'Amount'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {purchaseSummary.productsBought.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                      <td className="px-3 py-2">{p.qty}</td>
                      <td className="px-3 py-2">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {invoices.length > 0 ? (
            <Card padding={false}>
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">Invoices</div>
              <div className="divide-y divide-border">
                {invoices.map((inv) => (
                  <div key={String(inv.id)} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono font-semibold">{String(inv.invoiceNumber)}</div>
                        <div className="text-xs text-text-secondary">
                          {inv.invoiceDate ? formatDate(String(inv.invoiceDate)) : '—'} · {String(inv.status)}
                        </div>
                      </div>
                      <div className="text-right font-semibold">{formatCurrency(num(inv.grandTotal))}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
        </>
      )}

      {tab === 'Tickets' && (
        <Card padding={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="font-semibold">Service history</div>
            <Button
              size="sm"
              onClick={() =>
                navigate(`/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1`)
              }
            >
              <TicketPlus size={14} /> New ticket
            </Button>
          </div>
          {tickets.length === 0 ? (
            <EmptyState
              icon={<TicketCheck size={22} />}
              title="No service tickets yet"
              subtitle="Open a ticket after reviewing purchases — assign an agent and SLA."
              actionLabel="New service ticket"
              onAction={() =>
                navigate(`/tickets?contactId=${encodeURIComponent(String(contact.id))}&open=1`)
              }
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-text-secondary">
                <tr>
                  {['Service ID', 'Subject', 'Priority', 'Status', ''].map((h) => (
                    <th key={h || 'a'} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={String(t.id)} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link className="font-mono text-accent-blue hover:underline" to={`/tickets/${t.id}`}>
                        {formatServiceId(t.ticketNo != null ? String(t.ticketNo) : undefined)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{String(t.subject)}</td>
                    <td className="px-4 py-3">
                      <Badge color="amber">{String(t.priority)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={ticketStatusColor[String(t.status)] ?? 'gray'}>{String(t.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/tickets/${t.id}`)}>
                        <Eye size={14} /> View detail
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'Notes' && (
        <Card className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Add note</label>
            <textarea
              className="min-h-24 w-full rounded-[8px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
              placeholder="Customer preference, site access, follow-up…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <Button disabled={noteBusy || !noteDraft.trim()} onClick={() => void addNote()}>
                {noteBusy ? 'Saving…' : 'Add note'}
              </Button>
            </div>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-text-secondary">No notes yet — add the first one above.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => {
                const noteId = String(n.id)
                const isEditing = editingNoteId === noteId
                return (
                  <li key={noteId} className="rounded-lg border border-border p-3 text-sm">
                    {isEditing ? (
                      <>
                        <textarea
                          className="min-h-20 w-full rounded-[8px] border border-border bg-card p-2 text-sm outline-none focus:border-accent-blue"
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                        />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" disabled={noteBusy} onClick={() => void saveNoteEdit()}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingNoteId(null)
                              setEditingNoteText('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{String(n.content)}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-text-secondary">
                            {n.createdAt ? formatDate(String(n.createdAt)) : ''}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingNoteId(noteId)
                                setEditingNoteText(String(n.content ?? ''))
                              }}
                            >
                              <Edit3 size={14} /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={noteBusy}
                              onClick={() => void deleteNote(noteId)}
                            >
                              <Trash2 size={14} /> Delete
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4']

function ContactAnalytics({
  contact,
  custom,
  deals,
  tickets,
  invoices,
  productsBought,
  totalPaid,
  totalBilled,
}: {
  contact: Record<string, unknown>
  custom: Record<string, unknown>
  deals: Array<Record<string, unknown>>
  tickets: Array<Record<string, unknown>>
  invoices: Array<Record<string, unknown>>
  productsBought: Array<{ id: string; sku: string; name: string; qty: number; amount: number }>
  totalPaid: number
  totalBilled: number
}) {
  const spendOverTime = useMemo(() => {
    const map: Record<string, number> = {}
    for (const inv of invoices) {
      const d = inv.invoiceDate ? new Date(String(inv.invoiceDate)) : null
      if (!d || Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map[key] = (map[key] ?? 0) + num(inv.grandTotal)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, spend]) => ({ month, spend }))
  }, [invoices])

  const dealMix = useMemo(() => {
    const open = deals.filter((d) => !d.closedAt).length
    const won = deals.filter((d) => d.closedAt && num(d.probability) >= 100).length
    const closed = deals.filter((d) => d.closedAt).length
    const lost = Math.max(0, closed - won)
    return [
      { name: 'Open', value: open || 0 },
      { name: 'Won', value: won || 0 },
      { name: 'Lost/Other', value: lost || 0 },
    ].filter((x) => x.value > 0)
  }, [deals])

  const productBars = useMemo(
    () =>
      productsBought.slice(0, 6).map((p) => ({
        name: p.name.length > 18 ? `${p.name.slice(0, 16)}…` : p.name,
        qty: p.qty,
        amount: p.amount,
      })),
    [productsBought],
  )

  const ticketStatus = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of tickets) {
      const s = String(t.status ?? 'OPEN')
      map[s] = (map[s] ?? 0) + 1
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [tickets])

  const openPipeline = deals.filter((d) => !d.closedAt).reduce((s, d) => s + num(d.amount), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Lifetime billed', value: formatCurrency(totalBilled), icon: CircleDollarSign, tint: 'bg-blue-50 text-accent-blue' },
          { label: 'Amount paid', value: formatCurrency(totalPaid), icon: ShoppingBag, tint: 'bg-emerald-50 text-accent-green' },
          { label: 'Open pipeline', value: formatCurrency(openPipeline), icon: Briefcase, tint: 'bg-violet-50 text-accent-purple' },
          { label: 'Products bought', value: productsBought.length, icon: Package, tint: 'bg-amber-50 text-accent-amber' },
        ].map((k) => (
          <Card key={k.label}>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${k.tint}`}>
                <k.icon size={18} />
              </div>
              <div>
                <div className="text-lg font-semibold">{k.value}</div>
                <div className="text-xs text-text-secondary">{k.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Spend over time</h3>
          {spendOverTime.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spendOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatCurrency(num(v))} />
                  <Line type="monotone" dataKey="spend" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No invoice spend yet</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Deal mix</h3>
          {dealMix.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dealMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {dealMix.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No deals linked</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Purchases by product</h3>
          {productBars.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productBars}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="qty" fill="#10B981" name="Qty" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No products purchased</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Ticket status</h3>
          {ticketStatus.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ticketStatus} dataKey="value" nameKey="name" outerRadius={75}>
                    {ticketStatus.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-secondary">No support tickets</p>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Profile</h3>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Full name', contact.name],
            ['Title', contact.title],
            ['Department', contact.department],
            ['Email', contact.email],
            ['Alternate email', custom.alternate_email],
            ['Phone', contact.phone],
            ['Mobile', contact.mobile],
            ['WhatsApp', custom.whatsapp],
            ['LinkedIn', custom.linkedin],
            ['Address', custom.address_line],
            ['City', contact.city],
            ['State', contact.state],
            ['Pincode', custom.pincode],
            ['Country', contact.country],
            ['Created', contact.createdAt ? formatDate(String(contact.createdAt)) : '—'],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-xs text-text-secondary">
                {label === 'WhatsApp' ? (
                  <span className="inline-flex items-center gap-1" style={{ color: WA_GREEN }}>
                    <WhatsAppIcon size={12} /> WhatsApp
                  </span>
                ) : (
                  String(label)
                )}
              </dt>
              <dd className="text-sm font-medium text-text-primary">{String(value ?? '—')}</dd>
            </div>
          ))}
        </dl>
        {contact.description ? (
          <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-text-primary">{String(contact.description)}</p>
        ) : null}
      </Card>
    </div>
  )
}
