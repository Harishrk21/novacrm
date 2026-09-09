import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Pencil, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageTip } from '@/components/tips/PageTip'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  BulkActionBar,
  DeleteIconButton,
  EditIconButton,
  SelectCheckbox,
  ViewIconButton,
} from '@/components/ui/BulkSelect'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useRowSelection } from '@/hooks/useRowSelection'
import { api, ApiClientError, num } from '@/lib/api'
import { TENANT_ROLE_OPTIONS } from '@/lib/roles'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { WhatsAppIcon, WA_GREEN } from '@/components/whatsapp/WhatsAppIcon'

type EmployeeProfile = {
  id: string
  employeeCode: string
  department?: string | null
  designation?: string | null
  joinDate?: string | null
  salary?: number | null
  notes?: string | null
  status?: string
}

type TeamUser = {
  id: string
  name: string
  email: string
  phone?: string | null
  avatarUrl?: string | null
  status: string
  lastLoginAt?: string | null
  createdAt?: string
  role?: { id?: string; code: string; name: string } | null
  employee?: EmployeeProfile | null
}

type UsersPayload = {
  maxUsers: number | null
  used: number
  remaining: number | null
  unlimited?: boolean
  items: TeamUser[]
}

type FormState = {
  name: string
  email: string
  password: string
  phone: string
  avatarUrl: string
  roleCode: string
  status: string
  employeeCode: string
  department: string
  designation: string
  joinDate: string
  salary: string
  notes: string
}

const ROLE_OPTIONS = TENANT_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

const emptyForm = (): FormState => ({
  name: '',
  email: '',
  password: 'Demo@12345',
  phone: '',
  avatarUrl: '',
  roleCode: 'SERVICE_ENGINEER',
  status: 'ACTIVE',
  employeeCode: '',
  department: '',
  designation: '',
  joinDate: '',
  salary: '',
  notes: '',
})

function formFromUser(u: TeamUser): FormState {
  const join = u.employee?.joinDate
  return {
    name: u.name,
    email: u.email,
    password: '',
    phone: u.phone ?? '',
    avatarUrl: u.avatarUrl ?? '',
    roleCode: u.role?.code ?? 'SERVICE_ENGINEER',
    status: u.status || 'ACTIVE',
    employeeCode: u.employee?.employeeCode ?? '',
    department: u.employee?.department ?? '',
    designation: u.employee?.designation ?? '',
    joinDate: join ? String(join).slice(0, 10) : '',
    salary: u.employee?.salary != null ? String(u.employee.salary) : '',
    notes: u.employee?.notes ?? '',
  }
}

function roleBadgeColor(code?: string) {
  if (code === 'ADMIN') return 'blue' as const
  if (code === 'SERVICE_DESK') return 'amber' as const
  if (code === 'SERVICE_ENGINEER') return 'purple' as const
  if (code === 'SALES_EXECUTIVE' || code === 'AGENT') return 'blue' as const
  if (code === 'WAREHOUSE') return 'green' as const
  return 'gray' as const
}

