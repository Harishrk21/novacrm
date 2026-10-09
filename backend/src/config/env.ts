import "dotenv/config";
import { z } from "zod";

/**
 * Harden DATABASE_URL for Prisma + managed MySQL (AWS RDS / Aiven):
 * - sslaccept: RDS cert chains often fail Prisma's strict CA check on Render
 * - connection_limit: keep pool modest so THIS service shares RDS with other apps
 * - pool_timeout / connect_timeout: fail fast instead of hanging forever
 *
 * Important: too many parallel Prisma queries (Promise.all of 6–8 findMany)
 * exhausts a small pool and surfaces as P2024 on unrelated routes (e.g. leads).
 */
function upsertQueryParam(url: string, key: string, value: string): string {
  const re = new RegExp(`([?&])${key}=[^&]*`, "i");
  if (re.test(url)) return url.replace(re, `$1${key}=${value}`);
  return url + (url.includes("?") ? "&" : "?") + `${key}=${value}`;
}

/** Shared RDS with other products: stay in a narrow band. */
const POOL_MIN = 5;
const POOL_DEFAULT = 8;
const POOL_MAX = 12;

function normalizeDatabaseUrl(url: string | undefined) {
  if (!url) return url;
  let next = url;

  const isMysql = /^mysql(\+[^:]+)?:\/\//i.test(next);
  const isRds = /rds\.amazonaws\.com/i.test(next);

  if (isMysql || isRds) {
    if (/sslaccept=strict/i.test(next)) {
      next = next.replace(/sslaccept=strict/gi, "sslaccept=accept_invalid_certs");
    } else if (!/[?&]sslaccept=/i.test(next)) {
      next = upsertQueryParam(next, "sslaccept", "accept_invalid_certs");
    }

    const limitMatch = next.match(/[?&]connection_limit=(\d+)/i);
    const rawLimit = limitMatch ? Number(limitMatch[1]) : 0;
    let limit = rawLimit || POOL_DEFAULT;
    if (limit < POOL_MIN) limit = POOL_MIN;
    if (limit > POOL_MAX) limit = POOL_MAX;
    next = upsertQueryParam(next, "connection_limit", String(limit));

    // Wait longer for a free slot than the old 10–20s — better UX than hard P2024
    // under short bursts, while concurrency caps prevent permanent saturation.
    next = upsertQueryParam(next, "pool_timeout", "60");
    if (!/[?&]connect_timeout=/i.test(next)) {
      next = upsertQueryParam(next, "connect_timeout", "15");
    }
  }

  if (next !== url) process.env.DATABASE_URL = next;
  return next;
}

normalizeDatabaseUrl(process.env.DATABASE_URL);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("none"),
  REDIS_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("7d"),
  PLATFORM_ADMIN_EMAIL: z.string().email().default("admin@novacrm.com"),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).default("Admin@Nova2026"),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success)
  throw new Error(
    `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
  );
export const env = parsed.data;
