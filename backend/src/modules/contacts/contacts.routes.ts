import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./contacts.controller.js";
import * as s from "./contacts.schema.js";

export const contactsRouter = Router();
contactsRouter.use(authenticate, requireTenant);
contactsRouter.get("/phone-lookup", requirePermission("contacts:view"), validate(s.phoneSchema), c.phone);
contactsRouter.get("/", requirePermission("contacts:view"), c.list);
contactsRouter.post("/", requirePermission("contacts:write"), validate(s.createSchema), c.create);
contactsRouter.post(
  "/import",
  requirePermission("contacts:import"),
  validate(s.importSchema),
  c.importBulk,
);
/** Customers and machines sold per industry (Retail, Industrial, Billing & POS…) — dashboard card */
contactsRouter.get("/industry-summary", requirePermission("contacts:view"), async (q, r) => {
  const { prisma } = await import("../../config/database.js");
  const { success } = await import("../../common/utils/response.js");
  const t = q.auth!.tenantId!;
  const [contacts, sold] = await Promise.all([
    prisma.contact.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, customFields: true } }),
    prisma.customerAsset.groupBy({
      by: ["contactId"],
      where: { tenantId: t, deletedAt: null, origin: "SOLD_BY_US" },
      _count: { _all: true },
    }),
  ]);
  const soldBy = new Map(sold.map((x) => [x.contactId, x._count._all]));
  const rows = new Map<string, { industry: string; customers: number; machines: number }>();
  for (const ct of contacts) {
    const cf = (ct.customFields ?? {}) as Record<string, unknown>;
    const raw = String(cf.industry ?? "").trim();
    const industry = raw || "Not set";
    const key = industry.toLowerCase();
    const row = rows.get(key) ?? { industry, customers: 0, machines: 0 };
    row.customers += 1;
    row.machines += soldBy.get(ct.id) ?? 0;
    rows.set(key, row);
  }
  const list = [...rows.values()].sort((a, b) =>
    a.industry === "Not set" ? 1 : b.industry === "Not set" ? -1 : b.customers - a.customers,
  );
  return success(r, { total: contacts.length, rows: list });
});
contactsRouter.get("/:id", requirePermission("contacts:view"), validate(s.idSchema), c.get);
contactsRouter.patch("/:id", requirePermission("contacts:write"), validate(s.updateSchema), c.update);
contactsRouter.delete("/:id", requirePermission("contacts:delete"), validate(s.idSchema), c.remove);
contactsRouter.post("/:id/notes", requirePermission("contacts:write"), validate(s.noteCreateSchema), c.addNote);
contactsRouter.patch(
  "/:id/notes/:noteId",
  requirePermission("contacts:write"),
  validate(s.noteUpdateSchema),
  c.updateNote,
);
contactsRouter.delete(
  "/:id/notes/:noteId",
  requirePermission("contacts:write"),
  validate(s.noteIdSchema),
  c.removeNote,
);
