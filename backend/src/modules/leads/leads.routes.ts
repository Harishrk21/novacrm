import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { logLeadEvent } from "./leadHistory.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./leads.controller.js";
import * as s from "./leads.schema.js";

/** Record a sales work-history step once the route has answered successfully. */
function leadHistoryAfter(action: string, summary: string) {
  return (q: Request, r: Response, next: NextFunction) => {
    const json = r.json.bind(r);
    r.json = (body: unknown) => {
      try {
        const b = body as { success?: boolean; data?: { id?: unknown } | null } | null;
        if (r.statusCode < 400 && b && b.success !== false) {
          const id = String(q.params.id ?? b.data?.id ?? "");
          if (id && q.auth?.tenantId) void logLeadEvent(q.auth.tenantId, id, action, summary);
        }
      } catch {
        /* never break the response */
      }
      return json(body);
    };
    next();
  };
}

export const leadsRouter = Router();
leadsRouter.use(authenticate, requireTenant);
leadsRouter.get("/phone-search", requirePermission("leads:view"), validate(s.phoneSchema), c.phone);
leadsRouter.get("/", requirePermission("leads:view"), c.list);
leadsRouter.post("/", requirePermission("leads:write"), leadHistoryAfter("sales.created", "Enquiry received"), validate(s.createSchema), c.create);
leadsRouter.get("/:id", requirePermission("leads:view"), validate(s.idSchema), c.get);
leadsRouter.patch("/:id", requirePermission("leads:write"), validate(s.updateSchema), c.update);
leadsRouter.delete("/:id", requirePermission("leads:delete"), leadHistoryAfter("sales.deleted", "Enquiry deleted"), validate(s.idSchema), c.remove);
leadsRouter.post("/:id/assign", requirePermission("leads:write"), validate(s.assignSchema), c.assign);
leadsRouter.post("/:id/status", requirePermission("leads:write"), validate(s.statusSchema), c.status);
leadsRouter.post("/:id/convert", requirePermission("leads:convert"), leadHistoryAfter("sales.converted", "Converted to sale"), validate(s.convertSchema), c.convert);
leadsRouter.post("/:id/issue-demo", requirePermission("leads:write"), leadHistoryAfter("sales.demo_issued", "Demo unit issued to customer"), validate(s.issueDemoSchema), c.issueDemo);
leadsRouter.post("/:id/return-demo", requirePermission("leads:write"), leadHistoryAfter("sales.demo_returned", "Demo unit returned"), validate(s.returnDemoSchema), c.returnDemo);
leadsRouter.post("/:id/demo-update", requirePermission("leads:write"), validate(s.demoUpdateSchema), c.demoUpdate);
leadsRouter.post("/:id/verify", requirePermission("leads:write"), validate(s.verifySchema), c.verify);
leadsRouter.post(
  "/:id/create-ticket",
  requirePermission("tickets:create"),
  validate(s.createTicketSchema),
  c.createTicket,
);
leadsRouter.post(
  "/:id/prepare-handoff",
  requirePermission("tickets:create"),
  validate(s.prepareHandoffSchema),
  c.prepareHandoff,
);
leadsRouter.post(
  "/:id/link-ticket",
  requirePermission("tickets:create"),
  validate(s.linkTicketSchema),
  c.linkTicket,
);
