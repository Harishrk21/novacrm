import { prisma } from "../../config/database.js";
import { allPool } from "../../common/utils/concurrency.js";

export async function search(t: string, q: string, limit: number) {
  const where = (fields: string[]): Record<string, unknown> => ({
    tenantId: t,
    deletedAt: null,
    OR: fields.map((field) => ({ [field]: { contains: q } })),
  });
  const [leads, contacts, accounts, deals, products, invoices] = await allPool(
    [
      () => prisma.lead.findMany({ where: where(["name", "company", "email"]), take: limit }),
      () =>
        prisma.contact.findMany({
          where: where(["name", "email", "customerCode", "phone"]),
          take: limit,
        }),
      () => prisma.account.findMany({ where: where(["name", "email"]), take: limit }),
      () => prisma.deal.findMany({ where: where(["name"]), take: limit }),
      () => prisma.product.findMany({ where: where(["name", "sku"]), take: limit }),
      () =>
        prisma.invoice.findMany({
          where: { tenantId: t, deletedAt: null, invoiceNumber: { contains: q } },
          take: limit,
        }),
    ],
    3,
  );
  return { leads, contacts, accounts, deals, products, invoices };
}
