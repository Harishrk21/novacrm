import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

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
