import { z } from "zod";

export const updateSchema = z.object({
  body: z
    .object({
      branding: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional(),
      terminology: z.record(z.string()).optional(),
      logoUrl: z.string().max(512).nullable().optional(),
      website: z.string().max(255).nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      gstin: z.string().max(32).nullable().optional(),
      city: z.string().max(100).nullable().optional(),
      state: z.string().max(100).nullable().optional(),
      addressLine1: z.string().max(255).nullable().optional(),
      postalCode: z.string().max(20).nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0),
  query: z.any(),
  params: z.any(),
});
