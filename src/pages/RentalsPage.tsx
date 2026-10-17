import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  Package,
  RefreshCw,
  RotateCcw,
  Truck,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ContactPicker, type ContactPick } from '@/components/contacts/ContactPicker'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { api, ApiClientError, isTenantSession } from '@/lib/api'
import { cn, formatCurrency, formatDateTime, formatPhone } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type Row = Record<string, unknown>
type Tab = 'ACTIVE' | 'OVERDUE' | 'RETURNED' | 'CANCELLED' | 'ALL'
type IssueStep = 1 | 2 | 3

function statusColor(s: string): 'blue' | 'amber' | 'red' | 'green' | 'gray' {
  if (s === 'ACTIVE') return 'blue'
  if (s === 'OVERDUE') return 'red'
  if (s === 'RETURNED') return 'green'
  if (s === 'CANCELLED') return 'gray'
  return 'gray'
}

function localDateTimeValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function plusOneMonthLocal(from: string) {
  const d = new Date(from)
  if (Number.isNaN(d.getTime())) return ''
  d.setMonth(d.getMonth() + 1)
  return localDateTimeValue(d)
}

function emptyIssueForm() {
  const start = localDateTimeValue()
  return {
    productId: '',
    stockUnitId: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerCompany: '',
    customerAddress: '',
    city: '',
    state: '',
    startAt: start,
    expectedReturnAt: plusOneMonthLocal(start),
    monthlyRate: '',
    dailyRate: '',
    depositAmount: '',
    totalAmount: '',
    notes: '',
  }
}

