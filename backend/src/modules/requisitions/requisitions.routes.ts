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
import { historyOnSuccess, money, type HistoryArea } from "../../common/history.js";

/** Work history for requisition steps — label "REQ-00012 · customer", figures from the response. */
function reqHistory(action: string, area: HistoryArea, summary: string) {
  return historyOnSuccess((req, data) => {
    const d = (data && typeof data === "object" && "requisition" in data ? (data as { requisition: unknown }).requisition : data) as Record<string, unknown>;
    const cf = (d?.customFields && typeof d.customFields === "object" ? d.customFields : {}) as Record<string, unknown>;
    const lead = (d?.lead && typeof d.lead === "object" ? d.lead : {}) as Record<string, unknown>;
    const customer = String(cf.customerName ?? lead.name ?? d?.customerName ?? "") || null;
    return {
      action,
      area,
      entityType: "requisition",
      entityId: String(d?.id ?? req.params.id ?? "") || null,
      label: [String(d?.reqNumber ?? "") || "Requisition", customer].filter(Boolean).join(" · "),
      summary,
      details: {
        customer,
        status: d?.status ?? null,
        product: String(cf.productName ?? "") || null,
        quantity: d?.quantity ?? cf.quantity ?? null,
        serials: cf.releaseLines ?? cf.serialNo ?? null,
        total: money(cf.salePaymentTotal ?? d?.totalAmount),
        advance: money(d?.advanceAmount),
        note: (req.body as { note?: unknown; reason?: unknown } | undefined)?.note ?? (req.body as { reason?: unknown } | undefined)?.reason ?? null,
      },
    };
  });
}

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
  stampingNumber: z.string().max(80).nullable().optional(),
  /** A Jan–Mar · B Apr–Jun · C Jul–Sep · D Oct–Dec */
  stampingQuarter: z.enum(["A", "B", "C", "D"]).nullable().optional(),
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
  reqHistory("sales.requisition_raised", "Sales", "Stock requested for a sale"),
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
  reqHistory("sales.requisition_accepted", "Sales", "Admin accepted the stock request"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const data = await svc.approve(q.auth!.tenantId!, paramId(q), q.auth!.userId!, q);
    return success(r, data, "Requisition approved — sales can notify inventory");
  },
);

requisitionsRouter.post(
  "/:id/reject",
  requirePermission("requisitions:approve"),
  reqHistory("sales.requisition_rejected", "Sales", "Admin rejected the stock request"),
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
  reqHistory("stock.stamping_recorded", "Stock", "Stamping recorded before dispatch"),
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
  reqHistory("stock.released", "Stock", "Warehouse released the units"),
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
  reqHistory("stock.dc_created", "Stock", "Delivery challan created"),
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
  reqHistory("stock.shipped", "Stock", "Marked shipped / ready to deliver"),
  validate(z.object({ body: z.any(), query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const data = await svc.markShipped(q.auth!.tenantId!, paramId(q), q.auth!.userId!, q);
    return success(r, data, "Marked ready to ship");
  },
);

const salePaymentBody = z.object({
  total: z.coerce.number().nonnegative(),
  advance: z.coerce.number().nonnegative(),
});

/** Absolute Total / Advance from the lead Payment card — syncs requisition + lead. */
requisitionsRouter.post(
  "/:id/payment",
  requirePermission("requisitions:write"),
  reqHistory("sales.payment_recorded", "Sales", "Sale payment recorded"),
  validate(z.object({ body: salePaymentBody, query: z.any(), params: idParams })),
  async (q: Request, r: Response) => {
    const data = await svc.setSalePayment(q.auth!.tenantId!, paramId(q), salePaymentBody.parse(q.body));
    return success(r, data, "Payment saved");
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
