/**
 * Load the 10-customer Chennai demo pack into HMS Enterprises.
 *
 *   npx tsx scripts/seed-hms-demo.ts
 *   npm run db:seed-demo
 */
import { prisma } from "../src/config/database.js";
import { loadDemoData, removeDemoData, demoDataStatus } from "../src/modules/tenants/demoData.service.js";

async function main() {
  const tenant =
    (await prisma.tenant.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { slug: "precision-scales-india" },
          { code: "HMS01" },
          { slug: "hms" },
        ],
      },
      select: { id: true, name: true, slug: true, code: true },
    })) ?? null;

  if (!tenant) {
    throw new Error("HMS tenant not found (slug precision-scales-india / code HMS01)");
  }

  const admin = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      status: "ACTIVE",
      OR: [
        { email: "admin@hmsenterprises.in" },
        { email: { contains: "admin@" } },
      ],
    },
    select: { id: true, email: true, name: true },
  });
  if (!admin) throw new Error("No active admin user on HMS tenant");

  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);
  console.log(`Admin:  ${admin.email}`);

  const before = await demoDataStatus(tenant.id);
  console.log("Before:", before.counts);

  if (before.loaded) {
    console.log("Pack already has ≥10 customers — refreshing (remove + reload)…");
    await removeDemoData(tenant.id);
  }

  const result = await loadDemoData(tenant.id, admin.id);
  console.log("After:", result.counts);
  console.log(
    result.alreadyLoaded
      ? "Already loaded — no changes."
      : `Loaded pack ${result.pack}: ${result.counts.accounts} Chennai customers, ${result.counts.tickets} tickets, ${result.counts.customerAssets} machines.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
