import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../common/errors.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(`Route ${req.method} ${req.path} not found`, 404));
}

function isDbPoolExhausted(err: unknown, msg: string) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2024") return true;
  return /Timed out fetching a new connection|connection pool|max clients|EMAXCONNSESSION|too many connections/i.test(
    msg,
  );
}

function isDbUnreachable(err: unknown, msg: string) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P1001" || err.code === "P1017" || err.code === "P1000") return true;
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return /Can't reach database|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|TLS|SSL|Access denied|Server has gone away/i.test(
    msg,
  );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({ success: false, message: "Validation failed", details: err.flatten() });
  }
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : String(err.meta?.target ?? "");
    const hint =
      /email/i.test(target)
        ? "That email is already registered (including a removed employee). Use another email, or re-add with the same email to restore them."
        : /employee_code|employeeCode/i.test(target)
          ? "That employee code is already used. Leave code blank for auto, or pick a new one."
          : /invoice_number|invoiceNumber/i.test(target)
            ? "Invoice number already used — try Create again (number sequence was behind)."
            : "A record with this value already exists";
    return res.status(409).json({ success: false, message: hint, details: target || undefined });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2000") {
    return res.status(422).json({
      success: false,
      message: "One or more values are too long. Shorten the product name or SKU and try again.",
    });
  }

  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code
      : err instanceof Prisma.PrismaClientInitializationError
        ? "INIT"
        : undefined;

  if (isDbPoolExhausted(err, msg)) {
    console.error("[db-pool]", code ?? "", msg);
    return res.status(503).json({
      success: false,
      message:
        "Database connection pool is full. Wait a few seconds and retry. On Render, set DATABASE_URL with connection_limit=5&pool_timeout=20 and avoid running multiple API copies against the same small RDS.",
      details: code ? { code } : undefined,
    });
  }

  if (isDbUnreachable(err, msg)) {
    console.error("[db-unreachable]", code ?? "", msg);
    return res.status(503).json({
      success: false,
      message:
        "Cannot reach the database (RDS). Check Render DATABASE_URL, RDS security group (allow Render / 0.0.0.0:3306 for testing), and that the RDS instance is running.",
      details: code ? { code } : undefined,
    });
  }

  console.error(err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}
