import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import {
  isWhatsAppCloudConfigured,
  sendCloudText,
  sendCloudTemplate,
  templateBodyParams,
  digitsE164,
} from "../whatsapp/cloudApi.js";
import {
  WA,
  formatAddress,
  inrAmount,
  statusLabel,
  templateName,
  ticketLabel,
  waText,
} from "../whatsapp/templates.js";

export type WhatsappNotifyResult = {
  notified: boolean;
  reason?: string;
  fallbackWaLink?: string | null;
  provider?: string;
  messageId?: string;
  template?: string;
};

function digitsForWa(phone: string) {
  return digitsE164(phone);
}

async function tryCloudSend(
  phone: string,
  body: string,
  template?: { name: string; languageCode?: string; params: string[] },
  opts?: { preferTemplate?: boolean },
): Promise<{
  notified: boolean;
  provider: string;
  messageId?: string;
  reason?: string;
  template?: string;
}> {
  if (!isWhatsAppCloudConfigured()) {
    return { notified: false, provider: "local", reason: "cloud_not_configured" };
  }

  let templateError: string | undefined;
  if (template?.name) {
    const t = await sendCloudTemplate({
      toPhone: phone,
      templateName: template.name,
      languageCode: template.languageCode || "en",
      components: templateBodyParams(template.params),
    });
    if (t.ok) {
      return {
        notified: true,
        provider: "META_CLOUD",
        messageId: t.messageId,
        template: template.name,
      };
    }
    templateError = t.error || "template_send_failed";
    // Staff alerts used to stop here (requireTemplate) — that blocked engineers when the
    // Utility template was missing/unapproved while customers still got free-text status updates.
  }

  const text = await sendCloudText(phone, body);
  if (text.ok) {
    return {
      notified: true,
      provider: "META_CLOUD",
      messageId: text.messageId,
      // Surface that we fell back so admins know to approve the Utility template
      reason: templateError
        ? `sent_as_text_after_template_failed:${templateError}`
        : undefined,
      template: template?.name,
    };
  }

  return {
    notified: false,
    provider: "META_CLOUD",
    reason:
      templateError && opts?.preferTemplate
        ? `template_failed: ${templateError}; text_failed: ${text.error || "cloud_send_failed"}`
        : templateError || text.error || "cloud_send_failed",
    template: template?.name,
  };
}

/** Shared outbound WhatsApp (Meta Cloud API → AskMeister → queue + wa.me fallback). */
export async function sendCustomerWhatsApp(opts: {
  tenantId: string;
  contactId: string;
  body: string;
  activityTitle: string;
  actorUserId?: string | null;
  meta?: Record<string, unknown>;
  template?: { name: string; languageCode?: string; params: string[] };
}): Promise<WhatsappNotifyResult> {
  const { tenantId, contactId, body, activityTitle, actorUserId, meta, template } = opts;

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
  let messageId: string | undefined;
  let failReason: string | undefined;
  let usedTemplate: string | undefined;

  const cloud = await tryCloudSend(phone, body, template);
  if (cloud.notified) {
    notified = true;
    provider = cloud.provider;
    messageId = cloud.messageId;
    usedTemplate = cloud.template;
  } else if (cloud.reason) {
    failReason = cloud.reason;
  }

  if (!notified && integration?.secretsEnc) {
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
          template: template?.name,
          templateParams: template?.params,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        notified = true;
        provider = "ASKMEISTER";
        usedTemplate = template?.name;
      } else {
        failReason = "askmeister_send_failed";
      }
    } catch {
      failReason = "askmeister_send_failed";
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
        provider: provider === "META_CLOUD" ? "META_CLOUD" : "ASKMEISTER",
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
      externalId: messageId ?? null,
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
        ? `WhatsApp sent via ${provider}${usedTemplate ? ` · ${usedTemplate}` : ""}`
        : integration || isWhatsAppCloudConfigured()
          ? `WhatsApp queued — ${failReason || "send failed"}`
          : "WhatsApp queued — Cloud API / AskMeister not connected",
      contactId: contact.id,
      assignedToId: actorUserId ?? null,
      customFields: {
        ...(meta ?? {}),
        autoNotify: true,
        provider,
        messageId: messageId ?? null,
        template: usedTemplate ?? template?.name ?? null,
      },
    },
  });

  if (!notified && !integration && !isWhatsAppCloudConfigured()) {
    return { notified: false, reason: "whatsapp_not_connected", fallbackWaLink, provider };
  }
  if (!notified) {
    return {
      notified: false,
      reason: failReason || "send_failed",
      fallbackWaLink,
      provider,
      template: template?.name,
    };
  }
  return { notified: true, fallbackWaLink, provider, messageId, template: usedTemplate };
}

