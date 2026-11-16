import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { success } from "../../common/utils/response.js";
import { reportCatalog, runReport } from "./reports.service.js";

export const reportsRouter = Router();
reportsRouter.use(authenticate, requireTenant, requirePermission("reports:view"));

reportsRouter.get("/", async (q: Request, r: Response) =>
  success(r, await reportCatalog(q.auth!.tenantId!, String(q.auth!.role ?? ""))),
);

/** Parse yyyy-mm-dd as a local (IST) calendar day; defaults to this month so far. */
export function dayBounds(fromRaw: unknown, toRaw: unknown) {
  const now = new Date();
  const parse = (v: unknown) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ""));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const from = parse(fromRaw) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parse(toRaw) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

reportsRouter.get("/:key", async (q: Request, r: Response) => {
  const { from, to } = dayBounds(q.query.from, q.query.to);
  return success(
    r,
    await runReport(q.auth!.tenantId!, String(q.auth!.role ?? ""), String(q.params.key), {
      from,
      to,
      personId: q.query.personId ? String(q.query.personId) : undefined,
      status: q.query.status ? String(q.query.status) : undefined,
    }),
  );
});
