import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Briefcase, HelpCircle, Kanban, LayoutList, Plus } from 'lucide-react'
import { FeatureTip } from '@/components/tips/FeatureTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
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
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

type Stage = {
  id: string
  name: string
  code: string
  colorHex?: string
  probability: number
  isWon?: boolean
  isLost?: boolean
}

type DealRow = {
  id: string
  name: string
  amount: number
  stageId: string
  probability: number
  priority: string
  expectedCloseDate?: string | null
  contactId?: string | null
  accountId?: string | null
  ownerUserId?: string | null
  description?: string | null
}

export function DealsPage() {
  const navigate = useNavigate()
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const isAgent = authUser?.role === 'AGENT'
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<DealRow[]>([])
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; accountId?: string }>>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    amount: '',
    stageId: '',
    expectedCloseDate: '',
    contactId: '',
    accountId: '',
    ownerUserId: '',
    priority: 'MEDIUM',
    description: '',
  })
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const dealIds = useMemo(() => deals.map((d) => d.id), [deals])
  const selection = useRowSelection(dealIds)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pipeline, dealsRes, lookups] = await Promise.all([
        api.dealsPipeline(),
        api.deals({
          limit: 200,
          ...(isAgent && authUser?.id ? { ownerUserId: authUser.id } : {}),
        }),
        api.lookups(),
      ])
      setStages(pipeline)
      setDeals(
        (dealsRes.items ?? []).map((d) => ({
          id: String(d.id),
          name: String(d.name),
          amount: num(d.amount),
          stageId: String(d.stageId),
          probability: num(d.probability),
          priority: String(d.priority ?? 'MEDIUM'),
          expectedCloseDate: d.expectedCloseDate ? String(d.expectedCloseDate) : null,
          contactId: d.contactId ? String(d.contactId) : null,
          accountId: d.accountId ? String(d.accountId) : null,
          ownerUserId: d.ownerUserId ? String(d.ownerUserId) : null,
          description: d.description ? String(d.description) : null,
        })),
      )
      setContacts(lookups.contacts)
      setAccounts(lookups.accounts)
      setUsers(lookups.users)
      setForm((f) => ({
        ...f,
        stageId: f.stageId || pipeline[0]?.id || '',
        ownerUserId: f.ownerUserId || lookups.users[0]?.id || '',
      }))
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load deals',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast, authUser?.id, isAgent])

  useEffect(() => {
    void load()
  }, [load])

  const stageMap = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages])
  const contactName = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c.name])),
    [contacts],
  )
  const accountName = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts],
  )
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])), [users])

  const pipelineValue = useMemo(
    () => deals.reduce((s, d) => s + (stageMap[d.stageId]?.isWon || stageMap[d.stageId]?.isLost ? 0 : d.amount), 0),
    [deals, stageMap],
  )
  const wonValue = useMemo(
    () => deals.filter((d) => stageMap[d.stageId]?.isWon).reduce((s, d) => s + d.amount, 0),
    [deals, stageMap],
  )

  const weightedForecast = useMemo(
    () =>
      deals
        .filter((d) => !stageMap[d.stageId]?.isWon && !stageMap[d.stageId]?.isLost)
        .reduce((s, d) => s + (d.amount * d.probability) / 100, 0),
    [deals, stageMap],
  )
  const wonCount = useMemo(
    () => deals.filter((d) => stageMap[d.stageId]?.isWon).length,
    [deals, stageMap],
  )
  const lostCount = useMemo(
    () => deals.filter((d) => stageMap[d.stageId]?.isLost).length,
    [deals, stageMap],
  )
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0

  const stageStats = useMemo(
    () =>
      stages.map((stage) => {
        const column = deals.filter((d) => d.stageId === stage.id)
        return {
          ...stage,
          count: column.length,
          value: column.reduce((s, d) => s + d.amount, 0),
        }
      }),
    [stages, deals],
  )

  async function handleDragEnd(event: DragEndEvent) {
    const dealId = String(event.active.id)
    const nextStageId = event.over?.id ? String(event.over.id) : ''
    const deal = deals.find((d) => d.id === dealId)
    if (!deal || !nextStageId || deal.stageId === nextStageId) return
    const stage = stageMap[nextStageId]
    if (!stage) return
    const prev = deal.stageId
    setDeals((rows) =>
      rows.map((d) =>
        d.id === dealId ? { ...d, stageId: nextStageId, probability: stage.probability } : d,
      ),
    )
    try {
      await api.moveDeal(dealId, nextStageId)
      addToast({ type: 'success', message: `Moved to ${stage.name}` })
    } catch (err) {
      setDeals((rows) => rows.map((d) => (d.id === dealId ? { ...d, stageId: prev } : d)))
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not move deal',
      })
    }
  }

  async function handleAddDeal(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.stageId) {
      addToast({ type: 'error', message: 'Deal name and stage are required' })
      return
    }
    setSaving(true)
    try {
      await api.createDeal({
        name: form.name.trim(),
        amount: Number(form.amount) || 0,
        stageId: form.stageId,
        expectedCloseDate: form.expectedCloseDate || null,
        contactId: form.contactId || null,
        accountId: form.accountId || null,
        ownerUserId: form.ownerUserId || null,
        priority: form.priority,
        description: form.description.trim() || null,
      })
      setAddOpen(false)
      setForm((f) => ({
        ...f,
        name: '',
        amount: '',
        expectedCloseDate: '',
        contactId: '',
        accountId: '',
        description: '',
      }))
      addToast({ type: 'success', message: 'Deal created in pipeline' })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create deal',
      })
    } finally {
      setSaving(false)
    }
  }

  async function removeDeal(id: string, name: string) {
    try {
      await api.deleteDeal(id)
      addToast({ type: 'success', message: `${name} removed` })
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Delete failed',
      })
    }
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteDeal(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Deleted' : `${deleteIds.length} deleted`,
      })
      selection.clear()
      await load()
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
        title="Deals"
        count={deals.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Deals' }]}
        actions={
          <>
            <div className="flex rounded-[6px] border border-border bg-card p-0.5">
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-sm',
                  view === 'kanban' ? 'bg-accent-blue text-white' : 'text-text-secondary',
                )}
                onClick={() => setView('kanban')}
              >
                <Kanban size={15} /> Board
              </button>
              <button
                type="button"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-sm',
                  view === 'list' ? 'bg-accent-blue text-white' : 'text-text-secondary',
                )}
                onClick={() => setView('list')}
              >
                <LayoutList size={15} /> List
              </button>
            </div>
            <Button onClick={() => setAddOpen((v) => !v)} variant={addOpen ? 'outline' : 'primary'}>
              <Plus size={16} /> {addOpen ? 'Close form' : 'Add deal'}
            </Button>
          </>
        }
      />

      <FeatureTip
        title="Sales pipeline"
        body="Each card is an open opportunity. Drag across stages as the sale progresses. When you reach Won, open the deal and create an invoice."
        tipType="BEST_PRACTICE"
      />

      <FormPanel
        open={addOpen}
        accent="violet"
        eyebrow="Deals"
        title="Add deal"
        subtitle="Track a sales opportunity through your pipeline stages."
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setAddOpen(false)} />
            <Button type="submit" form="add-deal-form" disabled={saving}>
              {saving ? 'Saving…' : 'Create deal'}
            </Button>
          </>
        }
      >
        <form id="add-deal-form" onSubmit={(e) => void handleAddDeal(e)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            className="sm:col-span-2 lg:col-span-3"
            label="Deal name *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. 50kg platform scale — ABC Traders"
          />
          <Input
            label="Deal value ₹"
            type="number"
            placeholder="e.g. 185000"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <Input
            label="Expected close"
            type="date"
            value={form.expectedCloseDate}
            onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
          />
          <Select
            label="Stage *"
            value={form.stageId}
            onChange={(e) => setForm({ ...form, stageId: e.target.value })}
            options={[
              { value: '', label: 'Select stage' },
              ...stages.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <Select
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={[
              { value: 'LOW', label: 'Low' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'HIGH', label: 'High' },
            ]}
          />
          <Select
            label="Contact"
            value={form.contactId}
            onChange={(e) => {
              const c = contacts.find((x) => x.id === e.target.value)
              setForm({
                ...form,
                contactId: e.target.value,
                accountId: c?.accountId || form.accountId,
              })
            }}
            options={[
              { value: '', label: 'Select contact' },
              ...contacts.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="Account / company"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[
              { value: '', label: 'Select company' },
              ...accounts.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Select
            label="Owner"
            value={form.ownerUserId}
            onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
            options={[
              { value: '', label: 'Select owner' },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <label className="block text-sm sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block font-medium text-text-secondary">Notes</span>
            <textarea
              className="min-h-20 w-full rounded-[6px] border border-border bg-card p-3 text-sm outline-none focus:border-accent-blue"
              placeholder="Scope, site notes, competitor info…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>
      </FormPanel>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-l-4 border-l-accent-blue py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">Open pipeline</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(pipelineValue)}</div>
        </Card>
        <Card className="border-l-4 border-l-violet-500 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">Weighted forecast</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(weightedForecast)}</div>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">Won value</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{formatCurrency(wonValue)}</div>
        </Card>
        <Card className="border-l-4 border-l-amber-500 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">Win rate</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{winRate}%</div>
          <div className="text-xs text-text-secondary">{wonCount} won · {lostCount} lost</div>
        </Card>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {stageStats.map((s) => (
          <div
            key={s.id}
            className="min-w-[140px] flex-1 rounded-[10px] border border-border bg-card px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.colorHex || '#64748B' }}
              />
              <span className="truncate text-xs font-semibold text-text-primary">{s.name}</span>
            </div>
            <div className="mt-1 text-sm font-semibold tabular-nums">{formatCurrency(s.value)}</div>
            <div className="text-[11px] text-text-secondary">{s.count} deal{s.count === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <Card className="p-8 text-sm text-text-secondary">Loading live pipeline…</Card>
      ) : view === 'kanban' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => {
              const columnDeals = deals.filter((d) => d.stageId === stage.id)
              return (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  deals={columnDeals}
                  contactName={contactName}
                  accountName={accountName}
                  userName={userName}
                  onOpen={(id) => navigate(`/deals/${id}`)}
                  onDelete={removeDeal}
                />
              )
            })}
            {!stages.length && (
              <EmptyState
                icon={<HelpCircle size={22} />}
                title="No pipeline stages"
                subtitle="Stages are created when the client workspace is provisioned."
              />
            )}
          </div>
        </DndContext>
      ) : (
        <Card padding={false}>
          {deals.length === 0 ? (
            <EmptyState
              icon={<Briefcase size={24} />}
              title="No deals yet"
              subtitle="Create a deal from a qualified lead or add one manually."
              actionLabel="Add deal"
              onAction={() => setAddOpen(true)}
            />
          ) : (
            <div className="p-4 pt-3">
              {selection.someSelected ? (
                <BulkActionBar
                  count={selection.selectedCount}
                  noun="deal"
                  busy={busyDelete}
                  onClear={selection.clear}
                  onDelete={() => setConfirm({ ids: selection.selectedIds })}
                />
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="bg-muted text-xs text-text-secondary">
                    <tr>
                      <th className="w-10 px-4 py-3">
                        <SelectCheckbox
                          checked={selection.allSelected}
                          indeterminate={selection.someSelected && !selection.allSelected}
                          onChange={selection.toggleAll}
                          aria-label="Select all"
                        />
                      </th>
                      {['Deal', 'Customer', 'Value', 'Stage', 'Prob.', 'Close', 'Owner', 'Actions'].map(
                        (h) => (
                          <th key={h} className="px-4 py-3 font-medium">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((deal) => (
                      <tr
                        key={deal.id}
                        className="cursor-pointer border-t border-border hover:bg-surface"
                        onClick={() => navigate(`/deals/${deal.id}`)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <SelectCheckbox
                            checked={selection.isSelected(deal.id)}
                            onChange={() => selection.toggle(deal.id)}
                            aria-label={`Select ${deal.name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="font-semibold text-accent-blue hover:underline"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/deals/${deal.id}`)
                            }}
                          >
                            {deal.name}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div>{deal.contactId ? contactName[deal.contactId] ?? '—' : '—'}</div>
                          <div className="text-xs text-text-secondary">
                            {deal.accountId ? accountName[deal.accountId] ?? '' : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatCurrency(deal.amount)}</td>
                        <td className="px-4 py-3">
                          <Badge color="blue">{stageMap[deal.stageId]?.name ?? '—'}</Badge>
                        </td>
                        <td className="px-4 py-3">{deal.probability}%</td>
                        <td className="px-4 py-3 text-text-secondary">
                          {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {deal.ownerUserId ? userName[deal.ownerUserId] ?? '—' : '—'}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            <ViewIconButton onClick={() => navigate(`/deals/${deal.id}`)} />
                            <DeleteIconButton
                              disabled={busyDelete}
                              onClick={() => setConfirm({ ids: [deal.id] })}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Delete deal?' : `Delete ${confirm?.ids.length ?? 0} deals?`}
        body={
          confirm?.ids.length === 1
            ? 'This deal will be permanently removed.'
            : 'Selected deals will be permanently removed.'
        }
      />
    </div>
  )
}

function StageColumn({
  stage,
  deals,
  contactName,
  accountName,
  userName,
  onOpen,
  onDelete,
}: {
  stage: Stage
  deals: DealRow[]
  contactName: Record<string, string>
  accountName: Record<string, string>
  userName: Record<string, string>
  onOpen: (id: string) => void
  onDelete: (id: string, name: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = deals.reduce((s, d) => s + d.amount, 0)
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'w-[280px] shrink-0 rounded-[8px] border border-transparent bg-surface p-3',
        isOver && 'border-accent-blue bg-blue-50',
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: stage.colorHex || '#2563EB' }}
          />
          <h2 className="text-sm font-semibold">{stage.name}</h2>
          <Badge>{deals.length}</Badge>
        </div>
        <span className="text-xs font-semibold text-text-secondary">{formatCurrency(total)}</span>
      </header>
      <div className="min-h-24 space-y-3">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            contactLabel={deal.contactId ? contactName[deal.contactId] : undefined}
            accountLabel={deal.accountId ? accountName[deal.accountId] : undefined}
            ownerLabel={deal.ownerUserId ? userName[deal.ownerUserId] : undefined}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ))}
        {!deals.length && (
          <div className="rounded-[6px] border border-dashed border-border px-3 py-8 text-center text-sm text-text-secondary">
            Drop deals here
          </div>
        )}
      </div>
    </section>
  )
}

function DealCard({
  deal,
  contactLabel,
  accountLabel,
  ownerLabel,
  onOpen,
  onDelete,
}: {
  deal: DealRow
  contactLabel?: string
  accountLabel?: string
  ownerLabel?: string
  onOpen: (id: string) => void
  onDelete: (id: string, name: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'group rounded-[10px] border border-border bg-card p-3 shadow-sm transition hover:border-slate-300 hover:shadow-md touch-none',
        isDragging && 'z-30 opacity-70 shadow-lg',
      )}
      {...listeners}
      {...attributes}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          type="button"
          className="text-left text-sm font-semibold text-text-primary hover:text-accent-blue"
          onClick={() => onOpen(deal.id)}
        >
          {deal.name}
        </button>
        <Badge color={deal.priority === 'HIGH' ? 'red' : deal.priority === 'LOW' ? 'slate' : 'amber'}>
          {deal.priority}
        </Badge>
      </div>
      <div className="text-base font-semibold tabular-nums text-text-primary">{formatCurrency(deal.amount)}</div>
      <div className="mt-1 truncate text-xs text-text-secondary">
        {accountLabel || contactLabel || 'No customer linked'}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
        <span className="text-[11px] text-text-secondary">
          {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : 'No close date'}
        </span>
        {ownerLabel ? <Avatar name={ownerLabel} size="sm" /> : null}
      </div>
      <button
        type="button"
        className="mt-2 hidden text-[11px] text-accent-red hover:underline group-hover:inline"
        onClick={(e) => {
          e.stopPropagation()
          void onDelete(deal.id, deal.name)
        }}
      >
        Remove
      </button>
    </div>
  )
}

export default DealsPage
