import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./spareStock.controller.js";
import * as s from "./spareStock.schema.js";

export const spareStockRouter = Router();
spareStockRouter.use(authenticate, requireTenant);

spareStockRouter.get("/items", requirePermission("inventory:view"), validate(s.listItemsSchema), c.listItems);
spareStockRouter.post("/items", requirePermission("inventory:write"), validate(s.createItemSchema), c.createItem);
spareStockRouter.patch(
  "/items/:id",
  requirePermission("inventory:write"),
  validate(s.updateItemSchema),
  c.updateItem,
);
spareStockRouter.post("/receive", requirePermission("inventory:write"), validate(s.receiveSchema), c.receive);
spareStockRouter.post("/issue", requirePermission("inventory:write"), validate(s.issueSchema), c.issue);
spareStockRouter.get("/history", requirePermission("inventory:view"), validate(s.historySchema), c.history);
spareStockRouter.get("/monthly", requirePermission("inventory:view"), validate(s.monthlySchema), c.monthly);
