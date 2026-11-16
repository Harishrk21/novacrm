import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
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
   * When true (default), sidebar/route navigation and drawer close ask to discard
   * only after the user has edited the form (or when `dirty` is true).
   * Set false for read-only drawers.
   */
  guardUnsaved?: boolean
  /**
   * When set, discard confirm only runs if dirty.
   * When omitted, dirty is auto-detected from form input/change events
   * (Cancel with no edits closes immediately — no discard prompt).
   */
  dirty?: boolean
  /** Message shown in the discard dialog */
  unsavedReason?: string
  /**
   * drawer (default) = right-side resizable drawer.
   * page = full-width card in the page body with a sticky footer (same header, fields,
   * discard guard and Cancel behaviour) — for long multi-step forms.
   */
  layout?: 'drawer' | 'page'
}

const FormPanelCloseCtx = createContext<(() => void) | null>(null)

/**
 * Right-side drawer form.
 * While open with unsaved edits, blocks sidebar / route changes with a Discard dialog.
 * Cancel / close with no edits closes immediately.
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
  dirty,
  unsavedReason = 'You have unsaved changes. Leaving will discard them.',
  layout = 'drawer',
  className,
}: FormPanelProps) {
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) setTouched(false)
  }, [open])

  const hasEdits = dirty !== undefined ? dirty : touched
  const guardActive = guardUnsaved && open && hasEdits
  useDiscardGuard(guardActive, unsavedReason)
  const { requestLeave, dialog } = useConfirmLeave(guardActive, unsavedReason)

  const guardedClose = useCallback(() => {
    requestLeave(onClose)
  }, [requestLeave, onClose])

  const markTouched = useCallback(() => {
    setTouched(true)
  }, [])

  const heading = (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
        {eyebrow}
      </div>
      <div className="text-lg font-semibold tracking-tight text-text-primary">{title}</div>
      {subtitle ? <p className="mt-0.5 text-sm font-normal text-text-secondary">{subtitle}</p> : null}
    </div>
  )

  if (layout === 'page') {
    if (!open) return null
    const card = (
        <section
          className={cn(
            'mx-auto flex w-full max-w-6xl flex-col rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]',
            className,
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            {heading}
            <button
              type="button"
              onClick={guardedClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-text-secondary transition hover:bg-muted hover:text-text-primary"
            >
              <X size={18} />
            </button>
          </header>
          <div
            className={cn('p-5', bodyClassName)}
            onChange={dirty === undefined ? markTouched : undefined}
          >
            {children}
          </div>
          {footer ? (
            <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
              {footer}
            </footer>
          ) : null}
        </section>
    )
    // Cover the app content area (sidebar + topbar stay visible) with its own scroll,
    // so the form reads as its own page wherever it is opened from.
    const root = typeof document !== 'undefined' ? document.getElementById('page-form-root') : null
    return (
      <FormPanelCloseCtx.Provider value={guardedClose}>
        {root
          ? createPortal(
              <div className="absolute inset-0 z-40 overflow-y-auto overscroll-contain bg-surface p-3 sm:p-4 lg:p-5">
                {card}
              </div>,
              root,
            )
          : card}
        {dialog}
      </FormPanelCloseCtx.Provider>
    )
  }

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
        title={heading}
        footer={
          footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
          ) : undefined
        }
      >
        <div
          className={cn('p-5', bodyClassName)}
          onChange={dirty === undefined ? markTouched : undefined}
        >
          {children}
        </div>
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
