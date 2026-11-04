import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/** Checkbox multi-select for list tables. Clears when the visible id set changes. */
export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const idsRef = useRef(ids)
  idsRef.current = ids
  /** Stable fingerprint — ignore fresh array identity when contents match. */
  const key = useMemo(() => ids.slice().sort().join('|'), [ids])

  useEffect(() => {
    const currentIds = idsRef.current
    setSelected((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (currentIds.includes(id)) next.add(id)
      }
      return sameSet(prev, next) ? prev : next
    })
  }, [key])

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
    const currentIds = idsRef.current
    setSelected((prev) => {
      if (currentIds.length > 0 && currentIds.every((id) => prev.has(id))) return new Set()
      return new Set(currentIds)
    })
  }, [])

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
