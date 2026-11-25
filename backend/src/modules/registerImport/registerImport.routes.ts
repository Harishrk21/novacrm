import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { AppError } from "../../common/errors.js";
import { roleHasPermission } from "../../common/permissions.js";
import * as s from "./registerImport.service.js";
import { aiMatch } from "./aiMatch.js";

const str = z.string().max(500).nullable().optional();
const n = z.coerce.number().nullable().optional();
const row = z.object({
  ref: z.string().min(1).max(120),
  date: z.string().max(10).nullable().optional(),
  dateNote: z.string().max(200).nullable().optional(),
  phones: z.array(z.string().max(60)).max(6).nullable().optional(),
  customer: str,
  industry: str,
  // sales
  hmsId: str,
  brand: str,
  model: str,
  spec: str,
  address: str,
  executive: str,
  amount: n,
  productId: z.string().max(36).nullable().optional(),
  productCode: z.string().max(20).nullable().optional(),
  dcNo: str,
  deliveredBy: str,
  stampingDate: z.string().max(10).nullable().optional(),
  status: str,
  spares: str,
  paymentMode: str,
  machine: str,
  aiProduct: z.boolean().nullable().optional(),
  aiSpares: z.boolean().nullable().optional(),
  // service
  work: str,
  coverage: str,
  received: n,
  balance: n,
  paymentNote: str,
  serviceNo: str,
  area: str,
  engineer: str,
});
const kind = z.enum(["SALES", "SERVICE"]);
const previewSchema = z.object({
  body: z.object({ kind, rows: z.array(row).min(1).max(4000), unpaidAs: z.enum(["DUE", "PAID"]).optional() }),
  query: z.any(),
  params: z.any(),
});
const commitSchema = z.object({
  body: z.object({
    kind,
    rows: z.array(row).min(1).max(4000),
    batchId: z.string().min(8).max(40),
    fileName: z.string().max(200).optional().default(""),
    unpaidAs: z.enum(["DUE", "PAID"]).optional(),
  }),
  query: z.any(),
  params: z.any(),
});
const undoSchema = z.object({ body: z.object({ batchId: z.string().min(8).max(40) }), query: z.any(), params: z.any() });

/** Service registers create service jobs — the importer also needs that right */
function canKind(q: Request) {
  if (q.body?.kind === "SERVICE" && !roleHasPermission(String(q.auth!.role ?? ""), "tickets:create")) {
    throw new AppError("You can import customers but not service jobs", 403);
  }
}

export const registerImportRouter = Router();
registerImportRouter.use(authenticate, requireTenant, requirePermission("contacts:import"));

registerImportRouter.post("/preview", validate(previewSchema), async (q: Request, r: Response) => {
  canKind(q);
  return success(r, await s.preview(q.auth!.tenantId!, q.body.kind, q.body.rows, { unpaidAs: q.body.unpaidAs }));
});
registerImportRouter.post("/commit", validate(commitSchema), async (q: Request, r: Response) => {
  canKind(q);
  return success(
    r,
    await s.commit(q.auth!.tenantId!, q.auth!.userId, q.body.kind, q.body.rows, q.body.batchId, q.body.fileName, {
      unpaidAs: q.body.unpaidAs,
    }),
  );
});
const aiSchema = z.object({
  body: z.object({ kind: z.enum(["PRODUCT", "SPARE"]), texts: z.array(z.string().max(200)).min(1).max(60) }),
  query: z.any(),
  params: z.any(),
});
/** AI suggestions: loosely written machines / spares → Product ID / Spare ID (staff confirm) */
registerImportRouter.post("/ai-match", validate(aiSchema), async (q: Request, r: Response) =>
  success(r, await aiMatch(q.auth!.tenantId!, q.body.kind, q.body.texts)),
);
registerImportRouter.get("/batches", async (q: Request, r: Response) => success(r, await s.listBatches(q.auth!.tenantId!)));
registerImportRouter.post("/undo", validate(undoSchema), async (q: Request, r: Response) =>
  success(r, await s.undo(q.auth!.tenantId!, q.auth!.userId, q.body.batchId)),
);
