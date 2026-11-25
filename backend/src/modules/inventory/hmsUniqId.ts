import type { Prisma } from "@prisma/client";

/**
 * HMS Unique ID — HMS Enterprises' own machine tag (from their IT register):
 *
 *   26C0874  =  YY (26) + month letter (C = March) + running number (0874)
 *
 * - Month letters: A = Jan, B = Feb … L = Dec — the month the machine was tagged (received).
 * - ONE running number for the whole year, shared by every brand and machine type.
 *   It does not restart each month; it restarts at 0001 on 1 January.
 * - Every machine gets one. Weighing machines usually have no factory serial, so the HMS ID is
 *   their only identity (serialNo falls back to the HMS ID).
 *
 * Older test units may still carry the earlier provisional format `2026-WS-0030`; those are left alone.
 */

export const HMS_MONTH_LETTERS = "ABCDEFGHIJKL";
export const HMS_ID_RE = /^(\d{2})([A-L])(\d{4})$/;

/** Calendar date in India (HMS works in IST) — so a 1 a.m. receipt is not tagged with yesterday's month. */
function istParts(date: Date) {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() };
}

export function hmsYear(date: Date = new Date()) {
  return istParts(date).year;
}

export function formatHmsUniqId(date: Date, seq: number) {
  const { year, month } = istParts(date);
  return `${String(year % 100).padStart(2, "0")}${HMS_MONTH_LETTERS[month]}${String(seq).padStart(4, "0")}`;
}

export function sequenceKeyForYear(year: number) {
  return `HMS_UNIQ_${year}`;
}

export function isValidHmsUniqId(id: string | null | undefined) {
  return HMS_ID_RE.test(String(id ?? "").trim().toUpperCase());
}

/** `26C0874` → 874 when it belongs to `year` (2026); otherwise null. */
export function parseHmsUniqSeq(hmsUniqId: string | null | undefined, year: number): number | null {
  const m = String(hmsUniqId ?? "").trim().toUpperCase().match(HMS_ID_RE);
  if (!m || Number(m[1]) !== year % 100) return null;
  const n = Number.parseInt(m[3]!, 10);
  return n > 0 ? n : null;
}

export function maxHmsUniqSeqInList(ids: Array<string | null | undefined>, year: number): number {
  let max = 0;
  for (const id of ids) {
    const n = parseHmsUniqSeq(id, year);
    if (n != null && n > max) max = n;
  }
  return max;
}

type Db = Prisma.TransactionClient;

/**
 * Next free running number for the year: the stored counter, but never below the highest ID already
 * on a unit (e.g. after HMS's existing register is imported). Deleted units count too — the ID column
 * is unique even for removed rows.
 */
export async function nextHmsSeq(db: Db, tenantId: string, year: number) {
  const seqKey = sequenceKeyForYear(year);
  const yy = String(year % 100).padStart(2, "0");
  const [seq, existing] = await Promise.all([
    db.numberSequence.findUnique({ where: { tenantId_sequenceKey: { tenantId, sequenceKey: seqKey } } }),
    db.stockUnit.findMany({
      where: { tenantId, hmsUniqId: { startsWith: yy } },
      select: { hmsUniqId: true },
    }),
  ]);
  const dbMax = maxHmsUniqSeqInList(existing.map((x) => x.hmsUniqId), year);
  return { seqKey, start: Math.max(seq?.nextValue ?? 1, dbMax + 1), hasRow: !!seq };
}

/** Store the counter so the next allocation starts at `nextValue`. */
export async function saveHmsSeq(db: Db, tenantId: string, year: number, nextValue: number) {
  const sequenceKey = sequenceKeyForYear(year);
  await db.numberSequence.upsert({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey } },
    create: { tenantId, sequenceKey, prefix: String(year % 100).padStart(2, "0"), nextValue, padding: 4 },
    update: { nextValue },
  });
}

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
