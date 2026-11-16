import type { Request, Response } from "express";
import { z } from "zod";
import { success } from "../../common/utils/response.js";
import { AppError } from "../../common/errors.js";
import { reportCatalog, runReport, type Column, type ReportResult } from "../reports/reports.service.js";
import { callGemini, geminiModelName, parseJsonLoose } from "./gemini.js";

/**
 * "Ask your data" — the admin types any question ("top performer who closed more than 2 sales this
 * month", "unpaid jobs older than 30 days by engineer", "which customers bought weighing scales").
 *
 * Safety by design: the AI never writes SQL and never sees raw tables. It only picks one of the
 * permission-checked Reports + dates + a small post-processing plan (filter / group / count / sum /
 * sort / limit). The server runs the report and applies the plan itself, so every number in the
 * answer is computed, not invented.
 */

type Row = Record<string, string | number | null>;
type Op = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "not_contains";
type Plan = {
  report: string | null;
  from?: string;
  to?: string;
  where?: Array<{ column: string; op: Op; value: string | number }>;
  groupBy?: string | null;
  metrics?: Array<{ op: "count" | "sum" | "avg" | "min" | "max"; column?: string; as: string }>;
  having?: Array<{ column: string; op: Op; value: string | number }>;
  sort?: { column: string; dir: "asc" | "desc" } | null;
  limit?: number | null;
  title?: string;
  reason?: string;
};

/** Column lists per report — learnt once by running each report over an empty window. */
let columnCache: Map<string, Column[]> | null = null;
async function reportColumns(t: string, keys: string[]) {
  if (columnCache && keys.every((k) => columnCache!.has(k))) return columnCache;
  const map = columnCache ?? new Map<string, Column[]>();
  const day = new Date(2000, 0, 1);
  await Promise.all(
    keys
      .filter((k) => !map.has(k))
      .map(async (k) => {
        try {
          const r = await runReport(t, "ADMIN", k, { from: day, to: day });
          map.set(k, r.columns);
        } catch {
          /* report not available */
        }
      }),
  );
  columnCache = map;
  return map;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (v: unknown, end = false) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (end) d.setHours(23, 59, 59, 999);
  return d;
};

function compare(a: unknown, op: Op, b: unknown) {
  const blank = a === null || a === undefined || a === "";
  if (blank && op !== "=" && op !== "!=" && op !== "not_contains") return false;
  const an = Number(a);
  const bn = Number(b);
  const numeric = a !== null && a !== "" && !Number.isNaN(an) && b !== "" && !Number.isNaN(bn);
  const as = String(a ?? "").toLowerCase();
  const bs = String(b ?? "").toLowerCase();
  switch (op) {
    case "=":
      return numeric ? an === bn : as === bs;
    case "!=":
      return numeric ? an !== bn : as !== bs;
    case ">":
      return numeric ? an > bn : as > bs;
    case ">=":
      return numeric ? an >= bn : as >= bs;
    case "<":
      return numeric ? an < bn : as < bs;
    case "<=":
      return numeric ? an <= bn : as <= bs;
    case "contains":
      return as.includes(bs);
    case "not_contains":
      return !as.includes(bs);
    default:
      return true;
  }
}

