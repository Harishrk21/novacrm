/**
 * Match a machine written by hand in an HMS register ("PHOENIX | 150KG", "HMS | 2T", "WEP | SCANNER 2D")
 * to one product of the catalog.
 *
 * Rules
 *  - Brand decides the shortlist (with aliases: NUKKAD SHOPS → Nukkad, BILLING → HMS …). An unknown
 *    brand never borrows another brand's product.
 *  - Every capacity / size written in the row (150, 1200*1200, 0.1 …) must exist in the product.
 *  - Then the product whose words overlap most wins. Close ties are flagged so staff can check them.
 */

export type CatalogProduct = { id: string; name: string; brand: string; model: string; family: string; kind: string; code?: string };
export type ProductMatch = {
  productId: string | null;
  productName: string | null;
  /** The product's Product ID (HMS-012) */
  productCode?: string | null;
  /** new = not on the product list — the import adds it as a new product with its own Product ID */
  confidence: "exact" | "likely" | "check" | "none" | "new";
  brand: string;
  alternatives: Array<{ id: string; name: string }>;
};

const BRAND_ALIAS: Record<string, string> = {
  "NUKKAD SHOPS": "NUKKAD",
  "NUKKAD SHOP": "NUKKAD",
  BILLING: "HMS",
  "HMS/REEGLE": "HMS",
  "HMS REEGLE": "HMS",
  ANCHORE: "ANCHOR",
  "I MIN": "IMIN",
  "WEIGHING MASTER": "WEIGHING MASTER",
  STONE: "WEIGHING MASTER",
  ASK: "LADA", // ASK supplies HMS's LADA note counters; 2020 sheets write the supplier as brand
  "T V S": "TVS",
};

const UNIT_WORDS = new Set(["KG", "KGS", "G", "GM", "GMS", "MG", "TON", "TONS", "MM", "INCH", "CM"]);
const FILLER = new Set(["WITH", "AND", "THE", "OF", "NOS", "NO", "MACHINE", "SCALE", "SCALES", "WEIGHING", "&", "+", "-", "NILL", "NIL"]);

export function normBrand(raw: string) {
  const b = raw.toUpperCase().replace(/\s+/g, " ").trim();
  return BRAND_ALIAS[b] ?? b;
}

/** "1200X1200MS" → ["1200*1200","MS"]; "150KG" → ["150","KG"]; "6KG/100MG" → ["6","KG","100","MG"] */
export function tokens(raw: string): string[] {
  let s = ` ${raw.toUpperCase()} `;
  // dual-range scales "15/30KG" are sold as the bigger capacity
  s = s.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(KGS?|GMS?|G|TONS?)\b/g, "$2$3");
  s = s.replace(/(\d)\s*[X×*]\s*(\d)/g, "$1*$2");
  // model codes: NBY-20U → NBY 20 U, PAS-150 → PAS 150 (sizes like 1200*1200 stay whole)
  s = s.replace(/([A-Z])-?(\d)/g, "$1 $2").replace(/(\d)-?([A-WYZ])(?![A-Z]*\*)/g, "$1 $2");
  s = s.replace(/BLUTOOTH/g, "BLUETOOTH").replace(/PLTFRM|PLATFORM/g, "PLATFORM").replace(/LOADCELL/g, "LOAD CELL");
  s = s.replace(/(\d)(KGS?|GMS?|MG|G|TONS?|MM|INCH|CM|MP|TB|GB|CH|T)\b/g, "$1 $2");
  s = s.replace(/\bGMS?\b/g, "G").replace(/\bKGS\b/g, "KG").replace(/\bTONS\b/g, "TON");
  s = s.replace(/(\d+\*\d+)\s*(MS|SS)\b/g, "$1 $2");
  return s
    .split(/[\s,/()"'+&]+/)
    .map((x) => x.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((x) => x && !FILLER.has(x));
}
const isNum = (t: string) => /^\d+(\.\d+)?(\*\d+(\.\d+)?)?$/.test(t);

/** Capacities in grams: "200 KG" → 200000, "200 G" → 200, "1 TON" → 1000000 (200 kg ≠ 200 g) */
export function weightsOf(text: string) {
  const out = new Set<number>();
  const s = text.toUpperCase().replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(KGS?|GMS?|G|TONS?)\b/g, "$2$3");
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(TONS?|KGS?|GMS?|G|MG)\b/g)) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const g = /^TON/.test(unit) ? n * 1e6 : /^KG/.test(unit) ? n * 1e3 : unit === "MG" ? n / 1e3 : n;
    out.add(Math.round(g * 1000) / 1000);
  }
  return out;
}

function profile(text: string) {
  const all = tokens(text);
  return {
    nums: new Set(all.filter(isNum).map((n) => String(Number.isNaN(Number(n)) ? n : n.includes("*") ? n : Number(n)))),
    words: new Set(all.filter((x) => !isNum(x) && !UNIT_WORDS.has(x))),
    weights: weightsOf(text),
  };
}

