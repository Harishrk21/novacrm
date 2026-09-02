import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { cacheDelPattern, cacheGet, cacheSet } from "../../config/redis.js";
import { AppError, notFound } from "../../common/errors.js";
import {
  allocateCustomerIdentity,
  assertContactIdentityAvailable,
} from "../contacts/customerIdentity.js";

const invalidate = (t: string) => cacheDelPattern(`leads:${t}:*`);

async function validateRefs(t: string, d: Record<string, unknown>) {
  if (
    d.sourceId &&
    !(await prisma.leadSource.findFirst({
      where: { id: String(d.sourceId), tenantId: t, isActive: true },
    }))
  ) {
    throw notFound("Lead source");
  }
  if (
    d.assignedToId &&
    !(await prisma.user.findFirst({
      where: { id: String(d.assignedToId), tenantId: t, deletedAt: null, status: "ACTIVE" },
    }))
  ) {
    throw notFound("Assigned user");
  }
}

/** When a lead is assigned, create a PENDING follow-up so it shows in Team tasks / My Work */
async function ensureFollowUpTask(
  t: string,
  lead: { id: string; name: string; company: string | null; phone: string | null },
  assignedToId: string,
  createdById: string,
) {
  const existing = await prisma.activity.findFirst({
    where: {
      tenantId: t,
      leadId: lead.id,
      assignedToId,
      status: { in: ["PENDING", "OVERDUE"] },
      deletedAt: null,
    },
  });
  if (existing) return existing;

  const company = lead.company ? ` (${lead.company})` : "";
  return prisma.activity.create({
    data: {
      id: newId(),
      tenantId: t,
      type: "TASK",
      title: `Follow up lead: ${lead.name}${company}`,
      description: lead.phone
        ? `Call / qualify this enquiry. Phone: ${lead.phone}`
        : "Call / qualify this enquiry and update lead status.",
      status: "PENDING",
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      leadId: lead.id,
      assignedToId,
      customFields: { auto_from: "lead_assign", created_by: createdById },
    },
  });
}

