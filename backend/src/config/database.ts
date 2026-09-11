import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Always reuse one PrismaClient per process. Creating a new client on every
 * reload/deploy without disconnecting exhausts RDS max_connections quickly.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;

async function disconnect() {
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
}

process.once("SIGINT", () => {
  void disconnect().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void disconnect().finally(() => process.exit(0));
});
