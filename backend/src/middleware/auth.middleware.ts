import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../common/errors.js";
type Claims = { userId?: string; adminId?: string; tenantId?: string; role: string; kind: "platform" | "tenant" };
export function authenticate(req: Request, _res: Response, next: NextFunction) { try { const header = req.headers.authorization; if (!header?.startsWith("Bearer ")) throw new AppError("Authentication required", 401); const claims = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as Claims; const userId = claims.userId ?? claims.adminId; if (!userId || !claims.kind || !claims.role) throw new AppError("Invalid access token", 401); req.auth = { userId, tenantId: claims.tenantId, role: claims.role, kind: claims.kind }; next(); } catch (e) { next(e instanceof AppError ? e : new AppError("Invalid or expired access token", 401)); } }
export function requirePlatform(req: Request, _res: Response, next: NextFunction) { if (req.auth?.kind !== "platform") return next(new AppError("Platform access required", 403)); next(); }
