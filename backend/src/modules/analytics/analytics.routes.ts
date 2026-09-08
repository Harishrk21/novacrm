import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant, requireTenantAdmin } from "../../middleware/tenant.middleware.js";
import { success } from "../../common/utils/response.js";
import { prisma } from "../../config/database.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireTenant);

function parseRangeBounds(q: Request["query"]) {
  const now = new Date();
  const range = String(q.range ?? "month");
  let from = new Date(now);
  let to = new Date(now);

  if (q.from) {
    const parsed = new Date(String(q.from));
    if (!Number.isNaN(parsed.getTime())) from = parsed;
  } else if (range === "week") from.setDate(from.getDate() - 7);
  else if (range === "quarter") from.setMonth(from.getMonth() - 3);
  else if (range === "year") from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 1);

  if (q.to) {
    const parsed = new Date(String(q.to));
    if (!Number.isNaN(parsed.getTime())) {
      to = parsed;
      to.setHours(23, 59, 59, 999);
    }
  }

  const prevFrom = new Date(from);
  const span = Math.max(1, to.getTime() - from.getTime());
  prevFrom.setTime(from.getTime() - span);

  return { range, from, to, prevFrom, now };
}

analyticsRouter.get("/summary", requireTenantAdmin, async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const { range, from, to, prevFrom, now } = parseRangeBounds(q.query);
  const filterAssignee = q.query.assigneeId ? String(q.query.assigneeId) : "";
  const filterSource = q.query.sourceId ? String(q.query.sourceId) : "";
  const filterTicketStatus = q.query.ticketStatus ? String(q.query.ticketStatus) : "";
  const filterLeadStatus = q.query.leadStatus ? String(q.query.leadStatus) : "";
  const filterCity = q.query.city ? String(q.query.city).trim().toLowerCase() : "";

  const [
    leadsRaw,
    deals,
    stages,
    sources,
    users,
    accounts,
    activities,
    invoicesRaw,
    products,
    ticketsRaw,
    stock,
    contactCount,
    stockUnitGroups,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: { tenantId: t, deletedAt: null },
      select: {
        id: true,
        status: true,
        sourceId: true,
        score: true,
        city: true,
        state: true,
        assignedToId: true,
        createdAt: true,
        company: true,
        name: true,
        customFields: true,
        updatedAt: true,
        convertedAt: true,
      },
    }),
    prisma.deal.findMany({
      where: { tenantId: t, deletedAt: null },
      select: {
        id: true,
        name: true,
        amount: true,
        stageId: true,
        probability: true,
        ownerUserId: true,
        accountId: true,
        expectedCloseDate: true,
        closedAt: true,
        createdAt: true,
      },
    }),
    prisma.pipelineStage.findMany({
      where: { tenantId: t, isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.leadSource.findMany({ where: { tenantId: t, isActive: true } }),
    prisma.user.findMany({
      where: { tenantId: t, deletedAt: null },
      select: { id: true, name: true, email: true },
    }),
    prisma.account.findMany({
      where: { tenantId: t, deletedAt: null },
      select: { id: true, name: true, industry: true, city: true, state: true },
    }),
    prisma.activity.findMany({
      where: { tenantId: t, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        scheduledAt: true,
        completedAt: true,
        durationMinutes: true,
        assignedToId: true,
        createdAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { tenantId: t, deletedAt: null },
      select: {
        id: true,
        grandTotal: true,
        amountPaid: true,
        status: true,
        invoiceDate: true,
        accountId: true,
        serviceTicketId: true,
        createdById: true,
      },
    }),
    prisma.product.count({ where: { tenantId: t, deletedAt: null } }),
    prisma.ticket.findMany({
      where: { tenantId: t, deletedAt: null },
      select: {
        id: true,
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        slaDueAt: true,
        slaBreached: true,
        assignedToId: true,
        contactId: true,
        accountId: true,
        productId: true,
        customFields: true,
        paymentTotal: true,
        advanceAmount: true,
        odAmount: true,
        paymentStatus: true,
        nextDueDate: true,
        stampingDate: true,
        resolvedAt: true,
        closedAt: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.stockLevel.findMany({
      where: { tenantId: t },
      select: { quantityOnHand: true, quantityReserved: true },
    }),
    prisma.contact.count({ where: { tenantId: t, deletedAt: null } }),
    prisma.stockUnit.groupBy({
      by: ["status"],
      where: { tenantId: t, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const cityMatch = (city?: string | null) =>
    !filterCity || String(city ?? "").trim().toLowerCase() === filterCity;

  const leads = leadsRaw.filter((l) => {
    if (filterAssignee && l.assignedToId !== filterAssignee) return false;
    if (filterSource && l.sourceId !== filterSource) return false;
    if (filterLeadStatus && l.status !== filterLeadStatus) return false;
    if (!cityMatch(l.city)) return false;
    return true;
  });

  const tickets = ticketsRaw.filter((x) => {
    if (filterAssignee && x.assignedToId !== filterAssignee) return false;
    if (filterTicketStatus && x.status !== filterTicketStatus) return false;
    if (filterCity) {
      const cf =
        x.customFields && typeof x.customFields === "object" && !Array.isArray(x.customFields)
          ? (x.customFields as Record<string, unknown>)
          : {};
      const city = String(cf.city ?? "");
      if (!cityMatch(city)) return false;
    }
    return true;
  });

  const accountIdsInCity = filterCity
    ? new Set(accounts.filter((a) => cityMatch(a.city)).map((a) => a.id))
    : null;
  const invoices = invoicesRaw.filter((i) => {
    if (filterAssignee && i.createdById !== filterAssignee) return false;
    if (accountIdsInCity && i.accountId && !accountIdsInCity.has(i.accountId)) return false;
    return true;
  });

  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]));
  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s.name]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const leadsInRange = leads.filter((l) => l.createdAt >= from && l.createdAt <= to);
  const leadsPrev = leads.filter((l) => l.createdAt >= prevFrom && l.createdAt < from);
  const dealsInRange = deals.filter((d) => d.createdAt >= from && d.createdAt <= to);
  const dealsPrev = deals.filter((d) => d.createdAt >= prevFrom && d.createdAt < from);

  const wonDeals = deals.filter((d) => stageMap[d.stageId]?.isWon);
  const openDeals = deals.filter((d) => !stageMap[d.stageId]?.isWon && !stageMap[d.stageId]?.isLost);
  const invoiceRevenue = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);

  const leadsByStatus: Record<string, number> = {};
  for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;

  const leadsBySource = sources.map((s) => ({
    name: s.name,
    leads: leads.filter((l) => l.sourceId === s.id).length,
  }));

  const leadsByOwner = users
    .map((u) => {
      const owned = leads.filter((l) => l.assignedToId === u.id);
      const converted = owned.filter((l) => l.status === "CONVERTED").length;
      const demo = owned.filter((l) => l.status === "DEMO").length;
      const pending = owned.filter((l) =>
        ["NEW", "CONTACTED", "QUALIFIED"].includes(l.status),
      ).length;
      return {
        id: u.id,
        name: u.name,
        total: owned.length,
        pending,
        demo,
        converted,
        conversionRate: owned.length ? Math.round((converted / owned.length) * 1000) / 10 : 0,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.converted - a.converted || b.total - a.total);

  const funnel = stages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stageId === stage.id);
    return {
      stage: stage.name,
      code: stage.code,
      count: stageDeals.length,
      value: stageDeals.reduce((s, d) => s + Number(d.amount), 0),
      isWon: stage.isWon,
      isLost: stage.isLost,
      color: stage.colorHex,
    };
  });
  const topFunnel = funnel[0]?.count || 1;
  const funnelWithWidth = funnel.map((f) => ({
    ...f,
    conversion: Math.round((f.count / topFunnel) * 100),
    width: `${Math.max(12, Math.round((f.count / topFunnel) * 100))}%`,
  }));

  const openTicketStatuses = new Set(["OPEN", "IN_PROGRESS", "PENDING"]);

  const performers = users
    .map((u) => {
      const myTickets = tickets.filter((x) => x.assignedToId === u.id);
      const ticketsResolved = myTickets.filter(
        (x) => x.status === "RESOLVED" || x.status === "CLOSED",
      ).length;
      const ticketsOpen = myTickets.filter((x) => openTicketStatuses.has(x.status)).length;
      const serviceCollected = myTickets
        .filter((x) => String(x.paymentStatus) === "PAID")
        .reduce((s, x) => s + Number(x.paymentTotal ?? 0), 0);
      const myLeads = leads.filter((l) => l.assignedToId === u.id);
      const leadsConverted = myLeads.filter((l) => l.status === "CONVERTED").length;
      const score =
        ticketsResolved * 10 + leadsConverted * 15 + Math.round(serviceCollected / 1000);
      return {
        id: u.id,
        name: u.name,
        ticketsOpen,
        ticketsResolved,
        leadsConverted,
        leadsTotal: myLeads.length,
        serviceCollected,
        score,
      };
    })
    .filter((p) => p.ticketsResolved + p.leadsConverted + p.ticketsOpen + p.leadsTotal > 0)
    .sort((a, b) => b.score - a.score);

  const team = performers.map((p) => ({
    id: p.id,
    name: p.name,
    deals: p.leadsTotal,
    wonDeals: p.leadsConverted,
    revenue: p.serviceCollected,
    win: p.leadsTotal ? Math.round((p.leadsConverted / p.leadsTotal) * 100) : 0,
    openValue: p.ticketsOpen,
  }));

  const byCityMap: Record<
    string,
    { city: string; accounts: number; leads: number; tickets: number; revenue: number }
  > = {};
  for (const a of accounts) {
    if (!cityMatch(a.city)) continue;
    const city = a.city || "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, tickets: 0, revenue: 0 };
    byCityMap[city].accounts += 1;
  }
  for (const l of leads) {
    const city = l.city || "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, tickets: 0, revenue: 0 };
    byCityMap[city].leads += 1;
  }
  for (const x of tickets) {
    const cf =
      x.customFields && typeof x.customFields === "object" && !Array.isArray(x.customFields)
        ? (x.customFields as Record<string, unknown>)
        : {};
    const city = String(cf.city ?? accountMap[x.accountId ?? ""]?.city ?? "Unknown") || "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, tickets: 0, revenue: 0 };
    byCityMap[city].tickets += 1;
    if (String(x.paymentStatus) === "PAID") {
      byCityMap[city].revenue += Number(x.paymentTotal ?? 0);
    }
  }
  for (const inv of invoices) {
    const city = inv.accountId ? accountMap[inv.accountId]?.city || "Unknown" : "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, tickets: 0, revenue: 0 };
    byCityMap[city].revenue += Number(inv.grandTotal);
  }
  const byCity = Object.values(byCityMap).sort((a, b) => b.revenue - a.revenue);

  const byIndustryMap: Record<string, number> = {};
  for (const a of accounts) {
    if (!cityMatch(a.city)) continue;
    const ind = a.industry || "Other";
    byIndustryMap[ind] = (byIndustryMap[ind] ?? 0) + 1;
  }
  const byIndustry = Object.entries(byIndustryMap).map(([name, value]) => ({ name, value }));

  const months: Array<{ month: string; proforma: number; servicePaid: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const proforma = invoices
      .filter((x) => x.invoiceDate >= d && x.invoiceDate < next)
      .reduce((s, x) => s + Number(x.grandTotal), 0);
    const servicePaid = tickets
      .filter((x) => {
        if (String(x.paymentStatus) !== "PAID") return false;
        const at = x.paidAt ?? x.closedAt ?? x.resolvedAt;
        return at != null && at >= d && at < next;
      })
      .reduce((s, x) => s + Number(x.paymentTotal ?? 0), 0);
    months.push({ month: label, proforma, servicePaid });
  }

  const activityByType: Record<string, number> = {};
  for (const a of activities) activityByType[a.type] = (activityByType[a.type] ?? 0) + 1;
  const completedActivities = activities.filter((a) => a.status === "COMPLETED").length;
  const pendingActivities = activities.filter(
    (a) => a.status === "PENDING" || a.status === "OVERDUE",
  ).length;

  const leadGrowth =
    leadsPrev.length === 0
      ? leadsInRange.length > 0
        ? 100
        : 0
      : Math.round(((leadsInRange.length - leadsPrev.length) / leadsPrev.length) * 100);
  const dealGrowth =
    dealsPrev.length === 0
      ? dealsInRange.length > 0
        ? 100
        : 0
      : Math.round(((dealsInRange.length - dealsPrev.length) / dealsPrev.length) * 100);

  const stockUnits = stock.reduce((s, r) => s + Number(r.quantityOnHand), 0);
  const stockByStatus = stockUnitGroups.map((g) => ({
    name: g.status,
    value: g._count._all,
  }));
  const demoOut = stockByStatus.find((s) => s.name === "DEMO")?.value ?? 0;
  const inStock = stockByStatus.find((s) => s.name === "IN_STOCK")?.value ?? 0;

  const ticketsInRange = tickets.filter((x) => x.createdAt >= from && x.createdAt <= to);
  const ticketsPrev = tickets.filter((x) => x.createdAt >= prevFrom && x.createdAt < from);
  const openTickets = tickets.filter((x) => openTicketStatuses.has(x.status));
  const resolvedTickets = tickets.filter((x) => x.status === "RESOLVED" || x.status === "CLOSED");
  const resolvedInRange = tickets.filter((x) => {
    const doneAt = x.resolvedAt ?? x.closedAt;
    return doneAt != null && doneAt >= from && doneAt <= to;
  });
  const breachedTickets = tickets.filter((x) => x.slaBreached);
  const awaitingAssignment = tickets.filter((x) => x.status === "OPEN" && !x.assignedToId).length;
  const awaitingApproval = tickets.filter((x) => x.status === "RESOLVED").length;
  const serviceCollected = tickets
    .filter((x) => String(x.paymentStatus) === "PAID")
    .reduce((s, x) => s + Number(x.paymentTotal ?? 0), 0);
  const serviceCollectedInRange = tickets
    .filter((x) => {
      if (String(x.paymentStatus) !== "PAID") return false;
      const at = x.paidAt ?? x.closedAt ?? x.resolvedAt;
      return at != null && at >= from && at <= to;
    })
    .reduce((s, x) => s + Number(x.paymentTotal ?? 0), 0);

  const enquiriesPending = leads.filter((l) =>
    ["NEW", "CONTACTED", "QUALIFIED"].includes(l.status),
  ).length;
  const enquiriesDemo = leads.filter((l) => l.status === "DEMO").length;
  const enquiriesConverted = leads.filter((l) => l.status === "CONVERTED").length;
  const enquiriesLost = leads.filter((l) => l.status === "LOST" || l.status === "UNQUALIFIED").length;
  const enquiryByStatus = [
    { name: "Pending", value: enquiriesPending, code: "NEW" },
    { name: "Demo", value: enquiriesDemo, code: "DEMO" },
    { name: "Converted", value: enquiriesConverted, code: "CONVERTED" },
    { name: "Closed", value: enquiriesLost, code: "LOST" },
  ];

  const leadMonthly: Array<{ month: string; created: number; converted: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    leadMonthly.push({
      month: label,
      created: leads.filter((l) => l.createdAt >= d && l.createdAt < next).length,
      converted: leads.filter((l) => {
        const at = l.convertedAt ?? (l.status === "CONVERTED" ? l.updatedAt : null);
        return at != null && at >= d && at < next;
      }).length,
    });
  }

  const attentionTickets = [...openTickets]
    .sort((a, b) => {
      if (a.slaBreached !== b.slaBreached) return a.slaBreached ? -1 : 1;
      const as = a.slaDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bs = b.slaDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return as - bs;
    })
    .slice(0, 8)
    .map((x) => ({
      id: x.id,
      ticketNo: x.ticketNo,
      subject: x.subject,
      status: x.status,
      priority: x.priority,
      slaDueAt: x.slaDueAt,
      slaBreached: x.slaBreached,
      assignedToId: x.assignedToId,
      paymentStatus: x.paymentStatus,
      balanceDue: Math.max(0, Number(x.paymentTotal ?? 0) - Number(x.advanceAmount ?? 0)),
    }));

  const ticketGrowth =
    ticketsPrev.length === 0
      ? ticketsInRange.length > 0
        ? 100
        : 0
      : Math.round(((ticketsInRange.length - ticketsPrev.length) / ticketsPrev.length) * 100);

  const ticketsByStatusMap: Record<string, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    PENDING: 0,
    RESOLVED: 0,
    CLOSED: 0,
  };
  for (const x of tickets) ticketsByStatusMap[x.status] = (ticketsByStatusMap[x.status] ?? 0) + 1;
  const ticketsByStatus = Object.entries(ticketsByStatusMap).map(([name, value]) => ({ name, value }));

  const ticketsByPriorityMap: Record<string, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
  for (const x of tickets) ticketsByPriorityMap[x.priority] = (ticketsByPriorityMap[x.priority] ?? 0) + 1;
  const ticketsByPriority = Object.entries(ticketsByPriorityMap).map(([name, value]) => ({
    name,
    value,
  }));

  const ticketsByCategoryMap: Record<string, number> = {};
  for (const x of tickets) {
    const cf =
      x.customFields && typeof x.customFields === "object" && !Array.isArray(x.customFields)
        ? (x.customFields as Record<string, unknown>)
        : {};
    const cat = String(cf.category ?? "General").trim() || "General";
    ticketsByCategoryMap[cat] = (ticketsByCategoryMap[cat] ?? 0) + 1;
  }
  const ticketsByCategory = Object.entries(ticketsByCategoryMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const ticketsByAssignee = users
    .map((u) => {
      const owned = tickets.filter((x) => x.assignedToId === u.id);
      const open = owned.filter((x) => openTicketStatuses.has(x.status)).length;
      const resolved = owned.filter((x) => x.status === "RESOLVED" || x.status === "CLOSED").length;
      const breached = owned.filter((x) => x.slaBreached).length;
      return {
        id: u.id,
        name: u.name,
        total: owned.length,
        open,
        resolved,
        breached,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const unassignedTickets = tickets.filter((x) => !x.assignedToId).length;

  const ticketMonthly: Array<{
    month: string;
    created: number;
    resolved: number;
    breached: number;
  }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    ticketMonthly.push({
      month: label,
      created: tickets.filter((x) => x.createdAt >= d && x.createdAt < next).length,
      resolved: tickets.filter((x) => {
        const doneAt = x.resolvedAt ?? x.closedAt;
        return doneAt != null && doneAt >= d && doneAt < next;
      }).length,
      breached: tickets.filter((x) => x.slaBreached && x.createdAt >= d && x.createdAt < next).length,
    });
  }

  const resolutionHours: number[] = [];
  for (const x of tickets) {
    const doneAt = x.resolvedAt ?? x.closedAt;
    if (!doneAt) continue;
    const hours = (doneAt.getTime() - x.createdAt.getTime()) / (1000 * 60 * 60);
    if (Number.isFinite(hours) && hours >= 0) resolutionHours.push(hours);
  }
  const avgResolutionHours = resolutionHours.length
    ? Math.round((resolutionHours.reduce((s, h) => s + h, 0) / resolutionHours.length) * 10) / 10
    : 0;

  const balanceOutstanding = openTickets.reduce(
    (s, x) => s + Math.max(0, Number(x.paymentTotal ?? 0) - Number(x.advanceAmount ?? 0)),
    0,
  );
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  const [machinesDueSoon, machinesStampingDue] = await Promise.all([
    prisma.customerAsset.count({
      where: { tenantId: t, deletedAt: null, nextDueDate: { lte: in30, not: null } },
    }),
    prisma.customerAsset.count({
      where: {
        tenantId: t,
        deletedAt: null,
        OR: [{ stampingDate: null }, { nextDueDate: { lte: in30, not: null } }],
      },
    }),
  ]);

  const tenant = await prisma.tenant.findFirst({
    where: { id: t, deletedAt: null },
    select: { settings: true, currency: true, name: true },
  });
  const settings =
    tenant?.settings && typeof tenant.settings === "object" && !Array.isArray(tenant.settings)
      ? (tenant.settings as Record<string, unknown>)
      : {};
  const revenueTarget = Number(settings.revenueTarget ?? 0) || 0;
  const targetPeriod = String(settings.targetPeriod ?? "month");

  const callWithDuration = activities.filter(
    (a) => a.type === "CALL" && a.durationMinutes != null && Number(a.durationMinutes) > 0,
  );
  const avgCallMinutes = callWithDuration.length
    ? Math.round(
        callWithDuration.reduce((s, a) => s + Number(a.durationMinutes), 0) / callWithDuration.length,
      )
    : 0;

  const activityMonthly: Array<{ month: string; completed: number; pending: number; total: number }> =
    [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const inMonth = activities.filter((a) => a.createdAt >= d && a.createdAt < next);
    activityMonthly.push({
      month: label,
      completed: inMonth.filter((a) => a.status === "COMPLETED").length,
      pending: inMonth.filter((a) => a.status === "PENDING" || a.status === "OVERDUE").length,
      total: inMonth.length,
    });
  }

  const cities = [
    ...new Set(
      [
        ...accounts.map((a) => a.city).filter(Boolean),
        ...leads.map((l) => l.city).filter(Boolean),
      ].map((c) => String(c)),
    ),
  ].sort();

  return success(r, {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    filters: {
      assigneeId: filterAssignee || null,
      sourceId: filterSource || null,
      ticketStatus: filterTicketStatus || null,
      leadStatus: filterLeadStatus || null,
      city: filterCity || null,
    },
    generatedAt: now.toISOString(),
    salesTargets: {
      revenueTarget,
      targetPeriod,
      currency: tenant?.currency ?? "INR",
    },
    kpis: {
      totalLeads: leads.length,
      leadsInRange: leadsInRange.length,
      leadGrowth,
      qualifiedLeads: leads.filter((l) => l.status === "QUALIFIED" || l.status === "DEMO").length,
      convertedLeads: enquiriesConverted,
      conversionRate: leads.length ? Math.round((enquiriesConverted / leads.length) * 1000) / 10 : 0,
      enquiriesPending,
      enquiriesDemo,
      enquiriesConverted,
      enquiriesLost,
      openDeals: openDeals.length,
      dealsInRange: dealsInRange.length,
      dealGrowth,
      wonDeals: wonDeals.length,
      wonRevenue: serviceCollected,
      openPipeline: 0,
      invoiceRevenue,
      invoiceCount: invoices.length,
      invoiceRevenueInRange: invoices
        .filter((i) => i.invoiceDate >= from && i.invoiceDate <= to)
        .reduce((s, i) => s + Number(i.grandTotal), 0),
      serviceCollected,
      serviceCollectedInRange,
      products,
      tickets: tickets.length,
      ticketsInRange: ticketsInRange.length,
      ticketGrowth,
      openTickets: openTickets.length,
      resolvedTickets: resolvedTickets.length,
      resolvedInRange: resolvedInRange.length,
      slaBreached: breachedTickets.length,
      unassignedTickets,
      awaitingAssignment,
      awaitingApproval,
      avgResolutionHours,
      balanceOutstanding,
      machinesDueSoon,
      machinesStampingDue,
      stockUnits,
      demoOut,
      inStock,
      accounts: accounts.length,
      contacts: contactCount,
      activities: activities.length,
      completedActivities,
      pendingActivities,
      avgCallMinutes,
      callCount: activities.filter((a) => a.type === "CALL").length,
    },
    enquiryByStatus,
    stockByStatus,
    attentionTickets,
    leadsByStatus: Object.entries(leadsByStatus).map(([name, value]) => ({ name, value })),
    leadsBySource,
    leadsByOwner,
    leadMonthly,
    performers,
    ticketsByStatus,
    ticketsByPriority,
    ticketsByCategory,
    ticketsByAssignee,
    ticketMonthly,
    funnel: funnelWithWidth,
    team,
    byCity,
    byIndustry,
    monthlyRevenue: months,
    activityMonthly,
    activityByType: Object.entries(activityByType).map(([name, value]) => ({ name, value })),
    recentActivities: activities.slice(0, 12).map((a) => ({
      ...a,
      assignee: a.assignedToId ? userMap[a.assignedToId] ?? null : null,
    })),
    recentLeads: leads
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 8)
      .map((l) => ({
        id: l.id,
        name: l.name,
        company: l.company,
        status: l.status,
        city: l.city,
        source: l.sourceId ? sourceMap[l.sourceId] ?? null : null,
        createdAt: l.createdAt,
      })),
    stages: stages.map((s) => ({ id: s.id, name: s.name, code: s.code, colorHex: s.colorHex })),
    sources: sources.map((s) => ({ id: s.id, name: s.name })),
    users: users.map((u) => ({ id: u.id, name: u.name })),
    cities,
  });
});
