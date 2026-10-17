/** Fired after machine stock is received or reduced so warehouse alerts can refresh. */
export const STOCK_CHANGED_EVENT = 'nova:stock-changed'

export function notifyStockChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STOCK_CHANGED_EVENT))
}
