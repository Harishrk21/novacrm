import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  Package,
  RefreshCw,
  RotateCcw,
  Truck,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import { cn, formatCurrency, formatDateTime, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type Row = Record<string, unknown>
type Tab = 'ACTIVE' | 'OVERDUE' | 'RETURNED' | 'ALL'

function statusColor(s: string): 'blue' | 'amber' | 'red' | 'green' | 'gray' {
  if (s === 'ACTIVE') return 'blue'
  if (s === 'OVERDUE') return 'red'
  if (s === 'RETURNED') return 'green'
  return 'gray'
}

export function RentalsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('ACTIVE')
  const [items, setItems] = useState<Row[]>([])
  const [summary, setSummary] = useState({ active: 0, overdue: 0, returnedThisMonth: 0 })
  const [loading, setLoading] = useState(true)
  const [issueOpen, setIssueOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [units, setUnits] = useState<Row[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [returnTarget, setReturnTarget] = useState<Row | null>(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [returning, setReturning] = useState(false)

  const [picked, setPicked] = useState<ContactPick | null>(null)
  const [intakeLeadId, setIntakeLeadId] = useState<string | null>(null)
  const [form, setForm] = useState({
    productId: '',
    stockUnitId: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerCompany: '',
    customerAddress: '',
    city: '',
    state: '',
    startAt: new Date().toISOString().slice(0, 16),
    expectedReturnAt: '',
    dailyRate: '',
    depositAmount: '',
    totalAmount: '',
    notes: '',
  })

  const load = useCallback(async () => {
    if (!isTenantSession()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        api.rentals({
          status: tab === 'ALL' ? undefined : tab,
          limit: 150,
        }),
        api.rentalSummary(),
      ])
      setItems(list as Row[])
      setSummary(sum)
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Failed to load rentals',
      })
    } finally {
      setLoading(false)
    }
  }, [tab, addToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (searchParams.get('open') !== '1') return
    const leadId = searchParams.get('leadId')
    const contactId = searchParams.get('contactId')
    setIntakeLeadId(leadId)
    setIssueOpen(true)
    if (contactId) {
      void api
        .getContact(contactId)
        .then((c) => {
          const pick = {
            id: String(c.id),
            name: String(c.name ?? ''),
            phone: c.phone ? String(c.phone) : null,
            email: c.email ? String(c.email) : null,
            customerCode: c.customerCode ? String(c.customerCode) : null,
            company: c.company ? String(c.company) : undefined,
            city: c.city ? String(c.city) : undefined,
            state: c.state ? String(c.state) : undefined,
          } as ContactPick & { company?: string; city?: string; state?: string }
          setPicked(pick)
          setForm((f) => ({
            ...f,
            customerName: pick.name || f.customerName,
            customerPhone: pick.phone || f.customerPhone,
            customerEmail: pick.email || f.customerEmail,
            customerCompany: pick.company || f.customerCompany,
            city: pick.city || f.city,
            state: pick.state || f.state,
            notes: leadId && !f.notes ? 'From intake · rental enquiry' : f.notes,
          }))
        })
        .catch(() => {
          /* ignore */
        })
    }
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!issueOpen) return
    void Promise.all([
      api.stockUnits({ status: 'IN_STOCK', limit: 300 }),
      api.products({ limit: 300 }),
    ]).then(([u, p]) => {
      setUnits(u as Row[])
      setProducts((p.items ?? []) as Row[])
    }).catch(() => {
      /* ignore */
    })
  }, [issueOpen])

  const productOptions = useMemo(() => {
    const ids = new Set(units.map((u) => String(u.productId)))
    return products
      .filter((p) => ids.has(String(p.id)))
      .map((p) => ({ value: String(p.id), label: `${p.name} (${p.sku})` }))
  }, [products, units])

  const serialOptions = useMemo(() => {
    return units
      .filter((u) => !form.productId || String(u.productId) === form.productId)
      .map((u) => {
        const p = u.product as { name?: string; sku?: string } | null
        return {
          value: String(u.id),
          label: `${u.serialNo}${p?.name ? ` · ${p.name}` : ''}`,
        }
      })
  }, [units, form.productId])

  function openIssue() {
    setPicked(null)
    setIntakeLeadId(null)
    setForm({
      productId: '',
      stockUnitId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      customerCompany: '',
      customerAddress: '',
      city: '',
      state: '',
      startAt: new Date().toISOString().slice(0, 16),
      expectedReturnAt: '',
      dailyRate: '',
      depositAmount: '',
      totalAmount: '',
      notes: '',
    })
    setIssueOpen(true)
  }

  function onPickContact(c: ContactPick | null) {
    setPicked(c)
    if (!c) return
    setForm((f) => ({
      ...f,
      customerName: c.name || f.customerName,
      customerPhone: c.phone || f.customerPhone,
      customerEmail: c.email || f.customerEmail,
      customerCompany: (c as { company?: string }).company || f.customerCompany,
      city: (c as { city?: string }).city || f.city,
      state: (c as { state?: string }).state || f.state,
    }))
  }

  async function submitIssue(e: FormEvent) {
    e.preventDefault()
    if (!form.stockUnitId) {
      addToast({ type: 'error', message: 'Select the serial that is going out' })
      return
    }
    if (!form.customerName.trim()) {
      addToast({ type: 'error', message: 'Customer name is required' })
      return
    }
    setSaving(true)
    try {
      await api.issueRental({
        stockUnitId: form.stockUnitId,
        contactId: picked?.id || null,
        leadId: intakeLeadId || null,
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone || null,
        customerEmail: form.customerEmail || null,
        customerCompany: form.customerCompany || null,
        customerAddress: form.customerAddress || null,
        city: form.city || null,
        state: form.state || null,
        startAt: new Date(form.startAt).toISOString(),
        expectedReturnAt: form.expectedReturnAt
          ? new Date(form.expectedReturnAt).toISOString()
          : null,
        dailyRate: form.dailyRate ? Number(form.dailyRate) : null,
        depositAmount: form.depositAmount ? Number(form.depositAmount) : null,
        totalAmount: form.totalAmount ? Number(form.totalAmount) : null,
        notes: form.notes || null,
      })
      addToast({
        type: 'success',
        message: intakeLeadId
          ? 'Rental issued — linked to intake enquiry · stock reduced'
          : 'Rental issued — stock reduced',
      })
      setIssueOpen(false)
      setIntakeLeadId(null)
      setTab('ACTIVE')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not issue rental',
      })
    } finally {
      setSaving(false)
    }
  }

  async function confirmReturn() {
    if (!returnTarget) return
    setReturning(true)
    try {
      await api.returnRental(String(returnTarget.id), returnNotes)
      addToast({ type: 'success', message: 'Returned — stock restored' })
      setReturnTarget(null)
      setReturnNotes('')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Return failed',
      })
    } finally {
      setReturning(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rentals"
        breadcrumbs={[{ label: 'Service', to: '/tickets' }, { label: 'Rentals' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw size={14} className="mr-1" />
              Refresh
            </Button>
            <Button size="sm" onClick={openIssue}>
              <Truck size={14} className="mr-1" />
              Issue rental
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-text-secondary">Active rentals</div>
          <div className="mt-1 text-2xl font-semibold">{summary.active}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-secondary">Overdue returns</div>
          <div className="mt-1 text-2xl font-semibold text-red-500">{summary.overdue}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-secondary">Returned this month</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-600">
            {summary.returnedThisMonth}
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {(
            [
              { id: 'ACTIVE', label: 'Out on rent' },
              { id: 'OVERDUE', label: 'Overdue' },
              { id: 'RETURNED', label: 'Returned' },
              { id: 'ALL', label: 'All' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium',
                tab === t.id
                  ? 'bg-[color:var(--color-accent-blue)]/15 text-[color:var(--color-accent-blue)]'
                  : 'text-text-secondary hover:bg-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={6} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title="No rentals in this view"
            subtitle="Issue a machine on hire to deduct it from stock and track customer, dates, and serial."
            actionLabel="Issue rental"
            onAction={openIssue}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-[13px]">
              <thead className="border-b border-border bg-muted/30 text-[12px] text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Rental #</th>
                  <th className="px-3 py-2.5 font-medium">Product / Serial</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Start</th>
                  <th className="px-3 py-2.5 font-medium">Expected return</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Charges</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const product = r.product as { name?: string; sku?: string } | null
                  const unit = r.stockUnit as { serialNo?: string } | null
                  const status = String(r.status)
                  return (
                    <tr key={String(r.id)} className="border-b border-border/70 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">{String(r.rentalNo)}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{product?.name ?? '—'}</div>
                        <div className="text-[11px] text-text-secondary">
                          S/No {unit?.serialNo ?? '—'}
                          {product?.sku ? ` · ${product.sku}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{String(r.customerName)}</div>
                        <div className="text-[11px] text-text-secondary">
                          {[r.customerCompany, formatPhone(String(r.customerPhone ?? ''))]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                        {(r.city || r.state) && (
                          <div className="text-[11px] text-text-secondary">
                            {[r.city, r.state].filter(Boolean).join(', ')}
                          </div>
                        )}
                        {r.contactId ? (
                          <Link
                            to={`/contacts/${r.contactId}`}
                            className="text-[11px] text-[color:var(--color-accent-blue)] hover:underline"
                          >
                            Open contact
                          </Link>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {formatDateTime(String(r.startAt))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {r.expectedReturnAt ? (
                          <span
                            className={cn(
                              status === 'OVERDUE' && 'font-medium text-red-500',
                            )}
                          >
                            {formatDateTime(String(r.expectedReturnAt))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge color={statusColor(status)}>{status}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {r.dailyRate != null ? `${formatCurrency(Number(r.dailyRate))}/day` : '—'}
                        {r.depositAmount != null
                          ? ` · Dep ${formatCurrency(Number(r.depositAmount))}`
                          : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {(status === 'ACTIVE' || status === 'OVERDUE') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReturnTarget(r)
                              setReturnNotes('')
                            }}
                          >
                            <RotateCcw size={13} className="mr-1" />
                            Return
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FormPanel
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        accent="sky"
        eyebrow="Service · Rentals"
        title="Issue rental"
        subtitle="Select the serial going out. Stock is reduced immediately and customer + dates are logged."
        footer={
          <>
            <FormPanelCancel onClick={() => setIssueOpen(false)} />
            <Button type="submit" form="issue-rental" disabled={saving}>
              {saving ? 'Issuing…' : 'Issue & deduct stock'}
            </Button>
          </>
        }
      >
        <form id="issue-rental" onSubmit={submitIssue} className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-semibold">1. Machine going out</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Product"
                value={form.productId}
                onChange={(e) =>
                  setForm({ ...form, productId: e.target.value, stockUnitId: '' })
                }
                options={[
                  { value: '', label: 'All in-stock products…' },
                  ...productOptions,
                ]}
              />
              <Select
                label="Serial number *"
                value={form.stockUnitId}
                onChange={(e) => setForm({ ...form, stockUnitId: e.target.value })}
                options={[
                  {
                    value: '',
                    label: serialOptions.length
                      ? 'Select in-stock serial…'
                      : 'No IN_STOCK serials — add in Inventory',
                  },
                  ...serialOptions,
                ]}
              />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-semibold">2. Customer details</h3>
            <ContactPicker
              label="Link existing contact (optional)"
              valueId={picked?.id ?? ''}
              selected={picked}
              onSelect={onPickContact}
              returnTo="/rentals"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Customer name *"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
              <Input
                label="Phone"
                value={form.customerPhone}
                onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              />
              <Input
                label="Company / shop"
                value={form.customerCompany}
                onChange={(e) => setForm({ ...form, customerCompany: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
              />
              <Input
                label="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <Input
                label="State"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
              <Input
                className="sm:col-span-2"
                label="Address"
                value={form.customerAddress}
                onChange={(e) => setForm({ ...form, customerAddress: e.target.value })}
              />
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CalendarClock size={15} />
              3. Rental period & charges
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Rental start *"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
              <Input
                label="Expected return"
                type="datetime-local"
                value={form.expectedReturnAt}
                onChange={(e) => setForm({ ...form, expectedReturnAt: e.target.value })}
              />
              <Input
                label="Daily rate ₹"
                type="number"
                value={form.dailyRate}
                onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
              />
              <Input
                label="Deposit ₹"
                type="number"
                value={form.depositAmount}
                onChange={(e) => setForm({ ...form, depositAmount: e.target.value })}
              />
              <Input
                label="Agreed total ₹"
                type="number"
                value={form.totalAmount}
                onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
              />
              <Input
                className="sm:col-span-2"
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Delivery location, accessories, conditions…"
              />
            </div>
          </section>
        </form>
      </FormPanel>

      <ConfirmModal
        open={Boolean(returnTarget)}
        onClose={() => {
          setReturnTarget(null)
          setReturnNotes('')
        }}
        onConfirm={() => void confirmReturn()}
        title="Return rental to stock?"
        body={
          returnTarget
            ? `Mark ${String(returnTarget.rentalNo)} as returned. Serial goes back to IN_STOCK (+1 warehouse qty).${returnNotes.trim() ? ` Notes: ${returnNotes.trim()}` : ' You can add notes after closing if needed.'}`
            : ''
        }
        confirmLabel={returning ? 'Returning…' : 'Confirm return'}
      />
    </div>
  )
}

export default RentalsPage
