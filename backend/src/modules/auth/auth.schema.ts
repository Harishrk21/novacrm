import { z } from "zod";
const credentials = {
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(8),
};
export const platformLoginSchema = z.object({
  body: z.object(credentials),
  query: z.any(),
  params: z.any(),
});
/** tenantSlug/tenantCode optional — when omitted, resolve workspace by email */
export const tenantLoginSchema = z.object({
  body: z.object({
    ...credentials,
    tenantSlug: z.string().min(1).optional(),
    tenantCode: z.string().min(1).optional(),
  }),
  query: z.any(),
  params: z.any(),
});
export const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(32) }),
  query: z.any(),
  params: z.any(),
});
export const logoutSchema = refreshSchema;

export const updateProfileSchema = z.object({
  body: z
    .object({
      name: z.string().min(2).max(120).optional(),
      phone: z.string().max(32).nullable().optional(),
      avatarUrl: z.string().max(512).nullable().optional(),
      timezone: z.string().max(64).optional(),
      preferences: z.record(z.unknown()).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" }),
  query: z.any(),
  params: z.any(),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
  }),
  query: z.any(),
  params: z.any(),
});

