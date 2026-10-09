/**
 * Provisional HMS Unique ID: YYYY-{FAMILY}-{SEQ4}
 * e.g. 2026-BM-0001
 * Swap this module when final YEAR / MM-ABCD(L) / 0001 rules are confirmed.
 */

const FAMILY_SHORT: Record<string, string> = {
  WEIGHING_SCALES: "WS",
  BILLING_MACHINE: "BM",
  TOUCH_POS: "POS",
  BILLING_SOFTWARE: "SW",
  OFFICE_AUTOMATION: "OA",
  WEIGHING: "WS",
  BILLING: "BM",
  CCTV: "OA",
  CCM: "OA",
  BIOMETRIC: "OA",
};

/** Weighing machines typically have no supplier serial — identify by HMS Unique ID. */
export function isWeighingProduct(attrs: unknown, sku?: string | null): boolean {
  if (attrs && typeof attrs === "object") {
    const a = attrs as Record<string, unknown>;
    const family = String(a.familyCode ?? a.catalogFamily ?? "").toUpperCase();
    if (family === "WEIGHING_SCALES") return true;
    const kind = String(a.catalogKind ?? "").toUpperCase();
    if (kind === "WEIGHING") return true;
  }
  const s = String(sku ?? "").toUpperCase();
  return s.includes("-WS-") || s.startsWith("HMS-WS");
}

export function familyCodeFromProduct(attrs: unknown, sku?: string | null): string {
  if (attrs && typeof attrs === "object") {
    const a = attrs as Record<string, unknown>;
    const family = String(a.familyCode ?? a.catalogFamily ?? "").toUpperCase();
    if (family && FAMILY_SHORT[family]) return FAMILY_SHORT[family];
    const kind = String(a.catalogKind ?? "").toUpperCase();
    if (kind && FAMILY_SHORT[kind]) return FAMILY_SHORT[kind];
  }
  const s = String(sku ?? "").toUpperCase();
  if (s.includes("-WS-") || s.startsWith("HMS-WS")) return "WS";
  if (s.includes("-BM-") || s.startsWith("HMS-BM")) return "BM";
  if (s.includes("-POS-") || s.startsWith("HMS-POS")) return "POS";
  if (s.includes("-SW-") || s.startsWith("HMS-SW")) return "SW";
  if (s.includes("-OA-") || s.startsWith("HMS-OA")) return "OA";
  if (s.includes("-SP-")) return "SP";
  return "GN";
}

export function formatHmsUniqId(year: number, familyShort: string, seq: number) {
  return `${year}-${familyShort}-${String(seq).padStart(4, "0")}`;
}

export function sequenceKeyForFamily(year: number, familyShort: string) {
  return `HMS_UNIQ_${year}_${familyShort}`;
}

/** Bump trailing digits on a serial: ABC1001 + 2 → ABC1003 */
export function bumpSerial(start: string, offset: number): string {
  const s = start.trim().toUpperCase();
  const m = s.match(/^(.*?)(\d+)$/);
  if (!m) {
    if (offset === 0) return s;
    return `${s}${offset > 0 ? `-${offset + 1}` : ""}`;
  }
  const prefix = m[1] ?? "";
  const digits = m[2] ?? "0";
  const next = BigInt(digits) + BigInt(offset);
  return `${prefix}${next.toString().padStart(digits.length, "0")}`;
}

export function expandSerialRange(startSerial: string, quantity: number): string[] {
  const n = Math.max(0, Math.floor(quantity));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(bumpSerial(startSerial, i));
  return out;
}
