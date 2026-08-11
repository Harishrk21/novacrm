import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";

export type WhatsappNotifyResult = {
  notified: boolean;
  reason?: string;
  fallbackWaLink?: string | null;
  provider?: string;
};

function digitsForWa(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d || null;
}

/** Shared outbound WhatsApp (AskMeister if connected, else queue + wa.me fallback). */
export async function sendCustomerWhatsApp(opts: {
  tenantId: string;
  contactId: string;
  body: string;
  activityTitle: string;
  actorUserId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<WhatsappNotifyResult> {
  const { tenantId, contactId, body, activityTitle, actorUserId, meta } = opts;

  const [contact, integration] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, tenantId, deletedAt: null },
      select: { id: true, name: true, phone: true, phoneNormalized: true },
    }),
    prisma.integration.findFirst({
      where: { tenantId, provider: "ASKMEISTER", status: "CONNECTED" },
    }),
  ]);

  if (!contact) return { notified: false, reason: "no_contact" };
  const phone = contact.phone || contact.phoneNormalized;
  if (!phone) return { notified: false, reason: "no_phone" };

  const waDigits = digitsForWa(phone);
  const fallbackWaLink = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(body)}`
    : null;

  let notified = false;
  let provider = "local";

  if (integration?.secretsEnc) {
    const cfg = (integration.config ?? {}) as { phoneNumberId?: string };
    const base =
      process.env.ASKMEISTER_API_BASE?.replace(/\/$/, "") || "https://api.askmeister.com";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${integration.secretsEnc}`,
        },
        body: JSON.stringify({
          to: phone,
          body,
          phoneNumberId: cfg.phoneNumberId ?? undefined,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        notified = true;
        provider = "ASKMEISTER";
      }
    } catch {
      /* fall through */
    }
  }

  const phoneNorm = normalizePhone(phone) || phone.replace(/\D/g, "");
  let conversation = await prisma.whatsappConversation.findFirst({
    where: { tenantId, phoneNormalized: phoneNorm },
  });
  if (!conversation) {
    conversation = await prisma.whatsappConversation.create({
      data: {
        id: newId(),
        tenantId,
        provider: "ASKMEISTER",
        phone,
        phoneNormalized: phoneNorm,
        contactId: contact.id,
        contactName: contact.name,
        lastMessage: body,
        unreadCount: 0,
      },
    });
  } else {
    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: { lastMessage: body, unreadCount: 0, contactId: contact.id },
    });
  }

  await prisma.whatsappMessage.create({
    data: {
      id: newId(),
      tenantId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body,
      status: notified ? "SENT" : "QUEUED",
      sentByUserId: actorUserId ?? null,
    },
  });

  await prisma.activity.create({
    data: {
      id: newId(),
      tenantId,
      type: "WHATSAPP",
      title: activityTitle,
      description: body,
      status: "COMPLETED",
      completedAt: new Date(),
      outcome: notified
        ? "WhatsApp sent"
        : integration
          ? "WhatsApp queued — AskMeister send failed"
          : "WhatsApp queued — AskMeister not connected",
      contactId: contact.id,
      assignedToId: actorUserId ?? null,
      customFields: { ...(meta ?? {}), autoNotify: true },
    },
  });

  if (!notified && !integration) {
    return { notified: false, reason: "askmeister_not_connected", fallbackWaLink, provider };
  }
  if (!notified && integration) {
    return { notified: false, reason: "askmeister_send_failed", fallbackWaLink, provider };
  }
  return { notified: true, fallbackWaLink, provider };
}

export function buildTicketCompleteMessage(opts: {
  contactName: string;
  ticketNo: number | string;
  companyName: string;
  subject?: string;
}) {
  const subj = opts.subject ? ` (${opts.subject})` : "";
  return `Hi ${opts.contactName}, your service ticket TKT-${String(opts.ticketNo).padStart(5, "0")}${subj} is completed. Thank you — ${opts.companyName}.`;
}

export async function notifyTicketCompleted(
  tenantId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    contactId: string | null;
    assignedToId: string | null;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  if (!ticket.contactId) return { notified: false, reason: "no_contact" };

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { name: true },
  });
  const contact = await prisma.contact.findFirst({
    where: { id: ticket.contactId, tenantId, deletedAt: null },
    select: { name: true },
  });
  if (!contact) return { notified: false, reason: "no_contact" };

  const body = buildTicketCompleteMessage({
    contactName: contact.name.split(" ")[0] || contact.name,
    ticketNo: ticket.ticketNo,
    companyName: tenant?.name ?? "NovaCRM",
    subject: ticket.subject,
  });

  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `Service complete — ticket TKT-${String(ticket.ticketNo).padStart(5, "0")}`,
    actorUserId: actorUserId ?? ticket.assignedToId,
    meta: { ticketId: ticket.id, kind: "job_complete" },
  });
}

