import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import * as s from "./inventory.service.js";

export const levels = async (q: Request, r: Response) =>
  success(r, await s.levels(q.auth!.tenantId!, q.query as Record<string, unknown>));

export const adjust = async (q: Request, r: Response) =>
  success(r, await s.adjust(q.auth!.tenantId!, q.auth!.userId, q.body), "Stock adjusted", 201);

export const listUnits = async (q: Request, r: Response) =>
  success(r, await s.listUnits(q.auth!.tenantId!, q.query as Record<string, unknown>));

export const getUnit = async (q: Request, r: Response) =>
  success(r, await s.getUnit(q.auth!.tenantId!, paramId(q)));

export const addUnit = async (q: Request, r: Response) =>
  success(r, await s.addStockUnit(q.auth!.tenantId!, q.auth!.userId, q.body), "Stock unit added", 201);

export const updateUnit = async (q: Request, r: Response) =>
  success(r, await s.updateStockUnit(q.auth!.tenantId!, paramId(q), q.body), "Stock unit updated");

export const returnDemo = async (q: Request, r: Response) =>
  success(
    r,
    await s.returnDemoUnit(q.auth!.tenantId!, q.auth!.userId, paramId(q), q.body),
    "Demo unit returned to stock",
  );

export const stampUnit = async (q: Request, r: Response) =>
  success(
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

export const history = async (q: Request, r: Response) =>
  success(r, await s.history(q.auth!.tenantId!, q.query as Record<string, unknown>));
