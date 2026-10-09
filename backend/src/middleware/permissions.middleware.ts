import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/errors.js";
import { roleHasPermission, type Permission } from "../common/permissions.js";

/** Require one of the given permissions for a tenant user. */
export function requirePermission(...needed: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.kind !== "tenant" || !req.auth.role) {
      return next(new AppError("Tenant access required", 403));
    }
    const ok = needed.some((p) => roleHasPermission(req.auth!.role, p));
    if (!ok) {
      return next(new AppError("You do not have permission for this action", 403));
    }
    next();
  };
}

/** Require any of the listed role codes (legacy-friendly). */
export function requireRoles(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (!role || !codes.includes(role)) {
      return next(new AppError("Not allowed for this role", 403));
    }
    next();
  };
}
