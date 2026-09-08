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
  const demoStockUnitId =
    typeof data.demoStockUnitId === "string" && data.demoStockUnitId.trim()
      ? String(data.demoStockUnitId).trim()
      : "";
  const sendWhatsApp = data.sendWhatsApp === true;
  const { demoStockUnitId: _omitDemo, sendWhatsApp: _omitWa, ...leadData } = data;
  await validateRefs(t, leadData);
  // Never create as DEMO directly — issueDemoUnit sets DEMO + stock in one step after insert.
  if (leadData.status === "DEMO") leadData.status = "NEW";

  const x = await prisma.lead.create({
    data: {
      ...leadData,
      id: newId(),
      tenantId: t,
      createdById: user,
      phoneNormalized: normalizePhone(leadData.phone as string | null | undefined),
    } as any,
  });
  if (x.assignedToId) {
    await ensureFollowUpTask(t, x, x.assignedToId, user);
  }

  let whatsappDemo: unknown = null;
  if (demoStockUnitId) {
    const { issueDemoUnit } = await import("../inventory/inventory.service.js");
    await issueDemoUnit(t, user, x.id, demoStockUnitId);
    if (sendWhatsApp) {
      whatsappDemo = await sendDemoWhatsAppForLead(t, x.id, user);
    }
  }

  let whatsapp: unknown = null;
  if (sendWhatsApp && x.phone) {
    const { notifySaleEnquiryReceived } = await import("../tickets/ticketNotify.service.js");
    whatsapp = await notifySaleEnquiryReceived(t, await get(t, x.id), user);
  }

  await invalidate(t);
  return { ...(await get(t, x.id)), whatsapp, whatsappDemo };
}

async function sendDemoWhatsAppForLead(t: string, leadId: string, user: string) {
  const lead = await get(t, leadId);
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const { notifyDemoDcCustomer } = await import("../tickets/ticketNotify.service.js");
  return notifyDemoDcCustomer(
    t,
    {
      leadId,
      contactName: lead.name,
      phone: lead.phone,
      productName: String(cf.demoProductName ?? "Demo unit"),
      serialNo: String(cf.demoSerialNo ?? "—"),
      dcNumber: String(cf.demoDcNo ?? "—"),
      executiveName: String(cf.demoExecutiveName ?? "our sales team"),
    },
    user,
  );
}

