import { Router } from "express";
import { authenticate, requirePlatform, requirePlatformRoles } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import * as c from "./platform.controller.js";
import * as s from "./platform.schema.js";

export const platformRouter = Router();
platformRouter.use(authenticate, requirePlatform);

/** Read — all platform roles */
platformRouter.get("/plans", c.listPlans);
platformRouter.get("/tenants", c.listTenants);
platformRouter.get("/business-categories", c.listCategories);
platformRouter.get("/tips", c.listTips);
platformRouter.get("/dashboard/stats", c.stats);

/** Onboard — SUPER_ADMIN only */
platformRouter.post(
  "/tenants",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.createTenantSchema),
  c.createTenant,
);
platformRouter.post(
  "/business-categories",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.createCategorySchema),
  c.createCategory,
);
platformRouter.patch(
  "/business-categories/:id",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.updateCategorySchema),
  c.updateCategory,
);
platformRouter.delete(
  "/business-categories/:id",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.idSchema),
  c.deleteCategory,
);

platformRouter.post(
  "/tips",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.createTipSchema),
  c.createTip,
);
platformRouter.patch(
  "/tips/:id",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.updateTipSchema),
  c.updateTip,
);
platformRouter.delete(
  "/tips/:id",
  requirePlatformRoles("SUPER_ADMIN"),
  validate(s.idSchema),
  c.deleteTip,
);

/** Plan / status / modules — SUPER_ADMIN or BILLING */
platformRouter.post(
  "/tenants/:id/apply-pack",
  requirePlatformRoles("SUPER_ADMIN", "BILLING"),
  validate(s.applyPackSchema),
  c.applyPack,
);
platformRouter.patch(
  "/tenants/:id",
  requirePlatformRoles("SUPER_ADMIN", "BILLING"),
  validate(s.updateTenantSchema),
  c.updateTenant,
);
platformRouter.post(
  "/tenants/:id/suspend",
  requirePlatformRoles("SUPER_ADMIN", "BILLING"),
  validate(s.idSchema),
  c.suspendTenant,
);
platformRouter.post(
  "/tenants/:id/reactivate",
  requirePlatformRoles("SUPER_ADMIN", "BILLING"),
  validate(s.idSchema),
  c.reactivateTenant,
);
platformRouter.post(
  "/tenants/:id/modules",
  requirePlatformRoles("SUPER_ADMIN", "BILLING"),
  validate(s.setModulesSchema),
  c.setModules,
);

/** Support can reset company admin password; billing cannot */
platformRouter.post(
  "/tenants/:id/reset-admin-password",
  requirePlatformRoles("SUPER_ADMIN", "SUPPORT"),
  validate(s.resetAdminPasswordSchema),
  c.resetAdminPassword,
);
platformRouter.get(
  "/tenants/:id/users",
  requirePlatformRoles("SUPER_ADMIN", "SUPPORT"),
  validate(s.idSchema),
  c.listTenantUsers,
);
platformRouter.post(
  "/tenants/:id/users/:userId/password",
  requirePlatformRoles("SUPER_ADMIN", "SUPPORT"),
  validate(s.setUserPasswordSchema),
  c.setTenantUserPassword,
);
platformRouter.patch(
  "/tenants/:id/users/:userId/inventory-areas",
  requirePlatformRoles("SUPER_ADMIN", "SUPPORT"),
  validate(s.setUserInventoryAreasSchema),
  c.setTenantUserInventoryAreas,
);
