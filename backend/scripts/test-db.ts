import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log(
    "DATABASE_URL host check:",
    process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":****@"),
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ tables: bigint }>>(
    "SELECT COUNT(*)::bigint AS tables FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const tenants = await prisma.tenant.count().catch(() => -1);
  const categories = await prisma.businessCategory.count().catch(() => -1);
  console.log("✅ Connected to Supabase (PostgreSQL)");
  console.log("   Tables in public schema:", Number(rows[0]?.tables ?? 0));
  console.log("   Tenants:", tenants);
  console.log("   Business categories:", categories);
}

main()
  .catch((err) => {
    console.error("❌ Connection failed");
    console.error(err.message);
    console.error("\nPaste your Supabase Direct URI into backend/.env:");
    console.error(
      'DATABASE_URL="postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"',
    );
    console.error("\nSee: database/SUPABASE_SETUP.md");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
