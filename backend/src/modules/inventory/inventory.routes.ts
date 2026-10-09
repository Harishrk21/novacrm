import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./inventory.controller.js";
import {
  adjustSchema,
  addStockUnitSchema,
  receiveBatchSchema,
  previewUniqSchema,
  createBrandSchema,
  updateBrandSchema,
  updateStockUnitSchema,
  idSchema,
  returnDemoSchema,
  stampUnitSchema,
  reduceUnitSchema,
  stockExportSchema,
  stockImportSchema,
} from "./inventory.schema.js";

export const inventoryRouter = Router();
inventoryRouter.use(authenticate, requireTenant);
inventoryRouter.get("/levels", requirePermission("inventory:view"), c.levels);
inventoryRouter.get(
  "/export",
  requirePermission("inventory:view"),
  validate(stockExportSchema),
  c.exportStockIn,
);
inventoryRouter.post("/adjust", requirePermission("inventory:write"), validate(adjustSchema), c.adjust);
inventoryRouter.get("/brands", requirePermission("inventory:view"), c.listBrands);
inventoryRouter.post(
  "/brands",
  requirePermission("inventory:write"),
  validate(createBrandSchema),
  c.createBrand,
);
inventoryRouter.patch(
  "/brands/:id",
  requirePermission("inventory:write"),
  validate(updateBrandSchema),
  c.updateBrand,
);
inventoryRouter.delete(
  "/brands/:id",
  requirePermission("inventory:write"),
  validate(idSchema),
  c.deleteBrand,
);
inventoryRouter.get("/workspace", requirePermission("inventory:view"), c.stockWorkspace);
inventoryRouter.get("/units", requirePermission("inventory:view"), c.listUnits);
inventoryRouter.post("/units", requirePermission("inventory:write"), validate(addStockUnitSchema), c.addUnit);
inventoryRouter.post(
  "/receipts",
  requirePermission("inventory:write"),
  validate(receiveBatchSchema),
  c.receiveBatch,
);
inventoryRouter.post(
  "/uniq-ids/preview",
  requirePermission("inventory:view"),
  validate(previewUniqSchema),
  c.previewUniqIds,
);
inventoryRouter.get("/units/:id", requirePermission("inventory:view"), validate(idSchema), c.getUnit);
inventoryRouter.patch(
  "/units/:id",
  requirePermission("inventory:write"),
  validate(updateStockUnitSchema),
  c.updateUnit,
);
inventoryRouter.post(
  "/units/:id/return-demo",
  requirePermission("inventory:write"),
  validate(returnDemoSchema),
  c.returnDemo,
);
inventoryRouter.post(
  "/units/:id/stamp",
  requirePermission("inventory:write"),
  validate(stampUnitSchema),
  c.stampUnit,
);
inventoryRouter.post(
  "/units/:id/reduce",
  requirePermission("inventory:write"),
  validate(reduceUnitSchema),
  c.reduceUnit,
);
inventoryRouter.get("/history", requirePermission("inventory:view"), c.history);
inventoryRouter.get(
  "/delivery-challans",
  requirePermission("inventory:view"),
  c.listDeliveryChallans,
);
inventoryRouter.post(
  "/import",
  requirePermission("inventory:write"),
  validate(stockImportSchema),
  c.importStock,
);
