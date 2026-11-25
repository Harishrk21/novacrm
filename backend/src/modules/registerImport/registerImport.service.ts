/**
 * Import HMS's own Excel registers — sales (who bought which machine) and service (which job was done
 * for whom) — whatever layout the year's sheet used. The browser reads the file and works out the
 * columns; this service gets clean rows and decides, for each one:
 *
 *  - customer  → same phone number = same customer (phone is unique); no phone → same exact name
 *  - machine   → matched to a product of the catalog (brand + model + capacity)
 *  - duplicate → same HMS ID (sales) or same HMS service no. (service) is never imported twice
 *
 * preview() only reads. commit() writes in batches (the DB is far away) and tags everything with an
 * importBatch id so undo() can take a whole import back out.
 */
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { AppError } from "../../common/errors.js";
import { formatCustomerCode } from "../contacts/customerIdentity.js";
import { buildCatalogIndex, machineTypeOf, matchProduct, type CatalogProduct, type ProductMatch } from "./matcher.js";

export type SalesRow = {
  ref: string; // "BILLING!12" — sheet + row, shown back to the user
  date?: string | null; // YYYY-MM-DD
  dateNote?: string | null;
  hmsId?: string | null;
  brand?: string | null;
  model?: string | null;
  spec?: string | null; // serial / size / extra written next to the model
  customer?: string | null;
  address?: string | null;
  phones?: string[] | null;
  executive?: string | null;
  amount?: number | null;
  industry?: string | null;
  /** Staff picked the product by hand: an id, or null = "save as written" */
  productId?: string | null;
  /** Product ID written in the register (HMS-012) — exact product, no guessing */
  productCode?: string | null;
  dcNo?: string | null;
  area?: string | null;
  deliveredBy?: string | null;
  stampingDate?: string | null;
  /** Product ID filled in by AI (staff can change it) */
  aiProduct?: boolean | null;
};
export type ServiceRow = {
  ref: string;
  date?: string | null;
  dateNote?: string | null;
  work?: string | null;
  customer?: string | null;
  coverage?: string | null; // GC / NGC / AMC
  amount?: number | null;
  received?: number | null;
  balance?: number | null;
  paymentNote?: string | null;
  serviceNo?: string | null;
  /** Product ID of the machine serviced (HMS-012) */
  productCode?: string | null;
  /** HMS ID of the machine serviced (26C0874) — the exact unit */
  hmsId?: string | null;
  status?: string | null;
  /** "SP-001 x1, SP-049 x2" or as written ("6V BATTERY + POWER CARD") */
  spares?: string | null;
  paymentMode?: string | null;
  /** Machine as written ("HMS 2T", "JUNIOR STAR") — matched to the product list */
  machine?: string | null;
  aiProduct?: boolean | null;
  aiSpares?: boolean | null;
  phones?: string[] | null;
  area?: string | null;
  engineer?: string | null;
  industry?: string | null;
};
export type Kind = "SALES" | "SERVICE";
export type Options = {
  /** Service rows with an amount but no payment written: still due (default) or already paid */
  unpaidAs?: "DUE" | "PAID";
};

type PreviewRow = {
  ref: string;
  customer: string;
  phone: string | null;
  contact: "existing" | "new" | "same-file";
  contactName?: string;
  product?: ProductMatch;
  machine?: string;
  duplicate: boolean;
  skip: boolean;
  warnings: string[];
  /** Product / spares filled in by AI — shown with an "AI" mark */
  ai?: boolean;
  spares?: Array<{ spareId: string | null; name: string; qty: number }>;
  status?: string;
};

const clean = (v: unknown) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && !/^(NILL|NIL|-|NA|N\/A)$/i.test(s) ? s : "";
};
const title = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Gc|Ngc|Amc|Hms|Pos|Ss|Ms|Rs232|Gprs|Ups|Lcd)\b/g, (m) => m.toUpperCase());
const cf = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const istDate = (ymd?: string | null) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T10:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + m);
  return x;
};

