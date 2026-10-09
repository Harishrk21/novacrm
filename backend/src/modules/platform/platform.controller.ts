import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { writeAudit } from "../../common/audit.js";
import * as s from "./platform.service.js";

const meta = (q: Request) => ({
  ipAddress: q.ip,
  userAgent: q.get("user-agent") ?? undefined,
});

export const listTenants = async (_q: Request, r: Response) => success(r, await s.listTenants());

export const createTenant = async (q: Request, r: Response) => {
  const row = await s.createTenant(q.body, q.auth!.userId);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.create",
    entityType: "tenant",
    entityId: row.id,
    tenantId: row.id,
    afterJson: { name: row.name, slug: row.slug, plan: row.plan },
  });
  return success(r, row, "Tenant created", 201);
};

export const updateTenant = async (q: Request, r: Response) => {
  const id = paramId(q);
  const row = await s.updateTenant(id, q.body);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.update",
    entityType: "tenant",
    entityId: id,
    tenantId: id,
    afterJson: q.body,
  });
  return success(r, row);
};

export const suspendTenant = async (q: Request, r: Response) => {
  const id = paramId(q);
  const row = await s.suspendTenant(id);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.suspend",
    entityType: "tenant",
    entityId: id,
    tenantId: id,
  });
  return success(r, row);
};

export const reactivateTenant = async (q: Request, r: Response) => {
  const id = paramId(q);
  const row = await s.updateTenant(id, { status: "ACTIVE" });
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.reactivate",
    entityType: "tenant",
    entityId: id,
    tenantId: id,
  });
  return success(r, row, "Tenant reactivated");
};

export const resetAdminPassword = async (q: Request, r: Response) => {
  const id = paramId(q);
  const row = await s.resetTenantAdminPassword(id, q.body.password);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.reset_admin_password",
    entityType: "tenant",
    entityId: id,
    tenantId: id,
  });
  return success(r, row, "Admin password reset");
};

export const listTenantUsers = async (q: Request, r: Response) =>
  success(r, await s.listTenantUsers(paramId(q)));

export const setTenantUserPassword = async (q: Request, r: Response) => {
  const tenantId = paramId(q);
  const userId = paramId(q, "userId");
  const row = await s.setTenantUserPassword(tenantId, userId, q.body.password);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.user_password_set",
    entityType: "user",
    entityId: userId,
    tenantId,
    afterJson: { email: row.email, roleCode: row.roleCode },
  });
  return success(r, row, "User password updated");
};

export const setTenantUserInventoryAreas = async (q: Request, r: Response) => {
  const tenantId = paramId(q);
  const userId = paramId(q, "userId");
  const row = await s.setTenantUserInventoryAreas(tenantId, userId, q.body.inventoryAreas);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.user_inventory_areas",
    entityType: "user",
    entityId: userId,
    tenantId,
    afterJson: { email: row.email, inventoryAreas: row.inventoryAreas },
  });
  return success(r, row, "Inventory access updated");
};

export const setModules = async (q: Request, r: Response) => {
  const id = paramId(q);
  const rows = await s.setTenantModules(id, q.body.modulesEnabled);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.set_modules",
    entityType: "tenant",
    entityId: id,
    tenantId: id,
    afterJson: q.body.modulesEnabled,
  });
  return success(r, rows, "Modules updated");
};

export const listPlans = async (_q: Request, r: Response) =>
  success(r, { plans: s.listPlans(), subscriptionPacks: s.listSubscriptionPacks() });

export const listCategories = async (_q: Request, r: Response) => success(r, await s.listCategories());
export const createCategory = async (q: Request, r: Response) =>
  success(r, await s.createCategory(q.body), "Category created", 201);
export const updateCategory = async (q: Request, r: Response) =>
  success(r, await s.updateCategory(paramId(q), q.body));
export const deleteCategory = async (q: Request, r: Response) =>
  success(r, await s.softDeleteCategory(paramId(q)), "Category archived");
export const listTips = async (q: Request, r: Response) =>
  success(r, await s.listTips(q.query.all === "1" || q.query.all === "true"));
export const createTip = async (q: Request, r: Response) =>
  success(r, await s.createTip(q.body), "Tip created", 201);
export const updateTip = async (q: Request, r: Response) =>
  success(r, await s.updateTip(paramId(q), q.body), "Tip updated");
export const deleteTip = async (q: Request, r: Response) =>
  success(r, await s.deleteTip(paramId(q)), "Tip deleted");
export const applyPack = async (q: Request, r: Response) => {
  const id = paramId(q);
  const row = await s.applySubscriptionPack(id, q.body.subscriptionPack);
  await writeAudit({
    ...meta(q),
    actorType: "PLATFORM_ADMIN",
    actorId: q.auth!.userId,
    action: "tenant.apply_pack",
    entityType: "tenant",
    entityId: id,
    tenantId: id,
    afterJson: { subscriptionPack: q.body.subscriptionPack },
  });
  return success(r, row, "Subscription pack applied");
};
export const stats = async (_q: Request, r: Response) => success(r, await s.stats());
