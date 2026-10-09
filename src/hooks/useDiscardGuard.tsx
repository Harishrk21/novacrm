import { useCallback, useEffect, useId, useState } from 'react'
import { ConfirmModal } from '@/components/ui/Modal'
import { useUnsavedStore } from '@/store/unsavedStore'

/**
 * Marks global unsaved state so AppLayout blocks sidebar/route navigation
 * with a Discard changes? dialog. Does not own the route blocker itself.
 */
export function useDiscardGuard(active: boolean, reason = 'You have unsaved work in progress.') {
  const id = useId()
  const acquire = useUnsavedStore((s) => s.acquire)
  const release = useUnsavedStore((s) => s.release)

  useEffect(() => {
    if (!active) return
    acquire(id, reason)
    return () => release(id)
  }, [active, reason, id, acquire, release])
}

/** Confirm before leaving the current tab/view without changing the route. */
export function useConfirmLeave(active: boolean, reason?: string) {
  const [pending, setPending] = useState<(() => void) | null>(null)

  const requestLeave = useCallback(
    (then: () => void) => {
      if (!active) {
        then()
        return
      }
      setPending(() => then)
    },
    [active],
  )

  const dialog = (
    <ConfirmModal
      open={Boolean(pending)}
      onClose={() => setPending(null)}
      onConfirm={() => {
        const fn = pending
        setPending(null)
        fn?.()
      }}
      title="Discard changes?"
      body={reason ?? 'You have unsaved work in progress. Leave this page?'}
      confirmLabel="Discard"
      closeOnConfirm={false}
    />
  )

  return { requestLeave, dialog }
}
