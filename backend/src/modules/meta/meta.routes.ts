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
import {
  ensureStandardWarehouses,
  sortWarehousesForDropdown,
} from "../inventory/warehouses.service.js";
import { allPool } from "../../common/utils/concurrency.js";

/** Dropdown / lookup data for forms across CRM + ERP */
export const metaRouter = Router();
metaRouter.use(authenticate, requireTenant);

/** Short L1 cache — lookups are hit on almost every form open. */
const lookupsCache = new Map<string, { at: number; body: unknown }>();
const LOOKUPS_TTL_MS = 120_000;

metaRouter.get("/lookups", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const scopeRaw = String(q.query.scope ?? q.query.lite ?? "").toLowerCase();
  const lite = scopeRaw === "1" || scopeRaw === "warehouses";
  /** core = users/stages/warehouses only — tickets/forms that don't need full catalog */
  const coreOnly = scopeRaw === "core";
  // Only seed missing warehouses (no-op when already present) — never block every lookups call
  // with four sequential upserts against remote RDS.
  void ensureStandardWarehouses(t).catch(() => undefined);

  if (lite) {
    const warehouses = sortWarehousesForDropdown(
      await prisma.warehouse.findMany({
        where: { tenantId: t, deletedAt: null, isActive: true },
        orderBy: [{ code: "asc" }],
        select: { id: true, name: true, code: true, isDefault: true },
      }),
    );
    return success(r, {
      sources: [],
      stages: [],
      users: [],
      warehouses,
      categories: [],
      accounts: [],
      contacts: [],
      products: [],
      vendors: [],
    });
  }

  const cacheKey = `lookups:${t}:${coreOnly ? "core" : "full"}`;
  const hit = lookupsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < LOOKUPS_TTL_MS) {
    r.setHeader("X-Cache", "HIT-memory");
    return success(r, hit.body);
  }

  // Core path: few small queries (tickets/assign). Full path still capped — no 500-row dumps.
  const coreJobs = [
    () =>
      prisma.leadSource.findMany({
        where: { tenantId: t, isActive: true },
        orderBy: { name: "asc" },
      }),
    () =>
      prisma.pipelineStage.findMany({
        where: { tenantId: t, isActive: true },
        orderBy: { sortOrder: "asc" },
      }),
    () =>
      prisma.user.findMany({
        where: { tenantId: t, deletedAt: null, status: "ACTIVE" },
        select: { id: true, name: true, email: true, phone: true, avatarUrl: true, roleId: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
    () =>
      prisma.role.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, code: true, name: true },
      }),
    () =>
      prisma.warehouse.findMany({
        where: { tenantId: t, deletedAt: null, isActive: true },
        orderBy: [{ code: "asc" }],
      }),
    () =>
      prisma.productCategory.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, name: true, code: true, parentId: true },
        orderBy: { name: "asc" },
      }),
    () =>
      prisma.vendor.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, name: true, phone: true, email: true },
        orderBy: { name: "asc" },
        take: 150,
      }),
  ] as const;

  const catalogJobs = [
    () =>
      prisma.account.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, name: true, phone: true, email: true, city: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
    () =>
      prisma.contact.findMany({
        where: { tenantId: t, deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          accountId: true,
          customerCode: true,
          customerNo: true,
        },
        orderBy: { name: "asc" },
        take: 200,
      }),
    () =>
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
          imageUrl: true,
          productType: true,
          // attributes omitted — large JSON; pages that need it call /products
        },
        orderBy: { name: "asc" },
        take: 200,
      }),
  ] as const;

  const pooled = coreOnly
    ? await allPool([...coreJobs], 3)
    : await allPool([...coreJobs, ...catalogJobs], 3);

  const sources = pooled[0] as Awaited<ReturnType<(typeof coreJobs)[0]>>;
  const stages = pooled[1] as Awaited<ReturnType<(typeof coreJobs)[1]>>;
  const usersRaw = pooled[2] as Awaited<ReturnType<(typeof coreJobs)[2]>>;
  const roles = pooled[3] as Awaited<ReturnType<(typeof coreJobs)[3]>>;
  const warehouses = pooled[4] as Awaited<ReturnType<(typeof coreJobs)[4]>>;
  const categories = pooled[5] as Awaited<ReturnType<(typeof coreJobs)[5]>>;
  const vendors = pooled[6] as Awaited<ReturnType<(typeof coreJobs)[6]>>;
  const accounts = coreOnly
    ? []
    : (pooled[7] as Awaited<ReturnType<(typeof catalogJobs)[0]>>);
  const contacts = coreOnly
    ? []
    : (pooled[8] as Awaited<ReturnType<(typeof catalogJobs)[1]>>);
  const products = coreOnly
    ? []
    : (pooled[9] as Awaited<ReturnType<(typeof catalogJobs)[2]>>);

  const roleById = Object.fromEntries(roles.map((role) => [role.id, role]));
  const users = usersRaw.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    roleId: u.roleId,
    roleCode: roleById[u.roleId]?.code ?? null,
    roleName: roleById[u.roleId]?.name ?? null,
  }));
  const body = {
    sources,
    stages,
    users,
    warehouses: sortWarehousesForDropdown(warehouses),
    categories,
    accounts,
    contacts,
    products,
    vendors,
  };
  lookupsCache.set(cacheKey, { at: Date.now(), body });
  return success(r, body);
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
