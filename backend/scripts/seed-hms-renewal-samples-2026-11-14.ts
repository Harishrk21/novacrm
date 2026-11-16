/**
 * Harish 2026-11-14: "renewal of stamping and AMC … test it with data". The 5 sample customers only had
 * machines bought this week, so every renewal list would be empty. This adds older machines to them
 * (like existing customers from before the CRM) so each list has real cases, through the desk login and
 * the normal machines API. Made-up customers → reminders OFF on every machine.
 *   npx tsx --env-file=.env scripts/seed-hms-renewal-samples-2026-11-14.ts [--api=http://127.0.0.1:10000/api]
 * Refuses to run while HMS WhatsApp is on (run whatsapp-off-hms-2026-11-14.ts first).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const API = process.argv.find((a) => a.startsWith("--api="))?.slice(6) ?? "http://127.0.0.1:10000/api";

async function main() {
  const wa = await prisma.tenantModule.findFirst({ where: { tenantId: T, moduleKey: "engagement.whatsapp" } });
  if (wa?.isEnabled) throw new Error("HMS WhatsApp module is still ON — run scripts/whatsapp-off-hms-2026-11-14.ts first");

  const login = await (await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "desk@hmsenterprises.in", password: "Demo@12345", tenantSlug: "hms" }),
  })).json();
  if (!login.success) throw new Error("desk login failed");
  const tok = login.data.accessToken as string;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(`${method} ${path} → ${r.status} ${j.message ?? ""}`);
    return j.data;
  };
  const customer = async (phone: string) => {
    const c = await prisma.contact.findFirst({ where: { tenantId: T, deletedAt: null, OR: [{ phone: { contains: phone } }, { mobile: { contains: phone } }] } });
    if (!c) throw new Error(`customer ${phone} not found`);
    return c;
  };
  const already = await prisma.customerAsset.count({ where: { tenantId: T, deletedAt: null, notes: { contains: "[renewal sample]" } } });
  if (already) throw new Error(`${already} renewal sample machines already exist`);

  const machines: Array<{ phone: string; body: Record<string, unknown>; label: string }> = [
    {
      phone: "9884273150", label: "Kaveri Sweets — outside counter scale, stamping 9 days overdue, no cover (AMC offer)",
      body: { machineType: "WEIGHING", name: "Counter Scale 30 kg (outside)", capacity: "30 kg", model: "Essae DS-215", serialNo: "ES-215-40981",
        origin: "THIRD_PARTY", servicePlan: "NGC", stampingDate: "2025-11-05", nextDueDate: "2026-11-05", notes: "Bought from another dealer in 2022 [renewal sample]" },
    },
    {
      phone: "9444175829", label: "Annai Rice Mandi — outside hanging scale on AMC ending in 30 days, stamping due in 31–90 days",
      body: { machineType: "WEIGHING", name: "Hanging Scale 100 kg (outside)", capacity: "100 kg", model: "Avery HS-100", serialNo: "AV-HS-22-118",
        origin: "THIRD_PARTY", servicePlan: "AMC", amcStartDate: "2025-12-15", amcEndDate: "2026-12-14", nextServiceDueDate: "2026-12-15",
        stampingDate: "2026-01-20", nextDueDate: "2027-01-20", notes: "Bought elsewhere — on HMS AMC since Dec 2025 [renewal sample]" },
    },
    {
      phone: "9840156721", label: "Sri Lakshmi Supermarket — HMS table top bought Dec 2025: guarantee ends in 36 days, stamping due in 34 days",
      body: { machineType: "WEIGHING", name: "Table Top (2025)", capacity: "30 kg", model: "HMS-WS-RET-TABLE-TOP", serialNo: "2025-WS-0412",
        origin: "SOLD_BY_US", servicePlan: "GC", warrantyEndDate: "2026-12-20", stampingDate: "2025-12-18", nextDueDate: "2026-12-18",
        notes: "Bought from HMS on 20 Dec 2025 (before CRM) [renewal sample]" },
    },
    {
      phone: "9677240513", label: "Chennai Pharma — HMS billing machine, guarantee ends in 16 days (becomes NGC)",
      body: { machineType: "BILLING", name: "HMS Junior Star (2025)", model: "HMS-BM-JUNIOR-STAR", serialNo: "2025-BM-0233",
        origin: "SOLD_BY_US", servicePlan: "GC", warrantyEndDate: "2026-11-30", notes: "Bought from HMS on 30 Nov 2025 (before CRM) [renewal sample]" },
    },
    {
      phone: "9677240513", label: "Chennai Pharma — HMS platform scale from 2024: guarantee over (NGC), stamping date never recorded",
      body: { machineType: "WEIGHING", name: "Platform Scale 300 kg (2024)", capacity: "300 kg", model: "HMS-WS-RET-PLATFORM", serialNo: "2024-WS-0907",
        origin: "SOLD_BY_US", servicePlan: "NGC", warrantyEndDate: "2025-08-10", notes: "Bought from HMS on 10 Aug 2024 (before CRM) [renewal sample]" },
    },
  ];
  for (const m of machines) {
    const c = await customer(m.phone);
    await call("POST", "/assets", { ...m.body, contactId: c.id, remindersEnabled: false });
    console.log("  ✓", m.label);
  }
  // Murugan Jewellers' existing outside scale: last stamped 2 Dec 2025 → due in 18 days
  const mj = await customer("9790318462");
  const scale = await prisma.customerAsset.findFirst({ where: { tenantId: T, contactId: mj.id, deletedAt: null } });
  if (scale) {
    await call("PATCH", `/assets/${scale.id}`, { stampingDate: "2025-12-02", nextDueDate: "2026-12-02" });
    console.log("  ✓ Murugan Jewellers — jewellery scale stamping recorded 2 Dec 2025 (due in 18 days)");
  }
  const off = await prisma.customerAsset.updateMany({ where: { tenantId: T, deletedAt: null }, data: { remindersEnabled: false } });
  console.log(`Reminders off on ${off.count} machines.`);
}

main().catch((e) => { console.error("STOPPED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
