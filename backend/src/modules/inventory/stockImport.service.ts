import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError } from "../../common/errors.js";
import { receiveBatchStock } from "./inventory.service.js";
import * as spareStock from "../spareStock/spareStock.service.js";
import {
  assertMachinesAllowed,
  assertSpareFamilyAllowed,
  loadUserInventoryAreas,
  type InventoryAreas,
} from "../../common/inventoryAreas.js";

export const MACHINE_IMPORT_FIELDS = [
  "hmsUniqId",
  "brand",
  "model",
  "spec",
  "serialNo",
  "supplierName",
  "invoiceDate",
  "invoiceNo",
  "receivedDate",
  "unitAmount",
] as const;

export const SPARE_IMPORT_FIELDS = [
  "spareName",
  "opening",
  "newStock",
  "given",
  "balance",
  "gc",
  "ngc",
  "supplierName",
  "invoiceDate",
  "invoiceNo",
  "unit",
] as const;

export type StockImportKind = "machines" | "sparesBilling" | "sparesWeighing";

function cell(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null) return "";
  return String(v).trim();
}

function numCell(row: Record<string, unknown>, key: string): number {
  const raw = cell(row, key).replace(/,/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseDateLoose(raw: string): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
      return epoch;
    }
  }
  const d = new Date(s.includes("T") ? s : `${s.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

async function findOrCreateBrand(t: string, name: string) {
  const n = name.trim();
  if (!n) return null;
  const all = await prisma.brand.findMany({
    where: { tenantId: t, deletedAt: null, isActive: true },
  });
  const hit = all.find((b) => b.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit;
  const codeBase = n
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 10) || "BRAND";
  return prisma.brand.create({
    data: {
      id: newId(),
      tenantId: t,
      name: n,
      code: `${codeBase}-${Date.now().toString(36).slice(-4)}`.slice(0, 32),
    },
  });
}

async function findOrCreateVendor(t: string, name: string) {
  const n = name.trim();
  if (!n) return null;
  const all = await prisma.vendor.findMany({
    where: { tenantId: t, deletedAt: null },
  });
  const hit = all.find((v) => v.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit;
  return prisma.vendor.create({
    data: { id: newId(), tenantId: t, name: n },
  });
}

async function findProductByModel(t: string, model: string) {
  const m = model.trim();
  if (!m) return null;
  const products = await prisma.product.findMany({
    where: { tenantId: t, deletedAt: null, isActive: true },
    take: 500,
  });
  const lower = m.toLowerCase();
  return (
    products.find((p) => p.sku.toLowerCase() === lower) ??
    products.find((p) => p.name.toLowerCase() === lower) ??
    products.find((p) => p.name.toLowerCase().includes(lower) || p.sku.toLowerCase().includes(lower)) ??
    null
  );
}

async function mainWarehouse(t: string) {
  const rows = await prisma.warehouse.findMany({
    where: { tenantId: t, deletedAt: null, isActive: true },
  });
  return (
    rows.find((w) => String(w.code ?? "").toUpperCase() === "MAIN") ?? rows[0] ?? null
  );
}

export function assertImportKindAllowed(areas: InventoryAreas, kind: StockImportKind) {
  if (kind === "machines") assertMachinesAllowed(areas);
  else if (kind === "sparesBilling") assertSpareFamilyAllowed(areas, "BILLING");
  else assertSpareFamilyAllowed(areas, "WEIGHING");
}

export async function importMachineStock(
  t: string,
  userId: string,
  rows: Array<Record<string, unknown>>,
) {
  const areas = await loadUserInventoryAreas(t, userId);
  assertMachinesAllowed(areas);

  const warehouse = await mainWarehouse(t);
  if (!warehouse) throw new AppError("No warehouse configured", 400);

  const results = {
    created: 0,
    skipped: 0,
    errors: [] as Array<{ row: number; message: string }>,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNo = i + 2;
    try {
      const model = cell(row, "model");
      const hmsUniqId = cell(row, "hmsUniqId").toUpperCase();
      const serialNo = cell(row, "serialNo").toUpperCase() || hmsUniqId;
      if (!model) throw new AppError("MODEL is required", 400);
      if (!hmsUniqId && !serialNo) throw new AppError("HMS UNIQ ID or SNO required", 400);

      if (hmsUniqId) {
        const dup = await prisma.stockUnit.findFirst({
          where: { tenantId: t, hmsUniqId, deletedAt: null },
        });
        if (dup) {
          results.skipped += 1;
          continue;
        }
      }
      if (serialNo) {
        const dupS = await prisma.stockUnit.findFirst({
          where: { tenantId: t, serialNo, deletedAt: null },
        });
        if (dupS) {
          results.skipped += 1;
          continue;
        }
      }

      const product = await findProductByModel(t, model);
      if (!product) throw new AppError(`Product/model not found in catalog: ${model}`, 404);

      const brand = await findOrCreateBrand(t, cell(row, "brand"));
      const vendor = await findOrCreateVendor(t, cell(row, "supplierName"));
      const invoiceDate = parseDateLoose(cell(row, "invoiceDate"));
      const receivedDate = parseDateLoose(cell(row, "receivedDate")) ?? invoiceDate;

      await receiveBatchStock(t, userId, {
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: 1,
        vendorId: vendor?.id ?? null,
        brandId: brand?.id ?? null,
        spec: cell(row, "spec") || null,
        invoiceNo: cell(row, "invoiceNo") || null,
        invoiceDate: isoDay(invoiceDate),
        receivedDate: isoDay(receivedDate),
        unitAmount: numCell(row, "unitAmount"),
        units: [{ serialNo: serialNo || hmsUniqId, hmsUniqId: hmsUniqId || null }],
        notes: "Excel stock import",
      });
      results.created += 1;
    } catch (e) {
      results.errors.push({
        row: rowNo,
        message: e instanceof AppError ? e.message : e instanceof Error ? e.message : "Failed",
      });
    }
  }

  return results;
}

export async function importSpareStock(
  t: string,
  userId: string,
  kind: "sparesBilling" | "sparesWeighing",
  rows: Array<Record<string, unknown>>,
) {
  const areas = await loadUserInventoryAreas(t, userId);
  const family = kind === "sparesBilling" ? ("BILLING" as const) : ("WEIGHING" as const);
  assertSpareFamilyAllowed(areas, family);

  const results = {
    created: 0,
    skipped: 0,
    errors: [] as Array<{ row: number; message: string }>,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNo = i + 2;
    try {
      const spareName = cell(row, "spareName");
      if (!spareName) throw new AppError("Spare name is required", 400);

      const opening = numCell(row, "opening");
      const newStock = numCell(row, "newStock");
      const given = numCell(row, "given");
      const expectedBalance = numCell(row, "balance");
      const gc = cell(row, "gc");
      const ngc = cell(row, "ngc");
      const supplierName = cell(row, "supplierName") || "Import";
      const invoiceDate = parseDateLoose(cell(row, "invoiceDate")) ?? new Date();
      const invoiceNo = cell(row, "invoiceNo") || null;
      const notesExtra = [gc ? `GC:${gc}` : "", ngc ? `NGC:${ngc}` : ""]
        .filter(Boolean)
        .join(" ");

      let movements = 0;

      if (opening > 0) {
        const items = await spareStock.listItems(t, { machineFamily: family, search: spareName });
        const existing = items.find((p) => p.name.toLowerCase() === spareName.toLowerCase());
        const onHand = Number(existing?.quantityOnHand ?? 0);
        if (onHand < opening) {
          await spareStock.receive(t, userId, {
            machineFamily: family,
            sparePartId: existing?.id,
            spareName,
            quantity: opening - onHand,
            supplierName: "Opening balance",
            invoiceDate: isoDay(invoiceDate)!,
            invoiceNo: null,
            notes: `Opening stock import${notesExtra ? ` · ${notesExtra}` : ""}`,
          });
          movements += 1;
        }
      }

      if (newStock > 0) {
        await spareStock.receive(t, userId, {
          machineFamily: family,
          spareName,
          quantity: newStock,
          supplierName,
          invoiceDate: isoDay(invoiceDate)!,
          invoiceNo,
          notes: `New stock import${notesExtra ? ` · ${notesExtra}` : ""}`,
        });
        movements += 1;
      }

      if (given > 0) {
        const items = await spareStock.listItems(t, { machineFamily: family, search: spareName });
        const part = items.find((p) => p.name.toLowerCase() === spareName.toLowerCase());
        if (!part) throw new AppError(`Spare not found for issue: ${spareName}`, 404);
        const available = await spareStock.balanceOf(t, part.id);
        if (given > available) {
          throw new AppError(
            `Cannot give ${given} of ${spareName} — only ${available} on hand`,
            409,
          );
        }
        await prisma.spareStockTxn.create({
          data: {
            id: newId(),
            tenantId: t,
            sparePartId: part.id,
            txnType: "OUT",
            quantity: given,
            txnDate: invoiceDate,
            notes: `Import: given/issued${notesExtra ? ` · ${notesExtra}` : ""}`,
            createdById: userId,
            customFields: { importIssue: true },
          },
        });
        movements += 1;
      }

      if (movements === 0) {
        await spareStock
          .createItem(t, {
            machineFamily: family,
            name: spareName,
            unit: cell(row, "unit") || "NOS",
          })
          .catch(() => undefined);
        results.skipped += 1;
      } else {
        results.created += movements;
      }

      const items = await spareStock.listItems(t, { machineFamily: family, search: spareName });
      const part = items.find((p) => p.name.toLowerCase() === spareName.toLowerCase());
      if (part && (gc || ngc)) {
        const prev =
          part.customFields && typeof part.customFields === "object"
            ? (part.customFields as Record<string, unknown>)
            : {};
        await prisma.sparePartItem.update({
          where: { id: part.id },
          data: {
            customFields: { ...prev, gc: gc || prev.gc, ngc: ngc || prev.ngc } as Prisma.InputJsonValue,
          },
        });
      }

      if (part && expectedBalance > 0) {
        const actual = Number(part.quantityOnHand ?? 0);
        // Re-read after movements
        const actualNow = await spareStock.balanceOf(t, part.id);
        if (Math.abs(actualNow - expectedBalance) > 0.001) {
          results.errors.push({
            row: rowNo,
            message: `Balance check: sheet=${expectedBalance}, system=${actualNow} (imported anyway)`,
          });
        }
        void actual;
      }
    } catch (e) {
      results.errors.push({
        row: rowNo,
        message: e instanceof AppError ? e.message : e instanceof Error ? e.message : "Failed",
      });
    }
  }

  return results;
}
