import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import * as s from "./invoices.service.js";

const t = (q: Request) => q.auth!.tenantId!;

export const list = async (q: Request, r: Response) => success(r, await s.list(t(q), q.query));
export const get = async (q: Request, r: Response) => success(r, await s.get(t(q), paramId(q)));
export const create = async (q: Request, r: Response) =>
  success(r, await s.create(t(q), q.auth!.userId, q.body), "Invoice created", 201);
export const status = async (q: Request, r: Response) =>
  success(r, await s.updateStatus(t(q), paramId(q), q.body), "Invoice status updated");
