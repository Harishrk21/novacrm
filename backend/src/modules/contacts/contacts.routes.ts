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
