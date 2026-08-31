import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import * as c from "./spareParts.controller.js";
import * as s from "./spareParts.schema.js";

export const sparePartsRouter = Router();
sparePartsRouter.use(authenticate, requireTenant);
sparePartsRouter.get("/", c.list);
sparePartsRouter.post("/", validate(s.createSchema), c.create);
sparePartsRouter.get("/:id", validate(s.idSchema), c.get);
sparePartsRouter.patch("/:id", validate(s.updateSchema), c.update);
sparePartsRouter.delete("/:id", validate(s.idSchema), c.remove);
