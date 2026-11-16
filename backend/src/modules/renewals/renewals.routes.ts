import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { paramId } from "../../common/utils/params.js";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";
import { recordEvent } from "../../common/history.js";
import {
  addMonths,
  canEnrollAmc,
  effectiveServicePlan,
  isWeighingMachine,
  stampQuarterFromDate,
} from "../../common/hmsCoverage.js";

/**
 * Renewals — one place for admin, sales and service desk to track and follow up:
 *   STAMPING  yearly legal stamping of weighing machines (next due date on the machine)
 *   AMC       AMC contracts ending (renew for another year)
 *   GC        HMS guarantee ending → weighing machines can move to AMC
 *   NGC       weighing machines after guarantee / outside machines with no AMC → offer AMC
 * Follow-ups are kept on the machine (customFields.renewal[KIND]) and the next follow-up date becomes
 * a task in the person's Workqueue, so nothing is forgotten.
 */
export const renewalsRouter = Router();
renewalsRouter.use(authenticate, requireTenant);

const KINDS = ["STAMPING", "AMC", "VISIT", "GC", "NGC"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = {
  STAMPING: "Stamping renewal",
  AMC: "AMC renewal",
  VISIT: "AMC visit due",
  GC: "Guarantee ending",
  NGC: "AMC offer",
};
const STATUSES = ["CALLED", "INTERESTED", "NO_ANSWER", "CALL_BACK", "NOT_INTERESTED", "RENEWED"] as const;

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

renewalsRouter.get("/", requirePermission("renewals:view"), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const assets = await prisma.customerAsset.findMany({
    where: { tenantId: t, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });
  const contactIds = [...new Set(assets.map((a) => a.contactId))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { tenantId: t, id: { in: contactIds }, deletedAt: null },
        select: { id: true, name: true, customerCode: true, phone: true, mobile: true, area: true, city: true, accountId: true },
      })
    : [];
  const accountIds = [...new Set(contacts.map((c) => c.accountId).filter(Boolean) as string[])];
  const accounts = accountIds.length
    ? await prisma.account.findMany({ where: { tenantId: t, id: { in: accountIds } }, select: { id: true, name: true } })
    : [];
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const cMap = new Map(contacts.map((c) => [c.id, c]));

  const items = assets
    .filter((a) => cMap.has(a.contactId)) // machines of deleted customers never show
    .map((a) => {
      const c = cMap.get(a.contactId)!;
      const cf = obj(a.customFields);
      return {
        id: a.id,
        name: a.name,
        model: a.model,
        serialNo: a.serialNo,
        capacity: a.capacity,
        machineType: a.machineType,
        origin: a.origin,
        plan: effectiveServicePlan({ servicePlan: a.servicePlan, warrantyEndDate: a.warrantyEndDate }),
        warrantyEndDate: day(a.warrantyEndDate),
        amcStartDate: day(a.amcStartDate),
        amcEndDate: day(a.amcEndDate),
        nextServiceDueDate: day(a.nextServiceDueDate),
        stampingDate: day(a.stampingDate),
        nextDueDate: day(a.nextDueDate),
        stampingNumber: (cf.stampingNumber ?? cf.stampNumber ?? null) as string | null,
        createdAt: a.createdAt,
        renewal: obj(cf.renewal),
        customer: {
          id: c.id,
          name: c.name,
          code: c.customerCode,
          phone: c.mobile || c.phone,
          area: c.area,
          city: c.city,
          company: c.accountId ? accName.get(c.accountId) ?? null : null,
        },
      };
    });
  return success(r, { items, today: day(new Date()) });
});

