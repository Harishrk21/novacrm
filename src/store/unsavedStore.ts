import { create } from 'zustand'

type UnsavedState = {
  dirty: boolean
  reason: string | null
  /** Active discard-guard ids (idempotent acquire/release). */
  holdIds: string[]
  acquire: (id: string, reason?: string | null) => void
  release: (id: string) => void
  clear: () => void
}

/**
 * Global flag: block nav / show discard when a form or wizard is in progress.
 * Hold ids prevent double-acquire leaks (Strict Mode / overlapping FormPanels).
 */
export const useUnsavedStore = create<UnsavedState>((set, get) => ({
  dirty: false,
  reason: null,
  holdIds: [],
  acquire: (id, reason = null) => {
    const prev = get().holdIds
    const holdIds = prev.includes(id) ? prev : [...prev, id]
    set({
      holdIds,
      dirty: true,
      reason: reason ?? get().reason ?? 'You have unsaved work in progress.',
    })
  },
  release: (id) => {
    const holdIds = get().holdIds.filter((x) => x !== id)
    set({
      holdIds,
      dirty: holdIds.length > 0,
      reason: holdIds.length > 0 ? get().reason : null,
    })
  },
  clear: () => set({ dirty: false, reason: null, holdIds: [] }),
}))
