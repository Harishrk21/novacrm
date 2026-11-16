/**
 * Harish 2026-11-14: "create 5 new customer details in sales, service flow … each customer with unique
 * machines, single machine, more than one machine, then service tickets flow".
 * Runs the REAL flows through the API as each HMS login (sales → admin → warehouse → sales; desk →
 * engineer → desk/admin). Phone numbers are made up, so this must run against an API instance with
 * WhatsApp switched OFF (Harish chose "Made-up, no WhatsApp"); reminders are switched off on the new
 * machines at the end.
 *   PORT=10001 WHATSAPP_TOKEN= WHATSAPP_PHONE_NUMBER_ID= npx tsx src/server.ts   (separate shell)
 *   npx tsx --env-file=.env scripts/seed-hms-sample-customers-2026-11-14.ts --api=http://127.0.0.1:10001/api
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const API = process.argv.find((a) => a.startsWith("--api="))?.slice(6) ?? "";
if (!API || API.includes(":10000")) {
  throw new Error("Pass --api= pointing at the WhatsApp-OFF instance (not :10000) — the phone numbers are made up");
}
const TODAY = "2026-11-14";
const NEXT_YEAR = "2027-11-13";

type Session = { token: string; user: { id: string; name: string; tenantId: string } };
async function login(who: string): Promise<Session> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${who}@hmsenterprises.in`, password: "Demo@12345", tenantSlug: "hms" }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`login ${who}: ${j.message}`);
  return { token: j.data.accessToken, user: j.data.user };
}
async function call<T = any>(s: Session, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    throw new Error(`${method} ${path} → ${r.status} ${j.message ?? j.error?.message ?? ""} ${JSON.stringify(j.details ?? j.error?.details ?? "").slice(0, 300)}`);
  }
  return j.data as T;
}
const log = (m: string) => console.log(`  ✓ ${m}`);

const product = async (sku: string) => {
  const p = await prisma.product.findFirst({ where: { tenantId: T, sku, deletedAt: null } });
  if (!p) throw new Error(`product ${sku} missing`);
  return p;
};
const freeUnit = async (productId: string, skip: string[] = []) => {
  const u = await prisma.stockUnit.findFirst({
    where: { tenantId: T, productId, status: "IN_STOCK", deletedAt: null, id: { notIn: skip } },
    orderBy: { createdAt: "asc" },
  });
  if (!u) throw new Error(`no stock for product ${productId}`);
  return u;
};

type Line = { sku: string; stamp?: { number: string } };
type Sale = {
  person: string;
  company: string;
  phone: string;
  area: string;
  street: string;
  pincode: string;
  lines: Line[];
  total: number;
  advance: number; // paid at enquiry; balance settled after delivery
  followUp: string;
};

const s: Record<string, Session> = {};

async function runSale(sale: Sale) {
  const prods = await Promise.all(sale.lines.map((l) => product(l.sku)));
  const lead = await call(s.sales, "POST", "/leads", {
    name: sale.person,
    phone: sale.phone,
    company: sale.company,
    area: sale.area,
    city: "Chennai",
    state: "Tamil Nadu",
    country: "IN",
    status: "NEW",
    assignedToId: s.sales.user.id,
    serviceType: "SALES",
    description: `Enquiry for ${prods.map((p) => p.name).join(" + ")}`,
    customFields: {
      enquiry_date: TODAY,
      enquiry_way: "OFFICE_VISIT",
      customer_type: "New customer",
      interested_products: prods.map((p) => ({ id: p.id, name: p.name })),
      interested_product_id: prods[0].id,
      interested_product_name: prods.map((p) => p.name).join(", "),
      salePaymentTotal: sale.total,
      budget: sale.total,
      saleAdvanceAmount: sale.advance,
      saleDueAmount: sale.total - sale.advance,
      street: sale.street,
      pincode: sale.pincode,
      leadUpdates: [],
      timelineHistory: [{ type: "created", message: "Lead created · SALES · Office visit", at: new Date().toISOString(), by: s.sales.user.name }],
    },
  });
  log(`${sale.company}: enquiry created (${prods.map((p) => p.name).join(" + ")}, ₹${sale.total.toLocaleString("en-IN")})`);

  await call(s.sales, "POST", "/activities", {
    type: "CALL",
    title: `Follow-up call — ${sale.company}`,
    description: sale.followUp,
    status: "COMPLETED",
    scheduledAt: new Date().toISOString(),
    outcome: "Ready to buy",
    leadId: lead.id,
    assignedToId: s.sales.user.id,
  });
  log("follow-up call logged");

  const stage = await prisma.pipelineStage.findFirst({ where: { tenantId: T }, orderBy: { sortOrder: "asc" } });
  await call(s.sales, "POST", `/leads/${lead.id}/convert`, {
    stageId: stage?.id,
    dealName: `${sale.company} — Sale`,
    amount: sale.total,
    createAccount: true,
  });
  log("converted (Ready to buy) → customer + company created");

  const req = await call(s.sales, "POST", "/requisitions", { leadId: lead.id, advanceAmount: sale.advance, paymentNotes: `Advance ₹${sale.advance.toLocaleString("en-IN")} received` });
  log(`release request ${req.reqNumber} sent`);
  await call(s.admin, "POST", `/requisitions/${req.id}/approve`, {});
  log("admin accepted");

  await call(s.wh, "POST", `/requisitions/${req.id}/stamping`, {
    stampingRequired: sale.lines.some((l) => l.stamp),
    vcNumber: sale.lines.find((l) => l.stamp)?.stamp?.number ?? null,
    lines: sale.lines.map((l, i) => ({
      label: prods[i].name,
      stampingRequired: Boolean(l.stamp),
      stampingDate: l.stamp ? TODAY : null,
      nextDueDate: l.stamp ? NEXT_YEAR : null,
      stampingNumber: l.stamp?.number ?? null,
      stampingQuarter: l.stamp ? "D" : null,
    })),
  });
  log("warehouse confirmed stamping");

  const used: string[] = [];
  let last: any = null;
  for (const p of prods) {
    const u = await freeUnit(p.id, used);
    used.push(u.id);
    last = await call(s.wh, "POST", `/requisitions/${req.id}/fulfill`, { markShipped: false, stockUnitId: u.id });
    log(`stock out: ${p.name} serial ${u.serialNo || u.hmsUniqId}`);
  }
  if (last?.status !== "FULFILLED") throw new Error(`release not fulfilled: ${last?.status}`);
  const dc = await call(s.wh, "POST", `/requisitions/${req.id}/delivery-challan`, { notes: "Delivered and installed at site" });
  log(`delivery challan ${dc?.dcNumber ?? dc?.customFields?.dcNumber ?? "created"}`);
  await call(s.wh, "POST", `/requisitions/${req.id}/ship`, {});
  log("ready to ship / shipped");

  await call(s.sales, "POST", `/requisitions/${req.id}/payment`, { total: sale.total, advance: sale.total });
  if (sale.total > sale.advance) {
    await call(s.sales, "POST", `/requisitions/${req.id}/payment-note`, { note: `Balance ₹${(sale.total - sale.advance).toLocaleString("en-IN")} received on delivery` });
  }
  log("payment settled (due ₹0)");

  const fresh = await call(s.sales, "GET", `/leads/${lead.id}`);
  await call(s.sales, "PATCH", `/leads/${lead.id}`, {
    customFields: { ...(fresh.customFields ?? {}), saleCompletedAt: new Date().toISOString(), saleCompletedBy: s.sales.user.name, saleCompletedById: s.sales.user.id },
  });
  log("sale marked complete");
  const after = await call(s.sales, "GET", `/leads/${lead.id}`);
  const contactId = String(after.convertedContactId ?? after.customFields?.contact_id ?? "");
  if (!contactId) throw new Error("no customer created by convert");
  return { contactId, leadId: lead.id as string, reqNumber: req.reqNumber as string };
}

type Job = {
  contactId: string;
  assetId: string;
  subject: string;
  description: string;
  category: "Breakdown" | "Installation" | "AMC visit";
  priority?: "LOW" | "MEDIUM" | "HIGH";
  report: { found: string; done: string; readings?: string; next?: string; outcome: "DONE" | "WAITING_PARTS" | "CONTINUE" };
  pay?: { method: "CASH" | "UPI"; amount: number; reference?: string };
  free?: boolean;
  closeBy?: "desk" | "admin";
  stopAfterReport?: boolean;
};
async function runJob(j: Job) {
  const t = await call(s.desk, "POST", "/tickets", {
    subject: j.subject,
    description: j.description,
    priority: j.priority ?? "MEDIUM",
    status: "OPEN",
    contactId: j.contactId,
    assetId: j.assetId,
    customFields: { category: j.category, channel: "Phone" },
  });
  const code = `SVC-${String(t.ticketNo).padStart(5, "0")}`;
  log(`${code} logged by desk — ${j.subject}`);
  let cur = await call(s.eng, "POST", `/tickets/${t.id}/claim`, {});
  if (cur.status === "OPEN") cur = await call(s.eng, "PATCH", `/tickets/${t.id}`, { status: "IN_PROGRESS" });
  log("engineer accepted and started");
  cur = await call(s.eng, "GET", `/tickets/${t.id}`);
  await call(s.eng, "PATCH", `/tickets/${t.id}`, {
    customFields: {
      ...(cur.customFields ?? {}),
      dayNotes: [
        {
          id: `wr-${Date.now()}`,
          day: 1,
          date: TODAY,
          at: new Date().toISOString(),
          byUserId: s.eng.user.id,
          byName: s.eng.user.name,
          structured: true,
          found: j.report.found,
          done: j.report.done,
          readings: j.report.readings ?? "",
          next: j.report.next ?? "",
          outcome: j.report.outcome,
          note: j.report.done,
        },
      ],
    },
  });
  log("work report filled");
  if (j.stopAfterReport) return { id: t.id as string, code };
  await finishJob(t.id, j);
  return { id: t.id as string, code };
}

/** Online payments need a proof image (app rule) — upload one the way the ticket page does. */
async function uploadProof(file: string) {
  const fs = await import("node:fs");
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "image/png" }), "upi-receipt.png");
  const r = await fetch(`${API}/uploads/image`, { method: "POST", headers: { Authorization: `Bearer ${s.eng.token}` }, body: form });
  const j = await r.json();
  if (!r.ok || !j.success) throw new Error(`upload proof: ${j.message}`);
  return String(j.data.url);
}

