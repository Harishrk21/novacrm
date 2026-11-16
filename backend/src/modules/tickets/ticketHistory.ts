import { prisma } from "../../config/database.js";
import { money, recordEvent, serviceNo } from "../../common/history.js";

/**
 * Save a service-job step to the work history with the job's figures at that moment.
 * Fire-and-forget: `void logTicketEvent(...)`.
 */
export async function logTicketEvent(
  tenantId: string,
  ticketId: string,
  action: string,
  summary: string,
  extra?: Record<string, unknown>,
) {
  try {
    const x = await prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      select: {
        ticketNo: true,
        subject: true,
        status: true,
        contactId: true,
        assignedToId: true,
        paymentStatus: true,
        paymentTotal: true,
        advanceAmount: true,
        paymentMethod: true,
        paymentReference: true,
        customFields: true,
        resolvedAt: true,
        closedAt: true,
        paidAt: true,
      },
    });
    if (!x) return;
    const [contact, engineer] = await Promise.all([
      x.contactId
        ? prisma.contact.findFirst({ where: { id: x.contactId, tenantId }, select: { name: true, customerCode: true } })
        : null,
      x.assignedToId
        ? prisma.user.findFirst({ where: { id: x.assignedToId, tenantId }, select: { name: true } })
        : null,
    ]);
    const cf = (x.customFields && typeof x.customFields === "object" ? x.customFields : {}) as Record<string, unknown>;
    const category = String(cf.category ?? "") || "Breakdown";
    const total = money(x.paymentTotal);
    const advance = money(x.advanceAmount);
    recordEvent({
      tenantId,
      action,
      area: "Service",
      entityType: "ticket",
      entityId: ticketId,
      label: [serviceNo(x.ticketNo), contact?.name].filter(Boolean).join(" · "),
      summary,
      details: {
        jobType: category,
        subject: x.subject,
        status: x.status,
        customer: contact?.name ?? null,
        customerCode: contact?.customerCode ?? null,
        engineer: engineer?.name ?? null,
        payment: x.paymentStatus,
        total,
        advance,
        balance: x.paymentStatus === "PAID" ? 0 : Math.max(0, total - advance),
        paymentMethod: x.paymentMethod ?? null,
        paymentReference: x.paymentReference ?? null,
        completedAt: x.resolvedAt?.toISOString() ?? null,
        closedAt: x.closedAt?.toISOString() ?? null,
        paidAt: x.paidAt?.toISOString() ?? null,
        ...(extra ?? {}),
      },
    });
  } catch {
    /* history is best-effort */
  }
}
