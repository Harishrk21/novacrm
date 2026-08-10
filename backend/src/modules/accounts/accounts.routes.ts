import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";
import { z } from "zod";
import type { Request, Response } from "express";

const body = z.object({
  name: z.string().min(1),
  accountType: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  gstin: z.string().nullable().optional(),
  pan: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().length(2).optional(),
  ownerUserId: z.string().min(1).max(36).nullable().optional(),
  annualRevenue: z.coerce.number().nonnegative().nullable().optional(),
  employeeCount: z.coerce.number().int().nonnegative().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  billingAddress: z.record(z.unknown()).nullable().optional(),
  shippingAddress: z.record(z.unknown()).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});
const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body, query: z.any(), params: z.any() });
const updateSchema = z.object({ body: body.partial(), query: z.any(), params });
const idSchema = z.object({ body: z.any(), query: z.any(), params });

async function list(t: string, q: any) {
  const p = pagination(q);
  const where: any = { tenantId: t, deletedAt: null };
  if (q.search) {
    where.OR = [
      { name: { contains: String(q.search), mode: "insensitive" } },
      { email: { contains: String(q.search), mode: "insensitive" } },
      { phone: { contains: String(q.search) } },
      { gstin: { contains: String(q.search), mode: "insensitive" } },
    ];
  }
  if (q.accountType) where.accountType = q.accountType;
  const [items, total] = await Promise.all([
    prisma.account.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: "desc" } }),
    prisma.account.count({ where }),
  ]);
  return pageResult(items, total, p.page, p.limit);
}

async function get(t: string, id: string) {
  const x = await prisma.account.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!x) throw notFound("Account");
  const [contacts, deals, invoices, tickets] = await Promise.all([
    prisma.contact.findMany({ where: { tenantId: t, accountId: id, deletedAt: null }, take: 50 }),
    prisma.deal.findMany({ where: { tenantId: t, accountId: id, deletedAt: null }, take: 50 }),
    prisma.invoice.findMany({ where: { tenantId: t, accountId: id, deletedAt: null }, take: 50 }),
    prisma.ticket.findMany({ where: { tenantId: t, accountId: id, deletedAt: null }, take: 50 }),
  ]);
  return { ...x, contacts, deals, invoices, tickets };
}

export const accountsRouter = Router();
accountsRouter.use(authenticate, requireTenant);
accountsRouter.get("/", async (q: Request, r: Response) => success(r, await list(q.auth!.tenantId!, q.query)));
accountsRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const d = q.body;
  const row = await prisma.account.create({ data: { ...d, id: newId(), tenantId: q.auth!.tenantId! } });
  return success(r, row, "Account created", 201);
});
accountsRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) =>
  success(r, await get(q.auth!.tenantId!, paramId(q))),
);
accountsRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const id = paramId(q);
  const t = q.auth!.tenantId!;
  const updated = await prisma.account.updateMany({ where: { id, tenantId: t, deletedAt: null }, data: q.body });
  if (!updated.count) throw notFound("Account");
  return success(r, await get(t, id));
});
accountsRouter.delete("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const updated = await prisma.account.updateMany({
    where: { id: paramId(q), tenantId: q.auth!.tenantId!, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!updated.count) throw notFound("Account");
  return success(r, null, "Account deleted");
});