async function finishJob(id: string, j: Job) {
  if (j.free) {
    const cur = await call(s.eng, "GET", `/tickets/${id}`);
    await call(s.eng, "PATCH", `/tickets/${id}`, { customFields: { ...(cur.customFields ?? {}), freeJob: true } });
    log("marked free job (under GC / AMC)");
  } else if (j.pay) {
    const proof = j.pay.method === "UPI" ? await uploadProof(PROOF_FILE) : null;
    await call(s.eng, "POST", `/tickets/${id}/mark-paid`, {
      paymentMethod: j.pay.method,
      paymentReference: j.pay.reference ?? null,
      paymentProofUrl: proof,
      paymentTotal: j.pay.amount,
      advanceAmount: 0,
      sendWhatsApp: false,
    });
    log(`paid ₹${j.pay.amount.toLocaleString("en-IN")} by ${j.pay.method}${j.pay.reference ? ` (${j.pay.reference}, proof uploaded)` : ""}`);
  }
  await call(s.eng, "PATCH", `/tickets/${id}`, { status: "RESOLVED" });
  log("engineer marked complete");
  await call(j.closeBy === "admin" ? s.admin : s.desk, "PATCH", `/tickets/${id}`, { status: "CLOSED" });
  log(`approved & closed by ${j.closeBy ?? "desk"}`);
}
const PROOF_FILE =
  process.argv.find((a) => a.startsWith("--proof="))?.slice(8) ??
  "C:/Users/DELL/AppData/Local/Temp/claude/ef2eb5978be4dee1/79850363-1f50-446a-afe1-e84fd4565e9e/scratchpad/upi-receipt-sample.png";

