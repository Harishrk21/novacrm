import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant, requireTenantAdmin } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { notFound } from "../../common/errors.js";
import { paramId } from "../../common/utils/params.js";

/** Dropdown / lookup data for forms across CRM + ERP */
export const metaRouter = Router();
metaRouter.use(authenticate, requireTenant);

metaRouter.get("/lookups", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const [sources, stages, users, warehouses, categories, accounts, contacts, products, vendors] =
    await Promise.all([
      prisma.leadSource.findMany({ where: { tenantId: t, isActive: true }, orderBy: { name: "asc" } }),
      prisma.pipelineStage.findMany({ where: { tenantId: t, isActive: true }, orderBy: { sortOrder: "asc" } }),
      prisma.user.findMany({
        where: { tenantId: t, deletedAt: null, status: "ACTIVE" },
        select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
        orderBy: { name: "asc" },
      }),
      prisma.warehouse.findMany({
        where: { tenantId: t, deletedAt: null, isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.productCategory.findMany({
        where: { tenantId: t, deletedAt: null },
        orderBy: { name: "asc" },
      }),
      prisma.account.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, name: true, phone: true, email: true, city: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.contact.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, name: true, phone: true, email: true, accountId: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.product.findMany({
        where: { tenantId: t, deletedAt: null, isActive: true },
        select: {
          id: true,
          sku: true,
          name: true,
          salePrice: true,
          purchasePrice: true,
          unit: true,
          taxPercent: true,
        },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.vendor.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, name: true, phone: true, email: true },
        orderBy: { name: "asc" },
      }),
    ]);
  return success(r, {
    sources,
    stages,
    users,
    warehouses,
    categories,
    accounts,
    contacts,
    products,
    vendors,
  });
});

function slugCode(name: string) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

const stageBody = z.object({
  name: z.string().min(1).max(80),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  sortOrder: z.coerce.number().int().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const sourceBody = z.object({
  name: z.string().min(1).max(80),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  isActive: z.boolean().optional(),
});
const idParams = z.object({ id: z.string().min(1).max(36) });

metaRouter.post(
  "/stages",
  requireTenantAdmin,
  validate(z.object({ body: stageBody, query: z.any(), params: z.any() })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const d = q.body as z.infer<typeof stageBody>;
    const codeBase = slugCode(d.name) || "STAGE";
    let code = codeBase;
    let i = 1;
    while (await prisma.pipelineStage.findFirst({ where: { tenantId: t, code } })) {
      code = `${codeBase}_${i++}`.slice(0, 40);
    }
    const maxSort = await prisma.pipelineStage.aggregate({
      where: { tenantId: t },
      _max: { sortOrder: true },
    });
    const row = await prisma.pipelineStage.create({
      data: {
        id: newId(),
        tenantId: t,
        name: d.name.trim(),
        code,
        probability: d.probability ?? 20,
        colorHex: d.colorHex ?? "#2563EB",
        sortOrder: d.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        isWon: d.isWon ?? false,
        isLost: d.isLost ?? false,
      },
    });
    return success(r, row, "Stage created", 201);
  },
);

metaRouter.patch(
  "/stages/:id",
  requireTenantAdmin,
  validate(z.object({ body: stageBody.partial(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const id = paramId(q);
    const d = q.body as Partial<z.infer<typeof stageBody>>;
    const updated = await prisma.pipelineStage.updateMany({
      where: { id, tenantId: t },
      data: d,
    });
    if (!updated.count) throw notFound("Stage");
    const row = await prisma.pipelineStage.findFirst({ where: { id, tenantId: t } });
    return success(r, row, "Stage updated");
  },
);

metaRouter.post(
  "/sources",
  requireTenantAdmin,
  validate(z.object({ body: sourceBody, query: z.any(), params: z.any() })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const d = q.body as z.infer<typeof sourceBody>;
    const codeBase = slugCode(d.name) || "SOURCE";
    let code = codeBase;
    let i = 1;
    while (await prisma.leadSource.findFirst({ where: { tenantId: t, code } })) {
      code = `${codeBase}_${i++}`.slice(0, 40);
    }
    const row = await prisma.leadSource.create({
      data: {
        id: newId(),
        tenantId: t,
        name: d.name.trim(),
        code,
        colorHex: d.colorHex ?? "#64748B",
      },
    });
    return success(r, row, "Source created", 201);
  },
);

metaRouter.patch(
  "/sources/:id",
  requireTenantAdmin,
  validate(z.object({ body: sourceBody.partial(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const id = paramId(q);
    const d = q.body as Partial<z.infer<typeof sourceBody>>;
    const updated = await prisma.leadSource.updateMany({
      where: { id, tenantId: t },
      data: d,
    });
    if (!updated.count) throw notFound("Source");
    const row = await prisma.leadSource.findFirst({ where: { id, tenantId: t } });
    return success(r, row, "Source updated");
  },
);

metaRouter.delete(
  "/sources/:id",
  requireTenantAdmin,
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const id = paramId(q);
    const updated = await prisma.leadSource.updateMany({
      where: { id, tenantId: t },
      data: { isActive: false },
    });
    if (!updated.count) throw notFound("Source");
    return success(r, null, "Source deactivated");
  },
);