export async function update(t: string, id: string, data: Record<string, unknown>) {
  const { sendWhatsApp: _omitWa, ...patch } = data;
  await validateRefs(t, patch);
  const before = await get(t, id);
  if (patch.status === "CONVERTED" && before.status !== "CONVERTED") {
    throw new AppError("Use POST /leads/:id/convert to convert enquiries", 400);
  }

  // Demo → Not interested: return serial to main warehouse before marking LOST
  if (patch.status === "LOST" && before.status === "DEMO") {
    const cf =
      before.customFields && typeof before.customFields === "object" && !Array.isArray(before.customFields)
        ? (before.customFields as Record<string, unknown>)
        : {};
    const demoUnitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : "";
    if (demoUnitId) {
      const { returnDemoUnit } = await import("../inventory/inventory.service.js");
      await returnDemoUnit(t, "system", demoUnitId, {
        notes: "Customer not interested — demo returned to stock",
        leadId: id,
      });
    }
  }

  const r = await prisma.lead.updateMany({
    where: { id, tenantId: t, deletedAt: null },
    data: {
      ...patch,
      ...("phone" in patch
        ? { phoneNormalized: normalizePhone(patch.phone as string | null | undefined) }
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
    const cf =
      lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
        ? (lead.customFields as Record<string, unknown>)
        : {};
    const linkedContactId = cf.contact_id ? String(cf.contact_id) : "";

    let contact = linkedContactId
      ? await tx.contact.findFirst({
          where: { id: linkedContactId, tenantId: t, deletedAt: null },
        })
      : null;

    if (!contact && phoneNorm) {
      contact = await tx.contact.findFirst({
        where: { tenantId: t, phoneNormalized: phoneNorm, deletedAt: null },
      });
    }

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

  try {
    const { notifyBillingTeam } = await import("../notifications/notify.service.js");
    const contactId = result.contact?.id ?? "";
    const product =
      lead.customFields && typeof lead.customFields === "object"
        ? String((lead.customFields as Record<string, unknown>).demoProductName ?? (lead.customFields as Record<string, unknown>).interested_product_name ?? "")
        : "";
    const serial =
      lead.customFields && typeof lead.customFields === "object"
        ? String((lead.customFields as Record<string, unknown>).demoSerialNo ?? "")
        : "";
    await notifyBillingTeam(t, {
      title: "Sale ready for proforma invoice",
      message: `${lead.name}${lead.company ? ` · ${lead.company}` : ""} converted${product ? ` — ${product}` : ""}${serial ? ` · S/No ${serial}` : ""}. Create proforma in CRM; final GST bill in Tally.`,
      type: "LEAD_CONVERT_INVOICE",
      entityType: "invoice_lead",
      entityId: contactId || id,
    });
  } catch {
    /* non-fatal */
  }

  let whatsapp: unknown = null;
  if (data.sendWhatsApp === true) {
    try {
      const { notifySaleOrderConfirmed } = await import("../tickets/ticketNotify.service.js");
      const cf =
        lead.customFields && typeof lead.customFields === "object"
          ? (lead.customFields as Record<string, unknown>)
          : {};
      const product = String(cf.demoProductName ?? cf.interested_product_name ?? "your order");
      whatsapp = await notifySaleOrderConfirmed(
        t,
        {
          contactId: result.contact?.id ?? null,
          phone: lead.phone,
          contactName: lead.name,
          leadId: id,
          product,
          reference: `LE-${id.slice(0, 8).toUpperCase()}`,
        },
        user,
      );
    } catch (err) {
      console.error("sale convert whatsapp failed", err);
    }
  }

  return {
    ...result,
    leadId: id,
    contactId: result.contact?.id ?? null,
    dealId: result.deal?.id ?? null,
    whatsapp,
  };
}

export async function issueDemo(
  t: string,
  user: string,
  leadId: string,
  stockUnitId: string,
  sendWhatsApp = false,
) {
  const { issueDemoUnit } = await import("../inventory/inventory.service.js");
  const unit = await issueDemoUnit(t, user, leadId, stockUnitId);
  await invalidate(t);
  let whatsapp: unknown = null;
  if (sendWhatsApp) {
    whatsapp = await sendDemoWhatsAppForLead(t, leadId, user);
  }
  return { lead: await get(t, leadId), stockUnit: unit, whatsapp };
}

export async function returnDemo(
  t: string,
  user: string,
  leadId: string,
  body: {
    notes?: string;
    outcome?: "NOT_INTERESTED" | "READY_TO_BUY";
    stageId?: string;
    sendWhatsApp?: boolean;
  } = {},
) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : "";
  if (!unitId) throw new AppError("No demo unit linked to this enquiry", 400);

  const outcome = body.outcome ?? "NOT_INTERESTED";
  const notes = body.notes?.trim() || undefined;

  /** Customer wants to buy — convert prospect → permanent customer, sell demo unit, create machine, invoice next */
  if (outcome === "READY_TO_BUY") {
    let stageId = body.stageId;
    if (!stageId) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { tenantId: t, isActive: true },
        orderBy: { sortOrder: "asc" },
      });
      if (!stage) throw new AppError("No pipeline stage configured — ask admin to set up sales stages", 400);
      stageId = stage.id;
    }

    const converted = await convert(t, leadId, user, {
      stageId,
      dealName: `${lead.company || lead.name} — Sale`,
      amount: cf.budget != null ? Number(cf.budget) : 0,
      createAccount: true,
      sendWhatsApp: (body as { sendWhatsApp?: boolean }).sendWhatsApp === true,
    });

    try {
      const { notifyBillingTeam } = await import("../notifications/notify.service.js");
      await notifyBillingTeam(t, {
        title: "Demo closed — ready for proforma",
        message: `${lead.name} accepted the demo${cf.demoSerialNo ? ` (S/No ${cf.demoSerialNo})` : ""}. Customer created — raise proforma in CRM; GST invoice in Tally.`,
        type: "LEAD_DEMO_READY_INVOICE",
        entityType: "invoice_lead",
        entityId: String(converted.contactId ?? leadId),
      });
    } catch {
      /* non-fatal — convert already notifies */
    }

    return {
      outcome: "READY_TO_BUY" as const,
      lead: await get(t, leadId),
      contactId: converted.contactId,
      dealId: converted.dealId,
      productId: cf.demoProductId ? String(cf.demoProductId) : null,
      serialNo: cf.demoSerialNo ? String(cf.demoSerialNo) : null,
      next: "invoice" as const,
    };
  }

  /** Not interested — return serial to stock and close enquiry */
  const { returnDemoUnit } = await import("../inventory/inventory.service.js");
  const unit = await returnDemoUnit(t, user, unitId, {
    notes: notes || "Demo returned — customer not interested",
    leadId,
  });

  const afterReturn = await prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } });
  const afterCf =
    afterReturn?.customFields &&
    typeof afterReturn.customFields === "object" &&
    !Array.isArray(afterReturn.customFields)
      ? (afterReturn.customFields as Record<string, unknown>)
      : {};

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: "LOST",
      customFields: {
        ...afterCf,
        demoReturnReason: "NOT_INTERESTED",
        demoReturnNotes: notes || afterCf.demoReturnNotes || null,
        closedAt: new Date().toISOString(),
      },
    },
  });
  await invalidate(t);

  try {
    const { notifyAdmins } = await import("../notifications/notify.service.js");
    await notifyAdmins(t, {
      title: "Demo closed — not interested",
      message: `${lead.name}${cf.demoSerialNo ? ` · S/No ${cf.demoSerialNo}` : ""} returned demo stock. Enquiry marked closed.${notes ? ` Note: ${notes.slice(0, 120)}` : ""}`,
      type: "LEAD_DEMO_NOT_INTERESTED",
      entityType: "lead",
      entityId: leadId,
    });
  } catch {
    /* non-fatal */
  }

  return {
    outcome: "NOT_INTERESTED" as const,
    lead: await get(t, leadId),
    stockUnit: unit,
    next: null,
  };
}