const assetOf = async (contactId: string, name: string) => {
  const a = await prisma.customerAsset.findFirst({ where: { tenantId: T, contactId, name, deletedAt: null } });
  if (!a) throw new Error(`machine ${name} not found for customer`);
  return a;
};

/** --resume: the first run stopped at SVC-00061's UPI payment (proof needed) — finish it, then customer 5. */
async function resume() {
  const c4 = await prisma.contact.findFirst({ where: { tenantId: T, deletedAt: null, phone: { contains: "9444175829" } } });
  if (!c4) throw new Error("Annai Rice Mandi not found");
  const t = await prisma.ticket.findFirst({ where: { tenantId: T, deletedAt: null, contactId: c4.id, status: "IN_PROGRESS" } });
  if (!t) {
    console.log("\n4. (resume) SVC-00061 already finished");
    return [c4.id];
  }
  console.log(`\n4. (resume) finishing SVC-${String(t.ticketNo).padStart(5, "0")}`);
  await finishJob(t.id, {
    contactId: c4.id, assetId: t.assetId ?? "", subject: "", description: "", category: "Breakdown",
    report: { found: "", done: "", outcome: "DONE" }, pay: { method: "UPI", amount: 2500, reference: "UTR 431852907716" },
  });
  return [c4.id];
}

