import bcrypt from "bcryptjs";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { STANDARD_WAREHOUSES } from "../inventory/warehouses.service.js";
import { AppError, notFound } from "../../common/errors.js";
import { Prisma } from "@prisma/client";
import { permissionsJsonForRole } from "../../common/permissions.js";
import {
  mergePreferencesWithInventoryAreas,
  resolveInventoryAreas,
} from "../../common/inventoryAreas.js";
import { modulesForPlan, PLAN_CATALOG, listSubscriptionPacks, blankOnboardModules, type TenantPlanCode, type SubscriptionPack } from "../../common/plans.js";
import { writeAudit } from "../../common/audit.js";
import { mergeBranding, normalizeBranding, isReservedLoginSlug, type BrandPalette } from "../../common/branding.js";

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
  /** What the client paid for — drives module flags */
  subscriptionPack?: SubscriptionPack | "SALES" | "SALES_INVENTORY" | "HMS_FULL";
  /** HMS = full weighing ops pack; STANDARD = CRM-first (legacy; prefer subscriptionPack) */
  template?: "HMS" | "STANDARD";
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  country?: string;
  website?: string;
  gstin?: string;
  /** Max employees the company admin may create (including admin) */
  maxUsers?: number;
  trialEndsAt?: Date;
  modulesEnabled?: Record<string, boolean>;
  /** Color kit for this client's CRM UI */
  branding?: {
    palette: BrandPalette | string;
    locked?: boolean;
    accent?: string;
    accentHover?: string;
    sidebarBg?: string;
    loginTagline?: string;
  };
  logoUrl?: string | null;
  adminName?: string;
  adminEmail: string;
  adminPassword: string;
};

