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
  const now = new Date();
  const from = new Date(now);
  if (range === "week") from.setDate(from.getDate() - 7);
  else if (range === "quarter") from.setMonth(from.getMonth() - 3);
  else if (range === "year") from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 1);

  const span = now.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  const prevTo = from;

  const [
    leads,
    tickets,
    deals,
    stages,
    invoices,
    products,
    stock,
    contactCount,
    accountCount,
    activities,
    recentTickets,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.ticket.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        slaBreached: true,
        assignedToId: true,
        createdAt: true,
        resolvedAt: true,
        paymentTotal: true,
        advanceAmount: true,
        odAmount: true,
      },
    }),
    prisma.deal.findMany({
      where: { tenantId, deletedAt: null },
      select: { amount: true, probability: true, stageId: true, closedAt: true, createdAt: true },
      take: 1000,
    }),
    prisma.pipelineStage.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, code: true, isWon: true },
    }),
    prisma.invoice.findMany({
      where: { tenantId, deletedAt: null },
      select: { grandTotal: true, status: true, invoiceDate: true },
    }),
    prisma.product.count({ where: { tenantId, deletedAt: null } }),
    prisma.stockLevel.findMany({ where: { tenantId }, select: { quantityOnHand: true } }),
    prisma.contact.count({ where: { tenantId, deletedAt: null } }),
    prisma.account.count({ where: { tenantId, deletedAt: null } }),
    prisma.activity.count({
      where: { tenantId, deletedAt: null, status: { in: ["PENDING", "OVERDUE"] } },
    }),
    prisma.ticket.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
      },
      orderBy: [{ slaBreached: "desc" }, { slaDueAt: "asc" }],
      take: 10,
      select: {
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        slaBreached: true,
        slaDueAt: true,
      },
    }),
  ]);

  const openStatuses = new Set(["OPEN", "IN_PROGRESS", "PENDING"]);
  const openTickets = tickets.filter((t) => openStatuses.has(t.status));
  const breached = openTickets.filter((t) => t.slaBreached).length;
  const unassigned = openTickets.filter((t) => !t.assignedToId).length;
  const balanceOutstanding = openTickets.reduce((s, t) => {
    const pay = Number(t.paymentTotal ?? 0);
    const adv = Number(t.advanceAmount ?? 0);
    return s + Math.max(0, pay - adv);
  }, 0);

  const ticketsInRange = tickets.filter((t) => t.createdAt >= from).length;
  const ticketsPrev = tickets.filter((t) => t.createdAt >= prevFrom && t.createdAt < prevTo).length;
  const breachedInRange = tickets.filter((t) => t.slaBreached && t.createdAt >= from).length;
  const breachedPrev = tickets.filter(
    (t) => t.slaBreached && t.createdAt >= prevFrom && t.createdAt < prevTo,
  ).length;

  const wonIds = new Set(stages.filter((s) => s.isWon || /WON/i.test(s.code)).map((s) => s.id));
  const wonDeals = deals.filter((d) => d.stageId && wonIds.has(d.stageId));
  const openDeals = deals.filter((d) => !d.closedAt && !(d.stageId && wonIds.has(d.stageId)));
  const wonRevenue = wonDeals.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const openPipeline = openDeals.reduce(
    (s, d) => s + Number(d.amount ?? 0) * (Number(d.probability ?? 20) / 100),
    0,
  );

  const convertedLeads = leads.filter((l) => l.status === "CONVERTED").length;
  const leadsInRange = leads.filter((l) => l.createdAt >= from).length;
  const leadsPrev = leads.filter((l) => l.createdAt >= prevFrom && l.createdAt < prevTo).length;

  const invoiceRevenue = invoices.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0);
  const stockUnits = stock.reduce((s, r) => s + Number(r.quantityOnHand ?? 0), 0);

  const ticketMonthly: Array<{ month: string; created: number; resolved: number; breached: number }> =
    [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const label = d.toLocaleString("en-IN", { month: "short" });
    const inMonth = tickets.filter((t) => t.createdAt >= d && t.createdAt < next);
    ticketMonthly.push({
      month: label,
      created: inMonth.length,
      resolved: tickets.filter(
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
      leads: leads.length,
      leadsInRange,
      leadsPrev,
      leadGrowthPct: pct(leadsInRange, leadsPrev),
      convertedLeads,
      conversionRatePct: leads.length
        ? Math.round((convertedLeads / leads.length) * 1000) / 10
        : 0,
      openTickets: openTickets.length,
      ticketsInRange,
      ticketsPrev,
      ticketGrowthPct: pct(ticketsInRange, ticketsPrev),
      slaBreached: breached,
      breachedInRange,
      breachedPrev,
      breachGrowthPct: pct(breachedInRange, breachedPrev),
      unassignedTickets: unassigned,
      balanceOutstanding,
      wonRevenue,
      openPipeline,
      openDeals: openDeals.length,
      proformaCount: invoices.length,
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

  let userQ = question;
  if (mode === "overview") {
    userQ =
      "Summarize the Overview tab in exactly 5 short bullets covering service health, sales, leads, stock/proforma, and what needs attention first.";
  } else if (mode === "spikes") {
    userQ =
      "Explain spikes using the spikes object: ticket volume growth, SLA breaches, and outstanding balance. Say what rose/fell vs previous period and what to do next.";
  }

  const prompt = `You are HMS Enterprises CRM assistant for company admins.
Answer ONLY using the JSON snapshot (includes /analytics-style KPIs + spikes + ticketMonthly).
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
${JSON.stringify(snapshot)}`;

  const raw = await callGemini(prompt);
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
  const key = cacheKey(["cust", t, contactId, action]);
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
      customFields: true,
    },
  });
  if (!contact) throw new AppError("Customer not found", 404);

  const [tickets, assets] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId: t, contactId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        ticketNo: true,
        subject: true,
        status: true,
        priority: true,
        paymentTotal: true,
        advanceAmount: true,
        nextDueDate: true,
        createdAt: true,
      },
    }),
    prisma.customerAsset.findMany({
      where: { tenantId: t, contactId, deletedAt: null },
      take: 20,
      select: {
        id: true,
        name: true,
        serialNo: true,
        nextDueDate: true,
        stampingDate: true,
        amcEndDate: true,
        customFields: true,
      },
    }),
  ]);

  const prompt = `HMS CRM customer assistant. Action: ${action}
Return JSON: { "answer":"...", "bullets":["..."], "flags":["machines due / stamping"], "visitQuestions":["..."], "caution":"optional" }
Never invent dues. Use provided data only.

${JSON.stringify({ contact, tickets, assets })}
`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonLoose<Record<string, unknown>>(raw);
  const payload = {
    ...parsed,
    model: geminiModelName(),
    action,
    cached: false,
    disclaimer: "AI summary — verify dates on the customer profile.",
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
