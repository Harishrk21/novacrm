import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { forceAssignedToMe, isSalesExecutiveRole } from "../../common/utils/scope.js";
import * as s from "./leads.service.js";

const t = (q: Request) => q.auth!.tenantId!;

export const list = async (q: Request, r: Response) =>
  success(r, await s.list(t(q), forceAssignedToMe(q.auth, q.query as Record<string, unknown>)));
export const get = async (q: Request, r: Response) => success(r, await s.get(t(q), paramId(q)));
export const create = async (q: Request, r: Response) => {
  const body = { ...(q.body as Record<string, unknown>) };
  // Sales executives always own the enquiries they create.
  if (isSalesExecutiveRole(q.auth?.role) && q.auth?.userId) {
    body.assignedToId = q.auth.userId;
  }
  return success(r, await s.create(t(q), q.auth!.userId, body), "Lead created", 201);
};
export const update = async (q: Request, r: Response) =>
  success(r, await s.update(t(q), paramId(q), q.body));
export const remove = async (q: Request, r: Response) => {
  await s.remove(t(q), paramId(q));
  return success(r, null, "Lead deleted");
};
export const assign = async (q: Request, r: Response) =>
  success(r, await s.assign(t(q), paramId(q), q.body.userId));
export const status = async (q: Request, r: Response) =>
  success(r, await s.status(t(q), paramId(q), q.body.status));
export const convert = async (q: Request, r: Response) =>
  success(r, await s.convert(t(q), paramId(q), q.auth!.userId!, q.body), "Sale converted — admin notified for invoice");
export const issueDemo = async (q: Request, r: Response) =>
  success(
    r,
    await s.issueDemo(
      t(q),
      q.auth!.userId!,
      paramId(q),
      q.body.stockUnitId,
      q.body.sendWhatsApp === true,
    ),
    "Demo unit issued",
  );
export const returnDemo = async (q: Request, r: Response) =>
  success(r, await s.returnDemo(t(q), q.auth!.userId!, paramId(q), q.body), "Demo return processed");
export const demoUpdate = async (q: Request, r: Response) =>
  success(r, await s.addDemoUpdate(t(q), q.auth!.userId!, paramId(q), q.body), "Demo update saved");
export const phone = async (q: Request, r: Response) =>
  success(r, await s.phone(t(q), String(q.query.phone)));