function moduleGroup(key: string) {
  if (key.startsWith("crm.")) return "CRM" as const;
  if (key.startsWith("erp.")) return "ERP" as const;
  if (key.startsWith("engagement.")) return "ENGAGEMENT" as const;
  if (key === "reports") return "REPORTS" as const;
  if (key === "settings") return "SETTINGS" as const;
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

  if (isReservedLoginSlug(slug)) {
    throw new AppError(`Login slug "${slug}" is reserved for the platform`, 400);
  }

  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ slug }, { code }], deletedAt: null },
  });
  if (existing) throw new AppError("Client code or slug already exists", 409);

  const planCode = (data.plan ?? "STARTER") as TenantPlanCode;
  const weighing = category.code === "WEIGHING_MACHINES";
  /** Explicit pack from platform; otherwise blank shell — toggle modules on client control panel. */
  const subscriptionPack = data.subscriptionPack as SubscriptionPack | undefined;
  const template =
    data.template ??
    (subscriptionPack === "HMS_FULL" || weighing ? "HMS" : "STANDARD");
  const planned = modulesForPlan(planCode, {
    template,
    subscriptionPack,
    override: data.modulesEnabled,
  });
  const modules = data.modulesEnabled
    ? planned.modules
    : subscriptionPack
      ? planned.modules
      : blankOnboardModules();
  const maxUsers =
    data.maxUsers ??
    (data.status === "TRIAL" ? Math.min(5, planned.maxUsers) : planned.maxUsers);
  const passwordHash = await bcrypt.hash(data.adminPassword, 10);
  const stages = defaultStages(category.templateConfig);
  const sources = defaultSources(category.templateConfig);
  const branding = normalizeBranding(data.branding ?? { palette: "violet", locked: true });

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        id: newId(),
        code,
        name: data.name.trim(),
        slug,
        businessCategoryId: category.id,
        status: data.status ?? "TRIAL",
        plan: planCode,
        email: data.email ?? adminEmail,
        phone: data.phone,
        city: data.city,
        state: data.state,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        postalCode: data.postalCode,
        country: data.country ?? "IN",
        website: data.website,
        gstin: data.gstin,
        maxUsers,
        trialEndsAt: data.trialEndsAt ?? new Date(Date.now() + 14 * 86400000),
        modulesEnabled: modules as object,
        terminology: (category.terminology ?? {}) as object,
        branding: branding as object,
        logoUrl: data.logoUrl?.trim() || null,
        settings: {
          template,
          subscriptionPack: subscriptionPack ?? planned.subscriptionPack ?? null,
          planFeatures: planned.features,
          onboarding: { createdAt: new Date().toISOString() },
        },
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

    const staffRoles: Array<{ code: string; name: string }> = [
      { code: "ADMIN", name: "Administrator" },
      { code: "MANAGER", name: "Manager" },
      { code: "SERVICE_DESK", name: "Service Desk" },
      { code: "SERVICE_ENGINEER", name: "Service Engineer" },
      { code: "SALES_EXECUTIVE", name: "Sales Desk" },
      { code: "WAREHOUSE", name: "Warehouse Team" },
      { code: "READ_ONLY", name: "Read only" },
    ];
    const createdRoles: Record<string, string> = {};
    for (const r of staffRoles) {
      const row = await tx.role.create({
        data: {
          id: newId(),
          tenantId: tenant.id,
          code: r.code,
          name: r.name,
          isSystem: true,
          permissions: permissionsJsonForRole(r.code),
        },
      });
      createdRoles[r.code] = row.id;
    }
    const roleId = createdRoles.ADMIN!;

    const adminUser = await tx.user.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        roleId,
        name: data.adminName?.trim() || "Workspace Admin",
        email: adminEmail,
        passwordHash,
        tempPassword: data.adminPassword,
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

    for (const w of STANDARD_WAREHOUSES) {
      await tx.warehouse.create({
        data: {
          id: newId(),
          tenantId: tenant.id,
          code: w.code,
          name: w.name,
          isDefault: w.isDefault,
          isActive: true,
        },
      });
    }

    for (const [sequenceKey, prefix] of [
      ["INVOICE", "PI-"],
      ["SO", "SO-"],
      ["PO", "PO-"],
      ["TICKET", "TKT-"],
      ["CUSTOMER", "CUS-"],
      ["DEMO_DC", "DC-"],
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
      template,
      subscriptionPack: subscriptionPack ?? planned.subscriptionPack ?? null,
      planFeatures: planned.features,
    };
  });
}

export async function resetTenantAdminPassword(tenantId: string, newPassword: string) {
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  if (!tenant) throw notFound("Tenant");
  const adminRole = await prisma.role.findFirst({
    where: { tenantId, code: "ADMIN", deletedAt: null },
  });
  if (!adminRole) throw notFound("Admin role");
  const admin = await prisma.user.findFirst({
    where: { tenantId, roleId: adminRole.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw notFound("Company admin user");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash, tempPassword: newPassword, status: "ACTIVE" },
  });
  return { tenantId, adminEmail: admin.email, adminName: admin.name, temporaryPassword: newPassword };
}

/** Platform: list all staff logins for a client workspace (includes last set temp password). */
export async function listTenantUsers(tenantId: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) throw notFound("Tenant");

  const users = await prisma.user.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      tempPassword: true,
      lastLoginAt: true,
      createdAt: true,
      roleId: true,
      preferences: true,
    },
  });
  const roleIds = [...new Set(users.map((u) => u.roleId))];
  const roles = roleIds.length
    ? await prisma.role.findMany({
        where: { id: { in: roleIds }, tenantId },
        select: { id: true, code: true, name: true },
      })
    : [];
  const roleMap = Object.fromEntries(roles.map((r) => [r.id, r]));

  return {
    tenant,
    loginPath: `/login/${tenant.slug}`,
    users: users.map((u) => {
      const role = roleMap[u.roleId];
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        status: u.status,
        roleCode: role?.code ?? "—",
        roleName: role?.name ?? "—",
        temporaryPassword: u.tempPassword,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        inventoryAreas: resolveInventoryAreas(u.preferences, role?.code),
      };
    }),
  };
}

