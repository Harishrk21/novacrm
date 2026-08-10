import { z } from "zod";

const imageUrl = z
  .string()
  .max(512)
  .nullable()
  .optional()
  .refine(
    (v) =>
      v == null ||
      v === "" ||
      v.startsWith("/uploads/") ||
      v.startsWith("http://") ||
      v.startsWith("https://"),
    "Image must be a URL or uploaded path",
  )
  .transform((v) => (v === "" ? null : v));

const body = z.object({
  categoryId: z.string().min(1).max(36).nullable().optional(),
  sku: z.string().min(1).max(64),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  productType: z.enum(["GOODS", "SERVICE", "BUNDLE"]).optional(),
  unit: z.string().optional(),
  hsnSac: z.string().nullable().optional(),
  salePrice: z.coerce.number().nonnegative().optional(),
  purchasePrice: z.coerce.number().nonnegative().optional(),
  mrp: z.coerce.number().nonnegative().nullable().optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  trackInventory: z.boolean().optional(),
  reorderLevel: z.coerce.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
  imageUrl,
  attributes: z.record(z.unknown()).optional(),
  customFields: z.record(z.unknown()).optional(),
});

const params = z.object({ id: z.string().min(1).max(36) });
export const createSchema = z.object({ body, query: z.any(), params: z.any() });
export const updateSchema = z.object({ body: body.partial(), query: z.any(), params });
export const idSchema = z.object({ body: z.any(), query: z.any(), params });