async function main() {
  for (const who of ["sales", "admin", "warehouse", "desk", "engineer"]) {
    s[who === "warehouse" ? "wh" : who === "engineer" ? "eng" : who] = await login(who);
  }
  if (process.argv.includes("--resume")) {
    await resume();
    const all = await prisma.contact.findMany({ where: { tenantId: T, deletedAt: null }, select: { id: true } });
    await part5(all.map((c) => c.id));
    return;
  }
  const existing = await prisma.contact.count({ where: { tenantId: T, deletedAt: null } });
  if (existing > 0) throw new Error(`${existing} customers already exist — this seed expects a cleared list`);
  const contactIds: string[] = [];

  console.log("\n1. Sri Lakshmi Supermarket — 2 machines bought from us, free installation visit");
  const c1 = await runSale({
    person: "Ramesh Babu", company: "Sri Lakshmi Supermarket", phone: "9840156721", area: "T. Nagar",
    street: "42, Usman Road", pincode: "600017",
    lines: [{ sku: "HMS-WS-RET-PRICE-COMP", stamp: { number: "LM/CHN/2026/4412" } }, { sku: "HMS-BM-2T-SUPERSTAR" }],
    total: 68000, advance: 20000, followUp: "Visited store, confirmed 1 price computing scale + 1 billing machine for the new counter.",
  });
  contactIds.push(c1.contactId);
  const c1scale = await assetOf(c1.contactId, (await product("HMS-WS-RET-PRICE-COMP")).name);
  await runJob({
    contactId: c1.contactId, assetId: c1scale.id, category: "Installation", priority: "MEDIUM",
    subject: "Installation & demo — Price Computing Scale", description: "New scale delivered; install at billing counter and train staff.",
    report: { found: "New unit, sealed. Counter power point available.", done: "Installed at counter 2, set PLU for 12 items, trained 2 staff.", readings: "Test weight 5 kg → 5.000 kg", outcome: "DONE" },
    free: true, closeBy: "admin",
  });

  console.log("\n2. Kaveri Sweets — 1 machine bought from us (paid in full), free breakdown repair under GC");
  const c2 = await runSale({
    person: "Kavitha Raman", company: "Kaveri Sweets", phone: "9884273150", area: "Mylapore",
    street: "18, North Mada Street", pincode: "600004",
    lines: [{ sku: "HMS-WS-RET-TABLE-TOP", stamp: { number: "LM/CHN/2026/4413" } }],
    total: 14500, advance: 14500, followUp: "Called back — wants table top scale for the sweets counter, paying full amount.",
  });
  contactIds.push(c2.contactId);
  const c2scale = await assetOf(c2.contactId, (await product("HMS-WS-RET-TABLE-TOP")).name);
  await runJob({
    contactId: c2.contactId, assetId: c2scale.id, category: "Breakdown", priority: "HIGH",
    subject: "Display not turning on", description: "Customer says scale display stays blank after power cut.",
    report: { found: "Adaptor pin loose after power surge.", done: "Re-soldered adaptor pin, checked battery backup.", readings: "Test weight 2 kg → 2.000 kg", outcome: "DONE" },
    free: true,
  });

  console.log("\n3. Murugan Jewellers — outside machine only (not bought from us), paid repair");
  const c3 = await call(s.desk, "POST", "/contacts", {
    name: "S. Murugan", mobile: "9790318462", area: "Purasawalkam", city: "Chennai", state: "Tamil Nadu",
    street: "7, Purasawalkam High Road", pincode: "600007", description: "Murugan Jewellers — service customer (machine bought elsewhere)",
    customFields: { companyName: "Murugan Jewellers" },
  });
  contactIds.push(c3.id);
  log("desk added customer S. Murugan (Murugan Jewellers)");
  const m3 = await call(s.desk, "POST", "/assets", {
    contactId: c3.id, machineType: "WEIGHING", name: "Jewellery Scale 300 g (Essae)", capacity: "300 g", accuracy: "10 mg",
    model: "Essae DS-852J", serialNo: "ESJ-21-55870", origin: "THIRD_PARTY", servicePlan: "NON_AMC", remindersEnabled: false,
    notes: "Bought from another dealer in 2021",
  });
  log("outside machine registered: Jewellery Scale 300 g (Essae)");
  await runJob({
    contactId: c3.id, assetId: m3.id, category: "Breakdown", priority: "HIGH",
    subject: "Weight drifting — not holding zero", description: "Reading keeps changing by 20–30 mg on an empty pan.",
    report: { found: "Load cell cable worn near the pan holder; dust inside.", done: "Replaced load cell cable, cleaned and recalibrated.", readings: "Test weight 100 g → 100.00 g, zero stable", outcome: "DONE" },
    pay: { method: "CASH", amount: 1800 },
  });

  console.log("\n4. Annai Rice Mandi — 1 machine from us + 2 outside machines (one on AMC), paid repair");
  const c4 = await runSale({
    person: "P. Selvaraj", company: "Annai Rice Mandi", phone: "9444175829", area: "Koyambedu",
    street: "Shop 112, Koyambedu Market", pincode: "600107",
    lines: [{ sku: "HMS-WS-IND-HEAVY-PLATFORM", stamp: { number: "LM/CHN/2026/4414" } }],
    total: 42000, advance: 10000, followUp: "Needs 500 kg platform scale for rice bags; advance paid, balance on delivery.",
  });
  contactIds.push(c4.contactId);
  await call(s.desk, "POST", "/assets", {
    contactId: c4.contactId, machineType: "WEIGHING", name: "Platform Scale 300 kg (outside)", capacity: "300 kg", accuracy: "50 g",
    model: "Avery PS-300", serialNo: "AV-19-30871", origin: "THIRD_PARTY", servicePlan: "AMC",
    amcStartDate: "2026-06-01", amcEndDate: "2027-05-31", nextServiceDueDate: "2026-12-01", remindersEnabled: false,
    notes: "Bought elsewhere in 2019 — on HMS AMC from June 2026",
  });
  log("outside machine on AMC registered: Platform Scale 300 kg (AMC Jun 2026 – May 2027)");
  const m4 = await call(s.desk, "POST", "/assets", {
    contactId: c4.contactId, machineType: "BILLING", name: "Billing Printer (outside)", model: "TVS RP 3160 Gold",
    serialNo: "TVS-3160-88213", origin: "THIRD_PARTY", servicePlan: "NON_AMC", remindersEnabled: false,
    notes: "Bought from another dealer",
  });
  log("outside machine registered: Billing Printer (TVS RP 3160)");
  await runJob({
    contactId: c4.contactId, assetId: m4.id, category: "Breakdown",
    subject: "Printer cutting bills half-way", description: "Bill paper jams and prints only half the bill.",
    report: { found: "Auto-cutter blade worn, paper path dirty.", done: "Replaced cutter blade, cleaned print head and paper path.", readings: "20 test bills printed OK", outcome: "DONE" },
    pay: { method: "UPI", amount: 2500, reference: "UTR 431852907716" },
  });

  await part5(contactIds);
}