/** Platform: assign which inventory areas a staff user can see/manage. */
export async function setTenantUserInventoryAreas(
  tenantId: string,
  userId: string,
  inventoryAreas: {
    machines: boolean;
    sparesBilling: boolean;
    sparesWeighing: boolean;
  },
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });
  if (!user) throw notFound("User");
  const preferences = mergePreferencesWithInventoryAreas(
    user.preferences,
    inventoryAreas,
  ) as Prisma.InputJsonValue;
  await prisma.user.update({
    where: { id: user.id },
    data: { preferences },
  });
  const role = await prisma.role.findFirst({
    where: { id: user.roleId, tenantId },
    select: { code: true, name: true },
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleCode: role?.code ?? "—",
    inventoryAreas: resolveInventoryAreas(preferences, role?.code),
  };
}

/** Platform: set / reset any staff password for a tenant. */
export async function setTenantUserPassword(tenantId: string, userId: string, newPassword: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
  });
  if (!user) throw notFound("User");
  const role = await prisma.role.findFirst({
    where: { id: user.roleId, tenantId },
    select: { code: true, name: true },
  });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, tempPassword: newPassword, status: "ACTIVE" },
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleCode: role?.code ?? "—",
    temporaryPassword: newPassword,
  };
}

export async function setTenantModules(tenantId: string, modulesEnabled: Record<string, boolean>) {
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  if (!tenant) throw notFound("Tenant");
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { modulesEnabled: modulesEnabled as object },
  });
  const keys = Object.entries(modulesEnabled);
  for (const [i, [moduleKey, isEnabled]] of keys.entries()) {
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey } },
      update: { isEnabled },
      create: {
        id: newId(),
        tenantId,
        moduleKey,
        moduleGroup: moduleGroup(moduleKey),
        label: moduleKey.split(".").at(-1)!.replaceAll("_", " "),
        isEnabled,
        sortOrder: i,
      },
    });
  }
  return prisma.tenantModule.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } });
}

export { PLAN_CATALOG, listSubscriptionPacks };
export function listPlans() {
  return Object.values(PLAN_CATALOG);
}

export async function updateTenant(id: string, data: Record<string, unknown>) {
  const tenant = await prisma.tenant.findFirst({ where: { id, deletedAt: null } });
  if (!tenant) throw notFound("Tenant");

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
    "logoUrl",
    "addressLine1",
    "addressLine2",
    "postalCode",
    "country",
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

  if ("branding" in data) {
    patch.branding = mergeBranding(tenant.branding, data.branding) as object;
  }

  const pack = data.subscriptionPack;
  if (typeof pack === "string" && pack in { SALES: 1, SALES_INVENTORY: 1, HMS_FULL: 1 }) {
    const planned = modulesForPlan((patch.plan as string) ?? tenant.plan, {
      subscriptionPack: pack,
      override: (patch.modulesEnabled as Record<string, boolean> | undefined) ?? undefined,
    });
    patch.modulesEnabled = planned.modules;
    const prevSettings =
      tenant.settings && typeof tenant.settings === "object" && !Array.isArray(tenant.settings)
        ? (tenant.settings as Record<string, unknown>)
        : {};
    patch.settings = {
      ...prevSettings,
      subscriptionPack: pack,
      planFeatures: planned.features,
    };
  }

  const r = await prisma.tenant.updateMany({ where: { id, deletedAt: null }, data: patch });
  if (!r.count) throw notFound("Tenant");

  if (patch.modulesEnabled && typeof patch.modulesEnabled === "object") {
    await setTenantModules(id, patch.modulesEnabled as Record<string, boolean>);
  }

  try {
    const { cacheDel } = await import("../../config/redis.js");
    await cacheDel("platform:dashboard:stats");
  } catch {
    /* ignore */
  }

  return prisma.tenant.findUnique({ where: { id } });
}