export async function list(t: string, q: Record<string, unknown>) {
  const p = pagination(q);
  const key = `leads:${t}:${JSON.stringify(q)}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.status) where.status = q.status;
  if (q.assignedToId) where.assignedToId = q.assignedToId;
  if (q.search) {
    where.OR = [
      { name: { contains: String(q.search) } },
      { company: { contains: String(q.search) } },
      { email: { contains: String(q.search) } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: { createdAt: "desc" },
    }),
    prisma.lead.count({ where }),
  ]);
  const out = pageResult(items, total, p.page, p.limit);
  await cacheSet(key, out);
  return out;
}

export async function get(t: string, id: string) {
  const x = await prisma.lead.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!x) throw notFound("Lead");
  return x;
}

export async function create(t: string, user: string, data: Record<string, unknown>) {
  await validateRefs(t, data);
  const x = await prisma.lead.create({
    data: {
      ...data,
      id: newId(),
      tenantId: t,
      createdById: user,
      phoneNormalized: normalizePhone(data.phone as string | null | undefined),
    } as any,
  });
  if (x.assignedToId) {
    await ensureFollowUpTask(t, x, x.assignedToId, user);
  }
  await invalidate(t);
  return x;
}

export async function update(t: string, id: string, data: Record<string, unknown>) {
  await validateRefs(t, data);
  const before = await get(t, id);
  if (data.status === "CONVERTED" && before.status !== "CONVERTED") {
    throw new AppError("Use POST /leads/:id/convert to convert enquiries", 400);
  }
  const r = await prisma.lead.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      ...data,
      ...("phone" in data
        ? { phoneNormalized: normalizePhone(data.phone as string | null | undefined) }
        : {}),
    } as any,
  });
  if (!r.count) throw notFound("Lead");
  const after = await get(t, id);
  if (
    after.assignedToId &&
    after.assignedToId !== before.assignedToId &&
    !["CONVERTED", "LOST", "UNQUALIFIED"].includes(after.status)
  ) {
    await ensureFollowUpTask(t, after, after.assignedToId, after.createdById);
  }
  await invalidate(t);
  return after;
}

export async function remove(t: string, id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const demoUnitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : "";
  if (demoUnitId && lead.status === "DEMO") {
    const { returnDemoUnit } = await import("../inventory/inventory.service.js");
    await returnDemoUnit(t, "system", demoUnitId, { notes: "Lead deleted", leadId: id });
  }
  const r = await prisma.lead.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!r.count) throw notFound("Lead");
  await invalidate(t);
}

export async function assign(t: string, id: string, userId: string | null) {
  if (
    userId &&
    !(await prisma.user.findFirst({
      where: { id: userId, tenantId: t, deletedAt: null, status: "ACTIVE" },
    }))
  ) {
    throw notFound("User");
  }
  return update(t, id, { assignedToId: userId });
}

export const status = (t: string, id: string, next: string) => update(t, id, { status: next });

export const phone = (t: string, v: string) =>
  prisma.lead.findMany({
    where: { tenantId: t, phoneNormalized: normalizePhone(v), deletedAt: null },
    take: 20,
  });

export async function convert(t: string, id: string, user: string, data: any) {
  const lead = await get(t, id);
  if (lead.status === "CONVERTED") throw new AppError("Lead is already converted", 409);
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: data.stageId, tenantId: t, isActive: true },
  });
  if (!stage) throw notFound("Pipeline stage");
  const result = await prisma.$transaction(async (tx) => {
    let accountId: string | undefined;
    if (data.createAccount && lead.company) {
      const account = await tx.account.create({
        data: {
          id: newId(),
          tenantId: t,
          name: lead.company,
          email: lead.email,
          phone: lead.phone,
          city: lead.city,
          state: lead.state,
          ownerUserId: lead.assignedToId,
        },
      });
      accountId = account.id;
    }
    const phoneNorm = lead.phoneNormalized || normalizePhone(lead.phone || "") || null;
    let contact = phoneNorm
      ? await tx.contact.findFirst({
          where: { tenantId: t, phoneNormalized: phoneNorm, deletedAt: null },
        })
      : null;

    if (!contact) {
      await assertContactIdentityAvailable(
        t,
        {
          phone: lead.phone,
          email: lead.email,
          requirePhone: Boolean(lead.phone),
        },
        tx,
      );
      const identity = await allocateCustomerIdentity(t, tx);
      contact = await tx.contact.create({
        data: {
          id: newId(),
          tenantId: t,
          accountId,
          customerNo: identity.customerNo,
          customerCode: identity.customerCode,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          phoneNormalized: phoneNorm,
          city: lead.city,
          state: lead.state,
          ownerUserId: lead.assignedToId,
          customFields: lead.customFields ?? undefined,
        },
      });
    } else if (accountId && !contact.accountId) {
      contact = await tx.contact.update({
        where: { id: contact.id },
        data: { accountId },
      });
    }

    const deal = await tx.deal.create({
      data: {
        id: newId(),
        tenantId: t,
        name: data.dealName ?? `${lead.company ?? lead.name} opportunity`,
        amount: data.amount ?? 0,
        stageId: stage.id,
        probability: stage.probability,
        contactId: contact.id,
        accountId: accountId ?? contact.accountId ?? undefined,
        ownerUserId: lead.assignedToId ?? user,
        customFields: lead.customFields ?? undefined,
      },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: "CONVERTED",
        convertedAt: new Date(),
        convertedContactId: contact.id,
        convertedAccountId: accountId ?? contact.accountId,
        convertedDealId: deal.id,
      },
    });
    // Close open follow-up tasks for this lead
    await tx.activity.updateMany({
      where: {
        tenantId: t,
        leadId: lead.id,
        status: { in: ["PENDING", "OVERDUE"] },
        deletedAt: null,
      },
      data: { status: "COMPLETED", completedAt: new Date(), outcome: "Lead converted" },
    });
    return { contact, accountId: accountId ?? contact.accountId, deal };
  });
  await invalidate(t);
  // If this lead had a demo serial out, mark that unit SOLD
  try {
    const { markDemoSold } = await import("../inventory/inventory.service.js");
    await markDemoSold(t, user, id);
  } catch {
    /* non-fatal if no demo unit */
  }
  return result;
}

export async function issueDemo(t: string, user: string, leadId: string, stockUnitId: string) {
  const { issueDemoUnit } = await import("../inventory/inventory.service.js");
  const unit = await issueDemoUnit(t, user, leadId, stockUnitId);
  await invalidate(t);
  return { lead: await get(t, leadId), stockUnit: unit };
}

export async function returnDemo(t: string, user: string, leadId: string, notes?: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : "";
  if (!unitId) throw new AppError("No demo unit linked to this enquiry", 400);

  const { returnDemoUnit } = await import("../inventory/inventory.service.js");
  const unit = await returnDemoUnit(t, user, unitId, { notes, leadId });
  await invalidate(t);
  return { lead: await get(t, leadId), stockUnit: unit };
}
