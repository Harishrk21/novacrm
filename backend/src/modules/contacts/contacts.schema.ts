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

export const noteCreateSchema = z.object({
  body: z.object({ content: z.string().min(1) }),
  query: z.any(),
  params,
});

export const noteUpdateSchema = z.object({
  body: z.object({ content: z.string().min(1) }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36), noteId: z.string().min(1).max(36) }),
});

export const noteIdSchema = z.object({
  body: z.any(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36), noteId: z.string().min(1).max(36) }),
});

const importMachine = z
  .object({
    name: z.string().nullable().optional(),
    machineType: z.string().nullable().optional(),
    serialNo: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    capacity: z.string().nullable().optional(),
    accuracy: z.string().nullable().optional(),
    platformSize: z.string().nullable().optional(),
    origin: z.string().nullable().optional(),
    servicePlan: z.string().nullable().optional(),
    stampingDate: z.string().nullable().optional(),
    nextDueDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const importRow = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  doorNo: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  buildingName: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  landmark: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  machine: importMachine,
});

export const importSchema = z.object({
  body: z.object({
    rows: z.array(importRow).min(1).max(500),
  }),
  query: z.any(),
  params: z.any(),
});
