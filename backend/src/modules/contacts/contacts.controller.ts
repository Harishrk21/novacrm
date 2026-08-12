import type { Request, Response } from "express";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import * as s from "./contacts.service.js";

const t = (q: Request) => q.auth!.tenantId!;

export const list = async (q: Request, r: Response) => success(r, await s.list(t(q), q.query));
export const get = async (q: Request, r: Response) => success(r, await s.get(t(q), paramId(q)));
export const create = async (q: Request, r: Response) =>
  success(r, await s.create(t(q), q.body), "Contact created", 201);
export const update = async (q: Request, r: Response) =>
  success(r, await s.update(t(q), paramId(q), q.body));
export const remove = async (q: Request, r: Response) => {
  await s.remove(t(q), paramId(q));
  return success(r, null, "Contact deleted");
};
export const phone = async (q: Request, r: Response) =>
  success(r, await s.phone(t(q), String(q.query.phone)));

export const addNote = async (q: Request, r: Response) =>
  success(
    r,
    await s.addNote(t(q), paramId(q), q.auth!.userId!, String(q.body.content)),
    "Note added",
    201,
  );

export const updateNote = async (q: Request, r: Response) =>
  success(
    r,
    await s.updateNote(t(q), paramId(q), String(q.params.noteId), String(q.body.content)),
    "Note updated",
  );

export const removeNote = async (q: Request, r: Response) => {
  await s.removeNote(t(q), paramId(q), String(q.params.noteId));
  return success(r, null, "Note deleted");
};
