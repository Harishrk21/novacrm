/**
 * In-memory "last seen" list cache (stale-while-revalidate).
 * Coming back to a list shows the previous rows instantly while a fresh fetch runs,
 * instead of a full-page skeleton on every visit. Cleared on sign-out (see api.setAuth).
 */
const MAX_ENTRIES = 40
const MAX_AGE_MS = 10 * 60_000

const store = new Map<string, { at: number; data: unknown }>()

export function pageCacheGet<T>(key: string): T | undefined {
  const hit = store.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > MAX_AGE_MS) {
    store.delete(key)
    return undefined
  }
  return hit.data as T
}

export function pageCacheSet(key: string, data: unknown) {
  store.delete(key)
  store.set(key, { at: Date.now(), data })
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export function pageCacheClear() {
  store.clear()
}