export function buildCatalogIndex(products: CatalogProduct[]) {
  const byBrand = new Map<string, Array<CatalogProduct & { p: ReturnType<typeof profile> }>>();
  for (const prod of products) {
    const b = normBrand(prod.brand || "");
    const list = byBrand.get(b) ?? [];
    // Model text without the brand words
    const brandWords = new Set(tokens(prod.brand || ""));
    const modelText = (prod.model || prod.name)
      .split(/\s+/)
      .filter((w) => !brandWords.has(w.toUpperCase()))
      .join(" ");
    list.push({ ...prod, p: profile(modelText) });
    byBrand.set(b, list);
  }
  return byBrand;
}

export function matchProduct(
  index: ReturnType<typeof buildCatalogIndex>,
  brandRaw: string,
  modelRaw: string,
  specRaw = "",
): ProductMatch {
  let brand = normBrand(brandRaw || "");
  let model = modelRaw || "";
  // Brand and model written in swapped columns ("CASH DRAWER | RETSOL")
  if (!index.has(brand) && index.has(normBrand(model))) {
    [brand, model] = [normBrand(model), brandRaw];
  }
  // Brand with extra words ("RETSOL 2D | BARCODE SCANNER") → RETSOL, model "2D BARCODE SCANNER"
  if (!index.has(brand)) {
    const words = brand.split(/\s+/);
    for (let n = words.length - 1; n >= 1; n--) {
      const head = normBrand(words.slice(0, n).join(" "));
      if (index.has(head)) {
        model = `${words.slice(n).join(" ")} ${model}`.trim();
        brand = head;
        break;
      }
    }
  }
  const none: ProductMatch = { productId: null, productName: null, confidence: "none", brand, alternatives: [] };
  const list = index.get(brand);
  if (!list?.length) return none;
  if (!model.trim() && !specRaw.trim()) return none;

  // Numbers in the model must exist in the product; the serial / size column only adds weight
  const row = profile(`${model} ${specRaw}`);
  const required = profile(model).nums;
  const requiredWeights = profile(model).weights;
  const scored = list
    .map((c) => {
      // every capacity written must be the product's (with its unit), every other number too
      const numsOk = [...required].every((n) => c.p.nums.has(n)) && [...requiredWeights].every((w) => c.p.weights.has(w));
      const shared = [...row.words].filter((w) => c.p.words.has(w)).length;
      const rowCover = row.words.size ? shared / row.words.size : 1;
      const prodCover = c.p.words.size ? shared / c.p.words.size : 1;
      const numCover = c.p.nums.size ? [...c.p.nums].filter((n) => row.nums.has(n)).length / c.p.nums.size : 1;
      const score = (numsOk ? 0.45 : 0) + 0.3 * rowCover + 0.15 * prodCover + 0.1 * numCover;
      return { c, score, numsOk, shared };
    })
    .filter((x) => x.numsOk && (x.shared > 0 || row.words.size === 0 || row.nums.size > 0))
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return none;
  const [best, second] = scored;
  const gap = best.score - (second?.score ?? 0);
  const alternatives = scored.slice(1, 4).map((x) => ({ id: x.c.id, name: x.c.name }));
  const confidence: ProductMatch["confidence"] =
    best.score >= 0.85 && gap >= 0.05 ? "exact" : best.score >= 0.6 && gap >= 0.04 ? "likely" : best.score >= 0.5 ? "check" : "none";
  if (confidence === "none") return { ...none, alternatives: scored.slice(0, 3).map((x) => ({ id: x.c.id, name: x.c.name })) };
  return { productId: best.c.id, productName: best.c.name, productCode: best.c.code ?? null, confidence, brand, alternatives };
}

/** Customer machine type from the matched product (or the written text when nothing matched). */
export function machineTypeOf(product: Pick<CatalogProduct, "family" | "kind"> | null, text: string) {
  if (product) {
    if (product.kind === "CCM") return "CCM";
    if (product.kind === "CCTV") return "CCTV";
    if (product.kind === "BIOMETRIC") return "BIOMETRIC";
    if (product.family === "WEIGHING_SCALES") return "WEIGHING";
    if (["BILLING_MACHINE", "TOUCH_POS", "BILLING_SOFTWARE"].includes(product.family)) return "BILLING";
    return "OTHER";
  }
  const t = text.toUpperCase();
  if (/COUNTING|NOTE|CASH COUNT/.test(t)) return "CCM";
  if (/CAMERA|DVR|NVR|CCTV|HARD ?DIS/.test(t)) return "CCTV";
  if (/BIOMETRIC|FINGER|FACE/.test(t)) return "BIOMETRIC";
  if (/SHREDDER/.test(t)) return "PAPER_SHREDDER";
  if (/ROLL/.test(t)) return "PAPER_ROLL";
  if (/BILLING|POS|PRINTER|SCANNER|DRAWER|\b[23] ?T\b|GPRS|SOFTWARE|TOUCH/.test(t)) return "BILLING";
  if (/\d\s*(KG|G|GM|MG|TON)\b|SCALE|WEIGH|PLATFORM|CRANE|TON\b/.test(t)) return "WEIGHING";
  return "OTHER";
}
