import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant, requireTenantAdmin } from "../../middleware/tenant.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../config/database.js";
import {
  callGemini,
  cacheGet,
  cacheKey,
  cacheSet,
  geminiModelName,
  parseJsonLoose,
} from "./gemini.js";

const DASH_LINKS = [
  "/",
  "/tickets",
  "/tickets?slaBreached=1",
  "/tickets?status=OPEN",
  "/sale-tracking",
  "/sale-tracking?status=DEMO",
  "/contacts",
  "/erp/inventory",
  "/erp/inventory?tab=demo",
  "/erp/invoices",
  "/erp/products",
  "/activities",
  "/amc",
  "/stamping",
  "/help",
] as const;

function filterLinks(links: unknown) {
  const allowed = new Set<string>(DASH_LINKS);
  if (!Array.isArray(links)) return [];
  return links
    .filter((l) => l && typeof l === "object" && allowed.has(String((l as { to?: string }).to)))
    .map((l) => {
      const row = l as { label?: string; to?: string };
      return { label: String(row.label ?? "Open"), to: String(row.to) };
    })
    .slice(0, 8);
}

function requireRoles(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.auth?.role;
    if (!role || !codes.includes(role)) {
      return next(new AppError("Not allowed for this role", 403));
    }
    next();
  };
}

async function buildDashboardSnapshot(tenantId: string, range: string) {
  const snapKey = cacheKey(["dash-snap", tenantId, range]);
  const snapCached = cacheGet(snapKey);
  if (snapCached) {
    try {
      return JSON.parse(snapCached) as Awaited<ReturnType<typeof buildDashboardSnapshotFresh>>;
    } catch {
      /* rebuild */
    }
  }
  const fresh = await buildDashboardSnapshotFresh(tenantId, range);
  cacheSet(snapKey, JSON.stringify(fresh), 3 * 60 * 1000);
  return fresh;
}

