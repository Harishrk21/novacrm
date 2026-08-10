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
