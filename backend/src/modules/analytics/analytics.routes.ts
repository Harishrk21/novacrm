import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { success } from "../../common/utils/response.js";
import { prisma } from "../../config/database.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireTenant);

analyticsRouter.get("/summary", async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const range = String(q.query.range ?? "month");
  const now = new Date();
  const from = new Date(now);
  if (range === "week") from.setDate(from.getDate() - 7);
  else if (range === "quarter") from.setMonth(from.getMonth() - 3);
  else if (range === "year") from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 1);

  const prevFrom = new Date(from);
  const span = now.getTime() - from.getTime();
  prevFrom.setTime(from.getTime() - span);

  const [
    leads,
    deals,
    stages,
    sources,
    users,
    accounts,
    activities,
    invoices,
    products,
    tickets,
    stock,
    contactCount,
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
        nextDueDate: true,
        stampingDate: true,
        resolvedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.stockLevel.findMany({
      where: { tenantId: t },
      select: { quantityOnHand: true, quantityReserved: true },
    }),
    prisma.contact.count({ where: { tenantId: t, deletedAt: null } }),
  ]);

  const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]));
  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s.name]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const leadsInRange = leads.filter((l) => l.createdAt >= from);
  const leadsPrev = leads.filter((l) => l.createdAt >= prevFrom && l.createdAt < from);
  const dealsInRange = deals.filter((d) => d.createdAt >= from);
  const dealsPrev = deals.filter((d) => d.createdAt >= prevFrom && d.createdAt < from);

  const wonDeals = deals.filter((d) => stageMap[d.stageId]?.isWon);
  const openDeals = deals.filter((d) => !stageMap[d.stageId]?.isWon && !stageMap[d.stageId]?.isLost);
  const wonRevenue = wonDeals.reduce((s, d) => s + Number(d.amount), 0);
  const openPipeline = openDeals.reduce((s, d) => s + Number(d.amount), 0);
  const invoiceRevenue = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);

  const leadsByStatus: Record<string, number> = {};
  for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;

  const leadsBySource = sources.map((s) => ({
    name: s.name,
    leads: leads.filter((l) => l.sourceId === s.id).length,
  }));

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

  const team = users.map((u) => {
    const owned = deals.filter((d) => d.ownerUserId === u.id);
    const won = owned.filter((d) => stageMap[d.stageId]?.isWon);
    const revenue = won.reduce((s, d) => s + Number(d.amount), 0);
    return {
      id: u.id,
      name: u.name,
      deals: owned.length,
      wonDeals: won.length,
      revenue,
      win: owned.length ? Math.round((won.length / owned.length) * 100) : 0,
      openValue: owned
        .filter((d) => !stageMap[d.stageId]?.isWon && !stageMap[d.stageId]?.isLost)
        .reduce((s, d) => s + Number(d.amount), 0),
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const byCityMap: Record<string, { city: string; accounts: number; leads: number; revenue: number }> = {};
  for (const a of accounts) {
    const city = a.city || "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, revenue: 0 };
    byCityMap[city].accounts += 1;
  }
  for (const l of leads) {
    const city = l.city || "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, revenue: 0 };
    byCityMap[city].leads += 1;
  }
  for (const d of wonDeals) {
    const acc = d.accountId ? accountMap[d.accountId] : null;
    const city = acc?.city || "Unknown";
    if (!byCityMap[city]) byCityMap[city] = { city, accounts: 0, leads: 0, revenue: 0 };
    byCityMap[city].revenue += Number(d.amount);
  }
  const byCity = Object.values(byCityMap).sort((a, b) => b.revenue - a.revenue);

  const byIndustryMap: Record<string, number> = {};
  for (const a of accounts) {
    const ind = a.industry || "Other";
    byIndustryMap[ind] = (byIndustryMap[ind] ?? 0) + 1;
  }
  const byIndustry = Object.entries(byIndustryMap).map(([name, value]) => ({ name, value }));

  // Monthly revenue from won deals + invoices (last 7 months)
  const months: Array<{ month: string; current: number; last: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const lastStart = new Date(d.getFullYear() - 1, d.getMonth(), 1);
    const lastEnd = new Date(d.getFullYear() - 1, d.getMonth() + 1, 1);
    const current = wonDeals
      .filter((x) => {
        const c = x.closedAt ?? x.createdAt;
        return c >= d && c < next;
      })
      .reduce((s, x) => s + Number(x.amount), 0);
    const last = wonDeals
      .filter((x) => {
        const c = x.closedAt ?? x.createdAt;
        return c >= lastStart && c < lastEnd;
      })
      .reduce((s, x) => s + Number(x.amount), 0);
    months.push({ month: label, current, last });
  }

  const activityByType: Record<string, number> = {};
  for (const a of activities) activityByType[a.type] = (activityByType[a.type] ?? 0) + 1;
  const completedActivities = activities.filter((a) => a.status === "COMPLETED").length;
  const pendingActivities = activities.filter((a) => a.status === "PENDING" || a.status === "OVERDUE").length;

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

  const ticketsInRange = tickets.filter((x) => x.createdAt >= from);
  const ticketsPrev = tickets.filter((x) => x.createdAt >= prevFrom && x.createdAt < from);
  const openTicketStatuses = new Set(["OPEN", "IN_PROGRESS", "PENDING"]);
  const openTickets = tickets.filter((x) => openTicketStatuses.has(x.status));
  const resolvedTickets = tickets.filter((x) => x.status === "RESOLVED" || x.status === "CLOSED");
  const resolvedInRange = tickets.filter((x) => {
    const doneAt = x.resolvedAt ?? x.closedAt;
    return doneAt != null && doneAt >= from && doneAt <= now;
  });
  const breachedTickets = tickets.filter((x) => x.slaBreached);
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
      where: { tenantId: t, deletedAt: null, stampingDate: { lte: in30, not: null } },
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

  const activityMonthly: Array<{ month: string; completed: number; pending: number; total: number }> = [];
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

  return success(r, {
    range,
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
      qualifiedLeads: leads.filter((l) => l.status === "QUALIFIED").length,
      convertedLeads: leads.filter((l) => l.status === "CONVERTED").length,
      conversionRate: leads.length
        ? Math.round((leads.filter((l) => l.status === "CONVERTED").length / leads.length) * 1000) / 10
        : 0,
      openDeals: openDeals.length,
      dealsInRange: dealsInRange.length,
      dealGrowth,
      wonDeals: wonDeals.length,
      wonRevenue,
      openPipeline,
      invoiceRevenue,
      invoiceCount: invoices.length,
      products,
      tickets: tickets.length,
      ticketsInRange: ticketsInRange.length,
      ticketGrowth,
      openTickets: openTickets.length,
      resolvedTickets: resolvedTickets.length,
      resolvedInRange: resolvedInRange.length,
      slaBreached: breachedTickets.length,
      unassignedTickets,
      avgResolutionHours,
      balanceOutstanding,
      machinesDueSoon,
      machinesStampingDue,
      stockUnits,
      accounts: accounts.length,
      contacts: contactCount,
      activities: activities.length,
      completedActivities,
      pendingActivities,
      avgCallMinutes,
      callCount: activities.filter((a) => a.type === "CALL").length,
    },
    leadsByStatus: Object.entries(leadsByStatus).map(([name, value]) => ({ name, value })),
    leadsBySource,
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
  });
});
