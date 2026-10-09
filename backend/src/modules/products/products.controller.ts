import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import {
  assertMachinesAllowed,
  loadUserInventoryAreas,
} from "../../common/inventoryAreas.js";
import * as s from "./products.service.js";

const t = (q: Request) => q.auth!.tenantId!;

async function requireMachines(q: Request) {
  const areas = await loadUserInventoryAreas(q.auth!.tenantId!, q.auth!.userId);
  assertMachinesAllowed(areas);
}

export const list = async (q: Request, r: Response) => success(r, await s.list(t(q), q.query));
export const get = async (q: Request, r: Response) => success(r, await s.get(t(q), paramId(q)));
export const create = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.create(t(q), q.body), "Product created", 201);
};
export const update = async (q: Request, r: Response) => {
  await requireMachines(q);
  return success(r, await s.update(t(q), paramId(q), q.body));
};
export const remove = async (q: Request, r: Response) => {
  await requireMachines(q);
  await s.remove(t(q), paramId(q));
  return success(r, null, "Product deleted");
};
