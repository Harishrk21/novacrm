import { prisma } from "../../config/database.js";
import { allPool } from "../../common/utils/concurrency.js";
import { roleHasPermission, type Permission } from "../../common/permissions.js";

/**
 * Cross-record search. Each section is returned only when the caller's role may view it, and
 * only list-level fields (no amounts beyond what the list pages show, no custom fields / notes).
 */
export async function search(t: string, role: string, q: string, limit: number) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const can = (p: Permission) => roleHasPermission(role, p);
  const where = (fields: string[]): Record<string, unknown> => ({
    tenantId: t,
    deletedAt: null,
    OR: fields.map((field) => ({ [field]: { contains: q } })),
  });
  const none = async () => [] as never[];
  const [leads, contacts, accounts, deals, products, invoices] = await allPool(
    [
      can("leads:view")
        ? () =>
            prisma.lead.findMany({
              where: where(["name", "company", "email"]),
              take,
              select: { id: true, name: true, company: true, status: true, city: true },
            })
        : none,
      can("contacts:view")
        ? () =>
            prisma.contact.findMany({
              where: where(["name", "email", "customerCode", "phone"]),
              take,
              select: { id: true, name: true, customerCode: true, phone: true, city: true },
            })
        : none,
      can("accounts:view")
        ? () =>
            prisma.account.findMany({
              where: where(["name", "email"]),
              take,
              select: { id: true, name: true, city: true },
            })
        : none,
      can("deals:view")
        ? () =>
            prisma.deal.findMany({
              where: where(["name"]),
              take,
              select: { id: true, name: true, amount: true },
            })
        : none,
      can("products:view")
        ? () =>
            prisma.product.findMany({
              where: where(["name", "sku"]),
              take,
              select: { id: true, name: true, sku: true },
            })
        : none,
      can("invoices:view")
        ? () =>
            prisma.invoice.findMany({
              where: { tenantId: t, deletedAt: null, invoiceNumber: { contains: q } },
              take,
              select: { id: true, invoiceNumber: true, status: true, invoiceDate: true },
            })
        : none,
    ],
    3,
  );
  return { leads, contacts, accounts, deals, products, invoices };
}