/** Notify by raw phone (leads before contact exists). */
export async function sendPhoneWhatsApp(opts: {
  tenantId: string;
  phone: string;
  contactName: string;
  contactId?: string | null;
  leadId?: string | null;
  body: string;
  activityTitle: string;
  actorUserId?: string | null;
  meta?: Record<string, unknown>;
  template?: { name: string; languageCode?: string; params: string[] };
}): Promise<WhatsappNotifyResult> {
  const phone = opts.phone?.trim();
  if (!phone) return { notified: false, reason: "no_phone" };

  const waDigits = digitsForWa(phone);
  const fallbackWaLink = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(opts.body)}`
    : null;

  const cloud = await tryCloudSend(phone, opts.body, opts.template);
  const phoneNorm = normalizePhone(phone) || phone.replace(/\D/g, "");

  let conversation = await prisma.whatsappConversation.findFirst({
    where: { tenantId: opts.tenantId, phoneNormalized: phoneNorm },
  });
  if (!conversation) {
    conversation = await prisma.whatsappConversation.create({
      data: {
        id: newId(),
        tenantId: opts.tenantId,
        provider: "META_CLOUD",
        phone,
        phoneNormalized: phoneNorm,
        contactId: opts.contactId ?? null,
        leadId: opts.leadId ?? null,
        contactName: opts.contactName,
        lastMessage: opts.body,
        unreadCount: 0,
      },
    });
  } else {
    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: opts.body,
        unreadCount: 0,
        contactId: opts.contactId ?? conversation.contactId,
        leadId: opts.leadId ?? conversation.leadId,
      },
    });
  }

  await prisma.whatsappMessage.create({
    data: {
      id: newId(),
      tenantId: opts.tenantId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body: opts.body,
      status: cloud.notified ? "SENT" : "QUEUED",
      sentByUserId: opts.actorUserId ?? null,
      externalId: cloud.messageId ?? null,
    },
  });

  await prisma.activity.create({
    data: {
      id: newId(),
      tenantId: opts.tenantId,
      type: "WHATSAPP",
      title: opts.activityTitle,
      description: opts.body,
      status: "COMPLETED",
      completedAt: new Date(),
      outcome: cloud.notified
        ? `WhatsApp sent via ${cloud.provider}${cloud.template ? ` · ${cloud.template}` : ""}`
        : `WhatsApp queued — ${cloud.reason || "send failed"}`,
      contactId: opts.contactId ?? null,
      leadId: opts.leadId ?? null,
      assignedToId: opts.actorUserId ?? null,
      customFields: {
        ...(opts.meta ?? {}),
        autoNotify: true,
        provider: cloud.provider,
        template: cloud.template ?? opts.template?.name ?? null,
      },
    },
  });

  return {
    notified: cloud.notified,
    reason: cloud.notified ? undefined : cloud.reason,
    fallbackWaLink,
    provider: cloud.provider,
    messageId: cloud.messageId,
    template: cloud.template ?? opts.template?.name,
  };
}

export async function sendStaffWhatsApp(opts: {
  tenantId: string;
  userId: string;
  body: string;
  activityTitle: string;
  actorUserId?: string | null;
  template?: { name: string; languageCode?: string; params: string[] };
}): Promise<WhatsappNotifyResult> {
  const [user, employee] = await Promise.all([
    prisma.user.findFirst({
      where: { id: opts.userId, tenantId: opts.tenantId, deletedAt: null },
      select: { id: true, name: true, phone: true },
    }),
    prisma.employee.findFirst({
      where: { tenantId: opts.tenantId, userId: opts.userId, deletedAt: null },
      select: { phone: true },
    }),
  ]);
  if (!user) return { notified: false, reason: "no_user" };
  const phone = (user.phone || employee?.phone || "").trim();
  if (!phone) {
    return {
      notified: false,
      reason: "no_phone — add WhatsApp mobile under Users & Roles for this engineer",
    };
  }

  const waDigits = digitsForWa(phone);
  const fallbackWaLink = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(opts.body)}`
    : null;

  const cloud = await tryCloudSend(phone, opts.body, opts.template, {
    preferTemplate: Boolean(opts.template?.name),
  });
  const phoneNorm = normalizePhone(phone) || phone.replace(/\D/g, "");

  let conversation = await prisma.whatsappConversation.findFirst({
    where: { tenantId: opts.tenantId, phoneNormalized: phoneNorm },
  });
  if (!conversation) {
    conversation = await prisma.whatsappConversation.create({
      data: {
        id: newId(),
        tenantId: opts.tenantId,
        provider: "META_CLOUD",
        phone,
        phoneNormalized: phoneNorm,
        contactName: user.name,
        lastMessage: opts.body,
        unreadCount: 0,
      },
    });
  } else {
    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: { lastMessage: opts.body, unreadCount: 0 },
    });
  }
  await prisma.whatsappMessage.create({
    data: {
      id: newId(),
      tenantId: opts.tenantId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      body: opts.body,
      status: cloud.notified ? "SENT" : "QUEUED",
      sentByUserId: opts.actorUserId ?? null,
      externalId: cloud.messageId ?? null,
    },
  });

  await prisma.activity.create({
    data: {
      id: newId(),
      tenantId: opts.tenantId,
      type: "WHATSAPP",
      title: opts.activityTitle.slice(0, 191),
      description: opts.body.slice(0, 2000),
      status: cloud.notified ? "COMPLETED" : "PENDING",
      scheduledAt: new Date(),
      assignedToId: opts.userId,
      customFields: {
        kind: "staff_whatsapp",
        notified: cloud.notified,
        reason: cloud.reason ?? null,
        template: cloud.template ?? opts.template?.name ?? null,
        fallbackWaLink,
      },
    },
  });

  return {
    notified: cloud.notified,
    reason: cloud.notified
      ? cloud.reason // may note template→text fallback
      : cloud.reason || "engineer_whatsapp_failed",
    fallbackWaLink,
    provider: cloud.provider,
    messageId: cloud.messageId,
    template: cloud.template ?? opts.template?.name,
  };
}

