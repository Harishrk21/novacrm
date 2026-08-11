import { useCallback, useEffect, useMemo, useState } from 'react'

/** Checkbox multi-select for list tables. Clears when the visible id set changes. */
export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const key = useMemo(() => ids.slice().sort().join('|'), [ids])

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (ids.includes(id)) next.add(id)
      }
      return next
    })
  }, [key, ids])

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (ids.length > 0 && ids.every((id) => prev.has(id))) return new Set()
      return new Set(ids)
    })
  }, [ids])

  const clear = useCallback(() => setSelected(new Set()), [])

  const selectedIds = useMemo(() => Array.from(selected), [selected])
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
  const someSelected = selected.size > 0

  return {
    selected,
    selectedIds,
    selectedCount: selected.size,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
  }
}
