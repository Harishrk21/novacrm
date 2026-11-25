/**
 * AI help for register imports: machines and spares written loosely by HMS staff
 * ("HMS J.STAR", "WEB 3T", "CCM LADA", "BATTERY + POWER CARD") → the Product ID / Spare ID they mean.
 *
 * The AI only picks from our own list and must answer with an ID from it — anything else is dropped.
 * Results are suggestions: the import screen marks them "AI" and staff can change them before saving.
 */
import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors.js";
import { callGemini, parseJsonLoose } from "../ai/gemini.js";
import { weightsOf } from "./matcher.js";

export type AiKind = "PRODUCT" | "SPARE";
export type AiMatch = { text: string; code: string | null; name: string | null; sure: "high" | "medium" | "low" | null };

const cf = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function options(t: string, kind: AiKind) {
  if (kind === "PRODUCT") {
    const p = await prisma.product.findMany({
      where: { tenantId: t, deletedAt: null, isActive: true },
      select: { sku: true, name: true, attributes: true },
    });
    return p
      .filter((x) => /^[A-Z]{3}-\d{3,}$/.test(x.sku))
      .map((x) => ({ code: x.sku, name: x.name, hint: String(cf(x.attributes).machineType ?? "") }));
  }
  const s = await prisma.sparePartItem.findMany({
    where: { tenantId: t, deletedAt: null, isActive: true, partCode: { startsWith: "SP-" } },
    select: { partCode: true, name: true, customFields: true },
  });
  return s.map((x) => ({ code: x.partCode!, name: x.name, hint: ((cf(x.customFields).writtenAs as string[]) ?? []).join(" / ") }));
}

const GUIDE: Record<AiKind, string> = {
  PRODUCT: `Shorthand HMS staff use: 2T / 3T / J.STAR / JUNIOR STAR = HMS keypad billing machines; "WEB" = WEP; CCM / CASH COUNTING = LADA note counting machine; "HMS 30 KG" alone is a 30 kg HMS counter scale (pick the most common: Eco Metal Pole/Rear only if written); PLTFRM = platform; CHI = chequered plate; RS232 / BLUETOOTH are variants. Brands not in the list (POINT, SHARP, ACCURATE, CAS, GLOBAL, ESSAE…) → null.`,
  SPARE: `Shorthand: ADOPTOR = adaptor; LOADCELL = load cell; KEPAD = keypad; POWER CARD without a type = Power Card (Normal); BATTERY alone = 6V Battery; MOTHER BOARD / BOARD alone for a weighing scale = Mini On Board only if clearly that, else null. Ignore words like SERVICE, CHANGED, CHARGES.`,
};

/** Up to 60 texts per call; returns one answer per text, in order. */
export async function aiMatch(t: string, kind: AiKind, texts: string[]): Promise<AiMatch[]> {
  const list = await options(t, kind);
  if (!list.length) throw new AppError(kind === "PRODUCT" ? "No products with Product IDs yet" : "No spares with Spare IDs yet", 422);
  const valid = new Map(list.map((o) => [o.code, o]));
  const uniq = [...new Set(texts.map((x) => x.trim()).filter(Boolean))].slice(0, 60);
  if (!uniq.length) return [];
  const catalogText = list.map((o) => `${o.code} | ${o.name}${o.hint ? ` | ${o.hint}` : ""}`).join("\n");
  const prompt = `You match items written by hand in an Indian weighing-scale / billing-machine dealer's registers (HMS Enterprises) to their ${kind === "PRODUCT" ? "Product ID" : "Spare ID"} list.
${GUIDE[kind]}
Rules: answer ONLY with an ID from the list below, or null when the text does not clearly mean one item. Never invent IDs. "sure": high = clearly that item, medium = most likely, low = a guess.

LIST (ID | name | type / how it is written):
${catalogText}

WRITTEN TEXTS:
${uniq.map((x, i) => `${i}: ${x}`).join("\n")}

Return JSON only: {"matches":[{"i":0,"id":"HMS-025","sure":"high"},{"i":1,"id":null,"sure":null}]}`;

  let raw: { matches?: Array<{ i: number; id: string | null; sure?: string | null }> } = {};
  let lastErr: unknown = null;
  // A thin answer (almost every item null) is usually a hiccup of the AI provider — ask once more and
  // keep whichever answer matched more
  const ids = (r: typeof raw) => (r.matches ?? []).filter((m) => m?.id).length;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const got = parseJsonLoose<typeof raw>(await callGemini(prompt, { maxTokens: 1800, timeoutMs: 60_000, retries: 1 }));
      lastErr = null;
      if (ids(got) >= ids(raw)) raw = got;
      if (ids(raw) >= Math.max(1, Math.ceil(uniq.length * 0.2)) || uniq.length < 3) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr && !raw.matches) {
    throw new AppError(lastErr instanceof Error ? `AI is unavailable right now — ${lastErr.message}` : "AI is unavailable right now", 503);
  }
  const byIndex = new Map((raw.matches ?? []).map((m) => [Number(m.i), m]));
  return uniq.map((text, i) => {
    const m = byIndex.get(i);
    const code = m?.id ? String(m.id).toUpperCase().trim() : null;
    const hit = code ? valid.get(code) : undefined;
    let sure = (["high", "medium", "low"] as const).find((s) => s === m?.sure) ?? null;
    if (hit) sure = checkAnswer(text, hit, list) ?? sure ?? "medium";
    return { text, code: hit ? hit.code : null, name: hit?.name ?? null, sure: hit ? sure : null };
  });
}

const FILLER = new Set(["HMS", "M", "C", "MC", "MACHINE", "SCALE", "SCALES", "WITH", "NOS", "NO", "KG", "G", "GM", "MG", "TON", "MM", "ADOPTOR", "ADAPTOR", "ADOPOTR", "SERVICE", "NEW", "OLD", "MODEL", "WEB", "WERB", "WEP", "CCM", "LADA"]);
const words = (s: string) =>
  new Set(
    s
      .toUpperCase()
      .replace(/(\d)([A-Z])/g, "$1 $2")
      .split(/[^A-Z0-9.]+/)
      .filter((w) => w && !/^\d+(\.\d+)?$/.test(w) && !FILLER.has(w)),
  );

/**
 * Don't trust a guess: when the written text only gives a brand + capacity ("HMS 50 KG") and other items
 * share that capacity, an answer whose name shares no telling word with the text is only a guess ("low").
 * A capacity in the text that the chosen item does not have is wrong outright (null → dropped).
 */
function checkAnswer(text: string, hit: { code: string; name: string }, list: Array<{ code: string; name: string }>) {
  const tw = weightsOf(text);
  const hw = weightsOf(hit.name);
  if (tw.size && ![...tw].every((w) => hw.has(w))) return "low" as const;
  const telling = [...words(text)].filter((w) => words(hit.name).has(w));
  const sameCapacity = list.filter((o) => o.code !== hit.code && tw.size > 0 && [...tw].every((w) => weightsOf(o.name).has(w)));
  const sameBrand = list.filter((o) => o.code !== hit.code && o.code.slice(0, 3) === hit.code.slice(0, 3));
  if (!telling.length && (sameCapacity.length > 0 || (!tw.size && sameBrand.length > 0))) return "low" as const;
  return null;
}
