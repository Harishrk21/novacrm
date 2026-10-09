import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import * as svc from "./rentals.service.js";

const issueBody = z.object({
  stockUnitId: z.string().min(1).max(36),
  contactId: z.string().min(1).max(36).nullable().optional(),
  leadId: z.string().min(1).max(36).nullable().optional(),
  customerName: z.string().min(1).max(160),
  customerPhone: z.string().max(32).nullable().optional(),
  customerEmail: z.string().email().max(191).nullable().optional().or(z.literal("")),
  customerCompany: z.string().max(191).nullable().optional(),
  customerAddress: z.string().max(512).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(80).nullable().optional(),
  startAt: z.string().min(1),
  expectedReturnAt: z.string().nullable().optional(),
  dailyRate: z.coerce.number().nonnegative().nullable().optional(),
  totalAmount: z.coerce.number().nonnegative().nullable().optional(),
  depositAmount: z.coerce.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const returnBody = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

const idParams = z.object({ id: z.string().min(1).max(36) });

export const rentalsRouter = Router();
rentalsRouter.use(authenticate, requireTenant);

rentalsRouter.get("/summary", requirePermission("inventory:view"), async (q: Request, r: Response) => {
  return success(r, await svc.rentalSummary(q.auth!.tenantId!));
});

rentalsRouter.get("/", requirePermission("inventory:view"), async (q: Request, r: Response) => {
  return success(r, await svc.listRentals(q.auth!.tenantId!, q.query as Record<string, unknown>));
});

rentalsRouter.get(
  "/:id",
  requirePermission("inventory:view"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    return success(r, await svc.getRental(q.auth!.tenantId!, paramId(q)));
  },
);

rentalsRouter.post(
  "/",
  requirePermission("inventory:write"),
  validate(z.object({ body: issueBody, query: z.any(), params: z.any() })),
  async (q: Request, r: Response) => {
    const body = issueBody.parse(q.body);
    const data = await svc.issueRental(q.auth!.tenantId!, q.auth!.userId!, {
      ...body,
      customerEmail: body.customerEmail || null,
    });
    return success(r, data, "Rental issued — stock reduced", 201);
  },
);

rentalsRouter.post(
  "/:id/return",
  requirePermission("inventory:write"),
  validate(z.object({ body: returnBody, query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const body = returnBody.parse(q.body ?? {});
    const data = await svc.returnRental(
      q.auth!.tenantId!,
      q.auth!.userId!,
      paramId(q),
      body.notes,
    );
    return success(r, data, "Rental returned — stock restored");
  },
);