async function buildDashboardSnapshotFresh(tenantId: string, range: string) {
  const now = new Date();
  const from = new Date(now);
  if (range === "week") from.setDate(from.getDate() - 7);
  else if (range === "quarter") from.setMonth(from.getMonth() - 3);
  else if (range === "year") from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 1);

  const span = now.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  const prevTo = from;
  const openStatuses = ["OPEN", "IN_PROGRESS", "PENDING"] as const;
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [
    leadTotal,
    leadsInRange,
    leadsPrev,
    convertedLeads,
    ticketTotal,
    ticketsInRange,
    ticketsPrev,
    openTickets,
    breached,
    breachedInRange,
    breachedPrev,
    unassigned,
    openTicketPay,
    deals,
    stages,
    invoiceAgg,
    products,
    stockAgg,
    contactCount,
    accountCount,
    activities,
    recentTickets,
    ticketsForMonthly,
  ] = await Promise.all([
    prisma.lead.count({ where: { tenantId, deletedAt: null } }),
    prisma.lead.count({ where: { tenantId, deletedAt: null, createdAt: { gte: from } } }),
    prisma.lead.count({
      where: { tenantId, deletedAt: null, createdAt: { gte: prevFrom, lt: prevTo } },
    }),
    prisma.lead.count({ where: { tenantId, deletedAt: null, status: "CONVERTED" } }),
    prisma.ticket.count({ where: { tenantId, deletedAt: null } }),
    prisma.ticket.count({ where: { tenantId, deletedAt: null, createdAt: { gte: from } } }),
    prisma.ticket.count({
      where: { tenantId, deletedAt: null, createdAt: { gte: prevFrom, lt: prevTo } },
    }),
    prisma.ticket.count({
      where: { tenantId, deletedAt: null, status: { in: [...openStatuses] } },
    }),
    prisma.ticket.count({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: [...openStatuses] },
        slaBreached: true,
      },
    }),
    prisma.ticket.count({
      where: { tenantId, deletedAt: null, slaBreached: true, createdAt: { gte: from } },
    }),
    prisma.ticket.count({
      where: {
        tenantId,
        deletedAt: null,
        slaBreached: true,
        createdAt: { gte: prevFrom, lt: prevTo },
      },
    }),
    prisma.ticket.count({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: [...openStatuses] },
        assignedToId: null,
      },
    }),
    prisma.ticket.findMany({
      where: { tenantId, deletedAt: null, status: { in: [...openStatuses] } },
      select: { paymentTotal: true, advanceAmount: true },
      take: 2000,
    }),
    prisma.deal.findMany({
      where: { tenantId, deletedAt: null },
      select: { amount: true, probability: true, stageId: true, closedAt: true },
      take: 500,
    }),
    prisma.pipelineStage.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, code: true, isWon: true },
    }),
    prisma.invoice.aggregate({
      where: { tenantId, deletedAt: null },
      _sum: { grandTotal: true },
      _count: true,
    }),
    prisma.product.count({ where: { tenantId, deletedAt: null } }),
    prisma.stockLevel.aggregate({
      where: { tenantId },
      _sum: { quantityOnHand: true },
    }),
    prisma.contact.count({ where: { tenantId, deletedAt: null } }),
    prisma.account.count({ where: { tenantId, deletedAt: null } }),
    prisma.activity.count({
      where: { tenantId, deletedAt: null, status: { in: ["PENDING", "OVERDUE"] } },
    }),
    prisma.ticket.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: [...openStatuses] },
      },
      orderBy: [{ slaBreached: "desc" }, { slaDueAt: "asc" }],
      take: 8,
      select: {
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        slaBreached: true,
        slaDueAt: true,
      },
    }),
    prisma.ticket.findMany({
      where: { tenantId, deletedAt: null, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, resolvedAt: true, slaBreached: true },
      take: 3000,
    }),
  ]);

  const balanceOutstanding = openTicketPay.reduce((s, t) => {
    const pay = Number(t.paymentTotal ?? 0);
    const adv = Number(t.advanceAmount ?? 0);
    return s + Math.max(0, pay - adv);
  }, 0);

  const wonIds = new Set(stages.filter((s) => s.isWon || /WON/i.test(s.code)).map((s) => s.id));
  const wonDeals = deals.filter((d) => d.stageId && wonIds.has(d.stageId));
  const openDeals = deals.filter((d) => !d.closedAt && !(d.stageId && wonIds.has(d.stageId)));
  const wonRevenue = wonDeals.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const openPipeline = openDeals.reduce(
    (s, d) => s + Number(d.amount ?? 0) * (Number(d.probability ?? 20) / 100),
    0,
  );

  const invoiceRevenue = Number(invoiceAgg._sum.grandTotal ?? 0);
  const stockUnits = Number(stockAgg._sum.quantityOnHand ?? 0);

  const ticketMonthly: Array<{ month: string; created: number; resolved: number; breached: number }> =
    [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const inMonth = ticketsForMonthly.filter((t) => t.createdAt >= d && t.createdAt < next);
    ticketMonthly.push({
      month: label,
      created: inMonth.length,
      resolved: ticketsForMonthly.filter(
        (t) => t.resolvedAt && t.resolvedAt >= d && t.resolvedAt < next,
      ).length,
      breached: inMonth.filter((t) => t.slaBreached).length,
    });
  }

  const pct = (cur: number, prev: number) =>
    prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;

  return {
    range,
    generatedAt: now.toISOString(),
    company: "HMS Enterprises CRM",
    notes: [
      "CRM issues proforma invoices only; final GST tax invoices are in Tally.",
      "Figures are live from the tenant database.",
      "Compare current range vs previous equal period for spikes.",
    ],
    kpis: {
      leads: leadTotal,
      leadsInRange,
      leadsPrev,
      leadGrowthPct: pct(leadsInRange, leadsPrev),
      convertedLeads,
      conversionRatePct: leadTotal ? Math.round((convertedLeads / leadTotal) * 1000) / 10 : 0,
      openTickets,
      ticketsInRange,
      ticketsPrev,
      ticketGrowthPct: pct(ticketsInRange, ticketsPrev),
      ticketTotal,
      slaBreached: breached,
      breachedInRange,
      breachedPrev,
      breachGrowthPct: pct(breachedInRange, breachedPrev),
      unassignedTickets: unassigned,
      balanceOutstanding,
      wonRevenue,
      openPipeline,
      openDeals: openDeals.length,
      proformaCount: invoiceAgg._count,
      proformaRevenue: invoiceRevenue,
      products,
      stockUnits,
      contacts: contactCount,
      accounts: accountCount,
      pendingActivities: activities,
    },
    spikes: {
      ticketVolume: {
        current: ticketsInRange,
        previous: ticketsPrev,
        changePct: pct(ticketsInRange, ticketsPrev),
      },
      slaBreaches: {
        current: breachedInRange,
        previous: breachedPrev,
        changePct: pct(breachedInRange, breachedPrev),
        openBreachedNow: breached,
      },
      outstandingBalance: {
        current: balanceOutstanding,
        note: "Sum of (payment − advance) on open jobs",
      },
    },
    ticketMonthly,
    openTicketSample: recentTickets.map((t) => ({
      no: t.ticketNo,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      slaBreached: t.slaBreached,
      slaDueAt: t.slaDueAt,
    })),
  };
}

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function localDashboardAnswer(
  mode: string,
  question: string,
  snapshot: Awaited<ReturnType<typeof buildDashboardSnapshotFresh>>,
) {
  const k = snapshot.kpis;
  const s = snapshot.spikes;

  if (mode === "overview") {
    return {
      answer: "Overview from live KPIs (no LLM wait).",
      bullets: [
        `Service: ${k.openTickets} open jobs · ${k.slaBreached} SLA breached · ${k.unassignedTickets} unassigned.`,
        `Sales: open pipeline ~${inr(k.openPipeline)} · won ~${inr(k.wonRevenue)} · ${k.openDeals} open deals.`,
        `Leads: ${k.leadsInRange} new this ${snapshot.range} (prev ${k.leadsPrev}, ${k.leadGrowthPct}%) · ${k.convertedLeads} converted overall (${k.conversionRatePct}%).`,
        `Stock & billing: ${k.stockUnits} units on hand · ${k.proformaCount} proformas · ${inr(k.proformaRevenue)} proforma total.`,
        `Attention first: ${
          k.slaBreached > 0
            ? "clear SLA breaches"
            : k.unassignedTickets > 0
              ? "assign open tickets"
              : k.balanceOutstanding > 0
                ? "collect outstanding balances"
                : "review pipeline & due stamping"
        }.`,
      ],
      links: [
        { label: "Tickets", to: "/tickets" },
        { label: "SLA breached", to: "/tickets?slaBreached=1" },
        { label: "Sale tracking", to: "/sale-tracking" },
        { label: "Stamping", to: "/stamping" },
      ],
      caution: "Verify figures on the linked screens before acting.",
    };
  }

  if (mode === "spikes") {
    return {
      answer: "Spike check vs previous equal period.",
      bullets: [
        `Ticket volume: ${s.ticketVolume.current} vs ${s.ticketVolume.previous} (${s.ticketVolume.changePct}%).`,
        `SLA breaches in range: ${s.slaBreaches.current} vs ${s.slaBreaches.previous} (${s.slaBreaches.changePct}%) · open breached now ${s.slaBreaches.openBreachedNow}.`,
        `Outstanding on open jobs: ${inr(s.outstandingBalance.current)}.`,
        s.ticketVolume.changePct >= 20
          ? "Ticket volume rose sharply — check staffing and recurring machine issues."
          : s.slaBreaches.changePct >= 20
            ? "SLA breaches rose — prioritize assignment and day notes."
            : "No extreme spike; keep watching open jobs and balances.",
      ],
      links: [
        { label: "Open tickets", to: "/tickets?status=OPEN" },
        { label: "SLA breached", to: "/tickets?slaBreached=1" },
        { label: "Invoices", to: "/erp/invoices" },
      ],
      caution: "Spikes compare this range to the previous equal window.",
    };
  }

  // Generic local fallback for free-text ask when Gemini is slow/unavailable
  const q = question.toLowerCase();
  const bullets = [
    `${k.openTickets} open tickets · ${k.slaBreached} SLA breached · ${k.unassignedTickets} unassigned.`,
    `Leads this ${snapshot.range}: ${k.leadsInRange} (prev ${k.leadsPrev}). Conversion ${k.conversionRatePct}%.`,
    `Pipeline ~${inr(k.openPipeline)} · outstanding balances ${inr(k.balanceOutstanding)}.`,
  ];
  if (/sale|pipeline|deal|convert/.test(q)) {
    bullets.unshift(
      `Sales pulse: won ${inr(k.wonRevenue)} · ${k.openDeals} open deals · conversion ${k.conversionRatePct}%.`,
    );
  }
  if (/stamp|amc|due/.test(q)) {
    bullets.push("Open Stamping / AMC pages for machines due renewal.");
  }
  return {
    answer: "Quick KPI answer (AI model skipped or unavailable).",
    bullets,
    links: [
      { label: "Tickets", to: "/tickets" },
      { label: "Sale tracking", to: "/sale-tracking" },
      { label: "Stamping", to: "/stamping" },
      { label: "Inventory", to: "/erp/inventory" },
    ],
    caution: "Live KPIs only — open links to verify details.",
  };
}

