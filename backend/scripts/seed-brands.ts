import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const tenant =
    (await prisma.tenant.findFirst({ where: { slug: "hms" } })) ??
    (await prisma.tenant.findFirst());
  if (!tenant) throw new Error("no tenant");
  for (const b of [
    { code: "RETSOL", name: "RETSOL" },
    { code: "SMART", name: "SMART" },
    { code: "ISTHA", name: "ISTHA" },
  ] as const) {
    await prisma.brand.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: b.code } },
      update: { name: b.name, isActive: true, deletedAt: null },
      create: {
        id: randomUUID(),
        tenantId: tenant.id,
        code: b.code,
        name: b.name,
        isActive: true,
      },
    });
    console.log("brand", b.code);
  }
  console.log("done for", tenant.slug ?? tenant.code);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
