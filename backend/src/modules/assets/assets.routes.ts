import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { notFound } from "../../common/errors.js";

const MACHINE_TYPES = [
  "WEIGHING",
  "BILLING",
  "CCM",
  "CCTV",
  "BIOMETRIC",
  "PAPER_SHREDDER",
  "PAPER_ROLL",
  "OTHER",
] as const;

const body = z.object({
  contactId: z.string().min(1).max(36),
  machineType: z.enum(MACHINE_TYPES).optional(),
  name: z.string().min(1).max(191),
  capacity: z.string().nullable().optional(),
  accuracy: z.string().nullable().optional(),
  platformSize: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNo: z.string().nullable().optional(),
  origin: z.enum(["SOLD_BY_US", "THIRD_PARTY"]).optional(),
  servicePlan: z.enum(["AMC", "NON_AMC"]).optional(),
  amcStartDate: z.string().nullable().optional(),
  amcEndDate: z.string().nullable().optional(),
  remindersEnabled: z.boolean().optional(),
  stampingDate: z.string().nullable().optional(),
  nextDueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

const params = z.object({ id: z.string().min(1).max(36) });
const createSchema = z.object({ body, query: z.any(), params: z.any() });
const updateSchema = z.object({ body: body.partial().omit({ contactId: true }).extend({ contactId: z.string().min(1).max(36).optional() }), query: z.any(), params });
const idSchema = z.object({ body: z.any(), query: z.any(), params });

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function serialize(row: {
  stampingDate: Date | null;
  nextDueDate: Date | null;
  amcStartDate?: Date | null;
  amcEndDate?: Date | null;
  [key: string]: unknown;
}) {
  return {
    ...row,
    stampingDate: row.stampingDate ? row.stampingDate.toISOString().slice(0, 10) : null,
    nextDueDate: row.nextDueDate ? row.nextDueDate.toISOString().slice(0, 10) : null,
    amcStartDate: row.amcStartDate ? row.amcStartDate.toISOString().slice(0, 10) : null,
    amcEndDate: row.amcEndDate ? row.amcEndDate.toISOString().slice(0, 10) : null,
  };
}

export const assetsRouter = Router();
assetsRouter.use(authenticate, requireTenant);

assetsRouter.get("/", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const p = pagination(q.query);
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.query.contactId) where.contactId = String(q.query.contactId);
  if (q.query.machineType) where.machineType = String(q.query.machineType);
  if (q.query.servicePlan === "AMC" || q.query.servicePlan === "NON_AMC") {
    where.servicePlan = String(q.query.servicePlan);
  }
  if (q.query.origin === "SOLD_BY_US" || q.query.origin === "THIRD_PARTY") {
    where.origin = String(q.query.origin);
  }
  if (q.query.dueSoon === "1" || q.query.dueSoon === "true") {
    const until = new Date();
    until.setDate(until.getDate() + 30);
    where.OR = [
      { nextDueDate: { lte: until, not: null } },
      { amcEndDate: { lte: until, not: null } },
    ];
  }
  if (q.query.search) {
    const s = String(q.query.search).trim();
    where.AND = [
      ...(where.AND as object[] | undefined ?? []),
      {
        OR: [
          { name: { contains: s } },
          { serialNo: { contains: s } },
          { model: { contains: s } },
        ],
      },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.customerAsset.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: [{ nextDueDate: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.customerAsset.count({ where }),
  ]);
  const contactIds = [...new Set(items.map((i) => i.contactId))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { tenantId: t, id: { in: contactIds }, deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          customerCode: true,
        },
      })
    : [];
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  return success(
    r,
    pageResult(
      items.map((row) => ({
        ...serialize(row),
        contact: contactMap[row.contactId] ?? null,
      })),
      total,
      p.page,
      p.limit,
    ),
  );
});

assetsRouter.post("/", validate(createSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const d = q.body as z.infer<typeof body>;
  const contact = await prisma.contact.findFirst({
    where: { id: d.contactId, tenantId: t, deletedAt: null },
  });
  if (!contact) throw notFound("Contact");
  const row = await prisma.customerAsset.create({
    data: {
      id: newId(),
      tenantId: t,
      contactId: d.contactId,
      machineType: d.machineType ?? "WEIGHING",
      name: d.name.trim(),
      capacity: d.capacity ?? null,
      accuracy: d.accuracy ?? null,
      platformSize: d.platformSize ?? null,
      model: d.model ?? null,
      serialNo: d.serialNo ?? null,
      origin: d.origin ?? "SOLD_BY_US",
      servicePlan: d.servicePlan ?? "NON_AMC",
      amcStartDate: d.servicePlan === "AMC" ? parseDate(d.amcStartDate) : null,
      amcEndDate: d.servicePlan === "AMC" ? parseDate(d.amcEndDate) : null,
      remindersEnabled: d.remindersEnabled ?? true,
      stampingDate: parseDate(d.stampingDate),
      nextDueDate: parseDate(d.nextDueDate),
      notes: d.notes ?? null,
      customFields: (d.customFields as object | undefined) ?? undefined,
    },
  });
  return success(r, serialize(row), "Machine saved", 201);
});

assetsRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const row = await prisma.customerAsset.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!row) throw notFound("Machine");
  return success(r, serialize(row));
});

assetsRouter.patch("/:id", validate(updateSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const existing = await prisma.customerAsset.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!existing) throw notFound("Machine");
  const d = q.body as Record<string, unknown>;
  if (d.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: String(d.contactId), tenantId: t, deletedAt: null },
    });
    if (!contact) throw notFound("Contact");
  }
  const data: Record<string, unknown> = { ...d };
  if ("stampingDate" in d) data.stampingDate = parseDate(d.stampingDate);
  if ("nextDueDate" in d) data.nextDueDate = parseDate(d.nextDueDate);
  if ("amcStartDate" in d) data.amcStartDate = parseDate(d.amcStartDate);
  if ("amcEndDate" in d) data.amcEndDate = parseDate(d.amcEndDate);
  if (typeof d.name === "string") data.name = d.name.trim();
  if (d.servicePlan === "NON_AMC") {
    data.amcStartDate = null;
    data.amcEndDate = null;
  }
  await prisma.customerAsset.updateMany({ where: { id, tenantId: t, deletedAt: null }, data });
  const row = await prisma.customerAsset.findFirst({ where: { id, tenantId: t } });
  if (!row) throw notFound("Machine");
  return success(r, serialize(row), "Machine updated");
});

assetsRouter.delete("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const updated = await prisma.customerAsset.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!updated.count) throw notFound("Machine");
  return success(r, null, "Machine removed");
});