async function companyName(tenantId: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { name: true },
  });
  return tenant?.name ?? "HMS";
}

function firstName(name: string) {
  return waText(name.split(" ")[0] || name, "Customer");
}

/** Template 1 — ticket_created_customer */
export async function notifyTicketCreatedCustomer(
  tenantId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    contactId: string | null;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  if (!ticket.contactId) return { notified: false, reason: "no_contact" };
  const [company, contact] = await Promise.all([
    companyName(tenantId),
    prisma.contact.findFirst({
      where: { id: ticket.contactId, tenantId, deletedAt: null },
      select: { name: true },
    }),
  ]);
  if (!contact) return { notified: false, reason: "no_contact" };
  const label = ticketLabel(ticket.ticketNo);
  const name = firstName(contact.name);
  const issue = waText(ticket.subject);
  const body = `Hello ${name}, your service request ${label} has been registered with ${company}. Machine / issue: ${issue}. Our team will contact you shortly. Thank you.`;
  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `WhatsApp ticket created — ${label}`,
    actorUserId,
    meta: { ticketId: ticket.id, kind: "ticket_created" },
    template: {
      name: templateName("TICKET_CREATED_CUSTOMER", "WHATSAPP_TEMPLATE_TICKET_CREATED_CUSTOMER"),
      params: [name, label, company, issue],
    },
  });
}

