import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import * as c from "./spareParts.controller.js";
import * as s from "./spareParts.schema.js";

export const sparePartsRouter = Router();
sparePartsRouter.use(authenticate, requireTenant);
sparePartsRouter.get("/", requirePermission("tickets:view"), c.list);
sparePartsRouter.post("/", requirePermission("tickets:write"), validate(s.createSchema), c.create);
sparePartsRouter.get("/:id", requirePermission("tickets:view"), validate(s.idSchema), c.get);
sparePartsRouter.patch("/:id", requirePermission("tickets:write"), validate(s.updateSchema), c.update);
sparePartsRouter.delete("/:id", requirePermission("tickets:write"), validate(s.idSchema), c.remove);
