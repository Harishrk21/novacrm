import { useEffect, useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { BulkActionBar, DeleteIconButton, SelectCheckbox } from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { FormPanel, FormPanelCancel } from '@/components/ui/FormPanel'
import { ConfirmModal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

type Employee = {
  id: string
  name: string
  email: string
  phone?: string | null
  status: string
  lastLoginAt?: string | null
  role?: { code: string; name: string } | null
}

type UsersPayload = {
  maxUsers: number
  used: number
  remaining: number
  items: Employee[]
}

const ROLE_OPTIONS = [
  { value: 'AGENT', label: 'Sales Agent (follow-ups)' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Company Admin' },
  { value: 'READ_ONLY', label: 'Read only' },
]

export function UsersPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [data, setData] = useState<UsersPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('Demo@12345')
  const [phone, setPhone] = useState('')
  const [roleCode, setRoleCode] = useState('AGENT')
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  const items = data?.items
  const ids = useMemo(() => (items ?? []).map((u) => u.id), [items])
  const selection = useRowSelection(ids)

  async function load() {
    setLoading(true)
    try {
      const res = await api.listUsers()
      setData(res)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Failed to load users',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function createEmployee() {
    if (!name.trim() || !email.trim() || password.length < 8) return
    setSaving(true)
    try {
      await api.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim() || null,
        roleCode,
      })
      addToast({ type: 'success', message: 'Employee login created' })
      setOpen(false)
      setName('')
      setEmail('')
      setPhone('')
      setPassword('Demo@12345')
      setRoleCode('AGENT')
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not create employee',
      })
    } finally {
      setSaving(false)
    }
  }

  async function runDelete(deleteIds: string[]) {
    setBusyDelete(true)
    try {
      await Promise.all(deleteIds.map((id) => api.deleteUser(id)))
      addToast({
        type: 'success',
        message: deleteIds.length === 1 ? 'Employee removed' : `${deleteIds.length} employees removed`,
      })
      selection.clear()
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not remove employee',
      })
    } finally {
      setBusyDelete(false)
      setConfirm(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Users' }]}
        actions={
          <Button
            onClick={() => setOpen((v) => !v)}
            variant={open ? 'outline' : 'primary'}
            disabled={!open && (data?.remaining ?? 0) <= 0}
          >
            <UserPlus size={16} /> {open ? 'Close form' : 'Add employee'}
          </Button>
        }
      />

      <PageTip moduleKey="crm.users" />

      <Card className="mb-4 border-slate-200">
        <p className="text-sm text-slate-600">
          Create logins for your team so they can follow up assigned leads. Seat limit is set by Nova
          platform admin.
        </p>
        <p className="mt-2 text-sm font-medium text-slate-900">
          {data
            ? `${data.used} / ${data.maxUsers} seats used · ${data.remaining} remaining`
            : loading
              ? 'Loading seats…'
              : '—'}
        </p>
      </Card>

      <FormPanel
        open={open}
        accent="emerald"
        eyebrow="Team"
        title="Add employee login"
        subtitle="They use the same login page with your workspace slug."
        onClose={() => setOpen(false)}
        footer={
          <>
            <FormPanelCancel onClick={() => setOpen(false)} disabled={saving} />
            <Button type="submit" form="add-employee-form" disabled={saving}>
              {saving ? 'Creating…' : 'Create login'}
            </Button>
          </>
        }
      >
        <form
          id="add-employee-form"
          onSubmit={(e) => {
            e.preventDefault()
            void createEmployee()
          }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Input label="Full name *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Email *"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password *"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Select
            className="sm:col-span-2 lg:col-span-2"
            label="Role"
            value={roleCode}
            onChange={(e) => setRoleCode(e.target.value)}
            options={ROLE_OPTIONS}
          />
        </form>
      </FormPanel>

      <Card padding={false}>
        <div className="p-4 pt-3">
          {selection.someSelected ? (
            <BulkActionBar
              count={selection.selectedCount}
              noun="user"
              busy={busyDelete}
              onClear={selection.clear}
              onDelete={() => setConfirm({ ids: selection.selectedIds })}
            />
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface text-xs text-text-secondary">
                <tr>
                  <th className="w-10 px-5 py-3">
                    <SelectCheckbox
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected && !selection.allSelected}
                      onChange={selection.toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  {['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                    <th key={h} className="px-5 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((user) => (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-5 py-4">
                      <SelectCheckbox
                        checked={selection.isSelected(user.id)}
                        onChange={() => selection.toggle(user.id)}
                        aria-label={`Select ${user.name}`}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2 font-medium">
                        <Avatar name={user.name} size="sm" />
                        {user.name}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{user.email}</td>
                    <td className="px-5 py-4">
                      <Badge color="purple">
                        {(user.role?.name ?? user.role?.code ?? '—').replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge color={user.status === 'ACTIVE' ? 'green' : 'gray'}>{user.status}</Badge>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-5 py-4">
                      <DeleteIconButton
                        disabled={busyDelete}
                        onClick={() => setConfirm({ ids: [user.id] })}
                        label="Remove"
                      />
                    </td>
                  </tr>
                ))}
                {!loading && (items?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-text-secondary">
                      No employees yet. Add your first team login.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Remove employee?' : `Remove ${confirm?.ids.length ?? 0} employees?`}
        body={
          confirm?.ids.length === 1
            ? 'This employee login will be removed.'
            : 'Selected employee logins will be removed.'
        }
        confirmLabel="Remove"
      />
    </div>
  )
}

export default UsersPage