/** Template 2 — ticket_assigned_engineer */
export async function notifyTicketAssignedEngineer(
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
  if (!ticket.assignedToId) return { notified: false, reason: "no_assignee" };
  const [engineer, contact] = await Promise.all([
    prisma.user.findFirst({
      where: { id: ticket.assignedToId, tenantId, deletedAt: null },
      select: { name: true },
    }),
    ticket.contactId
      ? prisma.contact.findFirst({
          where: { id: ticket.contactId, tenantId, deletedAt: null },
          select: {
            name: true,
            phone: true,
            street: true,
            doorNo: true,
            area: true,
            pincode: true,
            location: true,
            city: true,
          },
        })
      : Promise.resolve(null),
  ]);
  const label = ticketLabel(ticket.ticketNo);
  const engName = firstName(engineer?.name || "Engineer");
  const custName = waText(contact?.name, "Customer");
  const custPhone = waText(contact?.phone, "—");
  const location = formatAddress([
    contact?.doorNo,
    contact?.street,
    contact?.area,
    contact?.location,
    contact?.city,
    contact?.pincode,
  ]);
  const issue = waText(ticket.subject);
  const body = `Hi ${engName}, new service job ${label} assigned. Customer: ${custName}. Phone: ${custPhone}. Location: ${location}. Issue: ${issue}. Please update status in CRM after visit.`;
  return sendStaffWhatsApp({
    tenantId,
    userId: ticket.assignedToId,
    body,
    activityTitle: `WhatsApp assign — ${label}`,
    actorUserId,
    template: {
      name: templateName("TICKET_ASSIGNED_ENGINEER", "WHATSAPP_TEMPLATE_TICKET_ASSIGNED_ENGINEER"),
      params: [engName, label, custName, custPhone, location, issue],
    },
  });
}

/** Template 3 — ticket_status_update */
export async function notifyTicketStatusUpdate(
  tenantId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    status: string;
    contactId: string | null;
    assignedToId: string | null;
  },
  note: string,
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  if (!ticket.contactId) return { notified: false, reason: "no_contact" };
  const contact = await prisma.contact.findFirst({
    where: { id: ticket.contactId, tenantId, deletedAt: null },
    select: { name: true },
  });
  if (!contact) return { notified: false, reason: "no_contact" };
  const label = ticketLabel(ticket.ticketNo);
  const name = firstName(contact.name);
  const status = statusLabel(ticket.status);
  const noteText = waText(note || ticket.subject, "Update from service team");
  const body = `Hello ${name}, update on service request ${label}: status is now ${status}. Note: ${noteText}. For help, reply to this chat or call us.`;
  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `WhatsApp status — ${label} → ${status}`,
    actorUserId: actorUserId ?? ticket.assignedToId,
    meta: { ticketId: ticket.id, kind: "status_update", status: ticket.status },
    template: {
      name: templateName("TICKET_STATUS_UPDATE", "WHATSAPP_TEMPLATE_TICKET_STATUS_UPDATE"),
      params: [name, label, status, noteText],
    },
  });
}

/** Template 4 — ticket_completed_customer */
export async function notifyTicketCompleted(
  tenantId: string,
  ticket: {
    id: string;
    ticketNo: number;
    subject: string;
    contactId: string | null;
    assignedToId: string | null;
    paymentTotal?: number;
    description?: string | null;
  },
  actorUserId?: string,
  workSummary?: string | null,
): Promise<WhatsappNotifyResult> {
  if (!ticket.contactId) return { notified: false, reason: "no_contact" };
  const contact = await prisma.contact.findFirst({
    where: { id: ticket.contactId, tenantId, deletedAt: null },
    select: { name: true },
  });
  if (!contact) return { notified: false, reason: "no_contact" };
  const label = ticketLabel(ticket.ticketNo);
  const name = firstName(contact.name);
  const summary = waText(workSummary || ticket.description || ticket.subject, "Service completed");
  const due =
    ticket.paymentTotal != null && ticket.paymentTotal > 0
      ? inrAmount(ticket.paymentTotal)
      : "Nil";
  const body = `Hello ${name}, service request ${label} is completed. Summary: ${summary}. Amount due: ${due}. Please keep this message for your records.`;
  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `Service complete — ${label}`,
    actorUserId: actorUserId ?? ticket.assignedToId,
    meta: { ticketId: ticket.id, kind: "job_complete" },
    template: {
      name: templateName("TICKET_COMPLETED_CUSTOMER", "WHATSAPP_TEMPLATE_TICKET_COMPLETED_CUSTOMER"),
      params: [name, label, summary, due],
    },
  });
}

