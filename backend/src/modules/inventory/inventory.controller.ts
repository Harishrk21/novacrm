import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import {
  assertMachinesAllowed,
  loadUserInventoryAreas,
} from "../../common/inventoryAreas.js";
import * as s from "./inventory.service.js";
import * as brands from "./brands.service.js";
import * as stockImport from "./stockImport.service.js";

async function requireMachines(q: Request) {
  const areas = await loadUserInventoryAreas(q.auth!.tenantId!, q.auth!.userId);
  assertMachinesAllowed(areas);
}

export const levels = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.levels(q.auth!.tenantId!, q.query as Record<string, unknown>));
};

export const adjust = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.adjust(q.auth!.tenantId!, q.auth!.userId, q.body), "Stock adjusted", 201);
};

export const listUnits = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.listUnits(q.auth!.tenantId!, q.query as Record<string, unknown>));
};

export const stockWorkspace = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.stockWorkspace(q.auth!.tenantId!));
};

export const getUnit = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.getUnit(q.auth!.tenantId!, paramId(q)));
};

export const addUnit = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.addStockUnit(q.auth!.tenantId!, q.auth!.userId, q.body), "Stock unit added", 201);
};

export const receiveBatch = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(
    r,
    await s.receiveBatchStock(q.auth!.tenantId!, q.auth!.userId, q.body),
    "Stock received",
    201,
  );
};

export const previewUniqIds = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(
    r,
    await s.previewHmsUniqIds(q.auth!.tenantId!, q.body.productId, q.body.quantity),
  );
};

export const listBrands = async (q: Request, r: Response) =>
  success(
    r,
    await brands.listBrands(q.auth!.tenantId!, {
      includeInactive: String(q.query.all ?? "") === "1" || String(q.query.all ?? "") === "true",
    }),
  );

export const createBrand = async (q: Request, r: Response) =>
  success(r, await brands.createBrand(q.auth!.tenantId!, q.body), "Brand created", 201);

export const updateBrand = async (q: Request, r: Response) =>
  success(r, await brands.updateBrand(q.auth!.tenantId!, paramId(q), q.body), "Brand updated");

export const deleteBrand = async (q: Request, r: Response) =>
  success(r, await brands.deleteBrand(q.auth!.tenantId!, paramId(q)), "Brand deleted");

export const updateUnit = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(
    r,
    await s.updateStockUnit(q.auth!.tenantId!, q.auth!.userId, paramId(q), q.body),
    "Stock unit updated",
  );
};

export const returnDemo = async (q: Request, r: Response) => {
  await requireMachines(q);
  const body = (q.body ?? {}) as {
    notes?: string;
    outcome?: "NOT_INTERESTED" | "READY_TO_BUY";
    stageId?: string;
    sendWhatsApp?: boolean;
  };
  if (body.outcome === "NOT_INTERESTED" || body.outcome === "READY_TO_BUY") {
    return success(
      r,
      await s.closeDemoFromUnit(q.auth!.tenantId!, q.auth!.userId, paramId(q), {
        notes: body.notes,
        outcome: body.outcome,
        stageId: body.stageId,
        sendWhatsApp: body.sendWhatsApp,
      }),
      body.outcome === "READY_TO_BUY"
        ? "Demo converted — approve sales requisition next"
        : "Demo closed",
    );
  }
  return success(
    r,
    await s.returnDemoUnit(q.auth!.tenantId!, q.auth!.userId, paramId(q), body),
    "Demo unit returned to stock",
  );
};

export const stampUnit = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(
    r,
    await s.recordStamping(
      q.auth!.tenantId!,
      q.auth!.userId,
      paramId(q),
      q.body.stampingDate,
      q.body.notes,
    ),
    "Stamping date recorded",
  );
};

export const reduceUnit = async (q: Request, r: Response) => {
  await requireMachines(q);
  const purpose = q.body?.purpose === "DEMO" ? "DEMO" : q.body?.purpose === "SALE" ? "SALE" : undefined;
  return success(
    r,
    await s.reduceStockUnit(q.auth!.tenantId!, q.auth!.userId, paramId(q), {
      notes: q.body?.notes,
      reason: q.body?.reason,
      purpose,
      issuedToUserId: q.body?.issuedToUserId,
      contactId: q.body?.contactId,
    }),
    purpose === "DEMO" ? "Unit issued for demo" : "Stock unit removed",
  );
};

export const history = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.history(q.auth!.tenantId!, q.query as Record<string, unknown>));
};

export const listDeliveryChallans = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.listDeliveryChallans(q.auth!.tenantId!));
};

export const exportStockIn = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(
    r,
    await s.exportStockIn(q.auth!.tenantId!, {
      from: String(q.query.from),
      to: String(q.query.to),
      warehouseId: q.query.warehouseId ? String(q.query.warehouseId) : undefined,
      productId: q.query.productId ? String(q.query.productId) : undefined,
    }),
  );
};

export const importStock = async (q: Request, r: Response) => {
  const kind = q.body.kind as stockImport.StockImportKind;
  const rows = q.body.rows as Array<Record<string, unknown>>;
  const areas = await loadUserInventoryAreas(q.auth!.tenantId!, q.auth!.userId);
  stockImport.assertImportKindAllowed(areas, kind);

  if (kind === "machines") {
    return success(
      r,
      await stockImport.importMachineStock(q.auth!.tenantId!, q.auth!.userId, rows),
      "Machine stock import finished",
    );
  }
  return success(
    r,
    await stockImport.importSpareStock(
      q.auth!.tenantId!,
      q.auth!.userId,
      kind,
      rows,
    ),
    "Spare stock import finished",
  );
};
