import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import * as s from "./spareParts.service.js";

const t = (q: Request) => q.auth!.tenantId!;

export const list = async (q: Request, r: Response) =>
  success(r, await s.list(t(q), q.query as Record<string, unknown>));

export const get = async (q: Request, r: Response) =>
  success(r, await s.get(t(q), paramId(q)));

export const create = async (q: Request, r: Response) =>
  success(r, await s.create(t(q), q.auth!.userId, q.body), "Spare part recorded", 201);

export const update = async (q: Request, r: Response) =>
  success(r, await s.update(t(q), paramId(q), q.body), "Spare part updated");

export const remove = async (q: Request, r: Response) => {
  await s.remove(t(q), paramId(q));
  return success(r, null, "Deleted");
};
