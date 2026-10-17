import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, PackagePlus, X } from 'lucide-react'
import { api, isTenantSession } from '@/lib/api'
import { productAttrs } from '@/lib/productCatalog'
import { resolveInventoryAreas } from '@/lib/inventoryAreas'
import { isCompanyAdmin, isWarehouse } from '@/lib/roles'
import { STOCK_CHANGED_EVENT } from '@/lib/stockEvents'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

type LowProduct = {
  id: string
  name: string
  sku: string
  inStock: number
}

const POLL_MS = 60_000

function canSeeStockAlert(role?: string | null) {
  return isWarehouse(role) || isCompanyAdmin(role) || role === 'MANAGER'
}

function isMachineStockProduct(product: Record<string, unknown> | null | undefined): boolean {
  if (!product) return false
  const type = String(product.productType ?? '').toUpperCase()
  if (type === 'SPARE' || type === 'PART' || type === 'SERVICE') return false
  const a = productAttrs(product)
  const kind = String(a.catalogKind ?? '').toUpperCase()
  if (kind === 'SPARE' || kind === 'PART') return false
  const fam = String(a.catalogFamily ?? a.familyCode ?? '').toUpperCase()
  if (fam.includes('SPARE')) return false
  const machineFams = [
    'WEIGHING_SCALES',
    'BILLING_MACHINE',
    'TOUCH_POS',
    'BILLING_SOFTWARE',
    'OFFICE_AUTOMATION',
    'CASH_COUNTING',
  ]
  if (machineFams.includes(fam)) return true
  if (['WEIGHING', 'BILLING', 'CCM', 'POS', 'TOUCH_POS'].includes(kind)) return true
  const sku = String(product.sku ?? '').toUpperCase()
  if (sku.startsWith('HMS-') || sku.includes('-WS-') || sku.includes('-BM-')) return true
  // Stock-level row for a non-spare catalog item → treat as machine stock
  return product.trackInventory !== false && !fam.includes('SPARE')
}

/** Floating bottom-right prompt for warehouse when any machine SKU has &lt; 1 in stock. */
export function LowMachineStockAlert() {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.user?.role)
  const inventoryAreas = useAuthStore((s) => s.user?.inventoryAreas)
  const areas = resolveInventoryAreas(inventoryAreas, role)
  const enabled = canSeeStockAlert(role) && areas.machines

  const [lowProducts, setLowProducts] = useState<LowProduct[]>([])
  const [dismissedKey, setDismissedKey] = useState('')
  const [loading, setLoading] = useState(false)

  const fingerprint = useMemo(
    () =>
      lowProducts
        .map((p) => p.id)
        .sort()
        .join(','),
    [lowProducts],
  )

  const visible = lowProducts.length > 0 && fingerprint !== dismissedKey

  const refresh = useCallback(async () => {
    if (!enabled || !isTenantSession()) {
      setLowProducts([])
      return
    }
    setLoading(true)
    try {
      const levels = await api.inventory()
      const byProduct = new Map<string, LowProduct & { available: number }>()
      for (const row of levels) {
        const product = (row.product as Record<string, unknown> | null) ?? null
        if (!isMachineStockProduct(product)) continue
        const id = String(row.productId ?? product?.id ?? '')
        if (!id) continue
        const prev = byProduct.get(id) ?? {
          id,
          name: String(product?.name ?? 'Machine'),
          sku: String(product?.sku ?? ''),
          inStock: 0,
          available: 0,
        }
        prev.inStock += Number(row.serialInStock ?? 0)
        prev.available += Number(row.quantityAvailable ?? 0)
        if (product?.name) prev.name = String(product.name)
        if (product?.sku) prev.sku = String(product.sku)
        byProduct.set(id, prev)
      }
      // Out of machine stock: fewer than 1 serial in stock (and not covered by qty on hand)
      const low = [...byProduct.values()]
        .filter((p) => p.inStock < 1 && p.available < 1)
        .map(({ available: _a, ...p }) => p)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      setLowProducts(low)
      // Stock refilled for previous set → allow alert again only if a new shortage appears later
      const nextKey = low
        .map((p) => p.id)
        .sort()
        .join(',')
      if (!nextKey) setDismissedKey('')
    } catch {
      // Silent — warehouse banner is best-effort
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setLowProducts([])
      return
    }
    void refresh()
    const t = window.setInterval(() => void refresh(), POLL_MS)
    const onStockChanged = () => void refresh()
    window.addEventListener(STOCK_CHANGED_EVENT, onStockChanged)
    return () => {
      window.clearInterval(t)
      window.removeEventListener(STOCK_CHANGED_EVENT, onStockChanged)
    }
  }, [enabled, refresh])

  // When stock recovers, fingerprint empties / changes — clear dismiss so a later shortage reappears
  useEffect(() => {
    if (!fingerprint) setDismissedKey('')
  }, [fingerprint])

  if (!enabled || !visible) return null

  const preview = lowProducts.slice(0, 3)
  const more = lowProducts.length - preview.length
  const title =
    lowProducts.length === 1
      ? 'Machine stock empty'
      : `${lowProducts.length} machines out of stock`

  return (
    <div
      className="pointer-events-none fixed bottom-14 right-4 z-[190] w-[min(100vw-2rem,22rem)] sm:right-5"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'pointer-events-auto overflow-hidden rounded-2xl border border-amber-300/90 bg-amber-50 shadow-[0_12px_32px_rgba(15,23,42,0.18)]',
          'dark:border-amber-500/40 dark:bg-amber-950/95 dark:shadow-[0_12px_36px_rgba(0,0,0,0.5)]',
          'animate-in fade-in slide-in-from-bottom-3 duration-200',
        )}
      >
        <button
          type="button"
          className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-amber-100/70 dark:hover:bg-amber-900/50"
          onClick={() => {
            navigate('/erp/stock/move?mode=add')
          }}
        >
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm shadow-amber-500/40">
            <AlertTriangle size={18} strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-amber-950 dark:text-amber-50">
              {title}
            </span>
            <span className="mt-0.5 block text-xs text-amber-900/85 dark:text-amber-100/85">
              Stock less than 1 — add stock for warehouse. Tap to open Add stock.
            </span>
            <ul className="mt-2 space-y-1">
              {preview.map((p) => (
                <li
                  key={p.id}
                  className="truncate text-xs font-medium text-amber-950 dark:text-amber-50"
                >
                  <PackagePlus size={12} className="mr-1 inline-block opacity-80" />
                  {p.name}
                  {p.sku ? (
                    <span className="font-normal text-amber-800/80 dark:text-amber-200/70">
                      {' '}
                      · {p.sku}
                    </span>
                  ) : null}
                </li>
              ))}
              {more > 0 ? (
                <li className="text-[11px] text-amber-800/80 dark:text-amber-200/70">
                  +{more} more
                </li>
              ) : null}
            </ul>
          </span>
        </button>
        <div className="flex items-center justify-between border-t border-amber-200/80 px-3 py-1.5 dark:border-amber-800/50">
          <button
            type="button"
            className="text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100"
            onClick={() => navigate('/erp/stock')}
          >
            Open stock
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-amber-800 hover:bg-amber-200/70 dark:text-amber-100 dark:hover:bg-amber-900/80"
            title="Dismiss until stock changes"
            aria-label="Dismiss stock alert"
            onClick={() => setDismissedKey(fingerprint)}
            disabled={loading}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
