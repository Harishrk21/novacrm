import { z } from "zod";

const tenant = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens"),
  businessCategoryId: z.string().min(1).max(36),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
  plan: z.enum(["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"]).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(2).optional(),
  website: z.string().max(255).optional(),
  gstin: z.string().max(32).optional(),
  maxUsers: z.coerce.number().int().positive().optional(),
  trialEndsAt: z.coerce.date().optional(),
  modulesEnabled: z.record(z.boolean()).optional(),
  template: z.enum(["HMS", "STANDARD"]).optional(),
  subscriptionPack: z.enum(["SALES", "SALES_INVENTORY", "HMS_FULL"]).optional(),
  branding: z
    .object({
      palette: z.enum(["ocean", "emerald", "violet", "amber", "rose", "slate"]),
      locked: z.boolean().optional(),
      accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentHover: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      sidebarBg: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      loginTagline: z.string().max(160).optional(),
    })
    .optional(),
  logoUrl: z.string().max(512).nullable().optional(),
  adminName: z.string().min(2).optional(),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

const category = z.object({
  code: z.string().regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  icon: z.string().optional(),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  defaultModules: z.record(z.boolean()).optional(),
  terminology: z.record(z.string()).optional(),
  templateConfig: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export const createTenantSchema = z.object({ body: tenant, query: z.any(), params: z.any() });
export const updateTenantSchema = z.object({
  body: tenant
    .omit({ adminEmail: true, adminPassword: true, adminName: true, code: true, slug: true, businessCategoryId: true })
    .partial()
    .extend({
      status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
      plan: z.enum(["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"]).optional(),
      maxUsers: z.coerce.number().int().positive().optional(),
      modulesEnabled: z.record(z.boolean()).optional(),
      subscriptionPack: z.enum(["SALES", "SALES_INVENTORY", "HMS_FULL"]).optional(),
      branding: z
        .object({
          palette: z.enum(["ocean", "emerald", "violet", "amber", "rose", "slate"]).optional(),
          locked: z.boolean().optional(),
          accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
          accentHover: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
          sidebarBg: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
          loginTagline: z.string().max(160).optional().nullable(),
        })
        .optional(),
      terminology: z.record(z.string()).optional(),
      website: z.string().optional(),
      gstin: z.string().optional(),
      logoUrl: z.string().max(512).nullable().optional(),
      addressLine1: z.string().max(255).optional(),
      addressLine2: z.string().max(255).optional(),
      postalCode: z.string().max(20).optional(),
      country: z.string().max(2).optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
    }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
export const idSchema = z.object({
  body: z.any(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
export const createCategorySchema = z.object({ body: category, query: z.any(), params: z.any() });
export const updateCategorySchema = z.object({
  body: category.partial(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
export const resetAdminPasswordSchema = z.object({
  body: z.object({ password: z.string().min(8).max(128) }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
export const setUserPasswordSchema = z.object({
  body: z.object({ password: z.string().min(8).max(128) }),
  query: z.any(),
  params: z.object({
    id: z.string().min(1).max(36),
    userId: z.string().min(1).max(36),
  }),
});
export const setUserInventoryAreasSchema = z.object({
  body: z.object({
    inventoryAreas: z.object({
      machines: z.boolean(),
      sparesBilling: z.boolean(),
      sparesWeighing: z.boolean(),
    }),
  }),
  query: z.any(),
  params: z.object({
    id: z.string().min(1).max(36),
    userId: z.string().min(1).max(36),
  }),
});
export const setModulesSchema = z.object({
  body: z.object({ modulesEnabled: z.record(z.boolean()) }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const applyPackSchema = z.object({
  body: z.object({
    subscriptionPack: z.enum(["SALES", "SALES_INVENTORY", "HMS_FULL"]),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const createTipSchema = z.object({
  body: z.object({
    moduleKey: z.string().min(1).max(64),
    sectionKey: z.string().min(1).max(64),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(4000),
    tipType: z.enum(["TIP", "NOTE", "WARNING", "BEST_PRACTICE"]).optional(),
    sortOrder: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const updateTipSchema = z.object({
  body: z
    .object({
      moduleKey: z.string().min(1).max(64).optional(),
      sectionKey: z.string().min(1).max(64).optional(),
      title: z.string().min(1).max(160).optional(),
      body: z.string().min(1).max(4000).optional(),
      tipType: z.enum(["TIP", "NOTE", "WARNING", "BEST_PRACTICE"]).optional(),
      sortOrder: z.coerce.number().int().optional(),
      isActive: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
