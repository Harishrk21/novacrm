import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import * as s from "./stockCount.service.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const spareCount = z.object({
  body: z.object({
    date: day,
    note: z.string().max(300).nullable().optional(),
    items: z
      .array(z.object({ sparePartId: z.string().min(1).max(36), counted: z.coerce.number().min(0).max(1_000_000), reason: z.string().max(120).nullable().optional() }))
      .min(1)
      .max(2000),
  }),
  query: z.any(),
  params: z.any(),
});
const machineBody = z.object({
  date: day,
  warehouseId: z.string().max(36).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
  ids: z.array(z.string().max(60)).max(5000),
});
const machineCheck = z.object({ body: machineBody, query: z.any(), params: z.any() });

export const stockCountRouter = Router();
stockCountRouter.use(authenticate, requireTenant);

stockCountRouter.get("/spares", requirePermission("inventory:view"), async (q: Request, r: Response) =>
  success(r, await s.sparesSheet(q.auth!.tenantId!, q.query.date ? String(q.query.date) : null)),
);
stockCountRouter.post("/spares", requirePermission("inventory:write"), validate(spareCount), async (q: Request, r: Response) =>
  success(r, await s.saveSpareCount(q.auth!.tenantId!, q.auth!.userId, q.body)),
);
stockCountRouter.post("/machines/check", requirePermission("inventory:view"), validate(machineCheck), async (q: Request, r: Response) =>
  success(r, await s.checkMachines(q.auth!.tenantId!, q.body)),
);
stockCountRouter.post("/machines", requirePermission("inventory:write"), validate(machineCheck), async (q: Request, r: Response) =>
  success(r, await s.saveMachineCount(q.auth!.tenantId!, q.auth!.userId, q.body)),
);
stockCountRouter.get("/history", requirePermission("inventory:view"), async (q: Request, r: Response) =>
  success(r, await s.history(q.auth!.tenantId!)),
);
