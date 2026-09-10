import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { AppError } from "../../common/errors.js";
import * as c from "./contacts.controller.js";
import * as s from "./contacts.schema.js";

function requireRoles(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (!role || !codes.includes(role)) {
      return next(new AppError("Not allowed for this role", 403));
    }
    next();
  };
}

export const contactsRouter = Router();
contactsRouter.use(authenticate, requireTenant);
contactsRouter.get("/phone-lookup", validate(s.phoneSchema), c.phone);
contactsRouter.get("/", c.list);
contactsRouter.post("/", validate(s.createSchema), c.create);
contactsRouter.post(
  "/import",
  requireRoles("ADMIN", "MANAGER", "SERVICE_DESK"),
  validate(s.importSchema),
  c.importBulk,
);
contactsRouter.get("/:id", validate(s.idSchema), c.get);
contactsRouter.patch("/:id", validate(s.updateSchema), c.update);
contactsRouter.delete("/:id", validate(s.idSchema), c.remove);
contactsRouter.post("/:id/notes", validate(s.noteCreateSchema), c.addNote);
contactsRouter.patch("/:id/notes/:noteId", validate(s.noteUpdateSchema), c.updateNote);
contactsRouter.delete("/:id/notes/:noteId", validate(s.noteIdSchema), c.removeNote);
