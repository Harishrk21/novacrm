import type { Dispatch, SetStateAction } from 'react'
import {
  Building2,
  ClipboardCheck,
  MapPin,
  MessageSquare,
  Phone,
  Receipt,
  Truck,
  Wallet,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { Select } from '@/components/ui/Select'
import {
  ReviewRow,
  ReviewSection,
  VerticalFormShell,
  type VerticalFormTab,
} from '@/components/ui/VerticalFormTabs'
import { indianMobileLocal, toStoredIndianMobile } from '@/lib/phoneIndia'
import { formatCurrency, formatPhone } from '@/lib/utils'

export type AccountFormState = {
  name: string
  accountType: string
  industry: string
  website: string
  phone: string
  email: string
  gstin: string
  pan: string
  city: string
  state: string
  country: string
  ownerUserId: string
  annualRevenue: string
  employeeCount: string
  description: string
  tags: string
  billLine1: string
  billLine2: string
  billCity: string
  billState: string
  billPincode: string
  billCountry: string
  shipLine1: string
  shipLine2: string
  shipCity: string
  shipState: string
  shipPincode: string
  shipCountry: string
  sameAsBilling: boolean
  linkedIn: string
  paymentTerms: string
  creditLimit: string
  notes: string
}

export type AccountFormStep =
  | 'identity'
  | 'contact'
  | 'tax'
  | 'location'
  | 'billing'
  | 'shipping'
  | 'commercial'
  | 'notes'
  | 'review'

export function emptyAccountForm(): AccountFormState {
  return {
    name: '',
    accountType: 'Customer',
    industry: '',
    website: '',
    phone: '',
    email: '',
    gstin: '',
    pan: '',
    city: '',
    state: 'Tamil Nadu',
    country: 'IN',
    ownerUserId: '',
    annualRevenue: '',
    employeeCount: '',
    description: '',
    tags: '',
    billLine1: '',
    billLine2: '',
    billCity: '',
    billState: 'Tamil Nadu',
    billPincode: '',
    billCountry: 'IN',
    shipLine1: '',
    shipLine2: '',
    shipCity: '',
    shipState: 'Tamil Nadu',
    shipPincode: '',
    shipCountry: 'IN',
    sameAsBilling: true,
    linkedIn: '',
    paymentTerms: 'Net 30',
    creditLimit: '',
    notes: '',
  }
}

function addr(
  line1: string,
  line2: string,
  city: string,
  state: string,
  pincode: string,
  country: string,
) {
  if (!line1 && !city && !pincode) return null
  return {
    line1: line1 || null,
    line2: line2 || null,
    city: city || null,
    state: state || null,
    pincode: pincode || null,
    country: country || 'IN',
  }
}

export function formToPayload(form: AccountFormState) {
  const billingAddress = addr(
    form.billLine1,
    form.billLine2,
    form.billCity || form.city,
    form.billState || form.state,
    form.billPincode,
    form.billCountry,
  )
  const shippingAddress = form.sameAsBilling
    ? billingAddress
    : addr(
        form.shipLine1,
        form.shipLine2,
        form.shipCity,
        form.shipState,
        form.shipPincode,
        form.shipCountry,
      )
  const tags = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const customFields: Record<string, unknown> = {}
  if (form.linkedIn) customFields.linkedin = form.linkedIn
  if (form.paymentTerms) customFields.payment_terms = form.paymentTerms
  if (form.creditLimit) customFields.credit_limit = Number(form.creditLimit)
  if (form.notes) customFields.notes = form.notes

  return {
    name: form.name.trim(),
    accountType: form.accountType || null,
    industry: form.industry.trim() || null,
    website: form.website.trim() || null,
    phone: form.phone ? toStoredIndianMobile(form.phone) : null,
    email: form.email.trim() || null,
    gstin: form.gstin.trim() || null,
    pan: form.pan.trim() || null,
    city: form.city.trim() || null,
    state: form.state.trim() || null,
    country: form.country.trim() || 'IN',
    ownerUserId: form.ownerUserId || null,
    annualRevenue: form.annualRevenue ? Number(form.annualRevenue) : null,
    employeeCount: form.employeeCount ? Number(form.employeeCount) : null,
    description: form.description.trim() || null,
    tags,
    billingAddress,
    shippingAddress,
    customFields: Object.keys(customFields).length ? customFields : undefined,
  }
}

export function accountToForm(account: Record<string, unknown>): AccountFormState {
  const cf = (account.customFields as Record<string, unknown>) ?? {}
  const bill = (account.billingAddress as Record<string, unknown> | null) ?? {}
  const ship = (account.shippingAddress as Record<string, unknown> | null) ?? {}
  const tags = Array.isArray(account.tags)
    ? (account.tags as string[]).join(', ')
    : String(account.tags ?? '')
  const sameAsBilling =
    !ship.line1 && !ship.city && !ship.pincode
      ? true
      : JSON.stringify(bill) === JSON.stringify(ship)

  return {
    name: String(account.name ?? ''),
    accountType: String(account.accountType ?? 'Customer'),
    industry: String(account.industry ?? ''),
    website: String(account.website ?? ''),
    phone: indianMobileLocal(String(account.phone ?? '')),
    email: String(account.email ?? ''),
    gstin: String(account.gstin ?? ''),
    pan: String(account.pan ?? ''),
    city: String(account.city ?? ''),
    state: String(account.state ?? 'Tamil Nadu'),
    country: String(account.country ?? 'IN'),
    ownerUserId: String(account.ownerUserId ?? ''),
    annualRevenue: account.annualRevenue != null ? String(account.annualRevenue) : '',
    employeeCount: account.employeeCount != null ? String(account.employeeCount) : '',
    description: String(account.description ?? ''),
    tags,
    billLine1: String(bill.line1 ?? ''),
    billLine2: String(bill.line2 ?? ''),
    billCity: String(bill.city ?? ''),
    billState: String(bill.state ?? 'Tamil Nadu'),
    billPincode: String(bill.pincode ?? ''),
    billCountry: String(bill.country ?? 'IN'),
    shipLine1: String(ship.line1 ?? ''),
    shipLine2: String(ship.line2 ?? ''),
    shipCity: String(ship.city ?? ''),
    shipState: String(ship.state ?? 'Tamil Nadu'),
    shipPincode: String(ship.pincode ?? ''),
    shipCountry: String(ship.country ?? 'IN'),
    sameAsBilling,
    linkedIn: String(cf.linkedin ?? ''),
    paymentTerms: String(cf.payment_terms ?? 'Net 30'),
    creditLimit: cf.credit_limit != null ? String(cf.credit_limit) : '',
    notes: String(cf.notes ?? ''),
  }
}

function formatAddr(
  line1: string,
  line2: string,
  city: string,
  state: string,
  pincode: string,
  country: string,
) {
  return [line1, line2, [city, state].filter(Boolean).join(', '), pincode, country]
    .filter((p) => p && String(p).trim())
    .join(' · ')
}

export function accountFormSteps(form: AccountFormState): AccountFormStep[] {
  const steps: AccountFormStep[] = [
    'identity',
    'contact',
    'tax',
    'location',
    'billing',
  ]
  if (!form.sameAsBilling) steps.push('shipping')
  steps.push('commercial', 'notes', 'review')
  return steps
}

export function AccountFormFields({
  form,
  setForm,
  users,
  step,
  onStepChange,
}: {
  form: AccountFormState
  setForm: Dispatch<SetStateAction<AccountFormState>>
  users: Array<{ id: string; name: string }>
  step: AccountFormStep
  onStepChange: (id: AccountFormStep) => void
}) {
  const set = (patch: Partial<AccountFormState>) => setForm((f) => ({ ...f, ...patch }))
  const ownerName = users.find((u) => u.id === form.ownerUserId)?.name

  const tabs: VerticalFormTab[] = [
    { id: 'identity', label: 'Identity', icon: Building2 },
    { id: 'contact', label: 'Contact', icon: Phone },
    { id: 'tax', label: 'Tax', icon: Receipt },
    { id: 'location', label: 'Location', icon: MapPin },
    { id: 'billing', label: 'Billing', icon: MapPin },
    ...(!form.sameAsBilling
      ? [{ id: 'shipping', label: 'Shipping', icon: Truck } satisfies VerticalFormTab]
      : []),
    { id: 'commercial', label: 'Commercial', icon: Wallet },
    { id: 'notes', label: 'Notes', icon: MessageSquare },
    { id: 'review', label: 'Review', icon: ClipboardCheck },
  ]

  return (
    <VerticalFormShell
      tabs={tabs}
      active={step}
      onChange={(id) => onStepChange(id as AccountFormStep)}
      accent="theme"
      title="Steps"
    >
      {step === 'identity' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Company name *"
            placeholder="e.g. Chennai Port Logistics"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            required
          />
          <Select
            label="Account type"
            value={form.accountType}
            onChange={(e) => set({ accountType: e.target.value })}
            options={['Customer', 'Dealer', 'Distributor', 'Partner', 'Prospect'].map((v) => ({
              value: v,
              label: v,
            }))}
          />
          <Input
            label="Industry"
            placeholder="e.g. Logistics, Manufacturing"
            value={form.industry}
            onChange={(e) => set({ industry: e.target.value })}
          />
          <Input
            label="Website"
            placeholder="https://company.in"
            value={form.website}
            onChange={(e) => set({ website: e.target.value })}
          />
          <Select
            label="Owner"
            value={form.ownerUserId}
            onChange={(e) => set({ ownerUserId: e.target.value })}
            options={[
              { value: '', label: 'Select owner' },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <Input
            label="Tags"
            placeholder="vip, tn-south, weighing"
            value={form.tags}
            onChange={(e) => set({ tags: e.target.value })}
          />
        </div>
      ) : null}

      {step === 'contact' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <PhoneInput
            label="Phone"
            value={form.phone}
            onChange={(phone) => set({ phone })}
            hint="India (+91) — 10 digits"
          />
          <Input
            label="Email"
            type="email"
            placeholder="accounts@company.in"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        </div>
      ) : null}

      {step === 'tax' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="GSTIN"
            placeholder="33AABCP1001A1Z1"
            value={form.gstin}
            onChange={(e) => set({ gstin: e.target.value })}
          />
          <Input
            label="PAN"
            placeholder="AABCP1001A"
            value={form.pan}
            onChange={(e) => set({ pan: e.target.value })}
          />
        </div>
      ) : null}

      {step === 'location' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="City"
            placeholder="Chennai"
            value={form.city}
            onChange={(e) => set({ city: e.target.value })}
          />
          <Input
            label="State"
            placeholder="Tamil Nadu"
            value={form.state}
            onChange={(e) => set({ state: e.target.value })}
          />
          <Input
            label="Country"
            placeholder="IN"
            value={form.country}
            onChange={(e) => set({ country: e.target.value })}
          />
          <Input
            label="Employees"
            type="number"
            placeholder="50"
            value={form.employeeCount}
            onChange={(e) => set({ employeeCount: e.target.value })}
          />
          <Input
            label="Annual revenue ₹"
            type="number"
            placeholder="2500000"
            value={form.annualRevenue}
            onChange={(e) => set({ annualRevenue: e.target.value })}
          />
        </div>
      ) : null}

      {step === 'billing' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Address line 1"
              placeholder="Plot 12, Industrial Estate"
              value={form.billLine1}
              onChange={(e) => set({ billLine1: e.target.value })}
            />
            <Input
              label="Address line 2"
              placeholder="Near port gate"
              value={form.billLine2}
              onChange={(e) => set({ billLine2: e.target.value })}
            />
            <Input
              label="City"
              placeholder="Chennai"
              value={form.billCity}
              onChange={(e) => set({ billCity: e.target.value })}
            />
            <Input
              label="State"
              placeholder="Tamil Nadu"
              value={form.billState}
              onChange={(e) => set({ billState: e.target.value })}
            />
            <Input
              label="Pincode"
              placeholder="600001"
              value={form.billPincode}
              onChange={(e) => set({ billPincode: e.target.value })}
            />
            <Input
              label="Country"
              placeholder="IN"
              value={form.billCountry}
              onChange={(e) => set({ billCountry: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent-blue"
              checked={form.sameAsBilling}
              onChange={(e) => {
                const sameAsBilling = e.target.checked
                set({ sameAsBilling })
                if (sameAsBilling && step === 'shipping') onStepChange('billing')
              }}
            />
            Shipping same as billing
          </label>
        </div>
      ) : null}

      {step === 'shipping' && !form.sameAsBilling ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Address line 1"
            placeholder="Warehouse road"
            value={form.shipLine1}
            onChange={(e) => set({ shipLine1: e.target.value })}
          />
          <Input
            label="Address line 2"
            placeholder="Unit B"
            value={form.shipLine2}
            onChange={(e) => set({ shipLine2: e.target.value })}
          />
          <Input
            label="City"
            placeholder="Chennai"
            value={form.shipCity}
            onChange={(e) => set({ shipCity: e.target.value })}
          />
          <Input
            label="State"
            placeholder="Tamil Nadu"
            value={form.shipState}
            onChange={(e) => set({ shipState: e.target.value })}
          />
          <Input
            label="Pincode"
            placeholder="600001"
            value={form.shipPincode}
            onChange={(e) => set({ shipPincode: e.target.value })}
          />
          <Input
            label="Country"
            placeholder="IN"
            value={form.shipCountry}
            onChange={(e) => set({ shipCountry: e.target.value })}
          />
        </div>
      ) : null}

      {step === 'commercial' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Payment terms"
            placeholder="Net 30"
            value={form.paymentTerms}
            onChange={(e) => set({ paymentTerms: e.target.value })}
          />
          <Input
            label="Credit limit ₹"
            type="number"
            placeholder="500000"
            value={form.creditLimit}
            onChange={(e) => set({ creditLimit: e.target.value })}
          />
          <Input
            className="sm:col-span-2"
            label="LinkedIn / company page"
            placeholder="https://linkedin.com/company/…"
            value={form.linkedIn}
            onChange={(e) => set({ linkedIn: e.target.value })}
          />
        </div>
      ) : null}

      {step === 'notes' ? (
        <div className="grid gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">Description</span>
            <textarea
              className="min-h-20 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder="What they buy, key decision makers, site notes…"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">Internal notes</span>
            <textarea
              className="min-h-16 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder="Private notes for your team only"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </label>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-100">
            Review everything below. Use <strong>Edit</strong> on a section if something needs changing,
            then Save.
          </div>
          <ReviewSection title="Identity" onEdit={() => onStepChange('identity')}>
            <ReviewRow label="Company" value={form.name} />
            <ReviewRow label="Type" value={form.accountType} />
            <ReviewRow label="Industry" value={form.industry} />
            <ReviewRow label="Website" value={form.website} />
            <ReviewRow label="Owner" value={ownerName} />
            <ReviewRow label="Tags" value={form.tags} />
          </ReviewSection>
          <ReviewSection title="Contact" onEdit={() => onStepChange('contact')}>
            <ReviewRow
              label="Phone"
              value={form.phone ? formatPhone(toStoredIndianMobile(form.phone)) : ''}
            />
            <ReviewRow label="Email" value={form.email} />
          </ReviewSection>
          <ReviewSection title="Tax" onEdit={() => onStepChange('tax')}>
            <ReviewRow label="GSTIN" value={form.gstin} />
            <ReviewRow label="PAN" value={form.pan} />
          </ReviewSection>
          <ReviewSection title="Location" onEdit={() => onStepChange('location')}>
            <ReviewRow
              label="Place"
              value={[form.city, form.state, form.country].filter(Boolean).join(', ')}
            />
            <ReviewRow label="Employees" value={form.employeeCount} />
            <ReviewRow
              label="Annual revenue"
              value={form.annualRevenue ? formatCurrency(Number(form.annualRevenue)) : ''}
            />
          </ReviewSection>
          <ReviewSection title="Billing" onEdit={() => onStepChange('billing')}>
            <ReviewRow
              label="Address"
              value={formatAddr(
                form.billLine1,
                form.billLine2,
                form.billCity || form.city,
                form.billState || form.state,
                form.billPincode,
                form.billCountry,
              )}
            />
            {form.sameAsBilling ? (
              <ReviewRow label="Shipping" value="Same as billing" />
            ) : null}
          </ReviewSection>
          {!form.sameAsBilling ? (
            <ReviewSection title="Shipping" onEdit={() => onStepChange('shipping')}>
              <ReviewRow
                label="Address"
                value={formatAddr(
                  form.shipLine1,
                  form.shipLine2,
                  form.shipCity,
                  form.shipState,
                  form.shipPincode,
                  form.shipCountry,
                )}
              />
            </ReviewSection>
          ) : null}
          <ReviewSection title="Commercial" onEdit={() => onStepChange('commercial')}>
            <ReviewRow label="Payment terms" value={form.paymentTerms} />
            <ReviewRow
              label="Credit limit"
              value={form.creditLimit ? formatCurrency(Number(form.creditLimit)) : ''}
            />
            <ReviewRow label="LinkedIn" value={form.linkedIn} />
          </ReviewSection>
          <ReviewSection title="Notes" onEdit={() => onStepChange('notes')}>
            <ReviewRow label="Description" value={form.description} />
            <ReviewRow label="Internal notes" value={form.notes} />
          </ReviewSection>
        </div>
      ) : null}
    </VerticalFormShell>
  )
}
