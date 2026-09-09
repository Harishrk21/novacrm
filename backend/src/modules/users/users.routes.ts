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

const roleEnum = z.enum([
  "ADMIN",
  "MANAGER",
  "AGENT",
  "READ_ONLY",
  "SERVICE_DESK",
  "SERVICE_ENGINEER",
  "SALES_EXECUTIVE",
  "WAREHOUSE",
]);

const employeeFields = {
  employeeCode: z.string().min(1).max(40).optional().nullable(),
  department: z.string().max(80).optional().nullable(),
  designation: z.string().max(80).optional().nullable(),
  joinDate: z.string().optional().nullable(),
  salary: z.union([z.number(), z.string()]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
};

const avatarUrlField = z
  .string()
  .max(512)
  .nullable()
  .optional()
  .refine(
    (v) =>
      v == null ||
      v === "" ||
      v.startsWith("/uploads/") ||
      /^https?:\/\//i.test(v),
    "Avatar must be an uploaded path or URL",
  );

const createBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().nullable().optional(),
  avatarUrl: avatarUrlField,
  roleCode: roleEnum.default("SERVICE_ENGINEER"),
  status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]).optional(),
  ...employeeFields,
});

const updateBody = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().nullable().optional(),
  avatarUrl: avatarUrlField,
  status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]).optional(),
  roleCode: roleEnum.optional(),
  password: z.string().min(8).optional(),
  ...employeeFields,
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
    AGENT: "Sales Executive",
    READ_ONLY: "Read only",
    SERVICE_DESK: "Service Desk",
    SERVICE_ENGINEER: "Service Engineer",
    SALES_EXECUTIVE: "Sales Executive",
    WAREHOUSE: "Warehouse Team",
  };
  const permissions =
    code === "ADMIN"
      ? ["*"]
      : code === "READ_ONLY"
        ? ["read"]
        : code === "WAREHOUSE"
          ? ["erp"]
          : code === "SERVICE_DESK" || code === "SERVICE_ENGINEER"
            ? ["crm"]
            : code === "SALES_EXECUTIVE" || code === "AGENT"
              ? ["crm"]
              : ["crm", "erp"];
  return prisma.role.create({
    data: {
      id: newId(),
      tenantId,
      code,
      name: names[code] ?? code,
      isSystem: true,
      permissions,
    },
  });
}

async function nextEmployeeCode(tenantId: string) {
  const count = await prisma.employee.count({ where: { tenantId } });
  let n = count + 1;
  for (let i = 0; i < 50; i++) {
    const code = `EMP-${String(n).padStart(5, "0")}`;
    const exists = await prisma.employee.findFirst({
      where: { tenantId, employeeCode: code },
    });
    if (!exists) return code;
    n += 1;
  }
  return `EMP-${Date.now().toString().slice(-8)}`;
}

function parseJoinDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSalary(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

type EmpInput = {
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  joinDate?: string | null;
  salary?: number | string | null;
  notes?: string | null;
};

/** Soft-deleted rows still hold @@unique codes — free a code when reusing. */
async function ensureEmployeeCodeAvailable(
  tenantId: string,
  code: string,
  exceptEmployeeId?: string,
) {
  const clash = await prisma.employee.findFirst({
    where: {
      tenantId,
      employeeCode: code,
      ...(exceptEmployeeId ? { NOT: { id: exceptEmployeeId } } : {}),
    },
  });
  if (!clash) return;
  if (clash.deletedAt) {
    await prisma.employee.update({
      where: { id: clash.id },
      data: { employeeCode: `${code}-X-${Date.now().toString(36).slice(-6)}` },
    });
    return;
  }
  throw new AppError("Employee code already exists", 409);
}

async function upsertEmployeeProfile(
  tenantId: string,
  userId: string,
  base: { name: string; email: string; phone?: string | null },
  emp: EmpInput,
) {
  const existing =
    (await prisma.employee.findFirst({
      where: { tenantId, userId, deletedAt: null },
    })) ??
    (await prisma.employee.findFirst({
      where: { tenantId, userId, deletedAt: { not: null } },
      orderBy: { updatedAt: "desc" },
    }));
  const notes = emp.notes?.trim() || null;
  const customFields = notes ? { notes } : {};
  const salary = parseSalary(emp.salary);
  const joinDate = parseJoinDate(emp.joinDate ?? undefined);
  const department = emp.department?.trim() || null;
  const designation = emp.designation?.trim() || null;

  if (existing) {
    const code =
      emp.employeeCode?.trim() && emp.employeeCode.trim() !== existing.employeeCode
        ? emp.employeeCode.trim()
        : existing.employeeCode;
    await ensureEmployeeCodeAvailable(tenantId, code, existing.id);
    return prisma.employee.update({
      where: { id: existing.id },
      data: {
        name: base.name,
        email: base.email,
        phone: base.phone ?? null,
        employeeCode: code,
        department,
        designation,
        joinDate,
        salary: salary ?? undefined,
        customFields,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
  }

  const employeeCode = emp.employeeCode?.trim() || (await nextEmployeeCode(tenantId));
  await ensureEmployeeCodeAvailable(tenantId, employeeCode);
  return prisma.employee.create({
    data: {
      id: newId(),
      tenantId,
      userId,
      employeeCode,
      name: base.name,
      email: base.email,
      phone: base.phone ?? null,
      department,
      designation,
      joinDate,
      salary,
      customFields,
      status: "ACTIVE",
    },
  });
}

function serializeEmployee(emp: {
  id: string;
  employeeCode: string;
  department: string | null;
  designation: string | null;
  joinDate: Date | null;
  salary: unknown;
  customFields: unknown;
  status: string;
} | null) {
  if (!emp) return null;
  const cf =
    emp.customFields && typeof emp.customFields === "object"
      ? (emp.customFields as Record<string, unknown>)
      : {};
  return {
    id: emp.id,
    employeeCode: emp.employeeCode,
    department: emp.department,
    designation: emp.designation,
    joinDate: emp.joinDate ? emp.joinDate.toISOString().slice(0, 10) : null,
    salary: emp.salary != null ? Number(emp.salary) : null,
    notes: typeof cf.notes === "string" ? cf.notes : null,
    status: emp.status,
  };
}

export const usersRouter = Router();
usersRouter.use(authenticate, requireTenant);

usersRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const [users, employees] = await Promise.all([
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
    prisma.employee.findMany({
      where: { tenantId: t, deletedAt: null, userId: { not: null } },
    }),
  ]);
  const roles = await prisma.role.findMany({
    where: { tenantId: t, deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  const roleMap = Object.fromEntries(roles.map((role) => [role.id, role]));
  const empByUser = Object.fromEntries(
    employees.filter((e) => e.userId).map((e) => [e.userId!, e]),
  );
  return success(r, {
    /** HMS has no seat cap — keep fields for older clients; remaining is effectively unlimited. */
    maxUsers: null,
    used: users.length,
    remaining: null,
    unlimited: true,
    items: users.map((u) => ({
      ...u,
      role: roleMap[u.roleId] ?? null,
      employee: serializeEmployee(empByUser[u.id] ?? null),
    })),
  });
});

usersRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const user = await prisma.user.findFirst({
    where: { id, tenantId: t, deletedAt: null },
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
  });
  if (!user) throw notFound("User");
  const [role, employee] = await Promise.all([
    prisma.role.findFirst({
      where: { id: user.roleId, tenantId: t },
      select: { id: true, code: true, name: true },
    }),
    prisma.employee.findFirst({ where: { tenantId: t, userId: id, deletedAt: null } }),
  ]);
  return success(r, {
    ...user,
    role,
    employee: serializeEmployee(employee),
  });
});

usersRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body as z.infer<typeof createBody>;
  const tenant = await prisma.tenant.findFirst({ where: { id: t, deletedAt: null } });
  if (!tenant) throw notFound("Tenant");
  const email = d.email.toLowerCase().trim();

  const activeSameEmail = await prisma.user.findFirst({
    where: { tenantId: t, email, deletedAt: null },
  });
  if (activeSameEmail) {
    throw new AppError(
      `Email already in use by ${activeSameEmail.name}. Pick another email or edit that employee.`,
      409,
    );
  }

  /** Soft-deleted users still occupy @@unique([tenantId, email]) — restore instead of failing. */
  const removed = await prisma.user.findFirst({
    where: { tenantId: t, email, deletedAt: { not: null } },
  });

  if (d.employeeCode?.trim()) {
    const codeTaken = await prisma.employee.findFirst({
      where: {
        tenantId: t,
        employeeCode: d.employeeCode.trim(),
        deletedAt: null,
        ...(removed ? { NOT: { userId: removed.id } } : {}),
      },
    });
    if (codeTaken) throw new AppError("Employee code already exists", 409);
  }
  const role = await ensureRole(t, d.roleCode);
  const phoneDigits = String(d.phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    throw new AppError(
      "WhatsApp / mobile number is required (include country code, e.g. 91…)",
      400,
    );
  }
  const passwordHash = await bcrypt.hash(d.password, 12);

  let user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatarUrl?: string | null;
    status: string;
    createdAt: Date;
  };
  let restored = false;

  if (removed) {
    await prisma.user.update({
      where: { id: removed.id },
      data: {
        roleId: role.id,
        name: d.name.trim(),
        phone: d.phone,
        passwordHash,
        status: d.status ?? "ACTIVE",
        deletedAt: null,
        ...("avatarUrl" in d
          ? { avatarUrl: d.avatarUrl?.trim() || null }
          : {}),
      },
    });
    const row = await prisma.user.findFirst({
      where: { id: removed.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });
    if (!row) throw notFound("User");
    user = row;
    restored = true;
  } else {
    user = await prisma.user.create({
      data: {
        id: newId(),
        tenantId: t,
        roleId: role.id,
        name: d.name.trim(),
        email,
        phone: d.phone,
        avatarUrl: d.avatarUrl?.trim() || null,
        passwordHash,
        status: d.status ?? "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });
  }

  const employee = await upsertEmployeeProfile(
    t,
    user.id,
    { name: user.name, email: user.email, phone: user.phone },
    d,
  );
  return success(
    r,
    { ...user, role, employee: serializeEmployee(employee), restored },
    restored ? "Employee restored (was previously removed)" : "Employee created",
    restored ? 200 : 201,
  );
});

usersRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const d = q.body as z.infer<typeof updateBody>;
  const existing = await prisma.user.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!existing) throw notFound("User");

  const data: Record<string, unknown> = {};
  if (d.name) data.name = d.name.trim();
  if ("phone" in d) data.phone = d.phone;
  if ("avatarUrl" in d) data.avatarUrl = d.avatarUrl?.trim() || null;
  if (d.status) data.status = d.status;
  if (d.password) data.passwordHash = await bcrypt.hash(d.password, 12);
  if (d.roleCode) {
    const role = await ensureRole(t, d.roleCode);
    data.roleId = role.id;
  }
  const nextPhone = "phone" in d ? d.phone : existing.phone;
  const phoneDigits = String(nextPhone ?? "").replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    throw new AppError(
      "WhatsApp / mobile number is required (include country code, e.g. 91…)",
      400,
    );
  }
  if (Object.keys(data).length) {
    await prisma.user.updateMany({
      where: { id, tenantId: t, deletedAt: null },
      data,
    });
  }
  const user = await prisma.user.findFirst({
    where: { id, tenantId: t },
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
  });
  if (!user) throw notFound("User");
  const role = await prisma.role.findFirst({
    where: { id: user.roleId },
    select: { id: true, code: true, name: true },
  });
  const employee = await upsertEmployeeProfile(
    t,
    user.id,
    { name: user.name, email: user.email, phone: user.phone },
    d,
  );
  return success(r, { ...user, role, employee: serializeEmployee(employee) });
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
  await prisma.employee.updateMany({
    where: { tenantId: t, userId: id, deletedAt: null },
    data: { deletedAt: new Date(), status: "RESIGNED" },
  });
  return success(r, null, "Employee removed");
});