export function buildTicketPaidMessage(opts: {
  contactName: string;
  ticketNo: number | string;
  companyName: string;
  amount: number;
  subject?: string;
  invoiceNumber?: string | null;
}) {
  const subj = opts.subject ? ` (${opts.subject})` : "";
  const amt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(opts.amount || 0);
  const inv = opts.invoiceNumber ? ` Invoice ${opts.invoiceNumber}.` : "";
  return `Hi ${opts.contactName}, payment received in full for job TKT-${String(opts.ticketNo).padStart(5, "0")}${subj} — ${amt}.${inv} Thank you — ${opts.companyName}.`;
}

export function buildPaymentDueMessage(opts: {
  contactName: string;
  ticketNo: number | string;
  companyName: string;
  balanceDue: number;
  paymentTotal: number;
  advanceAmount: number;
  subject?: string;
}) {
  const subj = opts.subject ? ` (${opts.subject})` : "";
  const bal = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(opts.balanceDue || 0);
  const total = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(opts.paymentTotal || 0);
  const adv = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(opts.advanceAmount || 0);
  return `Hi ${opts.contactName}, payment reminder for job TKT-${String(opts.ticketNo).padStart(5, "0")}${subj}: total ${total}, advance ${adv}, balance due ${bal}. Please clear at your earliest. — ${opts.companyName}.`;
}

export async function notifyTicketPaidFully(
  tenantId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    contactId: string | null;
    assignedToId: string | null;
    paymentTotal: number;
  },
  actorUserId?: string,
  invoiceNumber?: string | null,
): Promise<WhatsappNotifyResult> {
  if (!ticket.contactId) return { notified: false, reason: "no_contact" };

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { name: true },
  });
  const contact = await prisma.contact.findFirst({
    where: { id: ticket.contactId, tenantId, deletedAt: null },
    select: { name: true },
  });
  if (!contact) return { notified: false, reason: "no_contact" };

  const body = buildTicketPaidMessage({
    contactName: contact.name.split(" ")[0] || contact.name,
    ticketNo: ticket.ticketNo,
    companyName: tenant?.name ?? "NovaCRM",
    amount: ticket.paymentTotal,
    subject: ticket.subject,
    invoiceNumber,
  });

  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `Payment complete — ticket TKT-${String(ticket.ticketNo).padStart(5, "0")}`,
    actorUserId: actorUserId ?? ticket.assignedToId,
    meta: { ticketId: ticket.id, kind: "job_paid", invoiceNumber: invoiceNumber ?? null },
  });
}

export async function notifyPaymentDue(
  tenantId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    contactId: string | null;
    assignedToId: string | null;
    paymentTotal: number;
    advanceAmount: number;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  if (!ticket.contactId) return { notified: false, reason: "no_contact" };

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { name: true },
  });
  const contact = await prisma.contact.findFirst({
    where: { id: ticket.contactId, tenantId, deletedAt: null },
    select: { name: true },
  });
  if (!contact) return { notified: false, reason: "no_contact" };

  const balanceDue = Math.max(0, ticket.paymentTotal - ticket.advanceAmount);
  const body = buildPaymentDueMessage({
    contactName: contact.name.split(" ")[0] || contact.name,
    ticketNo: ticket.ticketNo,
    companyName: tenant?.name ?? "NovaCRM",
    balanceDue,
    paymentTotal: ticket.paymentTotal,
    advanceAmount: ticket.advanceAmount,
    subject: ticket.subject,
  });

  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `Payment due — ticket TKT-${String(ticket.ticketNo).padStart(5, "0")}`,
    actorUserId: actorUserId ?? ticket.assignedToId,
    meta: { ticketId: ticket.id, kind: "payment_due" },
  });
}

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "PENDING"] as const;

export async function refreshSlaBreached(tenantId: string, ticketIds?: string[]) {
  const now = new Date();
  await prisma.ticket.updateMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: [...OPEN_STATUSES] },
      slaDueAt: { lt: now },
      slaBreached: false,
      ...(ticketIds?.length ? { id: { in: ticketIds } } : {}),
    },
    data: { slaBreached: true },
  });
}
