import type { Dispatch, SetStateAction } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

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
  return { line1: line1 || null, line2: line2 || null, city: city || null, state: state || null, pincode: pincode || null, country: country || 'IN' }
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
    name: form.name,
    accountType: form.accountType || null,
    industry: form.industry || null,
    website: form.website || null,
    phone: form.phone || null,
    email: form.email || null,
    gstin: form.gstin || null,
    pan: form.pan || null,
    city: form.city || null,
    state: form.state || null,
    country: form.country || 'IN',
    ownerUserId: form.ownerUserId || null,
    annualRevenue: form.annualRevenue ? Number(form.annualRevenue) : null,
    employeeCount: form.employeeCount ? Number(form.employeeCount) : null,
    description: form.description || null,
    tags,
    billingAddress,
    shippingAddress,
    customFields,
  }
}

export function accountToForm(account: Record<string, unknown>): AccountFormState {
  const bill = (account.billingAddress as Record<string, string> | null) ?? {}
  const ship = (account.shippingAddress as Record<string, string> | null) ?? {}
  const cf = (account.customFields as Record<string, unknown> | null) ?? {}
  const tags = Array.isArray(account.tags) ? (account.tags as string[]).join(', ') : ''
  return {
    name: String(account.name ?? ''),
    accountType: String(account.accountType ?? 'Customer'),
    industry: String(account.industry ?? ''),
    website: String(account.website ?? ''),
    phone: String(account.phone ?? ''),
    email: String(account.email ?? ''),
    gstin: String(account.gstin ?? ''),
    pan: String(account.pan ?? ''),
    city: String(account.city ?? ''),
    state: String(account.state ?? 'Tamil Nadu'),
    country: String(account.country ?? 'IN'),
    ownerUserId: account.ownerUserId ? String(account.ownerUserId) : '',
    annualRevenue: account.annualRevenue != null ? String(account.annualRevenue) : '',
    employeeCount: account.employeeCount != null ? String(account.employeeCount) : '',
    description: String(account.description ?? ''),
    tags,
    billLine1: String(bill.line1 ?? ''),
    billLine2: String(bill.line2 ?? ''),
    billCity: String(bill.city ?? account.city ?? ''),
    billState: String(bill.state ?? account.state ?? 'Tamil Nadu'),
    billPincode: String(bill.pincode ?? ''),
    billCountry: String(bill.country ?? 'IN'),
    shipLine1: String(ship.line1 ?? ''),
    shipLine2: String(ship.line2 ?? ''),
    shipCity: String(ship.city ?? ''),
    shipState: String(ship.state ?? 'Tamil Nadu'),
    shipPincode: String(ship.pincode ?? ''),
    shipCountry: String(ship.country ?? 'IN'),
    sameAsBilling: !ship.line1 || JSON.stringify(bill) === JSON.stringify(ship),
    linkedIn: String(cf.linkedin ?? ''),
    paymentTerms: String(cf.payment_terms ?? 'Net 30'),
    creditLimit: cf.credit_limit != null ? String(cf.credit_limit) : '',
    notes: String(cf.notes ?? ''),
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-3 border-b border-border pb-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

export function AccountFormFields({
  form,
  setForm,
  users,
}: {
  form: AccountFormState
  setForm: Dispatch<SetStateAction<AccountFormState>>
  users: Array<{ id: string; name: string }>
}) {
  const set = (patch: Partial<AccountFormState>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div>
      <Section title="Company identity">
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
      </Section>

      <Section title="Contact">
        <Input
          label="Phone"
          placeholder="+91 98400 10001"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
        <Input
          label="Email"
          type="email"
          placeholder="accounts@company.in"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Section>

      <Section title="Tax & compliance">
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
      </Section>

      <Section title="Location">
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
      </Section>

      <Section title="Billing address">
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
      </Section>

      <div className="mb-3">
        <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent-blue"
            checked={form.sameAsBilling}
            onChange={(e) => set({ sameAsBilling: e.target.checked })}
          />
          Shipping same as billing
        </label>
      </div>

      {!form.sameAsBilling && (
        <Section title="Shipping address">
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
        </Section>
      )}

      <Section title="Commercial terms">
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
          label="LinkedIn / company page"
          placeholder="https://linkedin.com/company/…"
          value={form.linkedIn}
          onChange={(e) => set({ linkedIn: e.target.value })}
        />
      </Section>

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
    </div>
  )
}