/** Apply the plan to report rows — deterministic, no AI involved. */
function applyPlan(result: ReportResult, plan: Plan): { columns: Column[]; rows: Row[] } {
  const colKeys = new Set(result.columns.map((c) => c.key));
  const byLabel = new Map(result.columns.map((c) => [c.label.toLowerCase(), c.key]));
  const resolve = (c: string | undefined | null) =>
    c && colKeys.has(c) ? c : c ? byLabel.get(c.toLowerCase()) ?? null : null;

  let rows: Row[] = result.rows as Row[];
  for (const w of plan.where ?? []) {
    const key = resolve(w.column);
    if (key) rows = rows.filter((r) => compare(r[key], w.op, w.value));
  }

  let columns = result.columns;
  const group = resolve(plan.groupBy ?? null);
  if (group) {
    const metrics = (plan.metrics?.length ? plan.metrics : [{ op: "count" as const, as: "count" }]).map((m) => ({
      ...m,
      column: resolve(m.column ?? null),
      as: (m.as || `${m.op}${m.column ? `_${m.column}` : ""}`).replace(/[^\w]/g, "_"),
    }));
    // "Chennai" and "chennai " are the same city — group on a normalised key, show the usual spelling
    const groups = new Map<string, Row[]>();
    const spellings = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const raw = String(r[group] ?? "").trim() || "—";
      const k = raw.toLowerCase().replace(/\s+/g, " ");
      groups.set(k, [...(groups.get(k) ?? []), r]);
      const sp = spellings.get(k) ?? new Map<string, number>();
      sp.set(raw, (sp.get(raw) ?? 0) + 1);
      spellings.set(k, sp);
    }
    const display = (k: string) =>
      [...(spellings.get(k) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || (b[0] > a[0] ? 1 : -1))[0]?.[0] ?? k;
    const groupCol = result.columns.find((c) => c.key === group)!;
    rows = [...groups.entries()].map(([k, list]) => {
      const out: Row = { [group]: display(k) };
      for (const m of metrics) {
        const vals = m.column ? list.map((r) => Number(r[m.column!] ?? 0) || 0) : [];
        out[m.as] =
          m.op === "count"
            ? list.length
            : m.op === "sum"
              ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100
              : m.op === "avg"
                ? vals.length
                  ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
                  : 0
                : m.op === "min"
                  ? Math.min(...vals)
                  : Math.max(...vals);
      }
      return out;
    });
    columns = [
      { key: group, label: groupCol.label, type: groupCol.type },
      ...metrics.map((m) => {
        const src = result.columns.find((c) => c.key === m.column);
        const label =
          m.op === "count"
            ? "Count"
            : `${m.op === "sum" ? "Total" : m.op === "avg" ? "Average" : m.op === "min" ? "Lowest" : "Highest"} ${src?.label.toLowerCase() ?? ""}`.trim();
        return { key: m.as, label, type: m.op === "count" ? ("number" as const) : src?.type ?? ("number" as const) };
      }),
    ];
    const outKeys = new Set(columns.map((c) => c.key));
    for (const h of plan.having ?? []) {
      const key = outKeys.has(h.column) ? h.column : columns.find((c) => c.label.toLowerCase() === h.column.toLowerCase())?.key;
      if (key) rows = rows.filter((r) => compare(r[key], h.op, h.value));
    }
  }

  if (plan.sort?.column) {
    const key = columns.find((c) => c.key === plan.sort!.column || c.label.toLowerCase() === plan.sort!.column.toLowerCase())?.key;
    if (key) {
      const dir = plan.sort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const an = Number(a[key]);
        const bn = Number(b[key]);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
        return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * dir;
      });
    }
  }
  if (plan.limit && plan.limit > 0) rows = rows.slice(0, Math.min(plan.limit, 500));
  return { columns, rows };
}

const askSchema = z.object({
  body: z.object({ question: z.string().trim().min(3).max(500) }),
  query: z.any(),
  params: z.any(),
});
export const dataQuerySchema = askSchema;

