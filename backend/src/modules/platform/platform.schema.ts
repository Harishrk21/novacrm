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
  maxUsers: z.coerce.number().int().positive().optional(),
  trialEndsAt: z.coerce.date().optional(),
  modulesEnabled: z.record(z.boolean()).optional(),
  adminName: z.string().min(2).optional(),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

const category = z.object({
  code: z.string().regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  defaultModules: z.record(z.boolean()),
  terminology: z.record(z.string()),
  templateConfig: z.record(z.unknown()),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const createTenantSchema = z.object({ body: tenant, query: z.any(), params: z.any() });
export const updateTenantSchema = z.object({
  body: tenant
    .omit({ adminEmail: true, adminPassword: true, adminName: true, code: true, slug: true, businessCategoryId: true })
    .partial()
    .extend({
      status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
      plan: z.enum(["STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"]).optional(),
      modulesEnabled: z.record(z.boolean()).optional(),
      terminology: z.record(z.string()).optional(),
      website: z.string().optional(),
      gstin: z.string().optional(),
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