export const suspendTenant = (id: string) =>
  updateTenant(id, { status: "SUSPENDED", suspendedAt: new Date() });

export const listCategories = () =>
  prisma.businessCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } });

export const createCategory = (data: Record<string, unknown>) =>
  prisma.businessCategory.create({
    data: {
      id: newId(),
      code: String(data.code),
      name: String(data.name),
      description: data.description != null ? String(data.description) : null,
      icon: data.icon != null ? String(data.icon) : "scale",
      colorHex: data.colorHex != null ? String(data.colorHex) : "#2563EB",
      defaultCurrency: "INR",
      defaultTimezone: "Asia/Kolkata",
      defaultModules: (data.defaultModules as object) ?? {},
      terminology: (data.terminology as object) ?? {},
      templateConfig: (data.templateConfig as object) ?? {},
      isActive: data.isActive !== false,
      sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
    },
  });

export async function updateCategory(id: string, data: Record<string, unknown>) {
  const r = await prisma.businessCategory.updateMany({ where: { id, deletedAt: null }, data });
  if (!r.count) throw notFound("Business category");
  return prisma.businessCategory.findUnique({ where: { id } });
}

export const listTips = (includeInactive = false) =>
  prisma.featureTip.findMany({
    where: {
      tenantId: null,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }],
  });

export async function createTip(data: {
  moduleKey: string;
  sectionKey: string;
  title: string;
  body: string;
  tipType?: "TIP" | "NOTE" | "WARNING" | "BEST_PRACTICE";
  sortOrder?: number;
  isActive?: boolean;
}) {
  return prisma.featureTip.create({
    data: {
      id: newId(),
      tenantId: null,
      moduleKey: data.moduleKey.trim(),
      sectionKey: data.sectionKey.trim(),
      title: data.title.trim(),
      body: data.body.trim(),
      tipType: data.tipType ?? "TIP",
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive !== false,
    },
  });
}

export async function updateTip(
  id: string,
  data: Partial<{
    moduleKey: string;
    sectionKey: string;
    title: string;
    body: string;
    tipType: "TIP" | "NOTE" | "WARNING" | "BEST_PRACTICE";
    sortOrder: number;
    isActive: boolean;
  }>,
) {
  const existing = await prisma.featureTip.findFirst({ where: { id, tenantId: null } });
  if (!existing) throw notFound("Tip");
  return prisma.featureTip.update({
    where: { id },
    data: {
      ...(data.moduleKey != null ? { moduleKey: data.moduleKey.trim() } : {}),
      ...(data.sectionKey != null ? { sectionKey: data.sectionKey.trim() } : {}),
      ...(data.title != null ? { title: data.title.trim() } : {}),
      ...(data.body != null ? { body: data.body.trim() } : {}),
      ...(data.tipType != null ? { tipType: data.tipType } : {}),
      ...(data.sortOrder != null ? { sortOrder: data.sortOrder } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
    },
  });
}

export async function deleteTip(id: string) {
  const r = await prisma.featureTip.deleteMany({ where: { id, tenantId: null } });
  if (!r.count) throw notFound("Tip");
  return { id };
}

/** Apply a subscription pack to a live client (modules + settings). */
export async function applySubscriptionPack(tenantId: string, pack: SubscriptionPack) {
  return updateTenant(tenantId, { subscriptionPack: pack });
}

export async function softDeleteCategory(id: string) {
  const r = await prisma.businessCategory.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false },
  });
  if (!r.count) throw notFound("Business category");
  return { id };
}

export async function stats() {
  const { cacheGet, cacheSet } = await import("../../config/redis.js");
  const cacheKey = "platform:dashboard:stats";
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

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

  const out = {
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
  // Short TTL — overview should feel instant on refresh without going stale for long
  await cacheSet(cacheKey, out, 45);
  return out;
}
