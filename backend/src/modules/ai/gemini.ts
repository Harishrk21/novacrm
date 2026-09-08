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

export async function callGemini(
  prompt: string,
  opts?: { json?: boolean; maxTokens?: number },
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      "Gemini is not configured. Add GEMINI_API_KEY to the backend .env and restart the API.",
      503,
    );
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const wantJson = opts?.json !== false;

  let lastErr = "Gemini request failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
  return process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
}