const askSchema = z.object({
  body: z.object({
    question: z.string().trim().min(3).max(500),
    range: z.enum(["week", "month", "quarter", "year"]).optional(),
    mode: z.enum(["ask", "overview", "spikes"]).optional(),
  }),
});

async function askDashboard(req: Request, res: Response) {
  const t = req.auth!.tenantId!;
  const { question, range = "month", mode = "ask" } = req.body as {
    question: string;
    range?: string;
    mode?: string;
  };

  const key = cacheKey(["dash", t, range, mode, question]);
  const cached = cacheGet(key);
  if (cached) {
    const data = JSON.parse(cached) as Record<string, unknown>;
    return success(res, { ...data, cached: true });
  }

  const snapshot = await buildDashboardSnapshot(t, range);

  // Overview / spikes: answer instantly from KPIs (no Gemini wait)
  if (mode === "overview" || mode === "spikes") {
    const local = localDashboardAnswer(mode, question, snapshot);
    const payload = {
      ...local,
      links: filterLinks(local.links),
      model: "live-kpis",
      range,
      mode,
      generatedAt: snapshot.generatedAt,
      cached: false,
    };
    cacheSet(key, JSON.stringify(payload));
    return success(res, payload);
  }

  let userQ = question;
  const slim = {
    range: snapshot.range,
    generatedAt: snapshot.generatedAt,
    kpis: snapshot.kpis,
    spikes: snapshot.spikes,
    ticketMonthly: snapshot.ticketMonthly,
    openTicketSample: snapshot.openTicketSample,
  };

  const prompt = `You are HMS Enterprises CRM assistant for company admins.
Answer ONLY using the JSON snapshot.
Be concise. Prefer bullets. Always deep-link when useful.
Allowed link paths: ${DASH_LINKS.join(", ")}
Never invent GST invoice numbers, serials, or payments.
Final GST billing is in Tally; CRM has proformas only.

Return strict JSON:
{
  "answer": "short plain text",
  "bullets": ["..."],
  "links": [{"label":"...","to":"/tickets"}],
  "caution": "optional"
}

User request: ${userQ}

Snapshot:
${JSON.stringify(slim)}`;

  try {
    const raw = await callGemini(prompt, { maxTokens: 700, timeoutMs: 18_000, retries: 1 });
    const parsed = parseJsonLoose<{
      answer?: string;
      bullets?: string[];
      links?: Array<{ label: string; to: string }>;
      caution?: string;
    }>(raw);

    const payload = {
      answer: String(parsed.answer ?? "").trim() || "No answer generated.",
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String).slice(0, 8) : [],
      links: filterLinks(parsed.links),
      caution: parsed.caution ? String(parsed.caution) : undefined,
      model: geminiModelName(),
      range,
      mode,
      generatedAt: snapshot.generatedAt,
      cached: false,
    };
    cacheSet(key, JSON.stringify(payload));
    return success(res, payload);
  } catch {
    // Soft-fail: still return useful KPIs instead of hanging / 503
    const local = localDashboardAnswer("ask", question, snapshot);
    const payload = {
      ...local,
      links: filterLinks(local.links),
      model: "live-kpis-fallback",
      range,
      mode,
      generatedAt: snapshot.generatedAt,
      cached: false,
      caution: `${local.caution ?? ""} AI was slow — showing live KPIs.`.trim(),
    };
    cacheSet(key, JSON.stringify(payload), 60_000);
    return success(res, payload);
  }
}

