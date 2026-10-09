/**
 * Run async work with a hard concurrency cap so Prisma's connection pool
 * is not stampeded (common cause of P2024 against remote RDS).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/** Like Promise.all, but each factory starts only when a slot is free. */
export async function allPool<const T extends readonly unknown[]>(
  factories: { [K in keyof T]: () => Promise<T[K]> },
  concurrency = 3,
): Promise<{ [K in keyof T]: T[K] }> {
  const list = factories as readonly (() => Promise<unknown>)[];
  const out = await mapPool(list, concurrency, (fn) => fn());
  return out as { [K in keyof T]: T[K] };
}
