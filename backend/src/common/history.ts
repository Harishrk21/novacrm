import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { writeAudit } from "./audit.js";

/**
 * Work history — every finished / closing step (service closed, sale completed, stock released,
 * proforma paid, employee removed …) is saved in audit_logs with who, when and the key figures.
 * Shown in Reports → "Closing & activity history".
 */

type Ctx = { userId?: string; tenantId?: string; ip?: string; userAgent?: string };
const store = new AsyncLocalStorage<Ctx>();

/** Called by authenticate(): remember the signed-in user for this request. */
export function enterRequestContext(ctx: Ctx) {
  store.enterWith(ctx);
}

export type HistoryArea = "Service" | "Sales" | "Stock" | "Billing" | "Team";

export type HistoryEvent = {
  tenantId?: string | null;
  userId?: string | null;
  /** e.g. service.closed, sales.completed, stock.released */
  action: string;
  area: HistoryArea;
  entityType: string;
  entityId?: string | null;
  /** Human reference shown in the report, e.g. "SVC-00042 · Ravi Stores" */
  label: string;
  /** One line: what happened */
  summary: string;
  /** Key figures / fields at that moment */
  details?: Record<string, unknown>;
};

/** Best-effort — never fails the user's action. */
export function recordEvent(e: HistoryEvent): void {
  const ctx = store.getStore() ?? {};
  const tenantId = e.tenantId ?? ctx.tenantId ?? null;
  if (!tenantId) return;
  void writeAudit({
    tenantId,
    actorType: "USER",
    actorId: e.userId ?? ctx.userId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    ipAddress: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    afterJson: { area: e.area, label: e.label, summary: e.summary, ...(e.details ?? {}) },
  });
}

/**
 * Route wrapper: record an event after the handler answers successfully. `describe` gets the
 * request and the response's `data` and returns the event (or null to skip).
 */
export function historyOnSuccess(
  describe: (req: Request, data: Record<string, unknown>) => Omit<HistoryEvent, "tenantId" | "userId"> | null,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      try {
        if (res.statusCode < 400 && body && typeof body === "object" && (body as { success?: unknown }).success !== false) {
          const data = ((body as { data?: unknown }).data ?? {}) as Record<string, unknown>;
          const ev = describe(req, data && typeof data === "object" ? data : {});
          if (ev) recordEvent({ ...ev, tenantId: req.auth?.tenantId, userId: req.auth?.userId });
        }
      } catch {
        /* history must never break the response */
      }
      return json(body);
    };
    next();
  };
}

export const money = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
export const serviceNo = (n: unknown) => (n != null && n !== "" ? `SVC-${String(n).padStart(5, "0")}` : "Service job");
