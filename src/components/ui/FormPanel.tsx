import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { Drawer } from './Drawer'
import { useConfirmLeave, useDiscardGuard } from '@/hooks/useDiscardGuard'

type Accent = 'theme' | 'sky' | 'emerald' | 'violet' | 'amber'

interface FormPanelProps {
  open: boolean
  title: string
  subtitle?: string
  eyebrow?: string
  /** Kept for API compatibility — drawer uses theme chrome */
  accent?: Accent
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  /** Drawer width (px). User can drag the left edge to resize. */
  width?: number
  minWidth?: number
  maxWidth?: number
  /** Persist resized width (default shared form-panel key) */
  storageKey?: string
  /**
   * When true (default), sidebar/route navigation and drawer close ask to discard.
   * Set false for read-only drawers.
   */
  guardUnsaved?: boolean
  /** Message shown in the discard dialog */
  unsavedReason?: string
}

const FormPanelCloseCtx = createContext<(() => void) | null>(null)

/**
 * Right-side drawer form.
 * While open, blocks sidebar / route changes with a Discard changes? dialog.
 */
export function FormPanel({
  open,
  title,
  subtitle,
  eyebrow = 'HMS Enterprises',
  onClose,
  children,
  footer,
  bodyClassName,
  width = 640,
  minWidth = 400,
  maxWidth = 960,
  storageKey = 'nova.drawer.formPanel',
  guardUnsaved = true,
  unsavedReason = 'You have a form open. Leaving will discard your changes.',
}: FormPanelProps) {
  const guardActive = guardUnsaved && open
  useDiscardGuard(guardActive, unsavedReason)
  const { requestLeave, dialog } = useConfirmLeave(guardActive, unsavedReason)

  const guardedClose = useCallback(() => {
    requestLeave(onClose)
  }, [requestLeave, onClose])

  return (
    <FormPanelCloseCtx.Provider value={guardedClose}>
      <Drawer
        open={open}
        onClose={guardedClose}
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        storageKey={storageKey}
        resizable
        title={
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
              {eyebrow}
            </div>
            <div className="text-lg font-semibold tracking-tight text-text-primary">{title}</div>
            {subtitle ? (
              <p className="mt-0.5 text-sm font-normal text-text-secondary">{subtitle}</p>
            ) : null}
          </div>
        }
        footer={
          footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
          ) : undefined
        }
      >
        <div className={cn('p-5', bodyClassName)}>{children}</div>
      </Drawer>
      {dialog}
    </FormPanelCloseCtx.Provider>
  )
}

/**
 * Cancel in a FormPanel footer.
 * Uses the panel discard confirm unless `skipConfirm` (e.g. wizard step back).
 */
export function FormPanelCancel({
  onClick,
  disabled,
  skipConfirm = false,
}: {
  onClick?: () => void
  disabled?: boolean
  /** Run onClick immediately without discard confirm (wizard back, etc.) */
  skipConfirm?: boolean
}) {
  const panelClose = useContext(FormPanelCloseCtx)
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => {
        if (skipConfirm) {
          onClick?.()
          return
        }
        if (panelClose) {
          panelClose()
          return
        }
        onClick?.()
      }}
    >
      Cancel
    </Button>
  )
}