/* ── Ticket assist (desk + engineer + admin) ─────────────────────────── */

const ticketAssistSchema = z.object({
  body: z.object({
    action: z.enum([
      "triage",
      "draft_summary",
      "similar",
      "next_due",
      "polish_notes",
      "whatsapp_draft",
      "onsite_checklist",
      "sla_risk",
    ]),
    ticketId: z.string().optional(),
    text: z.string().trim().max(4000).optional(),
    category: z.string().optional(),
    priority: z.string().optional(),
    contactId: z.string().optional(),
    assetId: z.string().optional(),
  }),
});

async function ticketAssist(req: Request, res: Response) {
  const t = req.auth!.tenantId!;
  const body = req.body as z.infer<typeof ticketAssistSchema>["body"];
  const key = cacheKey([
    "ticket",
    t,
    body.action,
    body.ticketId,
    body.contactId,
    body.assetId,
    (body.text ?? "").slice(0, 200),
  ]);
  const cached = cacheGet(key);
  if (cached) return success(res, { ...JSON.parse(cached), cached: true });

  let ticket: Record<string, unknown> | null = null;
  if (body.ticketId) {
    const row = await prisma.ticket.findFirst({
      where: { id: body.ticketId, tenantId: t, deletedAt: null },
      select: {
        id: true,
        ticketNo: true,
        subject: true,
        description: true,
        status: true,
        priority: true,
        slaDueAt: true,
        slaBreached: true,
        contactId: true,
        customFields: true,
        paymentTotal: true,
        advanceAmount: true,
        nextDueDate: true,
      },
    });
    if (!row) throw new AppError("Ticket not found", 404);
    ticket = row as unknown as Record<string, unknown>;
  }

  const contactId = body.contactId || (ticket?.contactId ? String(ticket.contactId) : "");
  let similar: unknown[] = [];
  if ((body.action === "similar" || body.action === "triage") && contactId) {
    similar = await prisma.ticket.findMany({
      where: {
        tenantId: t,
        deletedAt: null,
        contactId,
        ...(body.ticketId ? { id: { not: body.ticketId } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        customFields: true,
      },
    });
  }

  const prompt = `You are HMS service CRM assistant. Suggest only — never auto-create/assign/complete/pay.
Action: ${body.action}
Return JSON only.

For triage: { "priority":"LOW|MEDIUM|HIGH|CRITICAL", "category":"Weighing|Billing|CCTV|Stamping|AMC|Other", "summary":"...", "rationale":"...", "bullets":[] }
For draft_summary: { "summary":"...", "subject":"optional short subject", "bullets":[] }
For similar: { "answer":"...", "bullets":["hint about past jobs"], "links":[] }
For next_due: { "suggestedNextDueNote":"...", "amcWording":"...", "caution":"human must confirm dates", "bullets":[] }
For polish_notes: { "polished":"clean job update text", "bullets":[] }
For whatsapp_draft: { "message":"short customer WhatsApp (human must approve before send)", "bullets":[] }
For onsite_checklist: { "checklist":["..."], "answer":"...", "bullets":[] }
For sla_risk: { "answer":"one-liner SLA risk", "bullets":[], "caution":"optional" }

Never invent invoice numbers or mark paid.

Context:
${JSON.stringify({
  ticket,
  complaintText: body.text ?? null,
  category: body.category ?? null,
  priority: body.priority ?? null,
  similarPastJobs: similar,
})}
`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  const payload = {
    ...parsed,
    model: geminiModelName(),
    action: body.action,
    cached: false,
    disclaimer: "AI suggestion only — review and confirm before applying.",
  };
  cacheSet(key, JSON.stringify(payload));
  return success(res, payload);
}

/* ── Sales demo coach ────────────────────────────────────────────────── */

const salesAssistSchema = z.object({
  body: z.object({
    action: z.enum(["demo_coach", "draft_daily_update", "ready_handoff", "followup_tone"]),
    leadId: z.string().optional(),
    notes: z.string().trim().max(4000).optional(),
    outcome: z.enum(["READY_TO_BUY", "NOT_INTERESTED"]).optional(),
  }),
});

async function salesAssist(req: Request, res: Response) {
  const t = req.auth!.tenantId!;
  const body = req.body as z.infer<typeof salesAssistSchema>["body"];
  const key = cacheKey(["sales", t, body.action, body.leadId, (body.notes ?? "").slice(0, 160), body.outcome]);
  const cached = cacheGet(key);
  if (cached) return success(res, { ...JSON.parse(cached), cached: true });

  let lead: Record<string, unknown> | null = null;
  if (body.leadId) {
    const row = await prisma.lead.findFirst({
      where: { id: body.leadId, tenantId: t, deletedAt: null },
      select: {
        id: true,
        name: true,
        company: true,
        phone: true,
        status: true,
        customFields: true,
      },
    });
    if (!row) throw new AppError("Lead not found", 404);
    lead = row as unknown as Record<string, unknown>;
  }

  const prompt = `You are HMS sales CRM coach. Suggest only — never auto-convert or invent serials/prices.
Action: ${body.action}
Return JSON.

demo_coach: { "answer":"call today because...", "bullets":[], "tone":"helpful" }
draft_daily_update: { "updateText":"Day note draft from bullets", "bullets":[] }
ready_handoff: { "checklist":["billing handoff items"], "answer":"...", "bullets":[], "caution":"warehouse raises proforma; GST in Tally" }
followup_tone: { "readyTone":"...", "notInterestedTone":"...", "suggested":"...", "bullets":[] }

Lead/context:
${JSON.stringify({ lead, notes: body.notes ?? null, outcome: body.outcome ?? null })}
`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  const payload = {
    ...parsed,
    model: geminiModelName(),
    action: body.action,
    cached: false,
    disclaimer: "AI suggestion only — sales must confirm before convert/return.",
  };
  cacheSet(key, JSON.stringify(payload));
  return success(res, payload);
}

/* ── Warehouse / billing ─────────────────────────────────────────────── */

const warehouseAssistSchema = z.object({
  body: z.object({
    action: z.enum(["proforma_draft", "ocr_fields", "stock_explain"]),
    leadId: z.string().optional(),
    contactId: z.string().optional(),
    productId: z.string().optional(),
    serialNo: z.string().optional(),
    ocrText: z.string().trim().max(8000).optional(),
    stockUnitId: z.string().optional(),
  }),
});

async function warehouseAssist(req: Request, res: Response) {
  const t = req.auth!.tenantId!;
  const body = req.body as z.infer<typeof warehouseAssistSchema>["body"];
  const key = cacheKey([
    "wh",
    t,
    body.action,
    body.leadId,
    body.contactId,
    body.productId,
    body.serialNo,
    body.stockUnitId,
    (body.ocrText ?? "").slice(0, 120),
  ]);
  const cached = cacheGet(key);
  if (cached) return success(res, { ...JSON.parse(cached), cached: true });

  let context: Record<string, unknown> = { ...body };
  if (body.leadId) {
    context.lead = await prisma.lead.findFirst({
      where: { id: body.leadId, tenantId: t, deletedAt: null },
      select: { name: true, company: true, phone: true, customFields: true, status: true },
    });
  }
  if (body.productId) {
    context.product = await prisma.product.findFirst({
      where: { id: body.productId, tenantId: t, deletedAt: null },
      select: { name: true, sku: true, salePrice: true, taxPercent: true, description: true },
    });
  }
  if (body.stockUnitId) {
    context.unit = await prisma.stockUnit.findFirst({
      where: { id: body.stockUnitId, tenantId: t },
      select: { serialNo: true, status: true, customFields: true, productId: true },
    });
  }

  const prompt = `You are HMS warehouse/billing CRM assistant.
Remind: final GST tax invoice is in Tally; CRM issues proforma only.
Never invent invoice numbers or GST amounts — only suggest draft fields for human review.
Action: ${body.action}
Return JSON.

proforma_draft: { "notes":"...", "lineDescription":"...", "bullets":["..."], "caution":"Review before create. Final bill in Tally." }
ocr_fields: { "suggested":{"documentNumber":"","documentDate":"","amount":"","notes":""}, "bullets":[], "caution":"OCR may be wrong — review every field" }
stock_explain: { "answer":"plain language status", "bullets":[], "caution":"optional" }

Context:
${JSON.stringify(context)}
`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  const payload = {
    ...parsed,
    model: geminiModelName(),
    action: body.action,
    cached: false,
    disclaimer: "AI draft only — review before saving. GST billing stays in Tally.",
  };
  cacheSet(key, JSON.stringify(payload));
  return success(res, payload);
}

/* ── Customer 360 ────────────────────────────────────────────────────── */

const customerAssistSchema = z.object({
  body: z.object({
    contactId: z.string().min(1),
    action: z.enum(["summarize", "machines_due", "visit_questions"]).optional(),
  }),
});

async function customerAssist(req: Request, res: Response) {
  const t = req.auth!.tenantId!;
  const { contactId, action = "summarize" } = req.body as {
    contactId: string;
    action?: string;
  };
  const key = cacheKey(["cust-v2", t, contactId, action]);
  const cached = cacheGet(key);
  if (cached) return success(res, { ...JSON.parse(cached), cached: true });

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId: t, deletedAt: null },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      city: true,
      area: true,
      customerCode: true,
      customFields: true,
    },
  });
  if (!contact) throw new AppError("Customer not found", 404);

  const [tickets, assets, spareParts, invoices] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId: t, contactId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        paymentTotal: true,
        advanceAmount: true,
        paymentStatus: true,
        nextDueDate: true,
        description: true,
        createdAt: true,
        customFields: true,
      },
    }),
    prisma.customerAsset.findMany({
      where: { tenantId: t, contactId, deletedAt: null },
      take: 30,
      select: {
        id: true,
        name: true,
        serialNo: true,
        machineType: true,
        origin: true,
        nextDueDate: true,
        stampingDate: true,
        amcStartDate: true,
        amcEndDate: true,
        servicePlan: true,
        customFields: true,
      },
    }),
    prisma.sparePartChange.findMany({
      where: { tenantId: t, contactId, deletedAt: null },
      orderBy: { changedAt: "desc" },
      take: 20,
      select: {
        partName: true,
        changeType: true,
        changedAt: true,
        chargeAmount: true,
        underWarranty: true,
        assetId: true,
        notes: true,
      },
    }),
    prisma.invoice.findMany({
      where: { tenantId: t, contactId, deletedAt: null },
      orderBy: { invoiceDate: "desc" },
      take: 12,
      select: {
        invoiceNumber: true,
        status: true,
        invoiceDate: true,
        grandTotal: true,
        amountPaid: true,
      },
    }),
  ]);

  const prompt = `HMS CRM customer history assistant. Action: ${action}
Return JSON: {
  "answer":"2-4 sentence history overview for admin",
  "bullets":["key timeline / service facts"],
  "flags":["machines due / stamping / AMC / unpaid"],
  "visitQuestions":["useful next-visit questions"],
  "caution":"optional"
}
Focus on this customer's service history, machines, spare parts changed, invoices and open issues.
Never invent dues, serials, amounts, or dates. Use provided data only.

${JSON.stringify({ contact, tickets, assets, spareParts, invoices })}
`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  const payload = {
    ...parsed,
    model: geminiModelName(),
    action,
    cached: false,
    disclaimer: "AI summary of CRM history — verify dates and amounts on the customer profile.",
  };
  cacheSet(key, JSON.stringify(payload));
  return success(res, payload);
}