const followSchema = z.object({
  body: z.object({
    kind: z.enum(KINDS),
    status: z.enum(STATUSES),
    note: z.string().trim().max(1000).optional().default(""),
    nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

async function loadAsset(t: string, id: string) {
  const a = await prisma.customerAsset.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!a) throw notFound("Machine");
  const c = await prisma.contact.findFirst({ where: { id: a.contactId, tenantId: t, deletedAt: null }, select: { id: true, name: true, customerCode: true } });
  if (!c) throw notFound("Customer");
  return { a, c };
}

/** Save the follow-up on the machine; schedule the next one as a Workqueue task (replacing the old one). */
async function saveFollowUp(opts: {
  t: string;
  userId: string;
  userName: string;
  assetId: string;
  kind: Kind;
  status: (typeof STATUSES)[number];
  note: string;
  nextFollowUp?: string | null;
}) {
  const { a, c } = await loadAsset(opts.t, opts.assetId);
  const cf = obj(a.customFields);
  const renewal = obj(cf.renewal);
  const prev = obj(renewal[opts.kind]);

  // Old pending follow-up task for this machine + kind is replaced
  if (prev.taskId) {
    await prisma.activity.updateMany({
      where: { id: String(prev.taskId), tenantId: opts.t, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }
  let taskId: string | null = null;
  if (opts.nextFollowUp && opts.status !== "RENEWED" && opts.status !== "NOT_INTERESTED") {
    taskId = newId();
    await prisma.activity.create({
      data: {
        id: taskId,
        tenantId: opts.t,
        type: "CALL",
        title: `${KIND_LABEL[opts.kind]} — ${a.name} · ${c.name}`,
        description: opts.note || null,
        status: "PENDING",
        scheduledAt: new Date(`${opts.nextFollowUp}T10:00:00`),
        contactId: c.id,
        assignedToId: opts.userId,
        customFields: { renewalKind: opts.kind, assetId: a.id },
      },
    });
  }
  const entry = {
    status: opts.status,
    note: opts.note,
    nextFollowUp: opts.nextFollowUp ?? null,
    by: opts.userName,
    byId: opts.userId,
    at: new Date().toISOString(),
  };
  const history = [entry, ...(Array.isArray(prev.history) ? (prev.history as Row[]) : [])].slice(0, 25);
  const next = { ...entry, taskId, history };
  const updated = await prisma.customerAsset.update({
    where: { id: a.id },
    data: { customFields: { ...cf, renewal: { ...renewal, [opts.kind]: next } } as never },
  });
  return { asset: updated, customer: c, entry };
}

renewalsRouter.post(
  "/:id/follow-up",
  requirePermission("renewals:write"),
  validate(followSchema),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const me = await prisma.user.findFirst({ where: { id: q.auth!.userId!, tenantId: t }, select: { name: true } });
    const d = q.body as z.infer<typeof followSchema>["body"];
    const out = await saveFollowUp({
      t,
      userId: q.auth!.userId!,
      userName: me?.name ?? "User",
      assetId: paramId(q),
      kind: d.kind,
      status: d.status,
      note: d.note,
      nextFollowUp: d.nextFollowUp ?? null,
    });
    return success(r, { ok: true, followUp: out.entry });
  },
);

const renewSchema = z.object({
  body: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("STAMPING"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      number: z.string().trim().max(80).optional().nullable(),
      note: z.string().trim().max(1000).optional().default(""),
    }),
    z.object({
      kind: z.literal("AMC"),
      /** Start of the new 1-year contract; default = day after the old AMC ends (or today) */
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      amount: z.coerce.number().nonnegative().optional().nullable(),
      note: z.string().trim().max(1000).optional().default(""),
    }),
  ]),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

renewalsRouter.post(
  "/:id/renew",
  requirePermission("renewals:write"),
  validate(renewSchema),
  async (q: Request, r: Response) => {
    const t = q.auth!.tenantId!;
    const userId = q.auth!.userId!;
    const me = await prisma.user.findFirst({ where: { id: userId, tenantId: t }, select: { name: true } });
    const d = q.body as z.infer<typeof renewSchema>["body"];
    const { a, c } = await loadAsset(t, paramId(q));
    if (!isWeighingMachine(a.machineType)) throw new AppError("Stamping and AMC are only for weighing machines", 400);
    const cf = obj(a.customFields);
    const today = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00");

    if (d.kind === "STAMPING") {
      const date = new Date(`${d.date}T12:00:00`);
      if (date.getTime() > today.getTime()) throw new AppError("Stamping date cannot be in the future", 400);
      const nextDue = addMonths(d.date, 12);
      await prisma.customerAsset.update({
        where: { id: a.id },
        data: {
          stampingDate: date,
          nextDueDate: nextDue,
          customFields: {
            ...cf,
            ...(d.number ? { stampingNumber: d.number } : {}),
            stampingQuarter: stampQuarterFromDate(d.date),
            stampingQuarterYear: date.getFullYear(),
          } as never,
        },
      });
      await saveFollowUp({ t, userId, userName: me?.name ?? "User", assetId: a.id, kind: "STAMPING", status: "RENEWED", note: d.note || `Stamped ${d.date}${d.number ? ` · No. ${d.number}` : ""}` });
      recordEvent({
        tenantId: t, userId, action: "service.stamping_renewed", area: "Service", entityType: "CustomerAsset", entityId: a.id,
        label: `${c.customerCode ?? ""} · ${c.name}`.trim(),
        summary: `Stamping renewed — ${a.name}${a.serialNo ? ` (${a.serialNo})` : ""}; next due ${nextDue.toISOString().slice(0, 10)}`,
        details: { stampingDate: d.date, stampingNumber: d.number ?? null, nextDueDate: nextDue.toISOString().slice(0, 10) },
      });
      return success(r, { ok: true, nextDueDate: day(nextDue) });
    }

    // AMC: renew an AMC that is ending / ended, or start one after guarantee / on an outside machine
    const plan = effectiveServicePlan({ servicePlan: a.servicePlan, warrantyEndDate: a.warrantyEndDate });
    const isRenewal = plan === "AMC";
    if (!isRenewal) {
      const can = canEnrollAmc({ machineType: a.machineType, servicePlan: a.servicePlan, warrantyEndDate: a.warrantyEndDate, amcEndDate: a.amcEndDate });
      if (!can.ok) throw new AppError(can.reason, 400);
    }
    let start: Date;
    if (d.startDate) start = new Date(`${d.startDate}T12:00:00`);
    else if (isRenewal && a.amcEndDate && a.amcEndDate.getTime() >= today.getTime()) {
      start = new Date(a.amcEndDate.getTime() + 864e5);
    } else start = today;
    const end = new Date(addMonths(start, 12).getTime() - 864e5);
    const nextService = addMonths(start, 6);
    await prisma.customerAsset.update({
      where: { id: a.id },
      data: {
        servicePlan: "AMC",
        amcStartDate: start,
        amcEndDate: end,
        nextServiceDueDate: nextService,
        customFields: {
          ...cf,
          amcHistory: [
            { start: day(start), end: day(end), amount: d.amount ?? null, by: me?.name ?? "User", at: new Date().toISOString(), renewal: isRenewal },
            ...(Array.isArray(cf.amcHistory) ? (cf.amcHistory as Row[]) : []),
          ].slice(0, 20),
        } as never,
      },
    });
    await saveFollowUp({
      t, userId, userName: me?.name ?? "User", assetId: a.id, kind: isRenewal ? "AMC" : plan === "GC" ? "GC" : "NGC", status: "RENEWED",
      note: d.note || `AMC ${isRenewal ? "renewed" : "started"} ${day(start)} – ${day(end)}${d.amount ? ` · ₹${d.amount}` : ""}`,
    });
    recordEvent({
      tenantId: t, userId, action: isRenewal ? "service.amc_renewed" : "service.amc_started", area: "Service", entityType: "CustomerAsset", entityId: a.id,
      label: `${c.customerCode ?? ""} · ${c.name}`.trim(),
      summary: `AMC ${isRenewal ? "renewed" : "started"} — ${a.name}: ${day(start)} to ${day(end)}`,
      details: { amcStartDate: day(start), amcEndDate: day(end), amount: d.amount ?? null, nextServiceDueDate: day(nextService) },
    });
    return success(r, { ok: true, amcStartDate: day(start), amcEndDate: day(end) });
  },
);
