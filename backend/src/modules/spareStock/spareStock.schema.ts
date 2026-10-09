import { z } from "zod";

const machineFamily = z.enum(["WEIGHING", "BILLING"]);

export const listItemsSchema = z.object({
  body: z.any(),
  query: z.object({
    machineFamily: machineFamily.optional(),
    q: z.string().optional(),
    active: z.string().optional(),
  }),
  params: z.any(),
});

export const createItemSchema = z.object({
  body: z.object({
    machineFamily,
    name: z.string().min(1).max(191),
    partCode: z.string().max(64).optional().nullable(),
    unit: z.string().max(32).optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const updateItemSchema = z.object({
  body: z.object({
    machineFamily: machineFamily.optional(),
    name: z.string().min(1).max(191).optional(),
    partCode: z.string().max(64).optional().nullable(),
    unit: z.string().max(32).optional(),
    isActive: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().uuid() }),
});

export const receiveSchema = z.object({
  body: z.object({
    machineFamily,
    sparePartId: z.string().uuid().optional().nullable(),
    spareName: z.string().min(1).max(191).optional(),
    quantity: z.coerce.number().positive(),
    supplierName: z.string().min(1).max(191),
    invoiceDate: z.string().min(1),
    invoiceNo: z.string().max(80).optional().nullable(),
    txnDate: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    unitAmount: z.coerce.number().optional().nullable(),
    /** Per-unit spare unique IDs (auto-range from start). */
    spareUniqIds: z.array(z.string().min(1).max(80)).max(500).optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const issueSchema = z.object({
  body: z.object({
    sparePartId: z.string().uuid(),
    quantity: z.coerce.number().positive(),
    /** Optional — defaults to the logged-in user (easy stock reduce / self-issue). */
    issuedToUserId: z.string().uuid().optional().nullable(),
    txnDate: z.string().optional().nullable(),
    ticketId: z.string().uuid().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    reason: z.string().max(2000).optional().nullable(),
  }),
  query: z.any(),
  params: z.any(),
});

export const historySchema = z.object({
  body: z.any(),
  query: z.object({
    machineFamily: machineFamily.optional(),
    sparePartId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().optional(),
  }),
  params: z.any(),
});

export const monthlySchema = z.object({
  body: z.any(),
  query: z.object({
    machineFamily: machineFamily.optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    sparePartId: z.string().min(1).max(36).optional(),
  }),
  params: z.any(),
});