/* ── Polish / translate communication ────────────────────────────────── */

const polishSchema = z.object({
  body: z.object({
    text: z.string().trim().min(1).max(4000),
    action: z.enum(["shorten_title", "polish_whatsapp", "translate_simplify"]).optional(),
    target: z.enum(["en", "ta", "simple"]).optional(),
  }),
});

async function polishText(req: Request, res: Response) {
  const { text, action = "polish_whatsapp", target = "en" } = req.body as {
    text: string;
    action?: string;
    target?: string;
  };
  const key = cacheKey(["polish", action, target, text.slice(0, 180)]);
  const cached = cacheGet(key);
  if (cached) return success(res, { ...JSON.parse(cached), cached: true });

  const prompt = `HMS CRM writing assistant. Action: ${action}. Target: ${target}.
Return JSON: { "result":"...", "bullets":[], "caution":"Send only after human approve" }
Do not invent facts, phones, amounts, or invoice numbers.

Text:
${text}
`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonLoose<{ result?: string; caution?: string; bullets?: string[] }>(raw);
  const payload = {
    result: String(parsed.result ?? "").trim() || text,
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String) : [],
    caution: parsed.caution ? String(parsed.caution) : "Review before sending.",
    model: geminiModelName(),
    action,
    cached: false,
  };
  cacheSet(key, JSON.stringify(payload));
  return success(res, payload);
}

