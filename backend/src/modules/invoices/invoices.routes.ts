import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./invoices.controller.js";
import * as s from "./invoices.schema.js";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate, requireTenant);
invoicesRouter.get("/", requirePermission("invoices:view"), c.list);
invoicesRouter.post("/", requirePermission("invoices:write"), validate(s.createSchema), c.create);
invoicesRouter.get("/:id", requirePermission("invoices:view"), validate(s.idSchema), c.get);
invoicesRouter.post("/:id/status", requirePermission("invoices:write"), validate(s.statusSchema), c.status);
