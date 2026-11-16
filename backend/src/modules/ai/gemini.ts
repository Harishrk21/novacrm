import { AppError } from "../../common/errors.js";

type CacheEntry = { expires: number; value: string };
const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 3 * 60 * 1000;

export function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key: string, value: string, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
  }
}

export function cacheKey(parts: Array<string | number | undefined | null>) {
  return parts.map((p) => String(p ?? "").trim().toLowerCase()).join("|");
}

/**
 * Strip contact details before text leaves our servers: customer emails, Indian mobile / landline
 * numbers and GSTINs are replaced with placeholders. Drafts never need the real values.
 */
export function redactForAi(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, "[gstin]")
    .replace(/(?<![\w-])(?:\+?91[\s-]?)?(?:\d[\s-]?){9,11}\d(?![\w-])/g, "[phone]");
}

/**
 * Groq (OpenAI-compatible) — HMS's AI provider. Used whenever GROQ_API_KEY is set; Gemini stays
 * as the fallback provider. Same redaction applies before anything leaves our servers.
 */
type ChatProvider = { name: string; url: string; apiKey: string; model: string; headers?: Record<string, string> };

/** AI providers in order of preference — OpenRouter, then Groq. Gemini is the last fallback. */
function chatProviders(): ChatProvider[] {
  const out: ChatProvider[] = [];
  const or = process.env.OPENROUTER_API_KEY?.trim();
  if (or) {
    out.push({
      name: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: or,
      model: process.env.OPENROUTER_MODEL?.trim() || "meta-llama/llama-3.3-70b-instruct",
      headers: { "HTTP-Referer": "https://novacrms.vercel.app", "X-Title": "HMS Enterprises CRM" },
    });
  }
  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) {
    out.push({
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: groq,
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
    });
  }
  return out;
}

async function callChatProvider(
  provider: ChatProvider,
  prompt: string,
  opts?: { json?: boolean; maxTokens?: number; timeoutMs?: number; retries?: number },
): Promise<string> {
  const model = provider.model;
  const wantJson = opts?.json !== false;
  const maxAttempts = Math.max(1, opts?.retries ?? 2);
  const timeoutMs = opts?.timeoutMs ?? 22_000;
  let lastErr = "AI request failed";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
          ...(provider.headers ?? {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: opts?.maxTokens ?? 1024,
          messages: [
            ...(wantJson
              ? [{ role: "system", content: "Reply with one valid JSON object only — no prose, no code fences." }]
              : []),
            { role: "user", content: redactForAi(prompt) },
          ],
          ...(wantJson ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
      } | null;
      if (res.status === 429 || res.status >= 500) {
        lastErr = json?.error?.message || `AI temporarily unavailable (${res.status})`;
        continue;
      }
      if (!res.ok) throw new AppError(json?.error?.message || "AI request failed", 502);
      const text = json?.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new AppError("AI returned an empty answer", 502);
      return text;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      lastErr = aborted ? "AI timed out — try again or use a quick suggestion chip" : err instanceof Error ? err.message : lastErr;
      if (!aborted && attempt >= maxAttempts - 1) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AppError(lastErr, 503);
}

export async function callGemini(
  prompt: string,
  opts?: { json?: boolean; maxTokens?: number; timeoutMs?: number; retries?: number },
): Promise<string> {
  // OpenRouter → Groq → Gemini: a bad key or outage on one moves on to the next
  const providers = chatProviders();
  let lastProviderErr: unknown = null;
  for (const provider of providers) {
    try {
      return await callChatProvider(provider, prompt, opts);
    } catch (err) {
      lastProviderErr = err;
      console.warn(`[ai] ${provider.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (lastProviderErr && !process.env.GEMINI_API_KEY?.trim()) throw lastProviderErr;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      "AI is not configured. Add GROQ_API_KEY (or GEMINI_API_KEY) to the backend .env and restart the API.",
      503,
    );
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const wantJson = opts?.json !== false;
  const maxAttempts = Math.max(1, opts?.retries ?? 2);
  const timeoutMs = opts?.timeoutMs ?? 22_000;

  let lastErr = "Gemini request failed";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: redactForAi(prompt) }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: opts?.maxTokens ?? 1024,
            ...(wantJson ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });

      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      } | null;

      if (res.status === 503 || res.status === 429) {
        lastErr = json?.error?.message || `Gemini temporarily unavailable (${res.status})`;
        continue;
      }

      if (!res.ok) {
        throw new AppError(json?.error?.message || "Gemini request failed", 502);
      }

      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) throw new AppError("Gemini returned an empty answer", 502);
      return text;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      lastErr = aborted
        ? "Gemini timed out — try again or use a quick suggestion chip"
        : err instanceof Error
          ? err.message
          : lastErr;
      if (!aborted && attempt >= maxAttempts - 1) break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError(lastErr, 503);
}

export function parseJsonLoose<T extends Record<string, unknown>>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    return { answer: raw } as unknown as T;
  }
}

export function geminiModelName() {
  const first = chatProviders()[0];
  return first ? first.model : process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
}