/* ── Customer import column mapping ─────────────────────────────────── */

const IMPORT_FIELDS = [
  "name",
  "phone",
  "mobile",
  "whatsapp",
  "email",
  "doorNo",
  "street",
  "buildingName",
  "area",
  "city",
  "state",
  "pincode",
  "landmark",
  "description",
  "machineName",
  "machineType",
  "serialNo",
  "model",
  "capacity",
  "accuracy",
  "platformSize",
  "origin",
  "servicePlan",
  "stampingDate",
  "nextDueDate",
  "machineNotes",
] as const;

const mapImportSchema = z.object({
  body: z.object({
    headers: z.array(z.string().max(120)).min(1).max(80),
    sampleRows: z.array(z.record(z.unknown())).max(5).optional(),
  }),
});

async function mapCustomerImport(req: Request, res: Response) {
  const { headers, sampleRows = [] } = req.body as {
    headers: string[];
    sampleRows?: Array<Record<string, unknown>>;
  };

  const heuristic: Record<string, string | null> = {};
  for (const h of headers) {
    heuristic[h] = heuristicMapHeader(h);
  }

  let mapping = heuristic;
  let usedAi = false;
  let model: string | null = null;
  let note = "Mapped with column-name rules. Review before importing.";

  try {
    const prompt = `You map spreadsheet columns for HMS Enterprises CRM customer + machine import.
Allowed target fields (use exact keys, or null if no match):
${IMPORT_FIELDS.join(", ")}

Rules:
- name = customer / shop / company name (required)
- phone or mobile = primary phone (required). Prefer mobile for mobiles.
- Machine fields map to one machine on the same row (machineName, machineType, serialNo, model, etc.)
- origin: SOLD_BY_US vs THIRD_PARTY / outside
- servicePlan: AMC vs NON_AMC
- Do not invent columns. Only map from the given headers.
- Return JSON only: { "mapping": { "<header>": "<field|null>" }, "notes": "short tip" }

Headers: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sampleRows.slice(0, 3))}
`;
    const raw = await callGemini(prompt, { maxTokens: 1500 });
    const parsed = parseJsonLoose<{
      mapping?: Record<string, unknown>;
      notes?: string;
    }>(raw);
    if (parsed.mapping && typeof parsed.mapping === "object") {
      const allowed = new Set<string>(IMPORT_FIELDS as unknown as string[]);
      const next: Record<string, string | null> = {};
      for (const h of headers) {
        const v = parsed.mapping[h];
        const field = v == null || v === "" ? null : String(v);
        next[h] = field && allowed.has(field) ? field : heuristic[h] ?? null;
      }
      mapping = next;
      usedAi = true;
      model = geminiModelName();
      note = parsed.notes ? String(parsed.notes) : "AI mapped your columns. Review before importing.";
    }
  } catch {
    // Gemini optional — keep heuristic
    note =
      "AI mapping unavailable — used column-name rules. Rename headers to match the sample template for best results.";
  }

  return success(res, { mapping, usedAi, model, notes: note, fields: IMPORT_FIELDS });
}

