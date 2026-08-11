import bcrypt from "bcryptjs";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";

export const listTenants = async () => {
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const [userCounts, categories] = await Promise.all([
    prisma.user.groupBy({
      by: ["tenantId"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.businessCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true },
    }),
  ]);
  const usersByTenant = Object.fromEntries(userCounts.map((r) => [r.tenantId, r._count._all]));
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  return tenants.map((t) => ({
    ...t,
    userCount: usersByTenant[t.id] ?? 0,
    category: catMap[t.businessCategoryId] ?? null,
  }));
};

type CreateTenantInput = {
  code: string;
  name: string;
  slug: string;
  businessCategoryId: string;
  status?: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
  plan?: "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  maxUsers?: number;
  trialEndsAt?: Date;
  modulesEnabled?: Record<string, boolean>;
  adminName?: string;
  adminEmail: string;
  adminPassword: string;
};

function moduleGroup(key: string) {
  if (key.startsWith("crm.")) return "CRM" as const;
  if (key.startsWith("erp.")) return "ERP" as const;
  return "ENGAGEMENT" as const;
}

function defaultStages(template: unknown): Array<{ code: string; name: string; probability: number; colorHex: string; isWon?: boolean; isLost?: boolean }> {
  const cfg = (template ?? {}) as { pipeline?: string[] };
  const names = cfg.pipeline?.length
    ? cfg.pipeline
    : ["Enquiry", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
  const colors = ["#64748B", "#0EA5E9", "#2563EB", "#F59E0B", "#10B981", "#EF4444"];
  return names.map((name, i) => {
    const upper = name.toUpperCase();
    const isWon = upper.includes("WON") || upper.includes("CLOSED") || upper.includes("ENROLLED") || upper.includes("COMPLETED");
    const isLost = upper.includes("LOST");
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || `STAGE_${i + 1}`;
    const probability = isWon ? 100 : isLost ? 0 : Math.min(90, 15 + i * 15);
    return { code, name, probability, colorHex: colors[i % colors.length], isWon, isLost };
  });
}

function defaultSources(template: unknown): string[] {
  const cfg = (template ?? {}) as { lead_sources?: string[] };
  return cfg.lead_sources?.length
    ? cfg.lead_sources
    : ["Website", "Referral", "Walk-in", "Campaign", "Partner"];
}

export async function createTenant(data: CreateTenantInput, adminId: string) {
  const category = await prisma.businessCategory.findFirst({
    where: { id: data.businessCategoryId, isActive: true, deletedAt: null },
  });
  if (!category) throw notFound("Business category");

  const slug = data.slug.toLowerCase().trim();
  const code = data.code.toUpperCase().trim();
  const adminEmail = data.adminEmail.toLowerCase().trim();

  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ slug }, { code }], deletedAt: null },
  });
  if (existing) throw new AppError("Client code or slug already exists", 409);

  const modules = (data.modulesEnabled ?? category.defaultModules) as Record<string, boolean>;
  const passwordHash = await bcrypt.hash(data.adminPassword, 12);
  const stages = defaultStages(category.templateConfig);
  const sources = defaultSources(category.templateConfig);

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        id: newId(),
        code,
        name: data.name.trim(),
        slug,
        businessCategoryId: category.id,
        status: data.status ?? "TRIAL",
        plan: data.plan ?? "STARTER",
        email: data.email ?? adminEmail,
        phone: data.phone,
        city: data.city,
        state: data.state,
        maxUsers: data.maxUsers ?? 10,
        trialEndsAt: data.trialEndsAt ?? new Date(Date.now() + 14 * 86400000),
        modulesEnabled: modules as object,
        terminology: (category.terminology ?? {}) as object,
        createdByAdminId: adminId,
        activatedAt: data.status === "ACTIVE" ? new Date() : null,
      },
    });

    const moduleRows = Object.entries(modules).map(([moduleKey, isEnabled], i) => ({
      id: newId(),
      tenantId: tenant.id,
      moduleKey,
      moduleGroup: moduleGroup(moduleKey),
      label: moduleKey.split(".").at(-1)!.replaceAll("_", " "),
      isEnabled,
      sortOrder: i,
    }));
    if (moduleRows.length) await tx.tenantModule.createMany({ data: moduleRows });

    const role = await tx.role.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        code: "ADMIN",
        name: "Administrator",
        isSystem: true,
        permissions: ["*"],
      },
    });

    const adminUser = await tx.user.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        roleId: role.id,
        name: data.adminName?.trim() || "Workspace Admin",
        email: adminEmail,
        passwordHash,
        status: "ACTIVE",
      },
    });

    for (const [sortOrder, stage] of stages.entries()) {
      await tx.pipelineStage.create({
        data: {
          id: newId(),
          tenantId: tenant.id,
          code: stage.code,
          name: stage.name,
          probability: stage.probability,
          colorHex: stage.colorHex,
          isWon: Boolean(stage.isWon),
          isLost: Boolean(stage.isLost),
          sortOrder,
          isActive: true,
        },
      });
    }

    for (const name of sources) {
      const sourceCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      await tx.leadSource.create({
        data: { id: newId(), tenantId: tenant.id, name, code: sourceCode, isActive: true },
      });
    }

    await tx.warehouse.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        code: "MAIN",
        name: data.city ? `Main Warehouse — ${data.city}` : "Main Warehouse",
        isDefault: true,
        isActive: true,
      },
    });

    for (const [sequenceKey, prefix] of [
      ["INVOICE", "INV-"],
      ["SO", "SO-"],
      ["PO", "PO-"],
      ["TICKET", "TKT-"],
      ["CUSTOMER", "CUS-"],
    ] as const) {
      await tx.numberSequence.create({
        data: {
          tenantId: tenant.id,
          sequenceKey,
          prefix,
          nextValue: 1,
          padding: 5,
        },
      });
    }

    return {
      ...tenant,
      adminUser: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
      },
      login: {
        tenantSlug: tenant.slug,
        email: adminUser.email,
        temporaryPassword: data.adminPassword,
      },
    };
  });
}

