import { Prisma } from "@prisma/client";
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

function formatEnq(leadNo: number | null | undefined) {
  if (leadNo == null) return "ENQ-—";
  return `ENQ-${String(leadNo).padStart(5, "0")}`;
}

async function nextLeadNo(t: string) {
  return prisma.$transaction(
    async (tx) => {
      const maxRow = await tx.lead.aggregate({
        where: { tenantId: t },
        _max: { leadNo: true },
      });
      const minNext = (maxRow._max.leadNo ?? 0) + 1;

      let seq = await tx.numberSequence.findUnique({
        where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "LEAD" } },
      });
      if (!seq) {
        await tx.numberSequence.create({
          data: {
            tenantId: t,
            sequenceKey: "LEAD",
            prefix: "ENQ-",
            nextValue: minNext + 1,
            padding: 5,
          },
        });
        return minNext;
      }

      const leadNo = Math.max(seq.nextValue, minNext);
      await tx.numberSequence.update({
        where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "LEAD" } },
        data: { nextValue: leadNo + 1 },
      });
      return leadNo;
    },
    { maxWait: 5_000, timeout: 10_000 },
  );
}

async function nextTicketNoForLead(t: string) {
  return prisma.$transaction(async (tx) => {
    const maxRow = await tx.ticket.aggregate({
      where: { tenantId: t },
      _max: { ticketNo: true },
    });
    const minNext = (maxRow._max.ticketNo ?? 0) + 1;

    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "TICKET" } },
    });
    if (!seq) {
      await tx.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: "TICKET",
          prefix: "TKT-",
          nextValue: minNext + 1,
          padding: 5,
        },
      });
      return minNext;
    }

    const ticketNo = Math.max(seq.nextValue, minNext);
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "TICKET" } },
      data: { nextValue: ticketNo + 1 },
    });
    return ticketNo;
  });
}

function ticketCf(obj: unknown): Record<string, unknown> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
  return {};
}

function leadCf(lead: { customFields?: unknown }) {
  return lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
    ? (lead.customFields as Record<string, unknown>)
    : {};
}

const SERVICE_CATEGORY: Record<string, string> = {
  SERVICE: "Service",
  STAMPING: "Stamping",
  RENTAL: "Rental",
  RENEWAL: "Renewal",
};

