import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_MIN = 360
const DEFAULT_MAX = 960

function clampWidth(w: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(w)))
}

function readStoredWidth(key: string | undefined, fallback: number, min: number, max: number) {
  if (!key || typeof window === 'undefined') return clampWidth(fallback, min, max)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return clampWidth(fallback, min, max)
    const n = Number(raw)
    if (!Number.isFinite(n)) return clampWidth(fallback, min, max)
    return clampWidth(n, min, max)
  } catch {
    return clampWidth(fallback, min, max)
  }
}

function writeStoredWidth(key: string | undefined, value: number) {
  if (!key) return
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Initial / preferred width (px). User can drag to resize when resizable. */
  width?: number
  minWidth?: number
  maxWidth?: number
  /** Persist resized width in localStorage */
  storageKey?: string
  /** Drag the left edge to resize (default true) */
  resizable?: boolean
  footer?: ReactNode
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 480,
  minWidth = DEFAULT_MIN,
  maxWidth = DEFAULT_MAX,
  storageKey = 'nova.drawer.width',
  resizable = true,
  footer,
}: DrawerProps) {
  const [panelWidth, setPanelWidth] = useState(() =>
    readStoredWidth(storageKey, width, minWidth, maxWidth),
  )
  const widthRef = useRef(panelWidth)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    widthRef.current = panelWidth
  }, [panelWidth])

  useEffect(() => {
    if (!open) return
    const next = readStoredWidth(storageKey, width, minWidth, maxWidth)
    setPanelWidth(next)
    widthRef.current = next
  }, [open, storageKey, width, minWidth, maxWidth])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  function onResizeStart(e: React.PointerEvent) {
    if (!resizable) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startW: widthRef.current }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return
      const max = Math.min(
        maxWidth,
        typeof window !== 'undefined' ? window.innerWidth - 24 : maxWidth,
      )
      const next = clampWidth(
        dragRef.current.startW + (dragRef.current.startX - ev.clientX),
        minWidth,
        max,
      )
      widthRef.current = next
      setPanelWidth(next)
    }

    const onEnd = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      writeStoredWidth(storageKey, widthRef.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  if (typeof document === 'undefined') return null
  // Don't keep off-screen drawers / overlays in the DOM when closed — stacked
  // portals from every FormPanel were interfering with route updates.
  if (!open) return null

  const effectiveMax = Math.min(
    maxWidth,
    typeof window !== 'undefined' ? window.innerWidth - 24 : maxWidth,
  )
  const w = clampWidth(panelWidth, minWidth, effectiveMax)

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[180] bg-black/35 opacity-100 transition-opacity duration-150"
        onClick={onClose}
        aria-hidden={false}
      />
      <aside
        className="fixed bottom-0 right-0 top-0 z-[190] flex translate-x-0 flex-col bg-card shadow-[-4px_0_24px_rgba(0,0,0,0.14)] transition-transform duration-150"
        style={{ width: w, maxWidth: '100vw' }}
        role="dialog"
        aria-modal="true"
      >
        {resizable ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize drawer"
            title="Drag to resize"
            onPointerDown={onResizeStart}
            className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-accent-blue/40 active:bg-accent-blue/60"
          />
        ) : null}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 pr-2">{title}</div>
          <button
            onClick={onClose}
            className="ml-2 shrink-0 rounded-[6px] p-1 text-text-secondary transition-colors duration-150 hover:bg-muted"
            type="button"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-card px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </aside>
    </>,
    document.body,
  )
}