/** Template 6 — payment_received_customer (template 5 skipped) */
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
  const [company, contact] = await Promise.all([
    companyName(tenantId),
    prisma.contact.findFirst({
      where: { id: ticket.contactId, tenantId, deletedAt: null },
      select: { name: true },
    }),
  ]);
  if (!contact) return { notified: false, reason: "no_contact" };
  const label = ticketLabel(ticket.ticketNo);
  const name = firstName(contact.name);
  const amount = inrAmount(ticket.paymentTotal);
  const ref = waText(invoiceNumber || label);
  const body = `Hello ${name}, we have received payment of ${amount} for ${label}. Reference: ${ref}. Thank you for choosing ${company}.`;
  return sendCustomerWhatsApp({
    tenantId,
    contactId: ticket.contactId,
    body,
    activityTitle: `Payment complete — ${label}`,
    actorUserId: actorUserId ?? ticket.assignedToId,
    meta: { ticketId: ticket.id, kind: "job_paid", invoiceNumber: invoiceNumber ?? null },
    template: {
      name: templateName("PAYMENT_RECEIVED_CUSTOMER", "WHATSAPP_TEMPLATE_PAYMENT_RECEIVED_CUSTOMER"),
      params: [name, amount, label, ref, company],
    },
  });
}

/** @deprecated Template 5 unused — kept as no-op for old clients. */
export async function notifyPaymentDue(): Promise<WhatsappNotifyResult> {
  return { notified: false, reason: "payment_due_template_disabled" };
}

/** Template 7 — sale_enquiry_received */
export async function notifySaleEnquiryReceived(
  tenantId: string,
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    company?: string | null;
    description?: string | null;
    customFields?: unknown;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  if (!lead.phone) return { notified: false, reason: "no_phone" };
  const company = await companyName(tenantId);
  const cf =
    lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};
  const product = waText(
    cf.interested_product_name ||
      cf.demoProductName ||
      cf.productInterest ||
      lead.description ||
      "your product enquiry",
  );
  const ref = waText(cf.enquiryRef || `LE-${lead.id.slice(0, 8).toUpperCase()}`);
  const name = firstName(lead.name);
  const body = `Hello ${name}, we received your enquiry for ${product}. Reference: ${ref}. Our sales executive will contact you shortly. Thank you — ${company}.`;
  return sendPhoneWhatsApp({
    tenantId,
    phone: lead.phone,
    contactName: lead.name,
    leadId: lead.id,
    body,
    activityTitle: `WhatsApp sale enquiry — ${ref}`,
    actorUserId,
    meta: { leadId: lead.id, kind: "sale_enquiry" },
    template: {
      name: templateName("SALE_ENQUIRY_RECEIVED", "WHATSAPP_TEMPLATE_SALE_ENQUIRY_RECEIVED"),
      params: [name, product, ref, company],
    },
  });
}

