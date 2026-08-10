import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { emptyAccountForm, AccountFormFields, formToPayload, type AccountFormState } from '@/components/accounts/AccountFormFields'

export function AccountsPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const tip = DEFAULT_TIPS['crm.accounts'] ?? {
    title: 'Accounts',
    body: 'Companies / customers you sell to. Link contacts, deals and invoices here.',
    tipType: 'TIP' as const,
  }

  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<AccountFormState>(emptyAccountForm())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [res, lookups] = await Promise.all([
        api.accounts({ limit: 100, search: search || undefined }),
        api.lookups(),
      ])
      setItems(res.items ?? [])
      setUsers(lookups.users)
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to load accounts'
      setLoadError(message)
      addToast({ type: 'error', message })
    } finally {
      setLoading(false)
    }
  }, [addToast, search])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    try {
      const created = await api.createAccount(formToPayload(form))
      setOpen(false)
      setForm(emptyAccountForm())
      addToast({ type: 'success', message: 'Account saved' })
      window.location.href = `/accounts/${created.id}`
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    }
  }

  return (
    <div>
      <PageHeader
        title="Accounts"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Accounts' }]}
        actions={
          <Button
            onClick={() => {
              setForm(emptyAccountForm())
              setOpen(true)
            }}
          >
            <Plus size={16} /> Add account
          </Button>
        }
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <Card padding={false}>
        <div className="border-b border-border p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={16} />
            <Input
              className="pl-9"
              placeholder="Search company, GSTIN, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-text-secondary">Loading accounts from database…</p>
        ) : loadError && items.length === 0 ? (
          <EmptyState
            icon={<Building2 size={26} />}
            title="Could not load accounts"
            subtitle={loadError}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Building2 size={26} />}
            title="No accounts"
            subtitle="Add customer companies to bill and track deals."
            actionLabel="Add account"
            onAction={() => setOpen(true)}
          />
        ) : (
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-surface text-xs text-text-secondary">
              <tr className="border-b border-border">
                {['Company', 'Type', 'Industry', 'GSTIN', 'City', 'Phone', 'Revenue'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((account) => (
                <tr
                  key={String(account.id)}
                  className="cursor-pointer border-b border-border hover:bg-surface"
                  onClick={() => navigate(`/accounts/${account.id}`)}
                >
                  <td className="px-4 py-3">
                    <Link
                      className="font-medium text-accent-blue hover:underline"
                      to={`/accounts/${account.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {String(account.name)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color="blue">{String(account.accountType || '—')}</Badge>
                  </td>
                  <td className="px-4 py-3">{String(account.industry || '—')}</td>
                  <td className="px-4 py-3 font-mono text-xs">{String(account.gstin || '—')}</td>
                  <td className="px-4 py-3">{[account.city, account.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3">{String(account.phone || '—')}</td>
                  <td className="px-4 py-3">
                    {account.annualRevenue ? formatCurrency(num(account.annualRevenue)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add account"
        subtitle="Full company profile — tax, addresses, owner and commercial terms."
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-account">
              Save account
            </Button>
          </>
        }
      >
        <form id="add-account" onSubmit={handleCreate} className="max-h-[70vh] overflow-y-auto pr-1">
          <AccountFormFields form={form} setForm={setForm} users={users} />
        </form>
      </Modal>
    </div>
  )
}
