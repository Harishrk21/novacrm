import { z } from "zod";

const line = z.object({
  productId: z.string().min(1).max(36).nullable().optional(),
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
});

export const createSchema = z.object({
  body: z.object({
    accountId: z.string().min(1).max(36),
    contactId: z.string().min(1).max(36).nullable().optional(),
    salesOrderId: z.string().min(1).max(36).nullable().optional(),
    invoiceDate: z.coerce.date(),
    dueDate: z.coerce.date().nullable().optional(),
    currency: z.string().length(3).optional(),
    discountTotal: z.coerce.number().nonnegative().default(0),
    notes: z.string().nullable().optional(),
    customFields: z.record(z.unknown()).optional(),
    lines: z.array(line).min(1),
  }),
  query: z.any(),
  params: z.any(),
});

export const idSchema = z.object({
  body: z.any(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const statusSchema = z.object({
  body: z.object({
    status: z.enum(["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"]),
    amountPaid: z.coerce.number().nonnegative().optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
