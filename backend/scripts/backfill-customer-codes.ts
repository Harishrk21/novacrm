/**
 * One-shot: assign CUS-##### to contacts missing customerCode, ensure CUSTOMER sequences exist.
 * Usage: npx tsx scripts/backfill-customer-codes.ts
 */
import { prisma } from "../src/config/database.js";
import { backfillCustomerCodes } from "../src/modules/contacts/contacts.service.js";

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  for (const tenant of tenants) {
    const exists = await prisma.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: tenant.id, sequenceKey: "CUSTOMER" } },
    });
    if (!exists) {
      await prisma.numberSequence.create({
        data: {
          tenantId: tenant.id,
          sequenceKey: "CUSTOMER",
          prefix: "CUS-",
          nextValue: 1,
          padding: 5,
        },
      });
      console.log("Created CUSTOMER sequence for", tenant.id);
    }
  }
  const result = await backfillCustomerCodes();
  console.log("Backfilled customer codes:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