/** Template 8 — demo_dc_customer */
export async function notifyDemoDcCustomer(
  tenantId: string,
  opts: {
    leadId: string;
    contactName: string;
    phone?: string | null;
    contactId?: string | null;
    productName: string;
    serialNo: string;
    dcNumber: string;
    executiveName: string;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  if (!opts.phone) return { notified: false, reason: "no_phone" };
  const name = firstName(opts.contactName);
  const product = waText(opts.productName, "Demo unit");
  const serial = waText(opts.serialNo, "—");
  const dc = waText(opts.dcNumber, "—");
  const exec = waText(opts.executiveName, "our sales team");
  const body = `Hello ${name}, demo unit ${product} (serial ${serial}) is issued under challan ${dc}. Our executive ${exec} will follow up on the demo. Thank you.`;
  return sendPhoneWhatsApp({
    tenantId,
    phone: opts.phone,
    contactName: opts.contactName,
    contactId: opts.contactId,
    leadId: opts.leadId,
    body,
    activityTitle: `WhatsApp demo DC — ${dc}`,
    actorUserId,
    meta: { leadId: opts.leadId, kind: "demo_dc", dcNumber: dc },
    template: {
      name: templateName("DEMO_DC_CUSTOMER", "WHATSAPP_TEMPLATE_DEMO_DC_CUSTOMER"),
      params: [name, product, serial, dc, exec],
    },
  });
}

/** Template 9 — proforma_ready_customer */
export async function notifyProformaReady(
  tenantId: string,
  opts: {
    contactId: string;
    invoiceNumber: string;
    productDescription: string;
    amount: number;
    billingContact?: string | null;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  const [company, contact] = await Promise.all([
    companyName(tenantId),
    prisma.contact.findFirst({
      where: { id: opts.contactId, tenantId, deletedAt: null },
      select: { name: true },
    }),
  ]);
  if (!contact) return { notified: false, reason: "no_contact" };
  const name = firstName(contact.name);
  const inv = waText(opts.invoiceNumber);
  const product = waText(opts.productDescription, "your order");
  const amount = inrAmount(opts.amount);
  const billing = waText(opts.billingContact || `${company} billing desk`);
  const body = `Hello ${name}, your proforma ${inv} for ${product} is ready. Amount: ${amount}. Please contact ${billing} for next steps. Final tax invoice will be issued as per company process.`;
  return sendCustomerWhatsApp({
    tenantId,
    contactId: opts.contactId,
    body,
    activityTitle: `WhatsApp proforma — ${inv}`,
    actorUserId,
    meta: { kind: "proforma_ready", invoiceNumber: inv },
    template: {
      name: templateName("PROFORMA_READY_CUSTOMER", "WHATSAPP_TEMPLATE_PROFORMA_READY_CUSTOMER"),
      params: [name, inv, product, amount, billing],
    },
  });
}

/** Template 10 — sale_order_confirmed */
export async function notifySaleOrderConfirmed(
  tenantId: string,
  opts: {
    contactId?: string | null;
    phone?: string | null;
    contactName: string;
    leadId?: string | null;
    product: string;
    reference: string;
  },
  actorUserId?: string,
): Promise<WhatsappNotifyResult> {
  const company = await companyName(tenantId);
  const name = firstName(opts.contactName);
  const product = waText(opts.product, "your order");
  const ref = waText(opts.reference);
  const body = `Hello ${name}, your order for ${product} is confirmed. Reference: ${ref}. Our team will share proforma / delivery details next. Thank you — ${company}.`;
  if (opts.contactId) {
    return sendCustomerWhatsApp({
      tenantId,
      contactId: opts.contactId,
      body,
      activityTitle: `WhatsApp order confirmed — ${ref}`,
      actorUserId,
      meta: { leadId: opts.leadId, kind: "sale_confirmed" },
      template: {
        name: templateName("SALE_ORDER_CONFIRMED", "WHATSAPP_TEMPLATE_SALE_ORDER_CONFIRMED"),
        params: [name, product, ref, company],
      },
    });
  }
  if (!opts.phone) return { notified: false, reason: "no_phone" };
  return sendPhoneWhatsApp({
    tenantId,
    phone: opts.phone,
    contactName: opts.contactName,
    leadId: opts.leadId,
    body,
    activityTitle: `WhatsApp order confirmed — ${ref}`,
    actorUserId,
    meta: { leadId: opts.leadId, kind: "sale_confirmed" },
    template: {
      name: templateName("SALE_ORDER_CONFIRMED", "WHATSAPP_TEMPLATE_SALE_ORDER_CONFIRMED"),
      params: [name, product, ref, company],
    },
  });
}

export function buildTicketCompleteMessage(opts: {
  contactName: string;
  ticketNo: number | string;
  companyName: string;
  subject?: string;
}) {
  const subj = opts.subject ? ` (${opts.subject})` : "";
  return `Hi ${opts.contactName}, your service ticket ${ticketLabel(opts.ticketNo)}${subj} is completed. Thank you — ${opts.companyName}.`;
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
