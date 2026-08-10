import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../common/errors.js";
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) { next(new AppError(`Route ${req.method} ${req.path} not found`, 404)); }
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ success: false, message: "Validation failed", details: err.flatten() });
  }
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return res.status(409).json({ success: false, message: "A record with this value already exists" });
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/max clients|EMAXCONNSESSION|Can't reach database|P1001|P1017|connection/i.test(msg)) {
    console.error(err);
    return res.status(503).json({
      success: false,
      message: "Database is busy (connection pool full). Wait a few seconds and try again — keep only one API server running.",
    });
  }
  console.error(err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}