async function notifyServiceHandoff(
  t: string,
  user: string,
  lead: {
    id: string;
    name: string;
    phone: string | null;
    leadNo: number | null;
    area: string | null;
  },
  serviceType: string,
  requirement: string,
  req?: import("express").Request,
) {
  const { notifyServiceTeam } = await import("../notifications/notify.service.js");
  const { postTeamChatBySlug } = await import("../teamChat/teamChat.service.js");
  const enq = formatEnq(lead.leadNo);
  const phone = lead.phone ? String(lead.phone) : "";
  const area = lead.area ? String(lead.area).trim() : "";
  const title = `${enq} · ${serviceType} intake — ${lead.name}`;
  const message = [
    area ? `Area ${area}` : null,
    phone ? `Phone ${phone}` : null,
    requirement ? requirement.slice(0, 160) : "Details on enquiry",
    "Open Service intake to triage",
  ]
    .filter(Boolean)
    .join(" · ");

  const notifiedIds = await notifyServiceTeam(
    t,
    {
      title,
      message,
      type: "LEAD_SERVICE_INTAKE",
      entityType: "lead",
      entityId: lead.id,
    },
    req,
  );

  const chatBody = [
    `🔔 ${enq} · ${serviceType} intake`,
    `Customer: ${lead.name}${phone ? ` · ${phone}` : ""}`,
    area ? `Area: ${area}` : null,
    requirement ? `Notes: ${requirement.slice(0, 280)}` : null,
    `Open: /sale-tracking/${lead.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  await postTeamChatBySlug({
    tenantId: t,
    slug: "service",
    senderId: user,
    body: chatBody,
    ensureUserIds: notifiedIds,
  });

  return { notified: notifiedIds.length };
}

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

function scheduleFromLeadCf(cf: Record<string, unknown>): Date {
  if (cf.reminder_at) {
    const d = new Date(String(cf.reminder_at));
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (cf.follow_up_date) {
    const raw = String(cf.follow_up_date).slice(0, 10);
    const d = new Date(`${raw}T10:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

/** When a lead is assigned / follow-up set, create or refresh a PENDING task for Workqueue + bell */
async function ensureFollowUpTask(
  t: string,
  lead: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    customFields?: unknown;
  },
  assignedToId: string,
  createdById: string,
  req?: import("express").Request,
) {
  const cf = leadCf(lead);
  const scheduledAt = scheduleFromLeadCf(cf);
  const status =
    scheduledAt.getTime() < startOfToday().getTime() ? ("OVERDUE" as const) : ("PENDING" as const);

  const existing = await prisma.activity.findFirst({
    where: {
      tenantId: t,
      leadId: lead.id,
      assignedToId,
      status: { in: ["PENDING", "OVERDUE"] },
      deletedAt: null,
    },
  });

  const company = lead.company ? ` (${lead.company})` : "";
  const title = `Follow up lead: ${lead.name}${company}`;
  const description = lead.phone
    ? `Call / qualify this enquiry. Phone: ${lead.phone}`
    : "Call / qualify this enquiry and update lead status.";

  let activity;
  if (existing) {
    activity = await prisma.activity.update({
      where: { id: existing.id },
      data: {
        title,
        description,
        scheduledAt,
        status,
        customFields: {
          ...((existing.customFields as object) ?? {}),
          auto_from: "lead_followup",
          follow_up_date: cf.follow_up_date ?? null,
          reminder_at: cf.reminder_at ?? null,
        },
      },
    });
  } else {
    activity = await prisma.activity.create({
      data: {
        id: newId(),
        tenantId: t,
        type: "TASK",
        title,
        description,
        status,
        scheduledAt,
        leadId: lead.id,
        assignedToId,
        customFields: {
          auto_from: "lead_followup",
          created_by: createdById,
          follow_up_date: cf.follow_up_date ?? null,
          reminder_at: cf.reminder_at ?? null,
        },
      },
    });
  }

  try {
    const { createNotifications } = await import("../notifications/notify.service.js");
    const when = scheduledAt.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const dueToday =
      scheduledAt.getTime() >= startOfToday().getTime() &&
      scheduledAt.getTime() < startOfToday().getTime() + 24 * 60 * 60 * 1000;
    await createNotifications(
      [
        {
          tenantId: t,
          userId: assignedToId,
          title:
            status === "OVERDUE"
              ? "Follow-up overdue"
              : dueToday
                ? "Follow-up due today"
                : "Follow-up scheduled",
          message: `${lead.name} · due ${when}`,
          type: dueToday || status === "OVERDUE" ? "LEAD_FOLLOWUP_DUE" : "LEAD_FOLLOWUP",
          entityType: "Lead",
          entityId: lead.id,
        },
      ],
      req,
    );
  } catch {
    /* non-blocking */
  }

  return activity;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function list(t: string, q: Record<string, unknown>) {
  const p = pagination(q);
  const key = `leads:${t}:${JSON.stringify(q)}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const where: Record<string, unknown> = { tenantId: t, deletedAt: null };
  if (q.status) where.status = q.status;
  if (q.assignedToId) where.assignedToId = q.assignedToId;
  if (q.area) where.area = { contains: String(q.area).trim() };
  if (q.today === "1" || q.today === "true" || q.today === true) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    where.createdAt = { gte: start, lt: end };
  }
  if (q.search) {
    const term = String(q.search).trim();
    const enqDigits = term.replace(/^ENQ-?/i, "").replace(/\D/g, "");
    where.OR = [
      { name: { contains: term } },
      { company: { contains: term } },
      { email: { contains: term } },
      { phone: { contains: term } },
      { area: { contains: term } },
      ...(enqDigits ? [{ leadNo: Number(enqDigits) }] : []),
    ];
  }
  let items = await prisma.lead.findMany({
    where,
    skip: p.skip,
    take: Math.max(p.take, q.serviceType ? 500 : p.take),
    orderBy: { createdAt: "desc" },
  });
  if (q.serviceType) {
    const want = String(q.serviceType).toUpperCase();
    items = items.filter((row) => {
      const st = String(leadCf(row).serviceType ?? "SALES").toUpperCase();
      return st === want;
    });
  }
  const total = q.serviceType
    ? items.length
    : await prisma.lead.count({ where });
  if (q.serviceType) {
    items = items.slice(0, p.take);
  }
  const out = pageResult(items, total, p.page, p.limit);
  await cacheSet(key, out);
  return out;
}

export async function get(t: string, id: string) {
  const x = await prisma.lead.findFirst({ where: { id, tenantId: t, deletedAt: null } });
  if (!x) throw notFound("Lead");
  return x;
}

export async function create(t: string, user: string, data: Record<string, unknown>, req?: import("express").Request) {
  const demoStockUnitId =
    typeof data.demoStockUnitId === "string" && data.demoStockUnitId.trim()
      ? String(data.demoStockUnitId).trim()
      : "";
  const sendWhatsApp = data.sendWhatsApp === true;
  const serviceType =
    typeof data.serviceType === "string" && data.serviceType
      ? String(data.serviceType).toUpperCase()
      : "SALES";
  const {
    demoStockUnitId: _omitDemo,
    sendWhatsApp: _omitWa,
    serviceType: _omitSt,
    verified: verifiedIn,
    area,
    enquiryValue,
    requirement,
    ...leadData
  } = data;
  await validateRefs(t, leadData);
  if (leadData.status === "DEMO") leadData.status = "NEW";

  let needsVerify = verifiedIn === false;
  if (verifiedIn === undefined && leadData.sourceId) {
    const src = await prisma.leadSource.findFirst({
      where: { id: String(leadData.sourceId), tenantId: t },
    });
    const code = (src?.code ?? "").toUpperCase();
    const name = (src?.name ?? "").toUpperCase();
    if (
      code.includes("INDIAMART") ||
      code.includes("JUST_DIAL") ||
      code.includes("JUSTDIAL") ||
      name.includes("INDIAMART") ||
      name.includes("JUST DIAL")
    ) {
      needsVerify = true;
    }
  }
  // Service / stamping / rental / renewal intakes are taken by a human (sales/desk) —
  // always verified so the desk is notified immediately.
  const verified =
    serviceType !== "SALES" || verifiedIn === true ? true : verifiedIn === false ? false : !needsVerify;

  const prevCf =
    leadData.customFields && typeof leadData.customFields === "object" && !Array.isArray(leadData.customFields)
      ? (leadData.customFields as Record<string, unknown>)
      : {};
  const areaVal =
    area != null && String(area).trim()
      ? String(area).trim()
      : typeof prevCf.area === "string"
        ? String(prevCf.area).trim()
        : null;
  leadData.customFields = {
    ...prevCf,
    serviceType,
    verified,
    ...(areaVal ? { area: areaVal } : {}),
    ...(enquiryValue != null ? { enquiryValue } : {}),
    ...(requirement != null ? { requirement } : {}),
  };

  const leadNo = await nextLeadNo(t);
  const x = await prisma.lead.create({
    data: {
      ...leadData,
      id: newId(),
      tenantId: t,
      createdById: user,
      leadNo,
      area: areaVal,
      phoneNormalized: normalizePhone(leadData.phone as string | null | undefined),
    } as any,
  });
  // Auto follow-up task + workqueue row when assigned & verified
  if (x.assignedToId && verified) {
    await ensureFollowUpTask(t, x, x.assignedToId, user, req);
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
  if (sendWhatsApp && x.phone && verified && serviceType === "SALES") {
    const { notifySaleEnquiryReceived } = await import("../tickets/ticketNotify.service.js");
    whatsapp = await notifySaleEnquiryReceived(t, await get(t, x.id), user);
  }

  // Sales intake for service / stamping / rental / renewal → notify service team + #service chat
  let serviceHandoff: { notified: number } | null = null;
  if (serviceType !== "SALES" && verified) {
    try {
      const reqNotes =
        typeof requirement === "string" && requirement.trim()
          ? requirement.trim()
          : typeof prevCf.requirement === "string"
            ? String(prevCf.requirement)
            : "";
      serviceHandoff = await notifyServiceHandoff(t, user, x, serviceType, reqNotes, req);
    } catch (err) {
      // Don't fail the enquiry save if notify/chat fails
      const { logger } = await import("../../config/logger.js");
      logger.warn("Service handoff notify failed", { err, leadId: x.id });
    }
  }

  await invalidate(t);
  return { ...(await get(t, x.id)), whatsapp, whatsappDemo, serviceHandoff };
}

/** Confirm spam-prone sources as a real lead before follow-up. */
export async function verify(
  t: string,
  id: string,
  userId: string,
  body: {
    verified?: boolean;
    area?: string | null;
    enquiryValue?: number | string | null;
    requirement?: string | null;
    serviceType?: string;
    name?: string;
    phone?: string | null;
  },
  req?: import("express").Request,
) {
  const lead = await get(t, id);
  const cf = leadCf(lead);
  const verified = body.verified !== false;
  const areaVal =
    body.area != null && String(body.area).trim()
      ? String(body.area).trim()
      : lead.area
        ? String(lead.area)
        : typeof cf.area === "string"
          ? String(cf.area)
          : null;
  const serviceType = body.serviceType
    ? String(body.serviceType).toUpperCase()
    : String(cf.serviceType ?? "SALES").toUpperCase();
  const patch: Record<string, unknown> = {
    customFields: {
      ...cf,
      verified,
      verifiedAt: new Date().toISOString(),
      verifiedBy: userId,
      ...(areaVal ? { area: areaVal } : {}),
      ...(body.enquiryValue != null ? { enquiryValue: body.enquiryValue } : {}),
      ...(body.requirement != null ? { requirement: body.requirement } : {}),
      ...(body.serviceType ? { serviceType } : {}),
    },
  };
  if (areaVal) patch.area = areaVal;
  if (body.name) patch.name = body.name.trim();
  if ("phone" in body) {
    patch.phone = body.phone;
    patch.phoneNormalized = normalizePhone(body.phone);
  }
  if (verified && lead.status === "NEW") patch.status = "CONTACTED";

  await prisma.lead.update({ where: { id }, data: patch as any });
  const updated = await get(t, id);
  if (verified && updated.assignedToId) {
    await ensureFollowUpTask(t, updated, updated.assignedToId, userId);
  }

  let serviceHandoff: { notified: number } | null = null;
  if (verified && serviceType !== "SALES" && cf.verified !== true) {
    try {
      const reqNotes =
        body.requirement != null
          ? String(body.requirement)
          : typeof cf.requirement === "string"
            ? String(cf.requirement)
            : "";
      serviceHandoff = await notifyServiceHandoff(t, userId, updated, serviceType, reqNotes, req);
    } catch (err) {
      const { logger } = await import("../../config/logger.js");
      logger.warn("Service handoff notify failed on verify", { err, leadId: id });
    }
  }

  await invalidate(t);
  return { ...updated, serviceHandoff };
}

/**
 * Service desk: turn a SERVICE / STAMPING / RENTAL / RENEWAL intake into an OPEN ticket.
 * Desk then breaks down category / assigns engineer by area on the ticket.
 */
function resolveAreaFromLead(
  lead: { area?: string | null },
  cf: Record<string, unknown>,
  bodyArea?: string | null,
) {
  if (bodyArea != null && String(bodyArea).trim()) return String(bodyArea).trim();
  if (lead.area) return String(lead.area);
  if (typeof cf.area === "string" && cf.area.trim()) return String(cf.area).trim();
  return null;
}

/** Ensure a Contact exists for a non-sales intake lead (shared by ticket + rental handoff). */
export async function ensureContactFromLead(
  t: string,
  leadId: string,
  opts: { area?: string | null; serviceType?: string } = {},
) {
  const lead = await get(t, leadId);
  const cf = leadCf(lead);
  const serviceType = String(opts.serviceType ?? cf.serviceType ?? "SERVICE").toUpperCase();
  const areaVal = resolveAreaFromLead(lead, cf, opts.area);

  let contactId = lead.convertedContactId;
  if (!contactId && lead.phoneNormalized) {
    const existing = await prisma.contact.findFirst({
      where: { tenantId: t, phoneNormalized: lead.phoneNormalized, deletedAt: null },
    });
    contactId = existing?.id ?? null;
  }
  if (!contactId) {
    if (!lead.phoneNormalized && !lead.phone) {
      throw new AppError("Phone is required to create a customer from this enquiry", 422);
    }
    await assertContactIdentityAvailable(t, {
      phone: lead.phone,
      email: lead.email,
      requirePhone: true,
    });
    const identity = await allocateCustomerIdentity(t);
    contactId = newId();
    await prisma.contact.create({
      data: {
        id: contactId,
        tenantId: t,
        customerNo: identity.customerNo,
        customerCode: identity.customerCode,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        phoneNormalized: lead.phoneNormalized,
        city: lead.city,
        state: lead.state,
        country: lead.country || "IN",
        area: areaVal,
        accountId: lead.convertedAccountId,
        description: lead.description,
        customFields: {
          from_lead_id: lead.id,
          from_lead_no: lead.leadNo,
          serviceType,
        },
      },
    });
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId: t, deletedAt: null },
  });
  if (!contact) throw notFound("Contact");

  if (lead.convertedContactId !== contactId || (areaVal && lead.area !== areaVal)) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        convertedContactId: contactId,
        ...(areaVal ? { area: areaVal } : {}),
      },
    });
  }

  return { lead: await get(t, lead.id), contact, areaVal, serviceType, enquiryId: formatEnq(lead.leadNo) };
}

/**
 * Desk handoff prep: create/find customer, return where to send the user.
 * Does NOT create a ticket or rental — UI opens the right wizard with machine/serial pick.
 */
export async function prepareHandoffFromLead(
  t: string,
  leadId: string,
  userId: string,
  body: { area?: string | null } = {},
) {
  const lead = await get(t, leadId);
  const cf = leadCf(lead);
  const serviceType = String(cf.serviceType ?? "SERVICE").toUpperCase();
  if (serviceType === "SALES") {
    throw new AppError("Sales enquiries stay on the sale-tracking flow", 400);
  }
  if (["LOST", "UNQUALIFIED", "CONVERTED"].includes(lead.status)) {
    throw new AppError(`Cannot hand off a ${lead.status} enquiry`, 400);
  }
  if (serviceType === "RENTAL" && cf.rentalAgreementId) {
    return {
      serviceType,
      contactId: lead.convertedContactId,
      leadId: lead.id,
      enquiryId: formatEnq(lead.leadNo),
      alreadyLinked: true as const,
      rentalAgreementId: String(cf.rentalAgreementId),
      href: `/rentals`,
    };
  }
  if ((serviceType === "SERVICE" || serviceType === "STAMPING" || serviceType === "RENEWAL") && cf.serviceTicketId) {
    return {
      serviceType,
      contactId: lead.convertedContactId,
      leadId: lead.id,
      enquiryId: formatEnq(lead.leadNo),
      alreadyLinked: true as const,
      serviceTicketId: String(cf.serviceTicketId),
      href: `/tickets/${String(cf.serviceTicketId)}`,
    };
  }

  const prepared = await ensureContactFromLead(t, leadId, {
    area: body.area,
    serviceType,
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: lead.status === "NEW" || lead.status === "CONTACTED" ? "QUALIFIED" : lead.status,
      customFields: {
        ...cf,
        deskTriageAt: new Date().toISOString(),
        deskTriageBy: userId,
        ...(prepared.areaVal ? { area: prepared.areaVal } : {}),
      },
    },
  });

  const href =
    serviceType === "RENTAL"
      ? `/rentals?open=1&leadId=${encodeURIComponent(lead.id)}&contactId=${encodeURIComponent(prepared.contact.id)}`
      : serviceType === "STAMPING"
        ? `/tickets?open=1&job=stamping&category=Stamping&leadId=${encodeURIComponent(lead.id)}&contactId=${encodeURIComponent(prepared.contact.id)}`
        : `/tickets?open=1&job=service&leadId=${encodeURIComponent(lead.id)}&contactId=${encodeURIComponent(prepared.contact.id)}`;

  return {
    serviceType,
    contactId: prepared.contact.id,
    contact: prepared.contact,
    leadId: lead.id,
    enquiryId: prepared.enquiryId,
    area: prepared.areaVal,
    alreadyLinked: false as const,
    href,
    lead: await get(t, lead.id),
  };
}

export async function createTicketFromLead(
  t: string,
  leadId: string,
  userId: string,
  body: {
    category?: string;
    subject?: string;
    description?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    area?: string | null;
    assetId?: string | null;
  } = {},
) {
  const lead = await get(t, leadId);
  const cf = leadCf(lead);
  if (cf.serviceTicketId) {
    throw new AppError("A service ticket was already created from this enquiry", 400);
  }
  const serviceType = String(cf.serviceType ?? "SERVICE").toUpperCase();
  if (serviceType === "SALES") {
    throw new AppError("Sales enquiries convert via the sale flow, not service tickets", 400);
  }
  if (serviceType === "RENTAL") {
    throw new AppError(
      "Rental enquiries open Rentals (issue serial) — use prepare-handoff, not create-ticket",
      400,
    );
  }
  if (["LOST", "UNQUALIFIED", "CONVERTED"].includes(lead.status)) {
    throw new AppError(`Cannot create ticket from ${lead.status} enquiry`, 400);
  }

  const prepared = await ensureContactFromLead(t, leadId, {
    area: body.area,
    serviceType,
  });
  const { contact, areaVal, enquiryId: enq } = prepared;
  const contactId = contact.id;

  let assetId = body.assetId ? String(body.assetId) : null;
  if (assetId) {
    const asset = await prisma.customerAsset.findFirst({
      where: { id: assetId, tenantId: t, contactId, deletedAt: null },
    });
    if (!asset) throw new AppError("Machine not found for this customer", 404);
  }
  if (serviceType === "STAMPING" && !assetId) {
    throw new AppError(
      "Pick or add a machine before creating a stamping ticket (use the stamping job wizard)",
      422,
    );
  }

  const category =
    (body.category && String(body.category).trim()) ||
    SERVICE_CATEGORY[serviceType] ||
    "Service";
  const reqNotes =
    typeof cf.requirement === "string"
      ? String(cf.requirement)
      : typeof cf.product_interest === "string"
        ? String(cf.product_interest)
        : "";
  const subject =
    (body.subject && String(body.subject).trim()) ||
    `${category} — ${lead.name}${areaVal ? ` · ${areaVal}` : ""}`;
  const description =
    (body.description && String(body.description).trim()) ||
    [
      `From intake ${enq}`,
      `Type: ${serviceType}`,
      areaVal ? `Area: ${areaVal}` : null,
      lead.phone ? `Phone: ${lead.phone}` : null,
      reqNotes ? `Requirement: ${reqNotes}` : null,
      lead.description ? String(lead.description) : null,
    ]
      .filter(Boolean)
      .join("\n");

  const ticketNo = await nextTicketNoForLead(t);
  const ticketId = newId();
  const productId =
    typeof cf.interested_product_id === "string" ? String(cf.interested_product_id) : null;

  const ticket = await prisma.ticket.create({
    data: {
      id: ticketId,
      tenantId: t,
      ticketNo,
      subject,
      description,
      priority: body.priority ?? "MEDIUM",
      status: "OPEN",
      contactId,
      accountId: contact.accountId ?? lead.convertedAccountId ?? null,
      assignedToId: null,
      productId,
      assetId,
      customFields: {
        category,
        channel: "Service intake",
        area: areaVal,
        fromLeadId: lead.id,
        fromLeadNo: lead.leadNo,
        serviceType,
        visitPurpose: serviceType === "STAMPING" ? "STAMPING" : "SERVICE",
        created_by: userId,
        baseServiceCharge: 0,
        sparePartsTotal: 0,
      },
    },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "QUALIFIED",
      convertedContactId: contactId,
      area: areaVal,
      customFields: {
        ...cf,
        serviceTicketId: ticketId,
        serviceTicketNo: ticketNo,
        deskTriageAt: new Date().toISOString(),
        deskTriageBy: userId,
        ...(areaVal ? { area: areaVal } : {}),
      },
    },
  });

  await invalidate(t);
  return {
    ticket,
    lead: await get(t, lead.id),
    enquiryId: enq,
  };
}

/** Link a ticket created from the wizard back to the intake lead. */
export async function linkTicketToLead(t: string, leadId: string, ticketId: string, userId: string) {
  const lead = await get(t, leadId);
  const cf = leadCf(lead);
  if (cf.serviceTicketId && String(cf.serviceTicketId) !== ticketId) {
    throw new AppError("This enquiry already has a different service ticket", 400);
  }
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId: t, deletedAt: null },
  });
  if (!ticket) throw notFound("Ticket");
  const tcf = ticketCf(ticket.customFields);
  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      customFields: {
        ...tcf,
        fromLeadId: lead.id,
        fromLeadNo: lead.leadNo,
        serviceType: cf.serviceType ?? tcf.serviceType ?? null,
      },
    },
  });
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "QUALIFIED",
      convertedContactId: ticket.contactId ?? lead.convertedContactId,
      customFields: {
        ...cf,
        serviceTicketId: ticketId,
        serviceTicketNo: ticket.ticketNo,
        deskTriageAt: new Date().toISOString(),
        deskTriageBy: userId,
      },
    },
  });
  await invalidate(t);
  return get(t, lead.id);
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
  const {
    sendWhatsApp: _omitWa,
    serviceType,
    area,
    enquiryValue,
    requirement,
    ...rest
  } = data;
  const patch: Record<string, unknown> = { ...rest };
  await validateRefs(t, patch);
  const before = await get(t, id);
  if (patch.status === "CONVERTED" && before.status !== "CONVERTED") {
    throw new AppError("Use POST /leads/:id/convert to convert leads", 400);
  }

  const beforeCf = leadCf(before);
  const needsCfMerge =
    serviceType != null || area !== undefined || enquiryValue != null || requirement != null;
  if (needsCfMerge) {
    const areaVal =
      area !== undefined
        ? area != null && String(area).trim()
          ? String(area).trim()
          : null
        : undefined;
    patch.customFields = {
      ...beforeCf,
      ...(typeof patch.customFields === "object" && patch.customFields && !Array.isArray(patch.customFields)
        ? (patch.customFields as Record<string, unknown>)
        : {}),
      ...(serviceType != null ? { serviceType: String(serviceType).toUpperCase() } : {}),
      ...(areaVal !== undefined ? { area: areaVal } : {}),
      ...(enquiryValue != null ? { enquiryValue } : {}),
      ...(requirement != null ? { requirement } : {}),
    };
    if (areaVal !== undefined) patch.area = areaVal;
  }

  // Demo → Not interested: return serial to main warehouse before marking LOST
  if (patch.status === "LOST" && before.status === "DEMO") {
    const cf = leadCf(before);
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
  const afterCf = leadCf(after);
  const followChanged =
    String(beforeCf.follow_up_date ?? "") !== String(afterCf.follow_up_date ?? "") ||
    String(beforeCf.reminder_at ?? "") !== String(afterCf.reminder_at ?? "");
  if (
    after.assignedToId &&
    !["CONVERTED", "LOST", "UNQUALIFIED"].includes(after.status) &&
    (after.assignedToId !== before.assignedToId || followChanged)
  ) {
    await ensureFollowUpTask(t, after, after.assignedToId, after.createdById);
  }
  if (before.status !== after.status) {
    try {
      const { notifyAdmins } = await import("../notifications/notify.service.js");
      const lostNote =
        after.status === "LOST" && afterCf.lostReason
          ? ` — ${String(afterCf.lostReason).slice(0, 120)}`
          : "";
      await notifyAdmins(t, {
        title: `Lead status → ${after.status}`,
        message: `${after.name}: ${before.status} → ${after.status}${lostNote}`,
        type: "LEAD_STATUS_CHANGE",
        entityType: "lead",
        entityId: id,
      });
    } catch {
      /* non-fatal */
    }
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
  // Resolve / validate contact identity OUTSIDE the interactive transaction —
  // remote RDS latency (~500ms/query) otherwise blows the default 5s tx timeout.
  const phoneNorm = lead.phoneNormalized || normalizePhone(lead.phone || "") || null;
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const linkedContactId = cf.contact_id ? String(cf.contact_id) : "";

  let existingContact = linkedContactId
    ? await prisma.contact.findFirst({
        where: { id: linkedContactId, tenantId: t, deletedAt: null },
      })
    : null;

  if (!existingContact && phoneNorm) {
    existingContact = await prisma.contact.findFirst({
      where: { tenantId: t, phoneNormalized: phoneNorm, deletedAt: null },
    });
  }

  if (!existingContact) {
    await assertContactIdentityAvailable(t, {
      phone: lead.phone,
      email: lead.email,
      requirePhone: Boolean(lead.phone),
    });
  }

  const result = await prisma.$transaction(
    async (tx) => {
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

      let contact = existingContact
        ? await tx.contact.findFirst({
            where: { id: existingContact.id, tenantId: t, deletedAt: null },
          })
        : null;

      if (!contact) {
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
    },
    { maxWait: 8_000, timeout: 25_000 },
  );
  await invalidate(t);
  // Follow-up / day-update alerts expire — sale converted, those tasks are done
  try {
    const { expireEntityNotifications } = await import("../notifications/notify.service.js");
    await expireEntityNotifications({
      tenantId: t,
      entityType: "lead",
      entityId: id,
      types: [
        "LEAD_FOLLOWUP",
        "LEAD_FOLLOWUP_DUE",
        "LEAD_DAY_UPDATE",
        "LEAD_STATUS_CHANGE",
        "LEAD_SERVICE_INTAKE",
        "activity_overdue",
      ],
      mode: "remove",
    });
  } catch {
    /* non-fatal */
  }
  // Stock stays on DEMO / IN_STOCK until admin requisition → warehouse fulfill marks SOLD
  // (do not call markDemoSold here)

  let requisitionCreated = false;
  let requisitionError: string | null = null;
  try {
    const { submit: submitRequisition } = await import("../requisitions/requisitions.service.js");
    try {
      await submitRequisition(
        t,
        user,
        {
          leadId: id,
          advanceAmount: data.advanceAmount != null ? Number(data.advanceAmount) : undefined,
          paymentNotes: data.paymentNotes ? String(data.paymentNotes) : undefined,
          notes: "Auto-submitted after convert — awaiting admin sign-off",
        },
      );
      requisitionCreated = true;
    } catch (err) {
      // Already open (409) is OK — surface other failures so UI can prompt sales
      if (err instanceof AppError && err.statusCode === 409) {
        requisitionCreated = true; // already pending / open
        requisitionError = null;
      } else if (err instanceof AppError) {
        requisitionError = err.message;
        console.error("auto requisition after convert failed", err.message);
      } else {
        requisitionError = "Could not auto-create sales requisition — submit from lead detail";
        console.error("auto requisition after convert failed", err);
      }
    }
  } catch (err) {
    requisitionError = "Requisitions module unavailable";
    console.error("auto requisition module load failed", err);
  }

  try {
    const { notifyAdmins } = await import("../notifications/notify.service.js");
    const contactId = result.contact?.id ?? "";
    const product =
      lead.customFields && typeof lead.customFields === "object"
        ? String((lead.customFields as Record<string, unknown>).demoProductName ?? (lead.customFields as Record<string, unknown>).interested_product_name ?? "")
        : "";
    const serial =
      lead.customFields && typeof lead.customFields === "object"
        ? String((lead.customFields as Record<string, unknown>).demoSerialNo ?? "")
        : "";
    await notifyAdmins(t, {
      title: "Sale converted — requisition needed",
      message: `${lead.name}${lead.company ? ` · ${lead.company}` : ""} converted${product ? ` — ${product}` : ""}${serial ? ` · S/No ${serial}` : ""}. Approve the sales requisition before inventory releases stock.`,
      type: "LEAD_CONVERT_REQUISITION",
      entityType: "lead",
      entityId: id,
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
    requisitionCreated,
    requisitionError,
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
  let unitId = cf.demoStockUnitId ? String(cf.demoStockUnitId) : "";
  if (!unitId) {
    const linked = await prisma.stockUnit.findFirst({
      where: { tenantId: t, leadId, status: "DEMO", deletedAt: null },
    });
    if (linked) {
      unitId = linked.id;
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          customFields: {
            ...cf,
            demoStockUnitId: linked.id,
            demoSerialNo: linked.serialNo,
            demoProductId: linked.productId,
          },
        },
      });
    }
  }
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
      const { notifyAdmins } = await import("../notifications/notify.service.js");
      await notifyAdmins(t, {
        title: "Demo accepted — approve requisition",
        message: `${lead.name} accepted the demo${cf.demoSerialNo ? ` (S/No ${cf.demoSerialNo})` : ""}. Customer created — sign the sales requisition so inventory can release stock.`,
        type: "LEAD_DEMO_READY_REQUISITION",
        entityType: "lead",
        entityId: leadId,
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
      requisitionCreated: Boolean(
        (converted as { requisitionCreated?: boolean }).requisitionCreated,
      ),
      requisitionError:
        (converted as { requisitionError?: string | null }).requisitionError ?? null,
      next: "requisition" as const,
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

/** Sales executive day-wise update on an open lead (demo or pre-close pipeline) */
export async function addDemoUpdate(
  t: string,
  userId: string,
  leadId: string,
  body: { note: string; updateDate?: string },
) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: t, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  if (["LOST", "UNQUALIFIED"].includes(lead.status)) {
    throw new AppError("Daily updates are only for open leads", 400);
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
      } as Prisma.InputJsonValue,
    },
  });
  await invalidate(t);

  try {
    const { notifyAdmins } = await import("../notifications/notify.service.js");
    await notifyAdmins(t, {
      title: `Day ${dayNumber} lead update`,
      message: `${lead.name}${cf.demoSerialNo ? ` · S/No ${cf.demoSerialNo}` : ""} · ${lead.status} — ${note.slice(0, 160)}`,
      type: "LEAD_DAY_UPDATE",
      entityType: "lead",
      entityId: leadId,
    });
  } catch {
    /* non-fatal */
  }

  return get(t, leadId);
}