export async function askData(req: Request, res: Response) {
  const t = req.auth!.tenantId!;
  const role = String(req.auth!.role ?? "");
  const question = String((req.body as { question: string }).question).trim();

  const catalog = await reportCatalog(t, role);
  if (!catalog.length) throw new AppError("No reports available for your role", 403);
  const cols = await reportColumns(t, catalog.map((c) => c.key));
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const plus = (d: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d));

  const reportsText = catalog
    .map((r) => {
      const c = (cols.get(r.key) ?? []).map((x) => `${x.key}${x.type && x.type !== "text" ? `:${x.type}` : ""} (${x.label})`).join(", ");
      return `- ${r.key}: ${r.title}. ${r.description} ${r.dateFilter ? "[uses from/to dates]" : "[live list, dates ignored]"}\n  columns: ${c}`;
    })
    .join("\n");

  const prompt = `You turn a business owner's question into a query plan over ready-made reports of HMS Enterprises (weighing scales & billing machines: sales, service jobs, stamping, AMC, stock).
Today is ${ymd(now)} (India). "This month" = ${ymd(new Date(now.getFullYear(), now.getMonth(), 1))}..${ymd(now)}. "Last month" = previous calendar month. "This financial year" = ${fyStart}-04-01..${ymd(now)}. "This quarter" = Indian FY quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar). "Next 30 / 60 / 90 days" = ${ymd(now)}..${plus(30)} / ..${plus(60)} / ..${plus(90)}; "last 30 days" = ${plus(-30)}..${ymd(now)}. For "next N days" always set to = today + N. If no period is given, use this month for dated reports.

Reports:
${reportsText}

Rules:
- Pick exactly one report key that can answer the question, or "report": null if none can.
- "where" filters rows BEFORE grouping (column keys from that report; ops = != > >= < <= contains not_contains). Status/text values compare case-insensitively.
- To rank people/customers/products use groupBy on that column with metrics (count / sum / avg / min / max of a numeric column); "having" filters groups by a metric alias (e.g. more than 2 → {"column":"sales","op":">","value":2}).
- "Completed / closed / converted leads" = rows of the "sales" report. "Top performer" = sort desc by the main metric.
- Use sort + limit for top-N. Keep plans minimal.
Return JSON only:
{"report":"sales","from":"YYYY-MM-DD","to":"YYYY-MM-DD","where":[],"groupBy":"salesperson","metrics":[{"op":"count","as":"sales"},{"op":"sum","column":"amount","as":"amount"}],"having":[{"column":"sales","op":">","value":2}],"sort":{"column":"sales","dir":"desc"},"limit":null,"title":"short title for the table","reason":"if report is null, one line why"}

Question: ${question}`;

  let plan: Plan;
  try {
    plan = parseJsonLoose<Plan>(await callGemini(prompt, { maxTokens: 500, timeoutMs: 20_000, retries: 1 }));
  } catch (e) {
    throw new AppError(e instanceof Error ? `AI is unavailable right now — ${e.message}` : "AI is unavailable right now", 503);
  }
  const def = catalog.find((c) => c.key === plan.report);
  if (!plan.report || !def) {
    return success(res, {
      kind: "none",
      answer: plan.reason || "That isn't something the reports can answer yet. Try asking about sales, service jobs, collections, engineers, stock, machines due, customers or history.",
      model: geminiModelName(),
    });
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const from = parseDay(plan.from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to: Date = parseDay(plan.to, true) ?? today;
  // AI sometimes slips the year on future windows ("next 60 days" → 2026-01-12 instead of 2027) — roll forward
  for (let i = 0; i < 2 && to < from; i++) to.setFullYear(to.getFullYear() + 1);
  const report = await runReport(t, role, def.key, { from, to });
  const { columns, rows } = applyPlan(report, plan);

  // One-line answer written from the computed rows (falls back to a plain sentence)
  const period = def.dateFilter ? ` (${ymd(from)} to ${ymd(to)})` : "";
  let answer = rows.length
    ? `${rows.length} result${rows.length === 1 ? "" : "s"}${period}.`
    : `No results${period}.`;
  if (rows.length) {
    try {
      const sample = JSON.stringify({
        matching: rows.length,
        outOf: report.rows.length,
        columns: columns.map((c) => c.label),
        rows: rows.slice(0, 15),
      });
      const said = parseJsonLoose<{ answer?: string }>(
        await callGemini(
          `Answer the owner's question in ONE or TWO short sentences using only this computed table ("matching" rows out of "outOf" in the whole report — never say "all" unless they are equal). Amounts are Indian rupees (₹1,25,000 style). Name the people / customers and give their key numbers (counts, amounts) — lead with the top one or two and the total. Question: ${question}\nPeriod: ${period || "current"}\nTable: ${sample}\nReturn JSON {"answer":"..."}`,
          { maxTokens: 160, timeoutMs: 12_000, retries: 1 },
        ),
      );
      if (said.answer?.trim()) answer = said.answer.trim();
    } catch {
      /* keep the plain sentence */
    }
  }

  return success(res, {
    kind: "table",
    answer,
    title: plan.title || def.title,
    report: { key: def.key, title: def.title, from: def.dateFilter ? ymd(from) : null, to: def.dateFilter ? ymd(to) : null },
    plan: {
      where: plan.where ?? [],
      groupBy: plan.groupBy ?? null,
      having: plan.having ?? [],
      sort: plan.sort ?? null,
      limit: plan.limit ?? null,
    },
    columns,
    rows: rows.slice(0, 500),
    totalRows: rows.length,
    model: geminiModelName(),
  });
}
