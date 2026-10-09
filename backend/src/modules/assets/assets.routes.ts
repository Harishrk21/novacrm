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
import { AppError, notFound } from "../../common/errors.js";
import {
  defaultAmcEndFromStart,
  defaultNextAmcService,
  defaultWarrantyEndFromToday,
  effectiveServicePlan,
  hmsSoldCoverage,
  isUnderGc,
  normalizeServicePlan,
} from "../../common/hmsCoverage.js";
import { persistLapsedGc } from "./coverageLapse.js";

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

const SERVICE_PLANS = ["GC", "NGC", "AMC", "NON_AMC"] as const;

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
  servicePlan: z.enum(SERVICE_PLANS).optional(),
  warrantyEndDate: z.string().nullable().optional(),
  amcStartDate: z.string().nullable().optional(),
  amcEndDate: z.string().nullable().optional(),
  nextServiceDueDate: z.string().nullable().optional(),
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
  warrantyEndDate?: Date | null;
  amcStartDate?: Date | null;
  amcEndDate?: Date | null;
  nextServiceDueDate?: Date | null;
  [key: string]: unknown;
}) {
  const slice = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
  return {
    ...row,
    servicePlan: effectiveServicePlan({
      servicePlan: row.servicePlan as string | null | undefined,
      warrantyEndDate: row.warrantyEndDate,
    }),
    stampingDate: slice(row.stampingDate),
    nextDueDate: slice(row.nextDueDate),
    warrantyEndDate: slice(row.warrantyEndDate),
    amcStartDate: slice(row.amcStartDate),
    amcEndDate: slice(row.amcEndDate),
    nextServiceDueDate: slice(row.nextServiceDueDate),
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
  if (SERVICE_PLANS.includes(String(q.query.servicePlan) as (typeof SERVICE_PLANS)[number])) {
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
      { nextServiceDueDate: { lte: until, not: null } },
      { warrantyEndDate: { lte: until, not: null } },
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
  await persistLapsedGc(items);
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
  const origin = d.origin ?? "SOLD_BY_US";
  const machineType = d.machineType ?? "WEIGHING";
  const weighing = String(machineType) === "WEIGHING";
  const soldCoverage = origin === "SOLD_BY_US" ? hmsSoldCoverage(new Date(), weighing) : null;
  const plan = normalizeServicePlan(
    d.servicePlan ?? (soldCoverage ? "GC" : "NON_AMC"),
  );
  if (plan === "AMC" && String(machineType) !== "WEIGHING") {
    throw new AppError("AMC is only for weighing machines", 400);
  }
  const warrantyEnd =
    plan === "GC"
      ? parseDate(d.warrantyEndDate) ?? soldCoverage?.warrantyEndDate ?? defaultWarrantyEndFromToday()
      : parseDate(d.warrantyEndDate);
  const amcStart = plan === "AMC" ? parseDate(d.amcStartDate) ?? new Date() : null;
  const amcEnd =
    plan === "AMC" ? parseDate(d.amcEndDate) ?? defaultAmcEndFromStart(amcStart) : null;
  const nextService =
    plan === "AMC"
      ? parseDate(d.nextServiceDueDate) ?? defaultNextAmcService(amcStart)
      : parseDate(d.nextServiceDueDate);
  const incomingCf =
    d.customFields && typeof d.customFields === "object" && !Array.isArray(d.customFields)
      ? (d.customFields as Record<string, unknown>)
      : {};
  const customFields = soldCoverage
    ? {
        ...incomingCf,
        soldAt: incomingCf.soldAt ?? new Date().toISOString(),
        stampingQuarter: incomingCf.stampingQuarter ?? soldCoverage.stampingQuarter,
        stampingQuarterYear: incomingCf.stampingQuarterYear ?? soldCoverage.stampingQuarterYear,
      }
    : incomingCf;
  const row = await prisma.customerAsset.create({
    data: {
      id: newId(),
      tenantId: t,
      contactId: d.contactId,
      machineType,
      name: d.name.trim(),
      capacity: d.capacity ?? null,
      accuracy: d.accuracy ?? null,
      platformSize: d.platformSize ?? null,
      model: d.model ?? null,
      serialNo: d.serialNo ?? null,
      origin,
      servicePlan: plan,
      warrantyEndDate: warrantyEnd,
      amcStartDate: amcStart,
      amcEndDate: amcEnd,
      nextServiceDueDate: nextService,
      remindersEnabled: d.remindersEnabled ?? true,
      stampingDate: parseDate(d.stampingDate) ?? (weighing ? soldCoverage?.stampingDate ?? null : null),
      nextDueDate: parseDate(d.nextDueDate) ?? (weighing ? soldCoverage?.nextDueDate ?? null : null),
      notes: d.notes ?? null,
      customFields: Object.keys(customFields).length ? (customFields as object) : undefined,
    },
  });
  return success(r, serialize(row), "Machine saved", 201);
});

assetsRouter.get("/:id", validate(idSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const id = paramId(q);
  const row = await prisma.customerAsset.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!row) throw notFound("Machine");
  await persistLapsedGc([row]);
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
  if ("warrantyEndDate" in d) data.warrantyEndDate = parseDate(d.warrantyEndDate);
  if ("amcStartDate" in d) data.amcStartDate = parseDate(d.amcStartDate);
  if ("amcEndDate" in d) data.amcEndDate = parseDate(d.amcEndDate);
  if ("nextServiceDueDate" in d) data.nextServiceDueDate = parseDate(d.nextServiceDueDate);
  if (typeof d.name === "string") data.name = d.name.trim();
  if (typeof d.servicePlan === "string") {
    const plan = normalizeServicePlan(d.servicePlan);
    const machineType = String(d.machineType ?? existing.machineType);
    if (plan === "AMC" && machineType !== "WEIGHING") {
      throw new AppError("AMC is only for weighing machines", 400);
    }
    if (
      plan === "AMC" &&
      existing.servicePlan !== "AMC" &&
      isUnderGc({
        servicePlan: existing.servicePlan,
        warrantyEndDate: existing.warrantyEndDate,
      })
    ) {
      throw new AppError(
        "AMC opens after the 1-year GC ends. Existing weighing customers not under GC can convert now.",
        400,
      );
    }
    data.servicePlan = plan;
    if (plan === "GC" && !("warrantyEndDate" in d)) {
      data.warrantyEndDate =
        existing.warrantyEndDate ?? defaultWarrantyEndFromToday();
    }
    if (plan === "AMC") {
      if (!("amcStartDate" in d) && !existing.amcStartDate) {
        data.amcStartDate = new Date();
      }
      if (!("amcEndDate" in d) && !existing.amcEndDate) {
        data.amcEndDate = defaultAmcEndFromStart(
          ("amcStartDate" in d ? parseDate(d.amcStartDate) : existing.amcStartDate) ?? new Date(),
        );
      }
      if (!("nextServiceDueDate" in d) && !existing.nextServiceDueDate) {
        data.nextServiceDueDate = defaultNextAmcService(
          ("amcStartDate" in d ? parseDate(d.amcStartDate) : existing.amcStartDate) ?? new Date(),
        );
      }
    }
    if (plan === "NGC" || plan === "NON_AMC") {
      if (!("amcStartDate" in d)) data.amcStartDate = null;
      if (!("amcEndDate" in d)) data.amcEndDate = null;
      if (!("nextServiceDueDate" in d)) data.nextServiceDueDate = null;
    }
  }
  await prisma.customerAsset.updateMany({ where: { id, tenantId: t, deletedAt: null }, data });
  const row = await prisma.customerAsset.findFirst({ where: { id, tenantId: t } });
  if (!row) throw notFound("Machine");

  if (row.serialNo && ("stampingDate" in d || "nextDueDate" in d)) {
    const { syncStampingAcrossRegisters } = await import("../inventory/inventory.service.js");
    await syncStampingAcrossRegisters(t, {
      serialNo: row.serialNo,
      contactId: row.contactId,
      stampingDate: row.stampingDate,
      nextDueDate: row.nextDueDate,
    });
  }

  await persistLapsedGc([row]);
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
