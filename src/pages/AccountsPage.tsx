import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal } from '@/components/ui/Modal'
import { PageTabs } from '@/components/ui/PageTabs'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip, DEFAULT_TIPS } from '@/components/tips/FeatureTip'
import { useRowSelection } from '@/hooks/useRowSelection'
import { usePagedRows } from '@/hooks/usePagedRows'
import { PaginationBar } from '@/components/ui/PaginationBar'
import { api, ApiClientError, num } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import {
  emptyAccountForm,
  AccountFormFields,
  accountFormSteps,
  formToPayload,
  type AccountFormState,
  type AccountFormStep,
} from '@/components/accounts/AccountFormFields'
import { TableSkeleton } from '@/components/ui/Skeleton'

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
  const [tab, setTab] = useState<'list' | 'create'>('list')
  const [form, setForm] = useState<AccountFormState>(emptyAccountForm())
  const [accountStep, setAccountStep] = useState<AccountFormStep>('identity')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const paged = usePagedRows(items, search)
  const ids = useMemo(() => items.map((i) => String(i.id)), [items])
  const selection = useRowSelection(ids)

  const lookupsReadyRef = useRef(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const needLookups = !lookupsReadyRef.current
      const [res, lookups] = await Promise.all([
        api.accounts({ limit: 100, search: search || undefined }),
        needLookups ? api.lookups() : Promise.resolve(null),
      ])
      setItems(res.items ?? [])
      if (lookups) {
        setUsers(lookups.users)
        lookupsReadyRef.current = true
      }
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Failed to load accounts'
      setLoadError(message)
      addToast({ type: 'error', message })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [addToast, search])

  useEffect(() => {
    void load()
  }, [load])

  const createSteps = accountFormSteps(form)
  const createStepIdx = Math.max(0, createSteps.indexOf(accountStep))
  const onReviewStep = accountStep === 'review'

  function resetCreate() {
    setTab('list')
    setForm(emptyAccountForm())
    setAccountStep('identity')
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!onReviewStep) {
      const next = createSteps[createStepIdx + 1]
      if (next) setAccountStep(next)
      return
    }
    if (!form.name.trim()) {
      addToast({ type: 'error', message: 'Company name is required' })
      setAccountStep('identity')
      return
    }
    try {
      const created = await api.createAccount(formToPayload(form))
      resetCreate()
      addToast({ type: 'success', message: 'Account saved' })
      window.location.href = `/accounts/${created.id}`
    } catch (err) {
      addToast({ type: 'error', message: err instanceof ApiClientError ? err.message : 'Create failed' })
    }
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteAccount(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      selection.clear()
      await load({ silent: true })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not delete',
      })
    } finally {
      setBusyDelete(false)
      setConfirm(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Accounts"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Accounts' }]}
      />
      <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />

      <PageTabs
        accent="theme"
        active={tab}
        onChange={(id) => {
          setTab(id as 'list' | 'create')
          if (id === 'create') {
            setForm(emptyAccountForm())
            setAccountStep('identity')
          }
        }}
        tabs={[
          { id: 'list', label: 'All accounts', count: items.length },
          { id: 'create', label: 'Add account' },
        ]}
      />

      {tab === 'list' ? (
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
          {loading && items.length === 0 ? (
            <TableSkeleton rows={8} />
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
              onAction={() => setTab('create')}
            />
          ) : (
            <div className="p-4 pt-3">
              {selection.someSelected ? (
                <BulkActionBar
                  count={selection.selectedCount}
                  noun="account"
                  busy={busyDelete}
                  onClear={selection.clear}
                  onDelete={() => setConfirm({ ids: selection.selectedIds })}
                />
              ) : null}
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-surface text-xs text-text-secondary">
                  <tr className="border-b border-border">
                    <th className="w-10 px-4 py-3">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected && !selection.allSelected}
                        onChange={selection.toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    {['Company', 'Type', 'Industry', 'GSTIN', 'City', 'Phone', 'Revenue', 'Actions'].map(
                      (h) => (
                        <th key={h} className="px-4 py-3 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((account) => {
                    const id = String(account.id)
                    return (
                      <tr
                        key={id}
                        className="cursor-pointer border-b border-border hover:bg-surface"
                        onClick={() => navigate(`/accounts/${id}`)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <SelectCheckbox
                            checked={selection.isSelected(id)}
                            onChange={() => selection.toggle(id)}
                            aria-label={`Select ${String(account.name)}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            className="font-medium text-accent-blue hover:underline"
                            to={`/accounts/${id}`}
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
                        <td className="px-4 py-3">
                          {[account.city, account.state].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3">{String(account.phone || '—')}</td>
                        <td className="px-4 py-3">
                          {account.annualRevenue ? formatCurrency(num(account.annualRevenue)) : '—'}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            <ViewIconButton onClick={() => navigate(`/accounts/${id}`)} />
                            <DeleteIconButton
                              disabled={busyDelete}
                              onClick={() => setConfirm({ ids: [id] })}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <PaginationBar page={paged.page} total={paged.total} onPageChange={paged.setPage} />
            </div>
          )}
        </Card>
      ) : (
        <FormPanel
          open
          accent="theme"
          eyebrow="Companies"
          title="Add account"
          width={760}
          subtitle="Step through the profile, then review everything before saving."
          onClose={resetCreate}
          footer={
            <>
              <FormPanelCancel onClick={resetCreate} />
              {createStepIdx > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const prev = createSteps[createStepIdx - 1]
                    if (prev) setAccountStep(prev)
                  }}
                >
                  Back
                </Button>
              ) : null}
              <Button type="submit" form="add-account">
                {onReviewStep ? 'Save account' : 'Next'}
              </Button>
            </>
          }
        >
          <form id="add-account" onSubmit={handleCreate}>
            <AccountFormFields
              form={form}
              setForm={setForm}
              users={users}
              step={accountStep}
              onStepChange={setAccountStep}
            />
          </form>
        </FormPanel>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete account?' : `Delete ${confirm?.ids.length ?? 0} accounts?`}
        body={
          confirm?.ids.length === 1
            ? 'This account will be permanently removed.'
            : 'Selected accounts will be permanently removed.'
        }
      />
    </div>
  )
}
