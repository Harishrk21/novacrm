import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import * as c from "./inventory.controller.js";
import { historyOnSuccess } from "../../common/history.js";

/** Work history for stock moves — label is the unit's HMS ID / serial when the response has one. */
function stockHistory(action: string | ((body: Record<string, unknown>) => string), summary: string | ((body: Record<string, unknown>) => string)) {
  return historyOnSuccess((req, data) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const unit = data as Record<string, unknown>;
    const ref = String(unit.hmsUniqId ?? unit.serialNo ?? "") || null;
    const count = Array.isArray(unit.units) ? unit.units.length : Array.isArray(unit.items) ? unit.items.length : null;
    return {
      action: typeof action === "function" ? action(body) : action,
      area: "Stock",
      entityType: "stock_unit",
      entityId: String(unit.id ?? req.params.id ?? "") || null,
      label: ref ? `Unit ${ref}` : count ? `${count} unit(s)` : "Stock",
      summary: typeof summary === "function" ? summary(body) : summary,
      details: {
        serialNo: unit.serialNo ?? null,
        hmsId: unit.hmsUniqId ?? null,
        status: unit.status ?? null,
        productId: unit.productId ?? body.productId ?? null,
        quantity: body.quantity ?? body.qty ?? count,
        purpose: body.purpose ?? null,
        reason: body.reason ?? body.notes ?? null,
        customerId: body.contactId ?? null,
      },
    };
  });
}
import {
  adjustSchema,
  addStockUnitSchema,
  receiveBatchSchema,
  previewUniqSchema,
  createBrandSchema,
  updateBrandSchema,
  updateStockUnitSchema,
  idSchema,
  returnDemoSchema,
  stampUnitSchema,
  reduceUnitSchema,
  stockExportSchema,
  stockImportSchema,
} from "./inventory.schema.js";

export const inventoryRouter = Router();
inventoryRouter.use(authenticate, requireTenant);
inventoryRouter.get("/levels", requirePermission("inventory:view"), c.levels);
inventoryRouter.get(
  "/export",
  requirePermission("inventory:view"),
  validate(stockExportSchema),
  c.exportStockIn,
);
inventoryRouter.post("/adjust", requirePermission("inventory:write"), stockHistory("stock.adjusted", "Stock count adjusted"), validate(adjustSchema), c.adjust);
inventoryRouter.get("/brands", requirePermission("inventory:view"), c.listBrands);
inventoryRouter.post(
  "/brands",
  requirePermission("inventory:write"),
  validate(createBrandSchema),
  c.createBrand,
);
inventoryRouter.patch(
  "/brands/:id",
  requirePermission("inventory:write"),
  validate(updateBrandSchema),
  c.updateBrand,
);
inventoryRouter.delete(
  "/brands/:id",
  requirePermission("inventory:write"),
  validate(idSchema),
  c.deleteBrand,
);
inventoryRouter.get("/workspace", requirePermission("inventory:view"), c.stockWorkspace);
inventoryRouter.get("/units", requirePermission("inventory:view"), c.listUnits);
inventoryRouter.post("/units", requirePermission("inventory:write"), stockHistory("stock.received", "Unit added to stock"), validate(addStockUnitSchema), c.addUnit);
inventoryRouter.post(
  "/receipts",
  requirePermission("inventory:write"),
  stockHistory("stock.received", "Stock received into the warehouse"),
  validate(receiveBatchSchema),
  c.receiveBatch,
);
inventoryRouter.post(
  "/uniq-ids/preview",
  requirePermission("inventory:view"),
  validate(previewUniqSchema),
  c.previewUniqIds,
);
inventoryRouter.get("/units/:id", requirePermission("inventory:view"), validate(idSchema), c.getUnit);
inventoryRouter.patch(
  "/units/:id",
  requirePermission("inventory:write"),
  validate(updateStockUnitSchema),
  c.updateUnit,
);
inventoryRouter.post(
  "/units/:id/return-demo",
  requirePermission("inventory:write"),
  stockHistory("stock.demo_returned", "Demo unit returned to stock"),
  validate(returnDemoSchema),
  c.returnDemo,
);
inventoryRouter.post(
  "/units/:id/stamp",
  requirePermission("inventory:write"),
  stockHistory("stock.stamped", "Stamping recorded on stock unit"),
  validate(stampUnitSchema),
  c.stampUnit,
);
inventoryRouter.post(
  "/units/:id/reduce",
  requirePermission("inventory:write"),
  stockHistory(
    (b) => (b.purpose === "DEMO" ? "stock.demo_issued" : "stock.sold"),
    (b) => (b.purpose === "DEMO" ? "Unit issued for demo" : "Unit reduced — sold"),
  ),
  validate(reduceUnitSchema),
  c.reduceUnit,
);
inventoryRouter.get("/history", requirePermission("inventory:view"), c.history);
/** Opening / received / out / closing register for a month — same as Reports → Stock, for warehouse staff */
inventoryRouter.get("/stock-register", requirePermission("inventory:view"), async (q, r) => {
  const { runReport } = await import("../reports/reports.service.js");
  const { dayBounds } = await import("../reports/reports.routes.js");
  const { from, to } = dayBounds(q.query.from, q.query.to);
  const { success } = await import("../../common/utils/response.js");
  return success(r, await runReport(q.auth!.tenantId!, String(q.auth!.role ?? ""), "stock-monthly", { from, to }));
});
inventoryRouter.get(
  "/delivery-challans",
  requirePermission("inventory:view"),
  c.listDeliveryChallans,
);
inventoryRouter.post(
  "/import",
  requirePermission("inventory:write"),
  validate(stockImportSchema),
  c.importStock,
);