function heuristicMapHeader(header: string): string | null {
  const h = header.trim().toLowerCase().replace(/[_\-]+/g, " ");
  if (/^(customer|shop|company|client)?\s*name$|^name$|customer name|shop name/.test(h)) return "name";
  if (/whatsapp|wa\b/.test(h)) return "whatsapp";
  if (/mobile|cell/.test(h)) return "mobile";
  if (/^phone$|phone no|phone number|contact no|contact number/.test(h)) return "phone";
  if (/e-?mail/.test(h)) return "email";
  if (/door|door no|door number|door#/.test(h)) return "doorNo";
  if (/street|road|address line 1|addr1/.test(h)) return "street";
  if (/building|complex|tower/.test(h)) return "buildingName";
  if (/^area$|locality|colony|nagar/.test(h)) return "area";
  if (/^city$|town|district/.test(h)) return "city";
  if (/^state$/.test(h)) return "state";
  if (/pin|postal|zip/.test(h)) return "pincode";
  if (/landmark|near/.test(h)) return "landmark";
  if (/description|remarks|notes$/.test(h) && !/machine/.test(h)) return "description";
  if (/machine name|product name|equipment name|asset name/.test(h)) return "machineName";
  if (/machine type|product type|equipment type|category/.test(h)) return "machineType";
  if (/serial|sr no|srno|s\/n/.test(h)) return "serialNo";
  if (/^model$|model no|model name/.test(h)) return "model";
  if (/capacity|cap\b/.test(h)) return "capacity";
  if (/accuracy|class/.test(h)) return "accuracy";
  if (/platform|platter/.test(h)) return "platformSize";
  if (/origin|sold by|third party|outside/.test(h)) return "origin";
  if (/amc|service plan|service type/.test(h)) return "servicePlan";
  if (/stamping date|stamp date|last stamp/.test(h)) return "stampingDate";
  if (/next due|due date|next stamp/.test(h)) return "nextDueDate";
  if (/machine note|machine remark/.test(h)) return "machineNotes";
  if (/^address$/.test(h)) return "street";
  return null;
}

export const aiRouter = Router();
aiRouter.use(authenticate, requireTenant);

aiRouter.post("/dashboard-ask", requireTenantAdmin, validate(askSchema), askDashboard);

aiRouter.post(
  "/ticket-assist",
  requireRoles("ADMIN", "MANAGER", "SERVICE_DESK", "SERVICE_ENGINEER"),
  validate(ticketAssistSchema),
  ticketAssist,
);

aiRouter.post(
  "/sales-assist",
  requireRoles("ADMIN", "MANAGER", "SALES_EXECUTIVE", "AGENT"),
  validate(salesAssistSchema),
  salesAssist,
);

aiRouter.post(
  "/warehouse-assist",
  requireRoles("ADMIN", "MANAGER", "WAREHOUSE"),
  validate(warehouseAssistSchema),
  warehouseAssist,
);

aiRouter.post(
  "/customer-assist",
  requireRoles("ADMIN", "MANAGER", "SERVICE_DESK", "SERVICE_ENGINEER", "SALES_EXECUTIVE", "AGENT", "WAREHOUSE"),
  validate(customerAssistSchema),
  customerAssist,
);

aiRouter.post(
  "/polish",
  requireRoles(
    "ADMIN",
    "MANAGER",
    "SERVICE_DESK",
    "SERVICE_ENGINEER",
    "SALES_EXECUTIVE",
    "AGENT",
    "WAREHOUSE",
  ),
  validate(polishSchema),
  polishText,
);

aiRouter.post(
  "/map-customer-import",
  requireRoles("ADMIN", "MANAGER", "SERVICE_DESK"),
  validate(mapImportSchema),
  mapCustomerImport,
);
