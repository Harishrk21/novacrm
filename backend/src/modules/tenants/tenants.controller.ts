import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import * as s from "./tenants.service.js";
import * as demo from "./demoData.service.js";

export const get = async (q: Request, r: Response) => success(r, await s.get(q.auth!.tenantId!));
export const modules = async (q: Request, r: Response) =>
  success(r, await s.modules(q.auth!.tenantId!));
export const update = async (q: Request, r: Response) =>
  success(r, await s.update(q.auth!.tenantId!, q.body));

export const demoDataStatus = async (q: Request, r: Response) =>
  success(r, await demo.demoDataStatus(q.auth!.tenantId!));

export const loadDemoData = async (q: Request, r: Response) =>
  success(r, await demo.loadDemoData(q.auth!.tenantId!, q.auth!.userId), "Demo data loaded", 201);

export const removeDemoData = async (q: Request, r: Response) =>
  success(r, await demo.removeDemoData(q.auth!.tenantId!), "Demo data removed");
