import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import * as c from "./inventory.controller.js";
import {
  adjustSchema,
  addStockUnitSchema,
  updateStockUnitSchema,
  idSchema,
  returnDemoSchema,
  stampUnitSchema,
} from "./inventory.schema.js";

export const inventoryRouter = Router();
inventoryRouter.use(authenticate, requireTenant);
inventoryRouter.get("/levels", c.levels);
inventoryRouter.post("/adjust", validate(adjustSchema), c.adjust);
inventoryRouter.get("/units", c.listUnits);
inventoryRouter.post("/units", validate(addStockUnitSchema), c.addUnit);
inventoryRouter.get("/units/:id", validate(idSchema), c.getUnit);
inventoryRouter.patch("/units/:id", validate(updateStockUnitSchema), c.updateUnit);
inventoryRouter.post("/units/:id/return-demo", validate(returnDemoSchema), c.returnDemo);
inventoryRouter.post("/units/:id/stamp", validate(stampUnitSchema), c.stampUnit);
inventoryRouter.get("/history", c.history);
