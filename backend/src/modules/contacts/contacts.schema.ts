import { z } from "zod";

const contactFields = z.object({
  accountId: z.string().min(1).max(36).nullable().optional(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  doorNo: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().length(2).optional(),
  ownerUserId: z.string().min(1).max(36).nullable().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

const createBody = contactFields.superRefine((v, ctx) => {
  const phone = (v.phone || v.mobile || "").trim();
  if (phone.length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Phone number is required to identify the customer",
      path: ["phone"],
    });
  }
});

const params = z.object({ id: z.string().min(1).max(36) });

export const createSchema = z.object({ body: createBody, query: z.any(), params: z.any() });
export const updateSchema = z.object({ body: contactFields.partial(), query: z.any(), params });
export const idSchema = z.object({ body: z.any(), query: z.any(), params });
export const phoneSchema = z.object({
  body: z.any(),
  query: z.object({ phone: z.string().min(5) }),
  params: z.any(),
});
