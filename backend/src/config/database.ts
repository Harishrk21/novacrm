import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";
import { logger } from "./logger.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function poolHint(url: string): { limit: string; poolTimeout: string } {
  const limit = url.match(/[?&]connection_limit=(\d+)/i)?.[1] ?? "default";
  const poolTimeout = url.match(/[?&]pool_timeout=(\d+)/i)?.[1] ?? "default";
  return { limit, poolTimeout };
}

/**
 * Always reuse one PrismaClient per process. Creating a new client on every
 * reload/deploy without disconnecting exhausts RDS max_connections quickly.
 * Datasource URL comes from env.ts (already normalized for shared RDS).
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (!globalForPrisma.prisma) {
  const hint = poolHint(env.DATABASE_URL);
  logger.info("Prisma pool configured", {
    connection_limit: hint.limit,
    pool_timeout: hint.poolTimeout,
  });
}
globalForPrisma.prisma = prisma;

async function disconnect() {
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
}

process.once("beforeExit", () => {
  void disconnect();
});
