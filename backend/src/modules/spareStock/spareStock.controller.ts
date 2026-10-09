import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import {
  allowedSpareFamilies,
  assertSpareFamilyAllowed,
  loadUserInventoryAreas,
} from "../../common/inventoryAreas.js";
import { AppError } from "../../common/errors.js";
import * as svc from "./spareStock.service.js";

async function areasFor(q: Request) {
  return loadUserInventoryAreas(q.auth!.tenantId!, q.auth!.userId);
}

function clampFamily(
  areas: Awaited<ReturnType<typeof loadUserInventoryAreas>>,
  requested?: string,
): "WEIGHING" | "BILLING" | undefined {
  const allowed = allowedSpareFamilies(areas);
  if (!allowed.length) {
    throw new AppError("You do not have access to spare parts stock", 403);
  }
  if (requested === "WEIGHING" || requested === "BILLING") {
    assertSpareFamilyAllowed(areas, requested);
    return requested;
  }
  if (allowed.length === 1) return allowed[0];
  return undefined;
}

export const listItems = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  const query = q.query as { machineFamily?: string; q?: string; active?: string };
  const machineFamily = clampFamily(areas, query.machineFamily);
  const data = await svc.listItems(q.auth!.tenantId!, {
    machineFamily,
    search: query.q,
    active: query.active === "false" ? false : true,
  });
  const filtered =
    machineFamily != null
      ? data
      : data.filter((row) =>
          allowedSpareFamilies(areas).includes(row.machineFamily as "WEIGHING" | "BILLING"),
        );
  return success(r, filtered);
};

export const createItem = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  assertSpareFamilyAllowed(areas, q.body.machineFamily);
  return success(r, await svc.createItem(q.auth!.tenantId!, q.body), "Spare created", 201);
};

export const updateItem = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  const id = String(q.params.id);
  const family =
    q.body.machineFamily ?? (await svc.getItemFamily(q.auth!.tenantId!, id));
  assertSpareFamilyAllowed(areas, family);
  return success(r, await svc.updateItem(q.auth!.tenantId!, id, q.body), "Spare updated");
};

export const receive = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  assertSpareFamilyAllowed(areas, q.body.machineFamily);
  return success(
    r,
    await svc.receive(q.auth!.tenantId!, q.auth!.userId, q.body),
    "Spare stock received",
    201,
  );
};

export const issue = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  const part = await svc.getItemFamily(q.auth!.tenantId!, q.body.sparePartId);
  assertSpareFamilyAllowed(areas, part);
  return success(
    r,
    await svc.issue(q.auth!.tenantId!, q.auth!.userId, q.body),
    "Spare issued",
    201,
  );
};

export const history = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  const query = q.query as {
    machineFamily?: string;
    sparePartId?: string;
    from?: string;
    to?: string;
    limit?: string;
  };
  const machineFamily = clampFamily(areas, query.machineFamily);
  return success(
    r,
    await svc.history(q.auth!.tenantId!, {
      machineFamily,
      sparePartId: query.sparePartId,
      from: query.from,
      to: query.to,
      limit: query.limit ? Number(query.limit) : undefined,
      allowedFamilies: machineFamily ? undefined : allowedSpareFamilies(areas),
    }),
  );
};

export const monthly = async (q: Request, r: Response) => {
  const areas = await areasFor(q);
  const query = q.query as {
    year?: string;
    month?: string;
    machineFamily?: string;
    sparePartId?: string;
  };
  const now = new Date();
  const machineFamily = clampFamily(areas, query.machineFamily);
  return success(
    r,
    await svc.monthlyReport(q.auth!.tenantId!, {
      year: query.year ? Number(query.year) : now.getFullYear(),
      month: query.month ? Number(query.month) : now.getMonth() + 1,
      machineFamily,
      sparePartId: query.sparePartId ? String(query.sparePartId) : undefined,
      allowedFamilies: machineFamily ? undefined : allowedSpareFamilies(areas),
    }),
  );
};