/** Phones written as "7358514454/9566289616", "044 2345 6789", "+91 98…" → normalised, mobiles first. */
export function phonesOf(list: string[] | null | undefined) {
  const out: string[] = [];
  for (const raw of list ?? []) {
    for (const part of String(raw).split(/[\/,;&]|\s{2,}|\bor\b/i)) {
      const digits = part.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) continue;
      const n = normalizePhone(digits);
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out.sort((a, b) => Number(/^91[6-9]\d{9}$/.test(b)) - Number(/^91[6-9]\d{9}$/.test(a)));
}
const display = (n: string | null) => (n ? (n.startsWith("91") && n.length === 12 ? n.slice(2) : n) : null);

/** Serial numbers are long codes with digits; sizes ("1200X1200MS") and words ("WITH RS232") are not. */
// Serials are long (932017916, E2020081091); short codes like TE244 / PD400 are model names
const looksSerial = (s: string) =>
  /^[A-Z0-9\-\/]{5,}$/i.test(s) &&
  !/\d+\s*[X*×]\s*\d+/i.test(s) &&
  (s.replace(/[^0-9]/g, "").length >= 6 || (s.length >= 8 && /\d/.test(s)));

/**
 * What makes a record "the same" when a register is uploaded again (even edited, rows moved):
 *  - sale with an HMS ID → that HMS ID
 *  - sale without one    → customer (phone, else name) + date + machine as written
 *  - service job          → HMS service no., else customer + date + work written
 * Identical rows in one file (two same machines, same day) are told apart by their order (#1, #2…).
 */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
function whoKey(r: { customer?: string | null; phones?: string[] | null }) {
  return phonesOf(r.phones)[0] ?? `N:${squash(clean(r.customer))}`;
}
const IMPORT_KEY_SALE = (r: SalesRow) =>
  clean(r.hmsId)
    ? `H:${clean(r.hmsId).toUpperCase().replace(/\s+/g, "")}`
    : `S:${whoKey(r)}|${r.date ?? ""}|${squash(`${clean(r.brand)}${clean(r.model)}${clean(r.spec)}`)}`;
const IMPORT_KEY_SERVICE = (r: ServiceRow) =>
  clean(r.serviceNo) ? `V:${clean(r.serviceNo)}` : `J:${whoKey(r)}|${r.date ?? ""}|${squash(clean(r.work))}`;

async function catalog(t: string) {
  // Only HMS's own product list (IT register + stock list, with Product IDs) — never the old samples
  const products = (
    await prisma.product.findMany({
      where: { tenantId: t, deletedAt: null },
      select: { id: true, name: true, attributes: true, isActive: true, sku: true },
    })
  ).filter((p) => {
    const src = String(cf(p.attributes).source ?? "");
    return src.startsWith("hms-") || /^[A-Z]{3}-\d{3,}$/.test(p.sku);
  });
  const toItem = (p: (typeof products)[number]): CatalogProduct => {
    const a = cf(p.attributes);
    return {
      id: p.id,
      name: p.name,
      brand: String(a.brand ?? ""),
      model: String(a.model ?? p.name),
      family: String(a.catalogFamily ?? ""),
      kind: String(a.catalogKind ?? ""),
      code: String(a.productCode ?? "") || undefined,
    };
  };
  const active = products.filter((p) => p.isActive).map(toItem);
  const all = products.map(toItem);
  return {
    list: all,
    byId: new Map(all.map((p) => [p.id, p])),
    byCode: new Map(all.filter((p) => p.code).map((p) => [p.code!.toUpperCase(), p])),
    index: buildCatalogIndex(active),
    hiddenIndex: buildCatalogIndex(products.filter((p) => !p.isActive).map(toItem)),
  };
}

/** Records already in the system (from earlier imports or made in NovaCRM) → which customer has them. */
async function existingKeys(t: string, kind: Kind) {
  const rows =
    kind === "SALES"
      ? await prisma.customerAsset.findMany({ where: { tenantId: t, deletedAt: null }, select: { contactId: true, customFields: true } })
      : await prisma.ticket.findMany({ where: { tenantId: t, deletedAt: null }, select: { contactId: true, customFields: true } });
  const keys = new Map<string, string | null>();
  for (const r of rows) {
    const c = cf(r.customFields);
    if (c.importKey) keys.set(String(c.importKey), r.contactId);
    if (kind === "SALES" && c.hmsUniqId) keys.set(`H:${String(c.hmsUniqId).toUpperCase()}`, r.contactId);
    if (kind === "SERVICE" && c.hmsServiceNo) keys.set(`V:${String(c.hmsServiceNo)}`, r.contactId);
  }
  return keys;
}

/** Words people write in the machine column that are not a machine */
const NOT_A_MACHINE = /^(PENDING|BILLED|BILL|CANCELLED|OTHER BRAND|SALES\b.*|.*G ?PAY.*|NIL+|-)$/i;

/** "HMS 2T", "JUNIOR STAR", "POINT 100 KG", "200 KG" → a product (brand written first, else HMS) */
function productFromText(cat: Awaited<ReturnType<typeof catalog>>, text: string): CatalogProduct | null {
  const words = text.trim().split(/\s+/);
  const tries: Array<[string, string]> = [];
  for (let n = Math.min(2, words.length - 1); n >= 1; n--) tries.push([words.slice(0, n).join(" "), words.slice(n).join(" ")]);
  tries.push(["HMS", text]);
  for (const [b, m] of tries) {
    for (const idx of [cat.index, cat.hiddenIndex]) {
      const r = matchProduct(idx, b, m);
      if (r.productId && (r.confidence === "exact" || r.confidence === "likely")) return cat.byId.get(r.productId) ?? null;
    }
  }
  return null;
}

type SpareRef = { id: string; spareId: string; name: string; words: Set<string>; units: Set<string> };
async function spareCatalog(t: string): Promise<SpareRef[]> {
  const items = await prisma.sparePartItem.findMany({
    where: { tenantId: t, deletedAt: null, partCode: { startsWith: "SP-" } },
    select: { id: true, name: true, partCode: true, customFields: true },
  });
  return items.map((i) => {
    const written = (cf(i.customFields).writtenAs as string[] | undefined) ?? [];
    const units = ((cf(i.customFields).unitNumbers as string[] | undefined) ?? []).map((u) => u.toUpperCase().replace(/\s+/g, ""));
    return {
      id: i.id,
      spareId: i.partCode!,
      name: i.name,
      words: new Set([i.name, ...written].map((w) => w.toUpperCase().replace(/[^A-Z0-9]+/g, ""))),
      units: new Set(units),
    };
  });
}

/**
 * "SP-001 x1, SP-049 x2" → exact. Written text ("6V BATTERY + POWER CARD 2 NOS + SERVICE") → split on
 * + , & and matched by the spare's name or how the register wrote it; "SERVICE", charges etc. dropped.
 */
type UsedSpare = { spareId: string | null; name: string; qty: number; written: string; unitNo?: string };
/** HMS spare unit numbers (F-7655) written anywhere in a text → that exact spare unit */
const UNIT_NO = /\bF\s*-\s*(\d{4,5})\b/gi;
function spareUnitsIn(text: string, list: SpareRef[]): UsedSpare[] {
  const out: UsedSpare[] = [];
  for (const m of text.matchAll(UNIT_NO)) {
    const unitNo = `F-${m[1]}`;
    const hit = list.find((s) => s.units.has(unitNo));
    out.push({ spareId: hit?.spareId ?? null, name: hit?.name ?? `Spare ${unitNo}`, qty: 1, written: unitNo, unitNo });
  }
  return out;
}
function parseSpares(text: string, list: SpareRef[]): UsedSpare[] {
  if (!text) return [];
  const out: UsedSpare[] = spareUnitsIn(text, list);
  text = text.replace(UNIT_NO, " ");
  for (let part of text.split(/[+,&\/]|\bAND\b/i)) {
    part = part.trim();
    if (!part || /^(SERVICE|SERVICING|CHARGES?|CONVI[A-Z]*|LABOUR|VISIT|REPAIR|CHANGED?|\d+)$/i.test(part) || /\bCHARGES?\b/i.test(part)) continue;
    let qty = 1;
    const q = part.match(/(?:\bX\s*|\s)(\d{1,3})\s*(?:NOS?|NIS|PCS)?\s*$/i) ?? part.match(/^(\d{1,3})\s*(?:NOS?|PCS)\s+/i);
    if (q) {
      qty = Number(q[1]) || 1;
      part = part.replace(q[0], " ").trim();
    }
    part = part.replace(/\b(CHANGED|REPLACED|NEW|FITTED)\b/gi, "").trim();
    const code = part.match(/^SP-\d{3}$/i)?.[0]?.toUpperCase();
    const key = part.toUpperCase().replace(/[^A-Z0-9]+/g, "");
    const hit = code ? list.find((s) => s.spareId === code) : list.find((s) => s.words.has(key));
    out.push({ spareId: hit?.spareId ?? null, name: hit?.name ?? part, qty, written: part });
  }
  return out;
}

type ContactRef = { id: string; name: string; isNew: boolean };

/**
 * Every number a customer has on file — main, mobile, landline, WhatsApp, 2nd / 3rd mobile and the extra
 * numbers earlier imports added — points to that customer. A 2020 customer who gives only their second
 * number in 2021 is still the same customer.
 */
async function contactLookup(t: string, _rows: Array<{ customer?: string | null; phones?: string[] | null }>) {
  const all = await prisma.contact.findMany({
    where: { tenantId: t, deletedAt: null },
    select: { id: true, name: true, phoneNormalized: true, phone: true, mobile: true, customFields: true, area: true, street: true },
  });
  const phoneMap = new Map<string, (typeof all)[number]>();
  const nameMap = new Map<string, typeof all>();
  // main numbers first, so a number that is someone's main number wins over an "extra" one
  for (const pass of [0, 1]) {
    for (const c of all) {
      const x = cf(c.customFields);
      const nums =
        pass === 0
          ? [c.phoneNormalized, c.mobile, c.phone]
          : [x.whatsapp, x.mobile_2, x.mobile_3, x.landline, ...(Array.isArray(x.altPhones) ? x.altPhones : [])];
      for (const n of phonesOf(nums.filter(Boolean).map(String))) if (!phoneMap.has(n)) phoneMap.set(n, c);
    }
  }
  for (const c of all) nameMap.set(c.name.toUpperCase(), [...(nameMap.get(c.name.toUpperCase()) ?? []), c]);
  return { phoneMap, nameMap };
}

type Plan = {
  preview: PreviewRow[];
  newContacts: Array<{ id: string; name: string; phone: string | null; altPhones: string[]; street: string; area: string; industry: string; source: Kind }>;
  contactFill: Map<string, { area?: string; street?: string; industry?: string; source: Kind; altPhones: string[] }>;
  assets: Array<Record<string, unknown>>;
  tickets: Array<Record<string, unknown>>;
  spareChanges: Array<Record<string, unknown>>;
};

async function plan(t: string, kind: Kind, rows: Array<SalesRow | ServiceRow>, batchId: string, opts: Options = {}): Promise<Plan> {
  const [cat, keys, lookup] = await Promise.all([
    catalog(t),
    existingKeys(t, kind),
    contactLookup(t, rows),
  ]);
  const out: Plan = { preview: [], newContacts: [], contactFill: new Map(), assets: [], tickets: [], spareChanges: [] };
  const spareList = kind === "SERVICE" ? await spareCatalog(t) : [];
  const fileContacts = new Map<string, ContactRef>(); // phone or NAME:… → contact made earlier in this file
  const seenKeys = new Set<string>();
  const occurrences = new Map<string, number>();
  /** Key + its order among identical rows of this file */
  const keyWithOrder = (base: string) => {
    if (base.startsWith("H:") || base.startsWith("V:")) return base;
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    return `${base}#${n}`;
  };
  /** HMS ID / service no already on another customer — names filled in after the loop */
  const elsewhere: Array<{ warnings: string[]; contactId: string; what: string }> = [];
  // Same name written with two different phones — probably one customer with a typo in the number
  const phonesByName = new Map<string, Set<string>>();
  for (const r of rows) {
    const nm = clean(r.customer).toUpperCase();
    const ph = phonesOf(r.phones)[0];
    if (nm && ph) phonesByName.set(nm, (phonesByName.get(nm) ?? new Set()).add(ph));
  }

  // Service jobs attach to the customer's machine when there is exactly one
  type Machine = { id: string; contactId: string; name: string; productId: string | null; hmsId: string | null };
  const assetsOf = new Map<string, Machine[]>();
  const byHmsId = new Map<string, Machine>();
  let engineers: Array<{ id: string; name: string }> = [];
  if (kind === "SERVICE") {
    const [assets, users] = await Promise.all([
      prisma.customerAsset.findMany({
        where: { tenantId: t, deletedAt: null },
        select: { id: true, contactId: true, name: true, customFields: true },
      }),
      prisma.user.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, name: true } }),
    ]);
    for (const a of assets) {
      const c = cf(a.customFields);
      const m: Machine = {
        id: a.id,
        contactId: a.contactId,
        name: a.name,
        productId: c.productId ? String(c.productId) : null,
        hmsId: c.hmsUniqId ? String(c.hmsUniqId).toUpperCase() : null,
      };
      assetsOf.set(a.contactId, [...(assetsOf.get(a.contactId) ?? []), m]);
      if (m.hmsId) byHmsId.set(m.hmsId, m);
    }
    engineers = users;
  }

  for (const row of rows) {
    const warnings: string[] = [];
    const customer = clean(row.customer);
    const phones = phonesOf(row.phones);
    const phone = phones[0] ?? null;
    const p: PreviewRow = { ref: row.ref, customer, phone: display(phone), contact: "new", duplicate: false, skip: false, warnings };

    if (!customer && !phone) {
      p.skip = true;
      warnings.push("No customer name or phone — skipped");
      out.preview.push(p);
      continue;
    }
    if (!row.date) warnings.push("Date not readable");
    if (row.dateNote) warnings.push(row.dateNote);
    if (!phone) warnings.push(row.phones?.some((x) => clean(x)) ? "Phone number not valid (needs 10 digits)" : "No phone number");
    // Same name, a number that differs by one or two digits — almost always a typo
    const near = phone
      ? [...(phonesByName.get(customer.toUpperCase()) ?? [])].find((o) => {
          if (o === phone || o.length !== phone.length) return false;
          let diff = 0;
          for (let i = 0; i < o.length; i++) if (o[i] !== phone[i]) diff++;
          return diff <= 2;
        })
      : undefined;
    if (near) warnings.push(`Same name also written with ${display(near)} — check which number is right`);

    // ---- customer
    let contact: ContactRef | null = null;
    const fileKey = phone ?? `NAME:${customer.toUpperCase()}`;
    const known = phones.map((ph) => lookup.phoneMap.get(ph)).find(Boolean) ?? null;
    const earlierInFile = phones.map((ph) => fileContacts.get(ph)).find(Boolean);
    if (known) {
      contact = { id: known.id, name: known.name, isNew: false };
      p.contact = "existing";
      p.contactName = known.name;
    } else if (earlierInFile || fileContacts.has(fileKey)) {
      contact = (earlierInFile ?? fileContacts.get(fileKey))!;
      p.contact = contact.isNew ? "same-file" : "existing";
      p.contactName = contact.name;
    } else if (!phone) {
      const same = lookup.nameMap.get(customer.toUpperCase()) ?? [];
      if (same.length === 1) {
        contact = { id: same[0]!.id, name: same[0]!.name, isNew: false };
        p.contact = "existing";
        p.contactName = same[0]!.name;
      } else if (same.length > 1) warnings.push(`${same.length} customers have this name — a new one is made`);
    }
    const area = clean((row as ServiceRow).area ?? (row as SalesRow).area);
    const street = clean((row as SalesRow).address);
    const industry = clean(row.industry);
    if (!contact && phone) {
      // No number matches, but this name is already a customer — maybe the same shop with a new number
      const same = lookup.nameMap.get(customer.toUpperCase()) ?? [];
      if (same.length) {
        const nums = same
          .map((c) => display(c.phoneNormalized) ?? c.mobile ?? c.phone)
          .filter(Boolean)
          .slice(0, 2)
          .join(", ");
        warnings.push(`"${same[0]!.name}" is already a customer${nums ? ` with ${nums}` : ""} — a new customer is made; if it is the same shop, add this number to that customer instead`);
      }
    }
    if (!contact) {
      contact = { id: newId(), name: title(customer || `Customer ${display(phone)}`), isNew: true };
      out.newContacts.push({ id: contact.id, name: contact.name, phone, altPhones: phones.slice(1), street, area, industry, source: kind });
      p.contactName = contact.name;
    } else if (!contact.isNew) {
      const prev = out.contactFill.get(contact.id) ?? { source: kind, altPhones: [] };
      out.contactFill.set(contact.id, {
        ...prev,
        area: prev.area || area,
        street: prev.street || street,
        industry: prev.industry || industry,
        altPhones: [...new Set([...prev.altPhones, ...phones.filter((x) => x !== phone)])],
      });
    }
    fileContacts.set(fileKey, contact);
    for (const ph of phones) if (!fileContacts.has(ph)) fileContacts.set(ph, contact);

    // ---- sales row → customer machine
    if (kind === "SALES") {
      const r = row as SalesRow;
      const key = keyWithOrder(IMPORT_KEY_SALE(r));
      const hms = clean(r.hmsId).toUpperCase();
      if (seenKeys.has(key)) {
        p.duplicate = true;
        p.skip = true;
        warnings.push(hms ? `HMS ID ${hms} is twice in this file — the first one is used` : "Same row is twice in this file");
      } else if (keys.has(key)) {
        p.duplicate = true;
        p.skip = true;
        const owner = keys.get(key);
        if (!owner || owner === contact.id) warnings.push(hms ? `HMS ID ${hms} is already on this customer` : "This machine is already on this customer");
        else elsewhere.push({ warnings, contactId: owner, what: hms ? `HMS ID ${hms}` : "This sale" });
      }
      seenKeys.add(key);
      const brandRaw = clean(r.brand);
      const modelRaw = clean(r.model);
      const spec = clean(r.spec);
      const specForMatch = looksSerial(spec) ? "" : spec;
      let auto = matchProduct(cat!.index, brandRaw, modelRaw, specForMatch);
      // Hidden (old) products only when nothing on the current list fits
      if (auto.confidence === "none") {
        const old = matchProduct(cat!.hiddenIndex, brandRaw, modelRaw, specForMatch);
        const rank = { exact: 3, likely: 2, check: 1, none: 0 } as const;
        if (rank[old.confidence] > rank[auto.confidence]) auto = old;
      }
      const picked = r.productId !== undefined;
      const pickedProd = picked && r.productId ? cat!.byId.get(r.productId) ?? null : null;
      const code = clean(r.productCode).toUpperCase();
      const coded = code ? cat!.byCode.get(code) ?? null : null;
      if (code && !coded) warnings.push(`Product ID ${code} is not in the product list — matched by name instead`);
      const as = (x: CatalogProduct | null): ProductMatch => ({
        productId: x?.id ?? null,
        productName: x?.name ?? null,
        productCode: x?.code ?? null,
        confidence: x ? "exact" : "none",
        brand: auto.brand,
        alternatives: auto.alternatives,
      });
      const m: ProductMatch = picked ? as(pickedProd) : coded ? as(coded) : auto;
      p.product = m;
      if (r.aiProduct && m.productId) p.ai = true;
      const prod = m.productId ? cat!.byId.get(m.productId) ?? null : null;
      const typed = title([brandRaw, modelRaw, looksSerial(spec) ? "" : spec].filter(Boolean).join(" "));
      p.machine = prod?.name ?? (typed || "Machine (not written)");
      if (!brandRaw && !modelRaw && !prod) warnings.push("No machine written");
      if (p.skip) {
        out.preview.push(p);
        continue;
      }
      const sold = istDate(r.date) ?? new Date();
      const gcEnd = addMonths(sold, 12);
      const isWeighing = machineTypeOf(prod, typed) === "WEIGHING";
      out.assets.push({
        id: newId(),
        tenantId: t,
        contactId: contact.id,
        machineType: machineTypeOf(prod, typed),
        name: (p.machine || "Machine").slice(0, 191),
        model: (modelRaw ? title(modelRaw) : null)?.slice(0, 120) ?? null,
        capacity: isWeighing && /\d\s*(KG|G|GM|MG|TON)\b/i.test(modelRaw) ? modelRaw.slice(0, 60) : null,
        platformSize: /\d+\s*[X*×]\s*\d+/i.test(spec) ? spec.slice(0, 60) : null,
        serialNo: looksSerial(spec) ? spec.toUpperCase().slice(0, 120) : null,
        origin: "SOLD_BY_US",
        servicePlan: gcEnd >= new Date() ? "GC" : "NGC",
        warrantyEndDate: gcEnd,
        remindersEnabled: false,
        notes: `Sold ${r.date ?? ""}${clean(r.executive) ? ` by ${title(clean(r.executive))}` : ""}${clean(r.dcNo) ? ` · ${clean(r.dcNo)}` : ""} · from ${r.ref}`.slice(0, 500),
        stampingDate: istDate(r.stampingDate),
        nextDueDate: istDate(r.stampingDate) ? addMonths(istDate(r.stampingDate)!, 12) : null,
        createdAt: sold,
        customFields: {
          importKey: key,
          importBatch: batchId,
          importRegister: "SALES",
          hmsUniqId: clean(r.hmsId).toUpperCase() || null,
          productId: prod?.id ?? null,
          productCode: prod?.code ?? null,
          brand: m.brand || brandRaw || null,
          saleDate: r.date ?? null,
          saleAmount: r.amount ?? null,
          salesExecutive: clean(r.executive) ? title(clean(r.executive)) : null,
          dcNo: clean(r.dcNo) || null,
          deliveredBy: clean(r.deliveredBy) ? title(clean(r.deliveredBy)) : null,
          aiProduct: r.aiProduct ? true : undefined,
          address: street || null,
          industry: industry || null,
          sourceRow: r.ref,
          written: [brandRaw, modelRaw, spec].filter(Boolean).join(" | "),
        },
      });
    }

    // ---- service row → closed service job
    if (kind === "SERVICE") {
      const r = row as ServiceRow;
      const key = keyWithOrder(IMPORT_KEY_SERVICE(r));
      const sno = clean(r.serviceNo);
      if (seenKeys.has(key)) {
        p.duplicate = true;
        p.skip = true;
        warnings.push(sno ? `Service no. ${sno} is twice in this file — the first one is used` : "Same job is twice in this file");
      } else if (keys.has(key)) {
        p.duplicate = true;
        p.skip = true;
        const owner = keys.get(key);
        if (!owner || owner === contact.id) warnings.push(sno ? `Service no. ${sno} is already on this customer` : "This job is already on this customer");
        else elsewhere.push({ warnings, contactId: owner, what: sno ? `Service no. ${sno}` : "This job" });
      }
      seenKeys.add(key);
      const work = clean(r.work);
      const statusWord = `${clean(r.status)} ${work} ${NOT_A_MACHINE.test(clean(r.machine)) ? clean(r.machine) : ""}`.toUpperCase();
      const quotation = /QUOTATION/.test(statusWord);
      const jobStatus = /CANCEL/.test(statusWord)
        ? "CANCELLED"
        : quotation
          ? "QUOTATION"
          : /TAKEN TO OFFICE|IN OFFICE|OFFICE REPORT/.test(statusWord)
            ? "TAKEN_TO_OFFICE"
            : /PENDING/.test(clean(r.status).toUpperCase())
              ? "PENDING"
              : "COMPLETED";
      p.status = jobStatus;
      const cover = /^(GC|NGC|AMC)$/i.test(clean(r.coverage)) ? clean(r.coverage).toUpperCase() : null;
      const machines = contact.isNew ? [] : assetsOf.get(contact.id) ?? [];
      const sCode = clean(r.productCode).toUpperCase();
      const sProduct = sCode ? cat!.byCode.get(sCode) ?? null : null;
      if (sCode && !sProduct) warnings.push(`Product ID ${sCode} is not in the product list`);
      const sHms = clean(r.hmsId).toUpperCase().replace(/\s+/g, "");
      let machine: Machine | null = null;
      if (sHms) {
        const unit = byHmsId.get(sHms) ?? null;
        if (unit && unit.contactId === contact.id) machine = unit;
        else if (unit) warnings.push(`HMS ID ${sHms} belongs to another customer's machine — job kept on this customer`);
        else warnings.push(`HMS ID ${sHms} not found on any customer machine`);
      }
      if (!machine && sProduct) {
        const same = machines.filter((x) => x.productId === sProduct.id);
        if (same.length === 1) machine = same[0]!;
        else if (same.length > 1) warnings.push(`Customer has ${same.length} × ${sProduct.name} — add the HMS ID to pick one`);
      }
      // Machine as written ("HMS 2T", "JUNIOR STAR") → a product → that customer's machine of it
      const written = clean(r.machine);
      let wProduct: CatalogProduct | null = null;
      if (!sProduct && written && !NOT_A_MACHINE.test(written)) {
        wProduct = productFromText(cat!, written);
        if (wProduct) {
          const same = machines.filter((x) => x.productId === wProduct!.id);
          if (!machine && same.length === 1) machine = same[0]!;
        } else warnings.push(`Machine "${written}" not matched to a product`);
      }
      if (!machine && !sHms && !sProduct && !wProduct && machines.length === 1) machine = machines[0]!;
      if (r.aiProduct && sProduct) p.ai = true;
      const assetId = machine?.id ?? null;
      p.machine = machine
        ? machine.name + (machine.hmsId ? ` · ${machine.hmsId}` : "")
        : sProduct || wProduct
          ? `${(sProduct ?? wProduct)!.name} (${(sProduct ?? wProduct)!.code ?? "—"}) — not on record as their machine`
          : machines.length > 1
            ? `${machines.length} machines — job kept on the customer`
            : "No machine on record";
      if (p.skip) {
        out.preview.push(p);
        continue;
      }
      const amount = Number(r.amount) || 0;
      const received = r.received == null ? null : Number(r.received) || 0;
      const note = clean(r.paymentNote);
      let paymentStatus: "PAID" | "PARTIAL" | "UNPAID" = "UNPAID";
      let advance = 0;
      if (quotation || amount <= 0) paymentStatus = "PAID";
      else if (received != null && received >= amount) [paymentStatus, advance] = ["PAID", amount];
      else if (received != null && received > 0) [paymentStatus, advance] = ["PARTIAL", received];
      else if (note) [paymentStatus, advance] = ["PAID", amount];
      else if (opts.unpaidAs === "PAID") [paymentStatus, advance] = ["PAID", amount];
      if (!quotation && amount > 0 && paymentStatus === "UNPAID") warnings.push("No payment written — shows as due");
      const mode = clean(r.paymentMode).toUpperCase();
      const method = /CASH/.test(mode)
        ? "CASH"
        : /G ?PAY|UPI|PHONE ?PE|PAYTM/.test(mode)
          ? "UPI"
          : /CHEQUE|CHQ/.test(mode)
            ? "CHEQUE"
            : /NEFT|RTGS|IMPS|BANK/.test(mode)
              ? "NEFT"
              : /CARD/.test(mode)
                ? "CARD"
                : /G ?PAY|PHONE ?PE|PAYTM|UPI/i.test(note)
        ? "UPI"
        : /CHEQUE|CHQ/i.test(note)
          ? "CHEQUE"
          : /NEFT|RTGS|IMPS|BANK/i.test(note)
            ? "NEFT"
            : /^C[-\s]|CASH/i.test(note)
              ? "CASH"
              : null;
      const eng = clean(r.engineer);
      const engUser = eng
        ? engineers.filter((u) => u.name.toUpperCase().split(/\s+/)[0] === eng.toUpperCase().split(/\s+/)[0])
        : [];
      const when = istDate(r.date) ?? new Date();
      // Spares used → Spare IDs where they can be told apart
      const used = [...parseSpares(clean(r.spares), spareList), ...spareUnitsIn(work, spareList)];
      p.spares = used;
      const unknownSpares = used.filter((s) => !s.spareId).map((s) => s.name);
      if (unknownSpares.length) warnings.push(`Spare not matched: ${unknownSpares.join(", ")}`);
      const ticketId = newId();
      for (const s of used.filter((x) => x.spareId)) {
        out.spareChanges.push({
          id: newId(),
          tenantId: t,
          contactId: contact.id,
          assetId,
          ticketId,
          partName: s.name.slice(0, 191),
          partCode: s.spareId,
          changeType: "REPLACED",
          quantity: s.qty,
          changedAt: when,
          underWarranty: cover === "GC" || cover === "AMC",
          notes: `From ${r.ref}`,
          newSerialNo: s.unitNo ?? null,
          customFields: { importBatch: batchId, importRegister: "SERVICE", written: s.written, unitNo: s.unitNo ?? null },
        });
      }
      const open = jobStatus === "PENDING" || jobStatus === "TAKEN_TO_OFFICE";
      out.tickets.push({
        id: ticketId,
        tenantId: t,
        subject: (quotation ? "Quotation" : work ? title(work) : "Service").slice(0, 191),
        description: [
          work && title(work),
          quotation && amount ? `Quotation ₹${amount}` : "",
          cover ? `Cover: ${cover}` : "",
          clean(r.serviceNo) ? `HMS service no. ${clean(r.serviceNo)}` : "",
          note ? `Payment: ${note}` : "",
          used.length
            ? `Spares: ${used.map((s) => `${s.spareId ? `${s.spareId} ` : ""}${s.name}${s.unitNo ? ` (${s.unitNo})` : ""} ×${s.qty}`).join(", ")}`
            : "",
          written ? `Machine as written: ${written}` : "",
          jobStatus !== "COMPLETED" ? `Status: ${jobStatus.replace(/_/g, " ").toLowerCase()}` : "",
          `Imported from ${r.ref}`,
        ]
          .filter(Boolean)
          .join("\n"),
        priority: "MEDIUM",
        status: jobStatus === "PENDING" ? "PENDING" : jobStatus === "TAKEN_TO_OFFICE" ? "IN_PROGRESS" : "CLOSED",
        contactId: contact.id,
        assetId,
        productId: sProduct?.id ?? wProduct?.id ?? (machine?.productId || null),
        assignedToId: engUser.length === 1 ? engUser[0]!.id : null,
        paymentTotal: quotation ? 0 : amount,
        advanceAmount: quotation ? 0 : advance,
        paymentStatus,
        paymentMethod: paymentStatus !== "UNPAID" && amount > 0 ? method : null,
        paymentReference: note || null,
        paidAt: paymentStatus === "PAID" && amount > 0 ? when : null,
        resolvedAt: open ? null : when,
        closedAt: open ? null : when,
        createdAt: when,
        customFields: {
          importKey: key,
          importBatch: batchId,
          importRegister: "SERVICE",
          hmsServiceNo: clean(r.serviceNo) || null,
          productCode: (sProduct ?? wProduct)?.code ?? null,
          machineHmsId: sHms || null,
          machineWritten: written || null,
          jobStatus,
          cancelled: jobStatus === "CANCELLED" || undefined,
          sparesUsed: used.length ? used : undefined,
          aiProduct: r.aiProduct ? true : undefined,
          coverage: cover,
          category: quotation ? "Other" : cover === "AMC" ? "AMC visit" : "Breakdown",
          freeJob: !quotation && amount <= 0 && (cover === "GC" || cover === "AMC"),
          quotationAmount: quotation ? amount || null : null,
          engineerName: eng ? title(eng) : null,
          area: area || null,
          sourceRow: r.ref,
        },
      });
    }
    out.preview.push(p);
  }
  if (elsewhere.length) {
    const owners = await prisma.contact.findMany({
      where: { id: { in: [...new Set(elsewhere.map((e) => e.contactId))] } },
      select: { id: true, name: true, mobile: true, phone: true },
    });
    const who = new Map(owners.map((o) => [o.id, `${o.name}${o.mobile || o.phone ? ` (${o.mobile || o.phone})` : ""}`]));
    for (const e of elsewhere) e.warnings.push(`${e.what} is already on ${who.get(e.contactId) ?? "another customer"} — skipped, check the phone`);
  }
  return out;
}

