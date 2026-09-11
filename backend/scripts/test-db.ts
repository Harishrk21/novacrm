/**
 * Quick MySQL / RDS connectivity check (uses backend/.env DATABASE_URL).
 * Usage: cd backend && npx tsx scripts/test-db.ts
 */
import "./../src/config/env.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const raw = process.env.DATABASE_URL ?? "";
  const safe = raw.replace(/:[^:@/]+@/, ":****@");
  console.log("DATABASE_URL:", safe);

  await prisma.$queryRawUnsafe("SELECT 1 AS ok");
  const tenants = await prisma.tenant.count().catch(() => -1);
  const contacts = await prisma.contact.count().catch(() => -1);
  console.log("✅ Connected");
  console.log("   Tenants:", tenants);
  console.log("   Contacts:", contacts);
}

main()
  .catch((err) => {
    console.error("❌ Connection failed");
    console.error(err instanceof Error ? err.message : err);
    console.error("\nFor AWS RDS from Render, DATABASE_URL should look like:");
    console.error(
      'mysql://USER:PASSWORD@xxx.rds.amazonaws.com:3306/novacrm?sslaccept=accept_invalid_certs&connection_limit=5&pool_timeout=20&connect_timeout=15',
    );
    console.error("Also open RDS security group inbound TCP 3306 to Render (or 0.0.0.0/0 for a quick test).");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
