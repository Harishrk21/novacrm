import { z } from "zod";

const changeTypes = ["REPLACED", "INSTALLED", "REMOVED", "REPAIRED", "ADJUSTED"] as const;

const body = z.object({
  contactId: z.string().min(1).max(36),
  assetId: z.string().min(1).max(36).nullable().optional(),
  ticketId: z.string().min(1).max(36).nullable().optional(),
  partName: z.string().min(1).max(191),
  partCode: z.string().max(64).nullable().optional(),
  changeType: z.enum(changeTypes).optional(),
  quantity: z.coerce.number().int().min(1).max(999).optional(),
  oldSerialNo: z.string().max(120).nullable().optional(),
  newSerialNo: z.string().max(120).nullable().optional(),
  changedAt: z.string().nullable().optional(),
  performedByUserId: z.string().min(1).max(36).nullable().optional(),
  chargeAmount: z.coerce.number().nonnegative().nullable().optional(),
  underWarranty: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

const params = z.object({ id: z.string().min(1).max(36) });

export const createSchema = z.object({ body, query: z.any(), params: z.any() });
export const updateSchema = z.object({
  body: body.partial().omit({ contactId: true }),
  query: z.any(),
  params,
});
export const idSchema = z.object({ body: z.any(), query: z.any(), params });