export async function preview(t: string, kind: Kind, rows: Array<SalesRow | ServiceRow>, opts: Options = {}) {
  const p = await plan(t, kind, rows, "preview", opts);
  const rowsOut = p.preview;
  return {
    rows: rowsOut,
    summary: {
      total: rowsOut.length,
      toImport: rowsOut.filter((r) => !r.skip).length,
      duplicates: rowsOut.filter((r) => r.duplicate).length,
      skipped: rowsOut.filter((r) => r.skip && !r.duplicate).length,
      newCustomers: p.newContacts.length,
      existingCustomers: new Set(rowsOut.filter((r) => r.contact === "existing").map((r) => r.contactName)).size,
      matched: rowsOut.filter((r) => r.product?.productId).length,
      notMatched: rowsOut.filter((r) => r.product && !r.product.productId).length,
      withWarnings: rowsOut.filter((r) => r.warnings.length).length,
    },
  };
}

/** Reserve a block of numbers from a counter in one round trip. */
async function reserve(t: string, key: string, prefix: string, padding: number, n: number, floor = 1) {
  if (n <= 0) return { first: 0, prefix, padding };
  const seq = await prisma.numberSequence.upsert({
    where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: key } },
    create: { tenantId: t, sequenceKey: key, prefix, nextValue: Math.max(floor, 1) + n, padding },
    update: { nextValue: { increment: n } },
  });
  let first = seq.nextValue - n;
  if (first < floor) {
    // Counter lagged behind rows created another way — jump past them
    await prisma.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: key } },
      data: { nextValue: floor + n },
    });
    first = floor;
  }
  return { first, prefix: seq.prefix || prefix, padding: seq.padding || padding };
}

