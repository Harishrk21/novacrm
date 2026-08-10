import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import * as c from "./invoices.controller.js";
import * as s from "./invoices.schema.js";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate, requireTenant);
invoicesRouter.get("/", c.list);
invoicesRouter.post("/", validate(s.createSchema), c.create);
invoicesRouter.get("/:id", validate(s.idSchema), c.get);
invoicesRouter.post("/:id/status", validate(s.statusSchema), c.status);