/** Sales executive daily update while unit is on demo */
export async function addDemoUpdate(
  t: string,
  userId: string,
  leadId: string,
  body: { note: string; updateDate?: string },
) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  if (lead.status !== "DEMO") {
    throw new AppError("Daily updates are only for leads currently on demo", 400);
  }
  const note = body.note.trim();
  if (!note) throw new AppError("Update note is required", 400);

  const author = await prisma.user.findFirst({
    where: { id: userId, tenantId: t, deletedAt: null },
    select: { id: true, name: true },
  });
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const existing = Array.isArray(cf.demoDailyUpdates)
    ? (cf.demoDailyUpdates as Array<Record<string, unknown>>)
    : [];
  const dayNumber = existing.length + 1;
  const entry = {
    id: newId(),
    note,
    dayNumber,
    updateDate: (body.updateDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
    at: new Date().toISOString(),
    authorId: userId,
    authorName: author?.name ?? "Executive",
  };
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      customFields: {
        ...cf,
        demoDailyUpdates: [entry, ...existing].slice(0, 200),
        demoLastUpdateAt: entry.at,
        demoLastUpdateNote: note.slice(0, 240),
        demoLastUpdateBy: entry.authorName,
        demoLastUpdateDay: dayNumber,
      },
    },
  });
  await invalidate(t);

  try {
    const { notifyAdmins } = await import("../notifications/notify.service.js");
    await notifyAdmins(t, {
      title: `Day ${dayNumber} demo update`,
      message: `${lead.name}${cf.demoSerialNo ? ` · S/No ${cf.demoSerialNo}` : ""} — ${note.slice(0, 160)}`,
      type: "LEAD_DEMO_DAY_UPDATE",
      entityType: "lead",
      entityId: leadId,
    });
  } catch {
    /* non-fatal */
  }

  return get(t, leadId);
}
