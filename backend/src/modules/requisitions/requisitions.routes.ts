import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import * as svc from "./requisitions.service.js";

const idParams = z.object({ id: z.string().min(1).max(36) });

const submitBody = z.object({
  leadId: z.string().min(1).max(36),
  productId: z.string().min(1).max(36).nullable().optional(),
  stockUnitId: z.string().min(1).max(36).nullable().optional(),
  serialNo: z.string().max(80).nullable().optional(),
  productName: z.string().max(191).nullable().optional(),
  qty: z.coerce.number().positive().max(9999).optional(),
  advanceAmount: z.coerce.number().nonnegative().optional(),
  paymentNotes: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const rejectBody = z.object({
  reason: z.string().min(1).max(500),
});

const fulfillBody = z.object({
  unitPrice: z.coerce.number().nonnegative().optional(),
  taxPercent: z.coerce.number().nonnegative().max(100).optional(),
  notes: z.string().max(2000).nullable().optional(),
  markShipped: z.boolean().optional(),
  stockUnitId: z.string().min(1).max(36).nullable().optional(),
});

const stampLineBody = z.object({
  label: z.string().min(1).max(191),
  stampingRequired: z.boolean(),
  stampingDate: z.string().nullable().optional(),
  nextDueDate: z.string().nullable().optional(),
});

const stampingBody = z.object({
  stockUnitId: z.string().min(1).max(36).nullable().optional(),
  /** Inventory confirms: does this product need stamping? */
  stampingRequired: z.boolean().optional(),
  stampingDate: z.string().nullable().optional(),
  nextDueDate: z.string().nullable().optional(),
  vcNumber: z.string().max(80).nullable().optional(),
  plateNo: z.string().max(80).nullable().optional(),
  /** Multi-product sale (e.g. 1 weighing + 1 billing) — one confirm per line */
  lines: z.array(stampLineBody).max(20).optional(),
});

const paymentBody = z.object({
  amount: z.coerce.number().nonnegative().optional(),
  note: z.string().min(1).max(2000),
});

export const requisitionsRouter = Router();
requisitionsRouter.use(authenticate, requireTenant);

requisitionsRouter.get("/", requirePermission("requisitions:view"), async (q: Request, r: Response) => {
  return success(r, await svc.list(q.auth!.tenantId!, q.query as Record<string, unknown>));
});

requisitionsRouter.get(
  "/by-lead/:leadId",
  requirePermission("requisitions:view"),
  validate(
    z.object({
      body: z.any(),
      query: z.any(),
      params: z.object({ leadId: z.string().min(1).max(36) }),
    }),
  ),
  async (q: Request, r: Response) => {
    const leadId = String(q.params.leadId);
    return success(r, await svc.getByLead(q.auth!.tenantId!, leadId));
  },
);

requisitionsRouter.get(
  "/:id",
  requirePermission("requisitions:view"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    return success(r, await svc.get(q.auth!.tenantId!, paramId(q)));
  },
);

requisitionsRouter.post(
  "/",
  requirePermission("requisitions:write"),
  validate(z.object({ body: submitBody, query: z.any(), params: z.any() })),
  async (q: Request, r: Response) => {
    const body = submitBody.parse(q.body);
    const data = await svc.submit(q.auth!.tenantId!, q.auth!.userId!, body, q);
    return success(r, data, "Requisition submitted for admin approval", 201);
  },
);

requisitionsRouter.post(
  "/:id/approve",
  requirePermission("requisitions:approve"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const data = await svc.approve(q.auth!.tenantId!, paramId(q), q.auth!.userId!, q);
    return success(r, data, "Requisition approved — sales can notify inventory");
  },
);

requisitionsRouter.post(
  "/:id/reject",
  requirePermission("requisitions:approve"),
  validate(z.object({ body: rejectBody, query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const body = rejectBody.parse(q.body ?? {});
    const data = await svc.reject(q.auth!.tenantId!, paramId(q), q.auth!.userId!, body.reason, q);
    return success(r, data, "Requisition rejected");
  },
);

requisitionsRouter.post(
  "/:id/notify-inventory",
  requirePermission("requisitions:write"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const data = await svc.notifyInventory(q.auth!.tenantId!, paramId(q), q.auth!.userId!, q);
    return success(r, data, "Inventory team notified");
  },
);

requisitionsRouter.post(
  "/:id/stamping",
  requirePermission("requisitions:fulfill"),
  validate(z.object({ body: stampingBody, query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const body = stampingBody.parse(q.body);
    const data = await svc.recordStamping(q.auth!.tenantId!, paramId(q), q.auth!.userId!, body);
    return success(r, data, "Stamping confirmation saved");
  },
);

requisitionsRouter.post(
  "/:id/fulfill",
  requirePermission("requisitions:fulfill"),
  validate(z.object({ body: fulfillBody.optional(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const body = fulfillBody.parse(q.body ?? {});
    const data = await svc.fulfill(q.auth!.tenantId!, paramId(q), q.auth!.userId!, body, q);
    return success(r, data, "Stock reduced");
  },
);

requisitionsRouter.post(
  "/:id/delivery-challan",
  requirePermission("requisitions:fulfill"),
  validate(
    z.object({
      body: z.object({ notes: z.string().max(2000).nullable().optional() }).optional(),
      query: z.any(),
      params: idParams,
    }),
  ),
  async (q: Request, r: Response) => {
    const notes =
      q.body && typeof q.body === "object" && "notes" in q.body
        ? (q.body as { notes?: string | null }).notes
        : null;
    const data = await svc.createSaleDeliveryChallan(
      q.auth!.tenantId!,
      paramId(q),
      q.auth!.userId!,
      { notes },
      q,
    );
    return success(r, data, "Sale delivery challan created");
  },
);

requisitionsRouter.post(
  "/:id/ship",
  requirePermission("requisitions:fulfill"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const data = await svc.markShipped(q.auth!.tenantId!, paramId(q), q.auth!.userId!, q);
    return success(r, data, "Marked ready to ship");
  },
);

requisitionsRouter.post(
  "/:id/payment-note",
  requirePermission("requisitions:write"),
  validate(z.object({ body: paymentBody, query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const body = paymentBody.parse(q.body);
    const data = await svc.addPaymentNote(q.auth!.tenantId!, paramId(q), q.auth!.userId!, body);
    return success(r, data, "Payment follow-up saved");
  },
);