export async function commit(
  t: string,
  userId: string,
  kind: Kind,
  rows: Array<SalesRow | ServiceRow>,
  batchId: string,
  fileName: string,
  opts: Options = {},
) {
  if (!/^[a-z0-9-]{8,40}$/i.test(batchId)) throw new AppError("Bad import batch id", 422);
  const p = await plan(t, kind, rows, batchId, opts);

  // New customers — numbered in one block
  if (p.newContacts.length) {
    const maxNo = await prisma.contact.aggregate({ where: { tenantId: t }, _max: { customerNo: true } });
    const block = await reserve(t, "CUSTOMER", "CUS-", 5, p.newContacts.length, (maxNo._max.customerNo ?? 0) + 1);
    const data = p.newContacts.map((c, i) => ({
      id: c.id,
      tenantId: t,
      customerNo: block.first + i,
      customerCode: formatCustomerCode(block.first + i, block.prefix, block.padding),
      name: c.name.slice(0, 191),
      phone: display(c.phone),
      mobile: display(c.phone),
      phoneNormalized: c.phone,
      street: c.street ? c.street.slice(0, 191) : null,
      area: c.area ? title(c.area).slice(0, 120) : null,
      country: "IN",
      ownerUserId: userId,
      customFields: {
        importBatch: batchId,
        importSources: [c.source],
        lastImportSource: c.source,
        createdByImport: true,
        ...(c.altPhones.length ? { altPhones: c.altPhones.map(display) } : {}),
        ...(c.industry ? { industry: title(c.industry) } : {}),
      },
    }));
    for (let i = 0; i < data.length; i += 200) await prisma.contact.createMany({ data: data.slice(i, i + 200) });
  }

  // Existing customers — fill only what is blank; remember the import source + industry
  if (p.contactFill.size) {
    const ids = [...p.contactFill.keys()];
    const current = await prisma.contact.findMany({
      where: { id: { in: ids } },
      select: { id: true, area: true, street: true, customFields: true },
    });
    const updates = current.map((c) => {
      const fill = p.contactFill.get(c.id)!;
      const prev = cf(c.customFields);
      const sources = Array.isArray(prev.importSources) ? prev.importSources.map(String) : [];
      const alt = [...new Set([...(Array.isArray(prev.altPhones) ? prev.altPhones.map(String) : []), ...fill.altPhones.map((x) => display(x)!)])];
      return prisma.contact.update({
        where: { id: c.id },
        data: {
          area: c.area || (fill.area ? title(fill.area).slice(0, 120) : null),
          street: c.street || (fill.street ? fill.street.slice(0, 191) : null),
          customFields: {
            ...prev,
            importSources: sources.includes(fill.source) ? sources : [...sources, fill.source],
            lastImportSource: fill.source,
            ...(alt.length ? { altPhones: alt } : {}),
            ...(!prev.industry && fill.industry ? { industry: title(fill.industry) } : {}),
          },
        },
      });
    });
    for (let i = 0; i < updates.length; i += 25) await Promise.all(updates.slice(i, i + 25));
  }

  if (p.assets.length) {
    for (let i = 0; i < p.assets.length; i += 200) {
      await prisma.customerAsset.createMany({ data: p.assets.slice(i, i + 200) as never });
    }
  }

  if (p.tickets.length) {
    const maxNo = await prisma.ticket.aggregate({ where: { tenantId: t }, _max: { ticketNo: true } });
    const block = await reserve(t, "TICKET", "TKT-", 5, p.tickets.length, (maxNo._max.ticketNo ?? 0) + 1);
    const data = p.tickets.map((x, i) => ({ ...x, ticketNo: block.first + i }));
    for (let i = 0; i < data.length; i += 200) await prisma.ticket.createMany({ data: data.slice(i, i + 200) as never });
  }
  if (p.spareChanges.length) {
    for (let i = 0; i < p.spareChanges.length; i += 200) {
      await prisma.sparePartChange.createMany({ data: p.spareChanges.slice(i, i + 200) as never });
    }
  }

  const result = {
    batchId,
    customersCreated: p.newContacts.length,
    customersUpdated: p.contactFill.size,
    machinesAdded: p.assets.length,
    serviceJobsAdded: p.tickets.length,
    duplicatesSkipped: p.preview.filter((r) => r.duplicate).length,
    rowsSkipped: p.preview.filter((r) => r.skip && !r.duplicate).length,
  };
  await prisma.auditLog.create({
    data: {
      id: newId(),
      tenantId: t,
      actorType: "USER",
      actorId: userId,
      action: `import.register.${kind.toLowerCase()}`,
      entityType: "import_batch",
      entityId: batchId,
      afterJson: { ...result, kind, fileName, rows: rows.length },
    },
  });
  return result;
}

