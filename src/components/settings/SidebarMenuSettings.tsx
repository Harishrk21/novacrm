import { useEffect, useMemo, useState } from 'react'
import { Lock, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ApiClientError } from '@/lib/api'
import {
  SIDEBAR_ROLES,
  useSidebarConfigStore,
  type CatalogSection,
  type SidebarConfig,
  type SidebarRoleKey,
} from '@/lib/sidebarConfig'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

function Check({
  checked,
  partial,
  disabled,
  onChange,
}: {
  checked: boolean
  partial?: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      className="size-4 shrink-0 rounded border-border accent-[var(--color-accent-blue)] disabled:opacity-50"
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(partial) && checked
      }}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

/** Settings → Sidebar menu: per role, tick which sections, links and dropdown items are shown. */
export function SidebarMenuSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const config = useSidebarConfigStore((s) => s.config)
  const catalog = useSidebarConfigStore((s) => s.catalog)
  const save = useSidebarConfigStore((s) => s.save)
  const load = useSidebarConfigStore((s) => s.load)
  const [roleKey, setRoleKey] = useState<SidebarRoleKey>('SERVICE_DESK')
  const [draft, setDraft] = useState<SidebarConfig>({})
  const [saving, setSaving] = useState(false)

  const [ready, setReady] = useState(false)
  // Fetch the saved menu once, then edit locally — a late refresh must never wipe ticks in progress
  useEffect(() => {
    let alive = true
    void load().then(() => {
      if (!alive) return
      setDraft(useSidebarConfigStore.getState().config ?? {})
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [load])

  const sections: CatalogSection[] = catalog[roleKey] ?? []
  const hidden = useMemo(() => new Set(draft[roleKey]?.hidden ?? []), [draft, roleKey])
  const dirty = JSON.stringify(draft) !== JSON.stringify(config ?? {})

  function setHidden(keys: string[], hide: boolean) {
    setDraft((prev) => {
      const set = new Set(prev[roleKey]?.hidden ?? [])
      for (const k of keys) {
        if (hide) set.add(k)
        else set.delete(k)
      }
      return { ...prev, [roleKey]: { hidden: [...set].sort() } }
    })
  }

  async function onSave() {
    setSaving(true)
    try {
      await save(draft)
      addToast({ type: 'success', message: 'Sidebar menu saved — staff see it on their next page load' })
    } catch (e) {
      addToast({ type: 'error', message: e instanceof ApiClientError ? e.message : 'Could not save sidebar menu' })
    } finally {
      setSaving(false)
    }
  }

  const hiddenCount = (key: SidebarRoleKey) => draft[key]?.hidden?.length ?? 0

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">Sidebar menu</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Choose what each role sees in the left menu — whole sections, single links, and the items inside each
            link&apos;s dropdown. Hiding only tidies the menu; what a person may open still follows their role.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hiddenCount(roleKey)}
            onClick={() => setDraft((prev) => ({ ...prev, [roleKey]: { hidden: [] } }))}
          >
            <RotateCcw size={14} /> Show everything
          </Button>
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void onSave()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Role">
        {SIDEBAR_ROLES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={roleKey === r.key}
            onClick={() => setRoleKey(r.key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm font-medium transition',
              roleKey === r.key
                ? 'border-[color:var(--color-accent-blue)] bg-[color:var(--color-accent-blue)] text-white'
                : 'border-border text-text-secondary hover:text-text-primary',
            )}
          >
            {r.label}
            {hiddenCount(r.key) ? <span className="ml-1.5 opacity-80">· {hiddenCount(r.key)} hidden</span> : null}
          </button>
        ))}
      </div>

      {!ready || sections.length === 0 ? (
        <p className="mt-6 text-sm text-text-secondary">Loading the menu for this role…</p>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {sections.map((section) => {
            const itemKeys = section.items.filter((i) => !i.locked).map((i) => i.key)
            const sectionOn = !hidden.has(section.key)
            const someItemOff = itemKeys.some((k) => hidden.has(k))
            return (
              <div key={section.key} className="rounded-lg border border-border p-3">
                <label className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
                  <Check
                    checked={sectionOn}
                    partial={someItemOff}
                    disabled={section.locked}
                    onChange={(on) => setHidden([section.key], !on)}
                  />
                  {section.label}
                  {section.locked ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-text-secondary">
                      <Lock size={12} /> keeps Settings reachable
                    </span>
                  ) : null}
                </label>
                <ul className={cn('mt-2 space-y-1.5 pl-6', !sectionOn && 'opacity-50')}>
                  {section.items.map((item) => {
                    const itemOn = item.locked || !hidden.has(item.key)
                    return (
                      <li key={item.key}>
                        <label className="flex items-center gap-2.5 text-sm text-text-primary">
                          <Check
                            checked={itemOn}
                            disabled={item.locked || !sectionOn}
                            onChange={(on) => setHidden([item.key], !on)}
                          />
                          {item.label}
                          {item.locked ? <Lock size={12} className="text-text-secondary" /> : null}
                        </label>
                        {item.quick.length ? (
                          <ul className={cn('mt-1 space-y-1 pl-6', !itemOn && 'opacity-50')}>
                            {item.quick.map((q) => (
                              <li key={q.key}>
                                <label className="flex items-center gap-2 text-xs text-text-secondary">
                                  <Check
                                    checked={!hidden.has(q.key)}
                                    disabled={!itemOn || !sectionOn}
                                    onChange={(on) => setHidden([q.key], !on)}
                                  />
                                  {q.label}
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