async function part5(contactIds: string[]) {
  console.log("\n5. Chennai Pharma Distributors — 3 machines from us, breakdown job still in progress");
  const c5 = await runSale({
    person: "Arun Prakash", company: "Chennai Pharma Distributors", phone: "9677240513", area: "Anna Nagar",
    street: "AE-56, 2nd Avenue", pincode: "600040",
    lines: [{ sku: "HMS-OA-CASH-COUNT" }, { sku: "HMS-OA-FINGER-BIO" }, { sku: "HMS-WS-IND-LABEL-PRINT", stamp: { number: "LM/CHN/2026/4415" } }],
    total: 96500, advance: 30000, followUp: "Warehouse expansion — cash counter, attendance biometric and label printing scale.",
  });
  contactIds.push(c5.contactId);
  const c5cash = await assetOf(c5.contactId, (await product("HMS-OA-CASH-COUNT")).name);
  const live = await runJob({
    contactId: c5.contactId, assetId: c5cash.id, category: "Breakdown", priority: "MEDIUM",
    subject: "Counting machine rejecting new ₹500 notes", description: "Machine shows error E3 on new ₹500 notes.",
    report: { found: "UV sensor needs firmware update for new note series.", done: "Cleaned sensors; firmware file requested from the brand.", next: "Install firmware on next visit", outcome: "WAITING_PARTS" },
    stopAfterReport: true,
  });
  log(`${live.code} left IN PROGRESS (engineer waiting for firmware)`);

  // Made-up numbers: never send AMC / stamping / service reminders to them
  const off = await prisma.customerAsset.updateMany({ where: { tenantId: T, contactId: { in: contactIds } }, data: { remindersEnabled: false } });
  console.log(`\nReminders switched off on ${off.count} machines (made-up phone numbers).`);
  console.log(JSON.stringify({ contactIds }));
}

main().catch((e) => { console.error("\nSTOPPED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