/** Recent imports (one line per batch — a batch may have been sent in several parts). */
export async function listBatches(t: string) {
  const logs = await prisma.auditLog.findMany({
    where: { tenantId: t, action: { startsWith: "import.register." }, entityType: "import_batch" },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const byBatch = new Map<string, Record<string, unknown>>();
  for (const l of logs) {
    const a = cf(l.afterJson);
    const id = String(l.entityId);
    const prev = byBatch.get(id);
    const add = (k: string) => Number(prev?.[k] ?? 0) + Number(a[k] ?? 0);
    byBatch.set(id, {
      batchId: id,
      kind: a.kind,
      fileName: a.fileName,
      at: prev?.at ?? l.createdAt,
      undone: Boolean(prev?.undone) || l.action.endsWith(".undone"),
      rows: add("rows"),
      customersCreated: add("customersCreated"),
      machinesAdded: add("machinesAdded"),
      serviceJobsAdded: add("serviceJobsAdded"),
      duplicatesSkipped: add("duplicatesSkipped"),
    });
  }
  return [...byBatch.values()].slice(0, 30);
}

/** Take a whole import back out: its machines, service jobs and the customers it created. */
export async function undo(t: string, userId: string, batchId: string) {
  if (!/^[a-z0-9-]{8,40}$/i.test(batchId)) throw new AppError("Bad import batch id", 422);
  const now = new Date();
  const [assets, tickets, contacts] = await Promise.all([
    prisma.customerAsset.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, customFields: true } }),
    prisma.ticket.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, customFields: true } }),
    prisma.contact.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, customFields: true } }),
  ]);
  const mine = <T extends { customFields: unknown }>(l: T[]) => l.filter((x) => cf(x.customFields).importBatch === batchId);
  const a = mine(assets).map((x) => x.id);
  const k = mine(tickets).map((x) => x.id);
  if (a.length) await prisma.customerAsset.updateMany({ where: { id: { in: a } }, data: { deletedAt: now } });
  if (k.length) {
    await prisma.ticket.updateMany({ where: { id: { in: k } }, data: { deletedAt: now } });
    await prisma.sparePartChange.updateMany({ where: { tenantId: t, ticketId: { in: k } }, data: { deletedAt: now } });
  }
  // Customers made by this import go too — unless something else has been added for them since
  const made = mine(contacts).filter((c) => cf(c.customFields).createdByImport).map((c) => c.id);
  let removedContacts = 0;
  if (made.length) {
    const [stillAssets, stillTickets] = await Promise.all([
      prisma.customerAsset.groupBy({ by: ["contactId"], where: { tenantId: t, deletedAt: null, contactId: { in: made } }, _count: true }),
      prisma.ticket.groupBy({ by: ["contactId"], where: { tenantId: t, deletedAt: null, contactId: { in: made } }, _count: true }),
    ]);
    const busy = new Set([...stillAssets.map((x) => x.contactId), ...stillTickets.map((x) => x.contactId)]);
    const free = made.filter((id) => !busy.has(id));
    if (free.length) await prisma.contact.updateMany({ where: { id: { in: free } }, data: { deletedAt: now } });
    removedContacts = free.length;
  }
  const result = { batchId, machinesRemoved: a.length, serviceJobsRemoved: k.length, customersRemoved: removedContacts };
  await prisma.auditLog.create({
    data: {
      id: newId(),
      tenantId: t,
      actorType: "USER",
      actorId: userId,
      action: "import.register.undone",
      entityType: "import_batch",
      entityId: batchId,
      afterJson: result,
    },
  });
  return result;
}
