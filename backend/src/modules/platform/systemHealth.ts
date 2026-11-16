import { prisma } from "../../config/database.js";
import { isRedisAvailable, redis } from "../../config/redis.js";

/**
 * Real platform health for the super admin — each dependency is actually checked (the old panel
 * only showed "Live" because the page itself loaded).
 */
type Check = { key: string; label: string; status: "ok" | "warn" | "down"; detail: string; ms?: number };

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value };
  } catch (e) {
    return { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function systemHealth() {
  const checks: Check[] = [];

  const db = await timed(() => prisma.$queryRawUnsafe("SELECT 1"));
  checks.push({
    key: "database",
    label: "Database (MySQL)",
    status: db.error ? "down" : db.ms > 1500 ? "warn" : "ok",
    detail: db.error ? "Not reachable" : db.ms > 1500 ? "Reachable but slow" : "Reachable",
    ms: db.ms,
  });

  checks.push({
    key: "cache",
    label: "Cache (Redis)",
    status: !redis ? "warn" : isRedisAvailable() ? "ok" : "warn",
    detail: !redis ? "Not configured — in-memory cache only" : isRedisAvailable() ? "Connected" : "Configured but not connected — falling back to memory",
  });

  const attUrl = process.env.ATTENDANCE_API_URL?.trim();
  if (attUrl) {
    const att = await timed(() => fetchWithTimeout(`${attUrl.replace(/\/$/, "")}/health`));
    const ok = !att.error && (att.value as Response | undefined)?.ok;
    checks.push({
      key: "attendance",
      label: "Attendance server",
      status: ok ? (att.ms > 5000 ? "warn" : "ok") : "down",
      detail: ok ? (att.ms > 5000 ? "Answered slowly (was probably asleep)" : "Reachable") : "Not reachable — staff can't open Attendance",
      ms: att.ms,
    });
  } else {
    checks.push({ key: "attendance", label: "Attendance server", status: "warn", detail: "ATTENDANCE_API_URL not set" });
  }

  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    const ai = await timed(() =>
      fetchWithTimeout("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${orKey}` } }),
    );
    const res = ai.value as Response | undefined;
    checks.push({
      key: "ai",
      label: "AI (OpenRouter)",
      status: res?.ok ? "ok" : "down",
      detail: res?.ok ? `Key valid · model ${process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct"}` : res ? `Key rejected (${res.status})` : "Not reachable",
      ms: ai.ms,
    });
  } else {
    const other = process.env.GROQ_API_KEY?.trim() ? "Groq" : process.env.GEMINI_API_KEY?.trim() ? "Gemini" : null;
    checks.push({
      key: "ai",
      label: "AI",
      status: other ? "warn" : "down",
      detail: other ? `Using ${other} (OpenRouter key not set)` : "No AI key — Ask HMS shows plain figures only",
    });
  }

  const files = await timed(() => prisma.$queryRawUnsafe("SELECT COUNT(*) AS n FROM stored_files"));
  checks.push({
    key: "uploads",
    label: "Uploaded files",
    status: files.error ? "warn" : "ok",
    detail: files.error
      ? "Saved on the server disk — wiped on every deploy (run create-stored-files script)"
      : `Kept in the database (${Number((files.value as Array<{ n: bigint }>)[0]?.n ?? 0)} files)`,
  });

  checks.push({
    key: "whatsapp",
    label: "WhatsApp (Meta Cloud API)",
    status: process.env.WHATSAPP_TOKEN?.trim() ? "ok" : "warn",
    detail: process.env.WHATSAPP_TOKEN?.trim() ? "Platform token configured" : "No platform token — only tenants with their own WhatsApp setup can send",
  });

  return {
    checkedAt: new Date().toISOString(),
    overall: checks.some((c) => c.status === "down") ? "down" : checks.some((c) => c.status === "warn") ? "warn" : "ok",
    checks,
    server: {
      uptimeMinutes: Math.round(process.uptime() / 60),
      node: process.version,
      timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      environment: process.env.NODE_ENV ?? "development",
    },
  };
}
