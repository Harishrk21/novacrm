import { z } from "zod";

export const adjustSchema = z.object({
  body: z.object({
    productId: z.string().min(1).max(36),
    warehouseId: z.string().min(1).max(36),
    quantity: z.coerce.number().refine((v) => v !== 0, "Quantity cannot be zero"),
    movementType: z.enum(["IN", "OUT", "ADJUST", "RETURN"]).default("IN"),
    notes: z
      .string()
      .max(255)
      .optional()
      .transform((v) => {
        const t = (v ?? "").trim();
        return t.length >= 2 ? t : "Stock adjustment";
      }),
    referenceType: z.string().max(64).optional(),
    referenceId: z.string().min(1).max(36).optional(),
  }),
  query: z.any(),
  params: z.any(),
});

const dateStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && String(v).trim() ? String(v).trim().slice(0, 10) : null));

export const addStockUnitSchema = z.object({
  body: z.object({
    productId: z.string().min(1).max(36),
    warehouseId: z.string().min(1).max(36),
    serialNo: z.string().min(1).max(120),
    stampingDate: dateStr,
    notes: z.string().max(2000).nullable().optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const updateStockUnitSchema = z.object({
  body: z.object({
    warehouseId: z.string().min(1).max(36).optional(),
    serialNo: z.string().min(1).max(120).optional(),
    stampingDate: dateStr,
    notes: z.string().max(2000).nullable().optional(),
    status: z.enum(["IN_STOCK", "DEMO", "SOLD", "RETURNED"]).optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const idSchema = z.object({
  body: z.any(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const returnDemoSchema = z.object({
  body: z.object({
    notes: z.string().max(500).optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const stampUnitSchema = z.object({
  body: z.object({
    stampingDate: z.string().min(1).max(32),
    notes: z.string().max(500).optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const issueDemoSchema = z.object({
  body: z.object({
    stockUnitId: z.string().min(1).max(36),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});
