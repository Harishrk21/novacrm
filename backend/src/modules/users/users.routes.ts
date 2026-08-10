import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";

const createBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().nullable().optional(),
  roleCode: z.enum(["ADMIN", "MANAGER", "AGENT", "READ_ONLY"]).default("AGENT"),
});

const updateBody = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]).optional(),
  roleCode: z.enum(["ADMIN", "MANAGER", "AGENT", "READ_ONLY"]).optional(),
  password: z.string().min(8).optional(),
});

const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body: createBody, query: z.any(), params: z.any() });
const updateSchema = z.object({ body: updateBody, query: z.any(), params });
const idSchema = z.object({ body: z.any(), query: z.any(), params });

async function ensureRole(tenantId: string, code: string) {
  const existing = await prisma.role.findFirst({
    where: { tenantId, code, deletedAt: null },
  });
  if (existing) return existing;
  const names: Record<string, string> = {
    ADMIN: "Administrator",
    MANAGER: "Manager",
    AGENT: "Sales Agent",
    READ_ONLY: "Read only",
  };
  return prisma.role.create({
    data: {
      id: newId(),
      tenantId,
      code,
      name: names[code] ?? code,
      isSystem: true,
      permissions: code === "ADMIN" ? ["*"] : code === "READ_ONLY" ? ["read"] : ["crm", "erp"],
    },
  });
}

export const usersRouter = Router();
usersRouter.use(authenticate, requireTenant);

usersRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const [users, tenant] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: t, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        status: true,
        roleId: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.tenant.findFirst({
      where: { id: t },
      select: { maxUsers: true, name: true, slug: true },
    }),
  ]);
  const roles = await prisma.role.findMany({
    where: { tenantId: t, deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  const roleMap = Object.fromEntries(roles.map((role) => [role.id, role]));
  return success(r, {
    maxUsers: tenant?.maxUsers ?? 10,
    used: users.length,
    remaining: Math.max(0, (tenant?.maxUsers ?? 10) - users.length),
    items: users.map((u) => ({
      ...u,
      role: roleMap[u.roleId] ?? null,
    })),
  });
});

usersRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body as z.infer<typeof createBody>;
  const tenant = await prisma.tenant.findFirst({ where: { id: t, deletedAt: null } });
  if (!tenant) throw notFound("Tenant");
  const used = await prisma.user.count({ where: { tenantId: t, deletedAt: null } });
  if (used >= tenant.maxUsers) {
    throw new AppError(
      `Employee limit reached (${tenant.maxUsers}). Ask Nova admin to raise max users for this client.`,
      403,
    );
  }
  const email = d.email.toLowerCase().trim();
  const exists = await prisma.user.findFirst({
    where: { tenantId: t, email, deletedAt: null },
  });
  if (exists) throw new AppError("Email already exists in this workspace", 409);
  const role = await ensureRole(t, d.roleCode);
  const passwordHash = await bcrypt.hash(d.password, 12);
  const user = await prisma.user.create({
    data: {
      id: newId(),
      tenantId: t,
      roleId: role.id,
      name: d.name.trim(),
      email,
      phone: d.phone,
      passwordHash,
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
    },
  });
  return success(r, { ...user, role }, "Employee created", 201);
});

usersRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const d = q.body as z.infer<typeof updateBody>;
  const data: Record<string, unknown> = {};
  if (d.name) data.name = d.name.trim();
  if ("phone" in d) data.phone = d.phone;
  if (d.status) data.status = d.status;
  if (d.password) data.passwordHash = await bcrypt.hash(d.password, 12);
  if (d.roleCode) {
    const role = await ensureRole(t, d.roleCode);
    data.roleId = role.id;
  }
  const updated = await prisma.user.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data,
  });
  if (!updated.count) throw notFound("User");
  const user = await prisma.user.findFirst({
    where: { id, tenantId: t },
    select: { id: true, name: true, email: true, phone: true, status: true, roleId: true },
  });
  return success(r, user);
});

usersRouter.delete("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  if (id === q.auth!.userId) throw new AppError("You cannot delete your own login", 400);
  const updated = await prisma.user.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date(), status: "INACTIVE" },
  });
  if (!updated.count) throw notFound("User");
  return success(r, null, "Employee removed");
});
