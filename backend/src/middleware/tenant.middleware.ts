import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/errors.js";
export function requireTenant(req: Request, _res: Response, next: NextFunction) { if (req.auth?.kind !== "tenant" || !req.auth.tenantId) return next(new AppError("Tenant access required", 403)); next(); }
export function requireTenantAdmin(req: Request, _res: Response, next: NextFunction) { if (req.auth?.role !== "ADMIN") return next(new AppError("Tenant administrator access required", 403)); next(); }
