import { Redis } from "ioredis";
import { env } from "./env.js";

const disabled =
  !env.REDIS_URL ||
  env.REDIS_URL === "none" ||
  env.REDIS_URL === "disabled" ||
  process.env.DISABLE_REDIS === "1";

export const redis = disabled
  ? null
  : new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

let available = false;

if (redis) {
  redis.on("ready", () => {
    available = true;
  });
  redis.on("close", () => {
    available = false;
  });
  redis.on("error", () => {
    available = false;
  });
  void redis.connect().catch(() => undefined);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!available || !redis) return null;
  try {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttl = env.REDIS_TTL_SECONDS): Promise<void> {
  if (!available || !redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    /* fail open */
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (!available || !redis || !keys.length) return;
  try {
    await redis.del(...keys);
  } catch {
    /* fail open */
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  if (!available || !redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* fail open */
  }
}