export function RentalsPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('ACTIVE')
  const [items, setItems] = useState<Row[]>([])
  const [summary, setSummary] = useState({
    active: 0,
    overdue: 0,
    returnedThisMonth: 0,
    cancelled: 0,
  })
  const [loading, setLoading] = useState(true)
  const [issueOpen, setIssueOpen] = useState(false)
  const [issueStep, setIssueStep] = useState<IssueStep>(1)
  const [confirmIssueOpen, setConfirmIssueOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [units, setUnits] = useState<Row[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [returnTarget, setReturnTarget] = useState<Row | null>(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [returning, setReturning] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null)
  const [cancelNotes, setCancelNotes] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [extendTarget, setExtendTarget] = useState<Row | null>(null)
  const [extendDue, setExtendDue] = useState('')
  const [extendMonthly, setExtendMonthly] = useState('')
  const [extendDeposit, setExtendDeposit] = useState('')
  const [extendNotes, setExtendNotes] = useState('')
  const [extending, setExtending] = useState(false)
  const [detail, setDetail] = useState<Row | null>(null)

  const [picked, setPicked] = useState<ContactPick | null>(null)
  const [intakeLeadId, setIntakeLeadId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyIssueForm)

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
      setSummary({
        active: sum.active,
        overdue: sum.overdue,
        returnedThisMonth: sum.returnedThisMonth,
        cancelled: sum.cancelled ?? 0,
      })
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
    setIssueStep(1)
    setForm(emptyIssueForm())
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
          setIssueStep(2)
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
    ])
      .then(([u, p]) => {
        setUnits(u as Row[])
        setProducts((p.items ?? []) as Row[])
      })
      .catch(() => {
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
        const wh = u.warehouse as { name?: string; code?: string } | null
        const uniq = u.hmsUniqId ? String(u.hmsUniqId) : ''
        const whLabel = wh?.code || wh?.name || ''
        return {
          value: String(u.id),
          label: [
            String(u.serialNo),
            p?.name,
            uniq ? `HMS ${uniq}` : '',
            whLabel ? `@ ${whLabel}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        }
      })
  }, [units, form.productId])

  const selectedUnit = useMemo(
    () => units.find((u) => String(u.id) === form.stockUnitId) ?? null,
    [units, form.stockUnitId],
  )

  const selectedProduct = useMemo(() => {
    const pid = form.productId || (selectedUnit ? String(selectedUnit.productId) : '')
    return products.find((p) => String(p.id) === pid) ?? null
  }, [products, form.productId, selectedUnit])

  function openIssue() {
    setPicked(null)
    setIntakeLeadId(null)
    setForm(emptyIssueForm())
    setIssueStep(1)
    setConfirmIssueOpen(false)
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

  function validateStep(step: IssueStep): boolean {
    if (step === 1) {
      if (!picked?.id) {
        addToast({ type: 'error', message: 'Select a CRM customer first' })
        return false
      }
      if (!form.customerName.trim()) {
        addToast({ type: 'error', message: 'Customer name is required' })
        return false
      }
      return true
    }
    if (step === 2) {
      if (!form.stockUnitId) {
        addToast({ type: 'error', message: 'Select the serial that is going out' })
        return false
      }
      return true
    }
    if (!form.startAt) {
      addToast({ type: 'error', message: 'Rental start is required' })
      return false
    }
    return true
  }

  function goNext() {
    if (!validateStep(issueStep)) return
    if (issueStep < 3) setIssueStep((s) => (s + 1) as IssueStep)
  }

  function requestIssue(e: FormEvent) {
    e.preventDefault()
    if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
      if (!picked?.id) setIssueStep(1)
      else if (!form.stockUnitId) setIssueStep(2)
      else setIssueStep(3)
      return
    }
    setConfirmIssueOpen(true)
  }

  async function submitIssue() {
    if (!picked?.id || !form.stockUnitId) return
    setSaving(true)
    try {
      const expected =
        form.expectedReturnAt.trim() || plusOneMonthLocal(form.startAt)
      await api.issueRental({
        stockUnitId: form.stockUnitId,
        contactId: picked.id,
        leadId: intakeLeadId || null,
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone || null,
        customerEmail: form.customerEmail || null,
        customerCompany: form.customerCompany || null,
        customerAddress: form.customerAddress || null,
        city: form.city || null,
        state: form.state || null,
        startAt: new Date(form.startAt).toISOString(),
        expectedReturnAt: expected ? new Date(expected).toISOString() : null,
        monthlyRate: form.monthlyRate ? Number(form.monthlyRate) : null,
        dailyRate: form.dailyRate ? Number(form.dailyRate) : null,
        depositAmount: form.depositAmount ? Number(form.depositAmount) : null,
        totalAmount: form.totalAmount ? Number(form.totalAmount) : null,
        notes: form.notes || null,
      })
      addToast({
        type: 'success',
        message: intakeLeadId
          ? 'Rental issued — linked to intake · stock reduced'
          : 'Rental issued — stock reduced by 1',
      })
      setConfirmIssueOpen(false)
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
      addToast({ type: 'success', message: 'Returned — stock restored (+1)' })
      setReturnTarget(null)
      setReturnNotes('')
      setDetail(null)
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

  async function confirmCancel() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await api.cancelRental(String(cancelTarget.id), cancelNotes)
      addToast({ type: 'success', message: 'Cancelled — stock restored (+1)' })
      setCancelTarget(null)
      setCancelNotes('')
      setDetail(null)
      setTab('CANCELLED')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Cancel failed',
      })
    } finally {
      setCancelling(false)
    }
  }

  function openExtend(r: Row) {
    setExtendTarget(r)
    setExtendDue(
      r.expectedReturnAt
        ? localDateTimeValue(new Date(String(r.expectedReturnAt)))
        : plusOneMonthLocal(localDateTimeValue()),
    )
    setExtendMonthly(r.monthlyRate != null ? String(r.monthlyRate) : '')
    setExtendDeposit(r.depositAmount != null ? String(r.depositAmount) : '')
    setExtendNotes(r.notes != null ? String(r.notes) : '')
  }

  async function confirmExtend() {
    if (!extendTarget) return
    if (!extendDue) {
      addToast({ type: 'error', message: 'Expected return date is required' })
      return
    }
    setExtending(true)
    try {
      await api.patchRental(String(extendTarget.id), {
        expectedReturnAt: new Date(extendDue).toISOString(),
        monthlyRate: extendMonthly ? Number(extendMonthly) : null,
        depositAmount: extendDeposit ? Number(extendDeposit) : null,
        notes: extendNotes || null,
      })
      addToast({ type: 'success', message: 'Rental terms updated' })
      setExtendTarget(null)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not update rental',
      })
    } finally {
      setExtending(false)
    }
  }

  const confirmSerial = selectedUnit ? String(selectedUnit.serialNo) : '—'
  const confirmProductName = selectedProduct
    ? String(selectedProduct.name)
    : selectedUnit
      ? String((selectedUnit.product as { name?: string } | null)?.name ?? 'Machine')
      : 'Machine'

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Card className="p-4">
          <div className="text-xs text-text-secondary">Cancelled</div>
          <div className="mt-1 text-2xl font-semibold text-text-secondary">
            {summary.cancelled}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {(
            [
              { id: 'ACTIVE', label: 'Out on rent' },
              { id: 'OVERDUE', label: 'Overdue' },
              { id: 'RETURNED', label: 'Returned' },
              { id: 'CANCELLED', label: 'Cancelled' },
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
            subtitle="Issue a machine on hire — pick CRM customer, IN_STOCK serial, monthly rate. Stock reduces by 1."
            actionLabel="Issue rental"
            onAction={openIssue}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-[13px]">
              <thead className="border-b border-border bg-muted/30 text-[12px] text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Rental #</th>
                  <th className="px-3 py-2.5 font-medium">Product / Serial</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Warehouse</th>
                  <th className="px-3 py-2.5 font-medium">Hire period</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Monthly / deposit</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const product = r.product as { id?: string; name?: string; sku?: string } | null
                  const unit = r.stockUnit as {
                    serialNo?: string
                    hmsUniqId?: string | null
                  } | null
                  const wh = r.fromWarehouse as { name?: string; code?: string } | null
                  const status = String(r.status)
                  const productId = r.productId != null ? String(r.productId) : product?.id
                  const contactId = r.contactId != null ? String(r.contactId) : ''
                  const leadId = r.leadId != null ? String(r.leadId) : ''
                  const active = status === 'ACTIVE' || status === 'OVERDUE'
                  return (
                    <tr key={String(r.id)} className="border-b border-border/70 hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          className="font-medium text-[color:var(--color-accent-blue)] hover:underline"
                          onClick={() => setDetail(r)}
                        >
                          {String(r.rentalNo)}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        {productId ? (
                          <Link
                            to={`/erp/products/${productId}`}
                            className="font-medium text-[color:var(--color-accent-blue)] hover:underline"
                          >
                            {product?.name ?? 'Product'}
                          </Link>
                        ) : (
                          <div className="font-medium">{product?.name ?? '—'}</div>
                        )}
                        <div className="text-[11px] text-text-secondary">
                          {unit?.serialNo ? (
                            <Link
                              to={`/erp/inventory?q=${encodeURIComponent(String(unit.serialNo))}`}
                              className="text-[color:var(--color-accent-blue)] hover:underline"
                            >
                              S/No {unit.serialNo}
                            </Link>
                          ) : (
                            <>S/No —</>
                          )}
                          {unit?.hmsUniqId ? ` · ${unit.hmsUniqId}` : ''}
                          {product?.sku ? ` · ${product.sku}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {contactId ? (
                          <Link
                            to={`/contacts/${contactId}`}
                            className="font-medium text-[color:var(--color-accent-blue)] hover:underline"
                          >
                            {String(r.customerName)}
                          </Link>
                        ) : (
                          <div className="font-medium">{String(r.customerName)}</div>
                        )}
                        <div className="text-[11px] text-text-secondary">
                          {[r.customerCompany, formatPhone(String(r.customerPhone ?? ''))]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                        {leadId ? (
                          <Link
                            to={`/sale-tracking/${leadId}`}
                            className="mt-0.5 block text-[11px] text-[color:var(--color-accent-blue)] hover:underline"
                          >
                            Open enquiry
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {wh?.code || wh?.name || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div>{formatDateTime(String(r.startAt))}</div>
                        <div
                          className={cn(
                            'text-[11px]',
                            status === 'OVERDUE'
                              ? 'font-medium text-red-500'
                              : 'text-text-secondary',
                          )}
                        >
                          →{' '}
                          {r.expectedReturnAt
                            ? formatDateTime(String(r.expectedReturnAt))
                            : '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge color={statusColor(status)}>{status}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">
                        {r.monthlyRate != null
                          ? `${formatCurrency(Number(r.monthlyRate))}/mo`
                          : r.dailyRate != null
                            ? `${formatCurrency(Number(r.dailyRate))}/day`
                            : '—'}
                        {r.depositAmount != null
                          ? ` · Dep ${formatCurrency(Number(r.depositAmount))}`
                          : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {active ? (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => openExtend(r)}>
                              <CalendarClock size={13} className="mr-1" />
                              Extend
                            </Button>
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
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCancelTarget(r)
                                setCancelNotes('')
                              }}
                            >
                              <XCircle size={13} className="mr-1" />
                              Cancel
                            </Button>
                          </div>
                        ) : null}
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
        onClose={() => {
          setIssueOpen(false)
          setConfirmIssueOpen(false)
        }}
        accent="sky"
        eyebrow="Service · Rentals"
        title="Issue rental"
        subtitle="One serial per rental. Stock reduces by 1 when you confirm."
        footer={
          <>
            <FormPanelCancel
              onClick={() => {
                setIssueOpen(false)
                setConfirmIssueOpen(false)
              }}
            />
            {issueStep > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIssueStep((s) => (s - 1) as IssueStep)}
              >
                Back
              </Button>
            ) : null}
            {issueStep < 3 ? (
              <Button type="button" onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button type="submit" form="issue-rental" disabled={saving}>
                Review & issue…
              </Button>
            )}
          </>
        }
      >
        <div className="mb-4 flex gap-2 text-xs font-medium">
          {([1, 2, 3] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (s < issueStep) setIssueStep(s)
              }}
              className={cn(
                'rounded-full px-3 py-1',
                issueStep === s
                  ? 'bg-[color:var(--color-accent-blue)] text-white'
                  : issueStep > s
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'bg-muted text-text-secondary',
              )}
            >
              {s === 1 ? '1 · Customer' : s === 2 ? '2 · Machine' : '3 · Terms'}
            </button>
          ))}
        </div>

        <form id="issue-rental" onSubmit={requestIssue} className="space-y-5">
          {issueStep === 1 ? (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">1. CRM customer *</h3>
              <ContactPicker
                label="Customer *"
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
          ) : null}

          {issueStep === 2 ? (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">2. Machine going out (IN_STOCK)</h3>
              <p className="text-xs text-text-secondary">
                Only warehouse serials marked IN_STOCK appear. Need two machines? Issue twice.
              </p>
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
              {selectedUnit ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                  <strong>S/No {String(selectedUnit.serialNo)}</strong>
                  {selectedUnit.hmsUniqId ? ` · ${String(selectedUnit.hmsUniqId)}` : ''}
                  {(selectedUnit.warehouse as { code?: string } | null)?.code
                    ? ` · ${(selectedUnit.warehouse as { code: string }).code}`
                    : ''}
                  {selectedUnit.stampingDate
                    ? ` · stamp ${String(selectedUnit.stampingDate).slice(0, 10)}`
                    : ''}
                </div>
              ) : null}
            </section>
          ) : null}

          {issueStep === 3 ? (
            <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock size={15} />
                3. Hire period & charges
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Rental start *"
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => {
                    const startAt = e.target.value
                    setForm((f) => ({
                      ...f,
                      startAt,
                      expectedReturnAt:
                        !f.expectedReturnAt ||
                        f.expectedReturnAt === plusOneMonthLocal(f.startAt)
                          ? plusOneMonthLocal(startAt)
                          : f.expectedReturnAt,
                    }))
                  }}
                />
                <Input
                  label="Expected return (default +1 month)"
                  type="datetime-local"
                  value={form.expectedReturnAt}
                  onChange={(e) => setForm({ ...form, expectedReturnAt: e.target.value })}
                />
                <Input
                  label="Monthly rate ₹"
                  type="number"
                  value={form.monthlyRate}
                  onChange={(e) => setForm({ ...form, monthlyRate: e.target.value })}
                />
                <Input
                  label="Deposit ₹"
                  type="number"
                  value={form.depositAmount}
                  onChange={(e) => setForm({ ...form, depositAmount: e.target.value })}
                />
                <Input
                  label="Daily rate ₹ (optional)"
                  type="number"
                  value={form.dailyRate}
                  onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
                />
                <Input
                  label="Agreed total ₹ (optional)"
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
          ) : null}
        </form>
      </FormPanel>

      <ConfirmModal
        open={confirmIssueOpen}
        onClose={() => setConfirmIssueOpen(false)}
        onConfirm={() => void submitIssue()}
        title="Confirm issue rental?"
        body={`Issue ${confirmProductName} · S/No ${confirmSerial} to ${form.customerName.trim() || 'customer'}. Warehouse stock will reduce by 1 and the serial becomes RENTED.`}
        confirmLabel={saving ? 'Issuing…' : 'Issue & deduct stock'}
        confirmVariant="primary"
      />

      <Modal
        open={Boolean(returnTarget)}
        onClose={() => {
          if (!returning) {
            setReturnTarget(null)
            setReturnNotes('')
          }
        }}
        title="Return rental to stock?"
        subtitle={
          returnTarget
            ? `${String(returnTarget.rentalNo)} — serial back to IN_STOCK (+1 qty)`
            : undefined
        }
        size="sm"
        accent="emerald"
        footer={
          <>
            <Button
              variant="outline"
              disabled={returning}
              onClick={() => {
                setReturnTarget(null)
                setReturnNotes('')
              }}
            >
              Cancel
            </Button>
            <Button disabled={returning} onClick={() => void confirmReturn()}>
              <RotateCcw size={14} />
              {returning ? 'Returning…' : 'Confirm return'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Stock is restored to the original warehouse. Optional notes are saved on the agreement.
        </p>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium text-text-secondary">Return notes</span>
          <textarea
            className="min-h-[72px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            placeholder="Condition on return, missing accessories…"
          />
        </label>
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => {
          if (!cancelling) {
            setCancelTarget(null)
            setCancelNotes('')
          }
        }}
        title="Cancel rental?"
        subtitle={
          cancelTarget
            ? `${String(cancelTarget.rentalNo)} — restores stock, marks CANCELLED`
            : undefined
        }
        size="sm"
        accent="amber"
        footer={
          <>
            <Button
              variant="outline"
              disabled={cancelling}
              onClick={() => {
                setCancelTarget(null)
                setCancelNotes('')
              }}
            >
              Keep rental
            </Button>
            <Button disabled={cancelling} onClick={() => void confirmCancel()}>
              <XCircle size={14} />
              {cancelling ? 'Cancelling…' : 'Cancel & restore stock'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Use cancel if the machine never went out or the hire was voided. Stock returns once —
          cannot cancel again.
        </p>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium text-text-secondary">Cancel reason</span>
          <textarea
            className="min-h-[72px] w-full rounded-[6px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent-blue"
            value={cancelNotes}
            onChange={(e) => setCancelNotes(e.target.value)}
            placeholder="Why this hire was cancelled…"
          />
        </label>
      </Modal>

      <Modal
        open={Boolean(extendTarget)}
        onClose={() => {
          if (!extending) setExtendTarget(null)
        }}
        title="Extend / update terms"
        subtitle={
          extendTarget ? String(extendTarget.rentalNo) : undefined
        }
        size="sm"
        accent="sky"
        footer={
          <>
            <Button variant="outline" disabled={extending} onClick={() => setExtendTarget(null)}>
              Close
            </Button>
            <Button disabled={extending} onClick={() => void confirmExtend()}>
              {extending ? 'Saving…' : 'Save terms'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input
            label="Expected return *"
            type="datetime-local"
            value={extendDue}
            onChange={(e) => setExtendDue(e.target.value)}
          />
          <Input
            label="Monthly rate ₹"
            type="number"
            value={extendMonthly}
            onChange={(e) => setExtendMonthly(e.target.value)}
          />
          <Input
            label="Deposit ₹"
            type="number"
            value={extendDeposit}
            onChange={(e) => setExtendDeposit(e.target.value)}
          />
          <Input
            label="Notes"
            value={extendNotes}
            onChange={(e) => setExtendNotes(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? String(detail.rentalNo) : 'Rental'}
        subtitle="Hire details"
        size="md"
        accent="sky"
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-secondary">Customer</dt>
              <dd className="font-medium">{String(detail.customerName)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Status</dt>
              <dd>
                <Badge color={statusColor(String(detail.status))}>
                  {String(detail.status)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Product</dt>
              <dd className="font-medium">
                {(detail.product as { name?: string } | null)?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Serial</dt>
              <dd className="font-mono font-medium">
                {(detail.stockUnit as { serialNo?: string } | null)?.serialNo ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Warehouse</dt>
              <dd>
                {(detail.fromWarehouse as { code?: string; name?: string } | null)?.code ||
                  (detail.fromWarehouse as { name?: string } | null)?.name ||
                  '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-secondary">Monthly / deposit</dt>
              <dd>
                {detail.monthlyRate != null
                  ? `${formatCurrency(Number(detail.monthlyRate))}/mo`
                  : '—'}
                {detail.depositAmount != null
                  ? ` · Dep ${formatCurrency(Number(detail.depositAmount))}`
                  : ''}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-secondary">Period</dt>
              <dd>
                {formatDateTime(String(detail.startAt))}
                {' → '}
                {detail.expectedReturnAt
                  ? formatDateTime(String(detail.expectedReturnAt))
                  : '—'}
              </dd>
            </div>
            {detail.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-text-secondary">Notes</dt>
                <dd className="whitespace-pre-wrap">{String(detail.notes)}</dd>
              </div>
            ) : null}
            {detail.returnNotes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-text-secondary">Return / cancel notes</dt>
                <dd className="whitespace-pre-wrap">{String(detail.returnNotes)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </div>
  )
}

export default RentalsPage