export async function updateTenant(id: string, data: Record<string, unknown>) {
  const allowed = [
    "name",
    "email",
    "phone",
    "city",
    "state",
    "status",
    "plan",
    "maxUsers",
    "modulesEnabled",
    "terminology",
    "website",
    "gstin",
  ];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data) patch[key] = data[key];
  }
  if (patch.status === "SUSPENDED") patch.suspendedAt = new Date();
  if (patch.status === "ACTIVE") {
    patch.activatedAt = new Date();
    patch.suspendedAt = null;
  }
  const r = await prisma.tenant.updateMany({ where: { id, deletedAt: null }, data: patch });
  if (!r.count) throw notFound("Tenant");
  return prisma.tenant.findUnique({ where: { id } });
}

export const suspendTenant = (id: string) =>
  updateTenant(id, { status: "SUSPENDED", suspendedAt: new Date() });

export const listCategories = () =>
  prisma.businessCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } });

export const createCategory = (data: Record<string, unknown>) =>
  prisma.businessCategory.create({ data: { ...data, id: newId() } as never });

export async function updateCategory(id: string, data: Record<string, unknown>) {
  const r = await prisma.businessCategory.updateMany({ where: { id, deletedAt: null }, data });
  if (!r.count) throw notFound("Business category");
  return prisma.businessCategory.findUnique({ where: { id } });
}

export const listTips = () =>
  prisma.featureTip.findMany({
    where: { tenantId: null, isActive: true },
    orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }],
  });

export async function stats() {
  const [
    total,
    active,
    trial,
    suspended,
    categories,
    users,
    leads,
    deals,
    invoices,
    products,
    tenants,
  ] = await Promise.all([
    prisma.tenant.count({ where: { deletedAt: null } }),
    prisma.tenant.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.tenant.count({ where: { status: "TRIAL", deletedAt: null } }),
    prisma.tenant.count({ where: { status: "SUSPENDED", deletedAt: null } }),
    prisma.businessCategory.count({ where: { deletedAt: null, isActive: true } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.lead.count({ where: { deletedAt: null } }),
    prisma.deal.count({ where: { deletedAt: null } }),
    prisma.invoice.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true,
        city: true,
        maxUsers: true,
        createdAt: true,
        businessCategoryId: true,
      },
    }),
  ]);

  const [byPlan, byCategoryRaw, cats] = await Promise.all([
    prisma.tenant.groupBy({
      by: ["plan"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.tenant.groupBy({
      by: ["businessCategoryId"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.businessCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, colorHex: true },
    }),
  ]);

  const catNames = Object.fromEntries(cats.map((c) => [c.id, c]));

  return {
    total,
    active,
    trial,
    suspended,
    categories,
    users,
    leads,
    deals,
    invoices,
    products,
    byPlan: byPlan.map((r) => ({ plan: r.plan, count: r._count._all })),
    byCategory: byCategoryRaw.map((r) => ({
      categoryId: r.businessCategoryId,
      name: catNames[r.businessCategoryId]?.name ?? "Unknown",
      color: catNames[r.businessCategoryId]?.colorHex ?? "#2563EB",
      count: r._count._all,
    })),
    recentClients: tenants,
  };
}
