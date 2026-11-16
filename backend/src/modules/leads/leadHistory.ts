import { prisma } from "../../config/database.js";
import { money, recordEvent } from "../../common/history.js";

/** Save a sales step (converted / sale completed / lost) with the deal figures at that moment. */
export async function logLeadEvent(
  tenantId: string,
  leadId: string,
  action: string,
  summary: string,
  extra?: Record<string, unknown>,
) {
  try {
    const l = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: {
        leadNo: true,
        name: true,
        company: true,
        phone: true,
        status: true,
        assignedToId: true,
        customFields: true,
        convertedAt: true,
      },
    });
    if (!l) return;
    const cf = (l.customFields && typeof l.customFields === "object" ? l.customFields : {}) as Record<string, unknown>;
    const [owner, sold] = await Promise.all([
      l.assignedToId
        ? prisma.user.findFirst({ where: { id: l.assignedToId, tenantId }, select: { name: true } })
        : null,
      prisma.stockUnit.findMany({
        where: { tenantId, leadId, status: "SOLD", deletedAt: null },
        select: { serialNo: true, hmsUniqId: true },
      }),
    ]);
    recordEvent({
      tenantId,
      action,
      area: "Sales",
      entityType: "lead",
      entityId: leadId,
      label: [l.leadNo != null ? `ENQ-${String(l.leadNo).padStart(5, "0")}` : null, l.name].filter(Boolean).join(" · "),
      summary,
      details: {
        customer: l.name,
        company: l.company ?? null,
        phone: l.phone ?? null,
        status: l.status,
        salesperson: owner?.name ?? null,
        product: String(cf.demoProductName ?? cf.interested_product_name ?? cf.product_interest ?? "") || null,
        saleAmount: money(cf.salePaymentTotal),
        advance: money(cf.saleAdvanceAmount),
        soldSerials: sold.map((u) => u.hmsUniqId || u.serialNo),
        lostReason: cf.lostReason ?? null,
        saleCompletedAt: cf.saleCompletedAt ?? null,
        saleCompletedBy: cf.saleCompletedBy ?? null,
        convertedAt: l.convertedAt?.toISOString() ?? null,
        ...(extra ?? {}),
      },
    });
  } catch {
    /* best-effort */
  }
}
