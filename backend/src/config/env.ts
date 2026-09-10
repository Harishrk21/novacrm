import "dotenv/config";
import { z } from "zod";

/**
 * RDS / managed MySQL often presents a chain Prisma's CA store rejects under
 * sslaccept=strict. Prefer accept_invalid_certs so TLS still encrypts traffic
 * without failing certificate verification on Render.
 */
function normalizeDatabaseUrl(url: string | undefined) {
  if (!url) return url;
  let next = url.replace(/sslaccept=strict/gi, "sslaccept=accept_invalid_certs");
  if (!/[?&]sslaccept=/i.test(next) && /rds\.amazonaws\.com/i.test(next)) {
    next += (next.includes("?") ? "&" : "?") + "sslaccept=accept_invalid_certs";
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
if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
export const env = parsed.data;