export function UsersPage() {
  const addToast = useUIStore((s) => s.addToast)
  const authUser = useAuthStore((s) => s.user)
  const patchUser = useAuthStore((s) => s.patchUser)
  const [data, setData] = useState<UsersPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const photoRef = useRef<HTMLInputElement>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [viewUser, setViewUser] = useState<TeamUser | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [filterRole, setFilterRole] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterQ, setFilterQ] = useState('')

  const items = data?.items ?? []
  const filtered = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    return items.filter((u) => {
      if (filterRole && u.role?.code !== filterRole) return false
      if (filterStatus && u.status !== filterStatus) return false
      if (!q) return true
      const hay = `${u.name} ${u.email} ${u.phone ?? ''} ${u.employee?.employeeCode ?? ''} ${u.employee?.department ?? ''} ${u.employee?.designation ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, filterRole, filterStatus, filterQ])

  const ids = useMemo(() => filtered.map((u) => u.id), [filtered])
  const selection = useRowSelection(ids)

  const roleCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of items) {
      const c = u.role?.code ?? 'OTHER'
      map.set(c, (map.get(c) ?? 0) + 1)
    }
    return map
  }, [items])

  async function load() {
    setLoading(true)
    try {
      const res = await api.listUsers()
      setData(res as UsersPayload)
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

  function openCreate() {
    setFormMode('create')
    setEditingId(null)
    setForm(emptyForm())
    setViewUser(null)
    setFormOpen(true)
  }

  function openEdit(u: TeamUser) {
    setFormMode('edit')
    setEditingId(u.id)
    setForm(formFromUser(u))
    setViewUser(null)
    setFormOpen(true)
  }

  async function uploadPhoto(file?: File | null) {
    if (!file) return
    setPhotoUploading(true)
    try {
      const uploaded = await api.uploadImage(file)
      setForm((f) => ({ ...f, avatarUrl: uploaded.url }))
      addToast({ type: 'success', message: 'Photo uploaded — save to apply' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Photo upload failed',
      })
    } finally {
      setPhotoUploading(false)
    }
  }

  async function saveForm() {
    if (!form.name.trim() || !form.email.trim()) {
      addToast({ type: 'error', message: 'Name and email are required' })
      return
    }
    if (formMode === 'create' && form.password.length < 8) {
      addToast({ type: 'error', message: 'Password must be at least 8 characters' })
      return
    }
    if (formMode === 'edit' && form.password && form.password.length < 8) {
      addToast({ type: 'error', message: 'Password must be at least 8 characters' })
      return
    }
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (phoneDigits.length < 10) {
      addToast({
        type: 'error',
        message: 'WhatsApp / mobile number is required (include country code, e.g. 91…)',
      })
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        avatarUrl: form.avatarUrl.trim() || null,
        roleCode: form.roleCode,
        status: form.status,
        employeeCode: form.employeeCode.trim() || null,
        department: form.department.trim() || null,
        designation: form.designation.trim() || null,
        joinDate: form.joinDate || null,
        salary: form.salary.trim() ? Number(form.salary) : null,
        notes: form.notes.trim() || null,
      }
      if (formMode === 'create') {
        body.email = form.email.trim().toLowerCase()
        body.password = form.password
        const created = (await api.createUser(body)) as { restored?: boolean; id?: string; avatarUrl?: string | null }
        addToast({
          type: 'success',
          message: created?.restored
            ? 'Employee restored (same email was removed earlier)'
            : 'Employee created',
        })
        if (created?.id && authUser?.id === created.id) {
          patchUser({
            avatarUrl: (created.avatarUrl ?? form.avatarUrl.trim()) || null,
            name: form.name.trim(),
          })
        }
      } else if (editingId) {
        if (form.password.trim()) body.password = form.password.trim()
        const updated = (await api.updateUser(editingId, body)) as { avatarUrl?: string | null }
        addToast({ type: 'success', message: 'Employee updated' })
        if (authUser?.id === editingId) {
          patchUser({
            avatarUrl: (updated.avatarUrl ?? form.avatarUrl.trim()) || null,
            name: form.name.trim(),
            phone: form.phone.trim(),
          })
        }
      }
      setFormOpen(false)
      setEditingId(null)
      await load()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof ApiClientError ? err.message : 'Could not save employee',
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
      if (viewUser && deleteIds.includes(viewUser.id)) setViewUser(null)
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

  const formFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-[10px] border border-border bg-muted/30 px-4 py-3">
        <Avatar name={form.name || 'Employee'} src={form.avatarUrl || null} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">Profile photo</div>
          <p className="mt-0.5 text-xs text-text-secondary">
            Shows on their dashboard, sidebar, and top bar after they log in. JPG, PNG or WebP, up to 2 MB.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={photoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void uploadPhoto(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={photoUploading}
              onClick={() => photoRef.current?.click()}
            >
              {photoUploading ? 'Uploading…' : form.avatarUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {form.avatarUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, avatarUrl: '' }))}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Login access
      </div>
      <Input
        label="Full name *"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />
      <Input
        label="Email *"
        type="email"
        value={form.email}
        disabled={formMode === 'edit'}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
      />
      <Input
        label={formMode === 'create' ? 'Password *' : 'New password (optional)'}
        type="text"
        value={form.password}
        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        placeholder={formMode === 'edit' ? 'Leave blank to keep current' : undefined}
      />
      <Input
        id="user-phone-wa"
        label={
          <span className="inline-flex items-center gap-1.5">
            Mobile / <WhatsAppIcon size={14} />
            <span style={{ color: WA_GREEN }}>WhatsApp</span> *
          </span>
        }
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        placeholder="91XXXXXXXXXX"
      />
      <p className="-mt-2 text-xs text-text-secondary sm:col-span-2">
        Required for every employee. Use country code (e.g. 91…). Used for{' '}
        <span className="inline-flex items-center gap-1" style={{ color: WA_GREEN }}>
          <WhatsAppIcon size={12} /> WhatsApp
        </span>{' '}
        job / sales alerts.
      </p>
      <Select
        label="Role *"
        value={form.roleCode}
        onChange={(e) => setForm((f) => ({ ...f, roleCode: e.target.value }))}
        options={ROLE_OPTIONS}
      />
      <Select
        label="Status"
        value={form.status}
        onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
        options={[
          { value: 'ACTIVE', label: 'Active' },
          { value: 'INACTIVE', label: 'Inactive' },
          { value: 'LOCKED', label: 'Locked' },
        ]}
      />
      <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Employee profile
      </div>
      <Input
        label="Employee code"
        value={form.employeeCode}
        onChange={(e) => setForm((f) => ({ ...f, employeeCode: e.target.value }))}
        placeholder="Auto if blank (EMP-00001)"
      />
      <Input
        label="Department"
        value={form.department}
        onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
        placeholder="e.g. Service, Warehouse"
      />
      <Input
        label="Designation"
        value={form.designation}
        onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
        placeholder="e.g. Field Engineer"
      />
      <Input
        label="Join date"
        type="date"
        value={form.joinDate}
        onChange={(e) => setForm((f) => ({ ...f, joinDate: e.target.value }))}
      />
      <Input
        label="Salary (₹)"
        type="number"
        value={form.salary}
        onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))}
      />
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-text-secondary">Notes</label>
        <textarea
          className="min-h-20 w-full rounded-[8px] border border-border bg-card p-3 text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Internal notes about this employee"
        />
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        count={items.length}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Users & Roles' }]}
        actions={
          <Button onClick={openCreate}>
            <UserPlus size={16} /> Add employee
          </Button>
        }
      />

      <PageTip moduleKey="crm.users" />
      <Card className="mb-4 border-sky-200/80 bg-sky-50/50 p-4 text-sm text-text-secondary dark:border-sky-900/40 dark:bg-sky-950/20">
        <strong className="text-text-primary">Where employees live:</strong> create every team login here
        (Admin → Users &amp; Roles). Set <strong>role</strong> and a required{' '}
        <strong>WhatsApp / mobile</strong> for every person. No seat limit — add as many employees as you
        need. Assignee dropdowns only list the matching role; WhatsApp alerts use that number.
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-soft p-2 text-accent">
              <Users size={18} />
            </div>
            <div>
              <div className="text-xs text-text-secondary">Team members</div>
              <div className="text-lg font-semibold text-text-primary">{data?.used ?? '—'}</div>
            </div>
          </div>
        </Card>
        <Card className="py-4">
          <div className="text-xs text-text-secondary">Sales executives</div>
          <div className="text-lg font-semibold text-text-primary">
            {(roleCounts.get('SALES_EXECUTIVE') ?? 0) + (roleCounts.get('AGENT') ?? 0)}
          </div>
        </Card>
        <Card className="py-4">
          <div className="text-xs text-text-secondary">Service engineers</div>
          <div className="text-lg font-semibold text-text-primary">
            {roleCounts.get('SERVICE_ENGINEER') ?? 0}
          </div>
        </Card>
        <Card className="py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2 text-text-secondary">
              <Building2 size={18} />
            </div>
            <div>
              <div className="text-xs text-text-secondary">Service desk</div>
              <div className="text-lg font-semibold text-text-primary">
                {roleCounts.get('SERVICE_DESK') ?? 0}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card padding={false}>
        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          <Input
            className="min-w-[180px] flex-1"
            placeholder="Search name, email, code, dept…"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
          />
          <Select
            className="w-44"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            options={[{ value: '', label: 'All roles' }, ...ROLE_OPTIONS]}
          />
          <Select
            className="w-36"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            options={[
              { value: '', label: 'All status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'LOCKED', label: 'Locked' },
            ]}
          />
        </div>

        <div className="p-4 pt-3">
          {selection.someSelected ? (
            <BulkActionBar
              count={selection.selectedCount}
              noun="employee"
              busy={busyDelete}
              onClear={selection.clear}
              onDelete={() => setConfirm({ ids: selection.selectedIds })}
            />
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-surface text-xs text-text-secondary">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <SelectCheckbox
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected && !selection.allSelected}
                      onChange={selection.toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  {[
                    'Employee',
                    'Code',
                    'Department',
                    'Role',
                    'Status',
                    'Last login',
                    'Actions',
                  ].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr
                    key={user.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/40"
                    onClick={() => setViewUser(user)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <SelectCheckbox
                        checked={selection.isSelected(user.id)}
                        onChange={() => selection.toggle(user.id)}
                        aria-label={`Select ${user.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                        <span>
                          <span className="block font-medium text-text-primary">{user.name}</span>
                          <span className="block text-xs text-text-secondary">{user.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {user.employee?.employeeCode ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      <div>{user.employee?.department || '—'}</div>
                      {user.employee?.designation ? (
                        <div className="text-xs text-text-secondary/80">{user.employee.designation}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={roleBadgeColor(user.role?.code)}>
                        {(user.role?.name ?? user.role?.code ?? '—').replaceAll('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={user.status === 'ACTIVE' ? 'green' : 'gray'}>{user.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <ViewIconButton onClick={() => setViewUser(user)} />
                        <EditIconButton onClick={() => openEdit(user)} />
                        <DeleteIconButton
                          disabled={busyDelete}
                          onClick={() => setConfirm({ ids: [user.id] })}
                          label="Remove"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-text-secondary">
                      No employees match. Add a team login or clear filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        accent="theme"
        size="xl"
        title={formMode === 'create' ? 'Add employee' : 'Edit employee'}
        subtitle="Login + role + employee profile. WhatsApp / mobile is required for every employee."
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveForm()} disabled={saving}>
              {saving ? 'Saving…' : formMode === 'create' ? 'Create employee' : 'Save changes'}
            </Button>
          </>
        }
      >
        {formFields}
      </Modal>

      {viewUser ? (
        <Modal
          open
          onClose={() => setViewUser(null)}
          accent="theme"
          size="lg"
          title={viewUser.name}
          subtitle={viewUser.email}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setConfirm({ ids: [viewUser.id] })}
              >
                Delete
              </Button>
              <Button variant="outline" onClick={() => setViewUser(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  openEdit(viewUser)
                }}
              >
                <Pencil size={14} /> Edit
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <Avatar name={viewUser.name} src={viewUser.avatarUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-text-primary">{viewUser.name}</div>
                <div className="text-sm text-text-secondary">{viewUser.email}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge color={roleBadgeColor(viewUser.role?.code)}>
                    {(viewUser.role?.name ?? '—').replaceAll('_', ' ')}
                  </Badge>
                  <Badge color={viewUser.status === 'ACTIVE' ? 'green' : 'gray'}>
                    {viewUser.status}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['Phone', viewUser.phone || '—'],
                  ['Employee code', viewUser.employee?.employeeCode || '—'],
                  ['Department', viewUser.employee?.department || '—'],
                  ['Designation', viewUser.employee?.designation || '—'],
                  ['Join date', viewUser.employee?.joinDate || '—'],
                  [
                    'Salary',
                    viewUser.employee?.salary != null
                      ? formatCurrency(num(viewUser.employee.salary))
                      : '—',
                  ],
                  [
                    'Last login',
                    viewUser.lastLoginAt ? formatDateTime(viewUser.lastLoginAt) : 'Never',
                  ],
                  ['Notes', viewUser.employee?.notes || '—'],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
                <div key={label} className={label === 'Notes' ? 'sm:col-span-2' : undefined}>
                  <div className="text-xs text-text-secondary">{label}</div>
                  <div className="mt-0.5 font-medium text-text-primary">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runDelete(confirm.ids)
        }}
        title={confirm?.ids.length === 1 ? 'Remove employee?' : `Remove ${confirm?.ids.length ?? 0} employees?`}
        body={
          confirm?.ids.length === 1
            ? 'This employee login and profile will be removed.'
            : 'Selected employee logins will be removed.'
        }
        confirmLabel="Remove"
      />
    </div>
  )
}

export default UsersPage
