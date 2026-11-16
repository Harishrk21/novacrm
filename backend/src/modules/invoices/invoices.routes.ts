import { Router } from "express";
import { historyOnSuccess, money } from "../../common/history.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./invoices.controller.js";
import * as s from "./invoices.schema.js";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate, requireTenant);
invoicesRouter.get("/", requirePermission("invoices:view"), c.list);
const invoiceHistory = (action: string, summary: (b: Record<string, unknown>) => string) =>
  historyOnSuccess((req, d) => ({
    action,
    area: "Billing",
    entityType: "invoice",
    entityId: String(d.id ?? req.params.id ?? "") || null,
    label: String(d.invoiceNumber ?? "Proforma"),
    summary: summary((req.body ?? {}) as Record<string, unknown>),
    details: {
      status: d.status ?? null,
      total: money(d.grandTotal),
      received: money(d.amountPaid),
      tax: money(d.taxTotal),
      invoiceDate: d.invoiceDate ?? null,
    },
  }));

invoicesRouter.post("/", requirePermission("invoices:write"), invoiceHistory("billing.proforma_created", () => "Proforma invoice created"), validate(s.createSchema), c.create);
invoicesRouter.get("/:id", requirePermission("invoices:view"), validate(s.idSchema), c.get);
invoicesRouter.post("/:id/status", requirePermission("invoices:write"), invoiceHistory("billing.proforma_status", (b) => `Proforma marked ${String(b.status ?? "").toLowerCase() === "void" ? "cancelled" : String(b.status ?? "updated").toLowerCase()}`), validate(s.statusSchema), c.status);
