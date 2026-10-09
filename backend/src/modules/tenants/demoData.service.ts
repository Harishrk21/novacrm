import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { allocateCustomerIdentity } from "../contacts/customerIdentity.js";
import { ensureSpareStockTables } from "../spareStock/spareStock.service.js";
import { ensureDefaultChannels, postTeamChatBySlug } from "../teamChat/teamChat.service.js";
import { getWarehouseByCode } from "../inventory/warehouses.service.js";
import {
  familyCodeFromProduct,
  formatHmsUniqId,
  sequenceKeyForFamily,
} from "../inventory/hmsUniqId.js";

/** Full Chennai demo pack for customer presentations */
export const DEMO_PACK = "hms-chennai-10" as const;
const LEGACY_PACKS = ["hms-v1", DEMO_PACK] as const;
const TEAM_MSG_MARKER = `[[demoPack:${DEMO_PACK}]]`;
const TARGET_CUSTOMERS = 10;

export type DemoCounts = {
  accounts: number;
  contacts: number;
  customerAssets: number;
  leads: number;
  tickets: number;
  activities: number;
  deals: number;
  invoices: number;
  vendors: number;
  sparePartItems: number;
  spareStockTxns: number;
  stockUnits: number;
  teamMessages: number;
};

type DemoCustomer = {
  shop: string;
  industry: string;
  accountType: string;
  area: string;
  phone: string;
  email: string;
  owner: string;
  ownerPhone: string;
  ownerEmail: string;
  machines: Array<{
    machineType: "WEIGHING" | "BILLING" | "OTHER";
    name: string;
    model: string;
    serialNo: string;
    capacity?: string;
    accuracy?: string;
    servicePlan: "AMC" | "GC" | "NGC" | "NON_AMC";
    origin: "SOLD_BY_US" | "THIRD_PARTY";
  }>;
  ticket: {
    subject: string;
    description: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    status: "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED";
    category: string;
    paymentTotal?: number;
    advanceAmount?: number;
    paymentStatus?: "UNPAID" | "PARTIAL" | "PAID";
  };
  lead?: {
    name: string;
    company: string;
    status: "NEW" | "CONTACTED" | "QUALIFIED" | "DEMO" | "CONVERTED";
    description: string;
  };
};

const CHENNAI_CUSTOMERS: DemoCustomer[] = [
  {
    shop: "Anna Nagar Fresh Mart",
    industry: "Grocery",
    accountType: "Retail",
    area: "Anna Nagar",
    phone: "04426661001",
    email: "anna.nagar@demo.hms.local",
    owner: "R. Karthik",
    ownerPhone: "9999001001",
    ownerEmail: "karthik.annanagar@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "30kg Platform Scale",
        model: "RETSOL WS-30",
        serialNo: "HMS-CHN-1001",
        capacity: "30 kg",
        accuracy: "2 g",
        servicePlan: "AMC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Load cell drift — recalibration",
      description: "Unstable readings on 30 kg platform scale at billing counter.",
      priority: "HIGH",
      status: "OPEN",
      category: "Service",
      paymentTotal: 1500,
      advanceAmount: 0,
      paymentStatus: "UNPAID",
    },
    lead: {
      name: "Karthik — Extra counter scale",
      company: "Anna Nagar Fresh Mart",
      status: "QUALIFIED",
      description: "Wants second 15 kg scale for produce section.",
    },
  },
  {
    shop: "Velachery Textiles",
    industry: "Apparel",
    accountType: "Retail",
    area: "Velachery",
    phone: "04426661002",
    email: "velachery@demo.hms.local",
    owner: "Priya Selvam",
    ownerPhone: "9999001002",
    ownerEmail: "priya.velachery@demo.hms.local",
    machines: [
      {
        machineType: "BILLING",
        name: "Touch POS Billing",
        model: "SMART BM-Pro",
        serialNo: "HMS-CHN-1002",
        servicePlan: "GC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Printer not feeding paper",
      description: "Touch POS paper jam sensor error after power cut.",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      category: "Service",
      paymentTotal: 800,
      advanceAmount: 300,
      paymentStatus: "PARTIAL",
    },
  },
  {
    shop: "T Nagar Spices Hub",
    industry: "Wholesale",
    accountType: "Wholesale",
    area: "T Nagar",
    phone: "04426661003",
    email: "tnagar.spices@demo.hms.local",
    owner: "Suresh Kumar",
    ownerPhone: "9999001003",
    ownerEmail: "suresh.tnagar@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "60kg Table Top Scale",
        model: "RETSOL WS-60",
        serialNo: "HMS-CHN-1003",
        capacity: "60 kg",
        accuracy: "5 g",
        servicePlan: "AMC",
        origin: "SOLD_BY_US",
      },
      {
        machineType: "BILLING",
        name: "Billing Machine",
        model: "ISTHA Bill-X",
        serialNo: "HMS-CHN-1003B",
        servicePlan: "NON_AMC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Stamping renewal due",
      description: "Customer requested stamping appointment for 60 kg scale.",
      priority: "MEDIUM",
      status: "PENDING",
      category: "Stamping",
      paymentTotal: 2500,
      paymentStatus: "UNPAID",
    },
    lead: {
      name: "Suresh — Truck scale enquiry",
      company: "T Nagar Spices Hub",
      status: "DEMO",
      description: "Interested in 1 ton platform for godown.",
    },
  },
  {
    shop: "Adyar Super Mart",
    industry: "Grocery",
    accountType: "Retail",
    area: "Adyar",
    phone: "04426661004",
    email: "adyar.super@demo.hms.local",
    owner: "Lakshmi Narayan",
    ownerPhone: "9999001004",
    ownerEmail: "lakshmi.adyar@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "15kg Retail Scale",
        model: "SMART RS-15",
        serialNo: "HMS-CHN-1004",
        capacity: "15 kg",
        accuracy: "1 g",
        servicePlan: "GC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Display blank after restart",
      description: "LCD blank until power cycled twice. Needs board check.",
      priority: "HIGH",
      status: "RESOLVED",
      category: "Service",
      paymentTotal: 2200,
      advanceAmount: 2200,
      paymentStatus: "PAID",
    },
  },
  {
    shop: "Porur Hardware Mart",
    industry: "Hardware",
    accountType: "Retail",
    area: "Porur",
    phone: "04426661005",
    email: "porur.hardware@demo.hms.local",
    owner: "Anand Raj",
    ownerPhone: "9999001005",
    ownerEmail: "anand.porur@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "100kg Platform Scale",
        model: "RETSOL PS-100",
        serialNo: "HMS-CHN-1005",
        capacity: "100 kg",
        accuracy: "10 g",
        servicePlan: "AMC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Platform unstable — foot adjustment",
      description: "Scale rocks on uneven floor; needs leveling + recheck.",
      priority: "LOW",
      status: "CLOSED",
      category: "Service",
      paymentTotal: 500,
      advanceAmount: 500,
      paymentStatus: "PAID",
    },
  },
  {
    shop: "Tambaram Rice Traders",
    industry: "Agri / Rice",
    accountType: "Wholesale",
    area: "Tambaram",
    phone: "04426661006",
    email: "tambaram.rice@demo.hms.local",
    owner: "Murugan Selvam",
    ownerPhone: "9999001006",
    ownerEmail: "murugan.tambaram@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "300kg Platform Scale",
        model: "RETSOL PS-300",
        serialNo: "HMS-CHN-1006",
        capacity: "300 kg",
        accuracy: "50 g",
        servicePlan: "AMC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Overload warning false trigger",
      description: "Alarm beeps under 200 kg bags intermittently.",
      priority: "MEDIUM",
      status: "OPEN",
      category: "Service",
      paymentTotal: 1800,
      paymentStatus: "UNPAID",
    },
    lead: {
      name: "Murugan — Second godown scale",
      company: "Tambaram Rice Traders",
      status: "CONTACTED",
      description: "Needs another 300 kg unit for new godown.",
    },
  },
  {
    shop: "Guindy Auto Spares",
    industry: "Automobile",
    accountType: "Retail",
    area: "Guindy",
    phone: "04426661007",
    email: "guindy.auto@demo.hms.local",
    owner: "Vignesh R",
    ownerPhone: "9999001007",
    ownerEmail: "vignesh.guindy@demo.hms.local",
    machines: [
      {
        machineType: "BILLING",
        name: "Counter Billing Machine",
        model: "SMART BM-Lite",
        serialNo: "HMS-CHN-1007",
        servicePlan: "NON_AMC",
        origin: "THIRD_PARTY",
      },
    ],
    ticket: {
      subject: "Outside machine — keyboard sticky",
      description: "Third-party billing unit; keys stick when humid.",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      category: "Service",
      paymentTotal: 1200,
      advanceAmount: 500,
      paymentStatus: "PARTIAL",
    },
  },
  {
    shop: "Mylapore Jewellers",
    industry: "Jewellery",
    accountType: "Retail",
    area: "Mylapore",
    phone: "04426661008",
    email: "mylapore.jewels@demo.hms.local",
    owner: "Meenakshi Iyer",
    ownerPhone: "9999001008",
    ownerEmail: "meenakshi.mylapore@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "Jewellery Scale 300g",
        model: "ISTHA JS-300",
        serialNo: "HMS-CHN-1008",
        capacity: "300 g",
        accuracy: "0.01 g",
        servicePlan: "AMC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Calibration certificate request",
      description: "Need fresh calibration report for audit.",
      priority: "HIGH",
      status: "PENDING",
      category: "Stamping",
      paymentTotal: 3500,
      paymentStatus: "UNPAID",
    },
  },
  {
    shop: "Ambattur Engineering Works",
    industry: "Manufacturing",
    accountType: "Industrial",
    area: "Ambattur",
    phone: "04426661009",
    email: "ambattur.eng@demo.hms.local",
    owner: "Balaji Krishnan",
    ownerPhone: "9999001009",
    ownerEmail: "balaji.ambattur@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "1 Ton Floor Scale",
        model: "RETSOL FS-1000",
        serialNo: "HMS-CHN-1009",
        capacity: "1000 kg",
        accuracy: "200 g",
        servicePlan: "AMC",
        origin: "SOLD_BY_US",
      },
      {
        machineType: "WEIGHING",
        name: "Crane Scale 500kg",
        model: "SMART CS-500",
        serialNo: "HMS-CHN-1009B",
        capacity: "500 kg",
        accuracy: "100 g",
        servicePlan: "NGC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Floor scale junction box moisture",
      description: "Rain seepage near junction box — intermittent zero drift.",
      priority: "CRITICAL",
      status: "OPEN",
      category: "Service",
      paymentTotal: 4500,
      paymentStatus: "UNPAID",
    },
    lead: {
      name: "Balaji — Weighbridge quote",
      company: "Ambattur Engineering Works",
      status: "NEW",
      description: "Exploring 40T weighbridge for yard.",
    },
  },
  {
    shop: "Chromepet Provision Store",
    industry: "Grocery",
    accountType: "Retail",
    area: "Chromepet",
    phone: "04426661010",
    email: "chromepet.provision@demo.hms.local",
    owner: "Deepa Sundaram",
    ownerPhone: "9999001010",
    ownerEmail: "deepa.chromepet@demo.hms.local",
    machines: [
      {
        machineType: "WEIGHING",
        name: "30kg Price Computing Scale",
        model: "SMART PC-30",
        serialNo: "HMS-CHN-1010",
        capacity: "30 kg",
        accuracy: "2 g",
        servicePlan: "GC",
        origin: "SOLD_BY_US",
      },
    ],
    ticket: {
      subject: "Price labels not printing",
      description: "Computing scale prints blank labels after ribbon change.",
      priority: "MEDIUM",
      status: "CLOSED",
      category: "Service",
      paymentTotal: 900,
      advanceAmount: 900,
      paymentStatus: "PAID",
    },
  },
];

function demoTag(extra?: Record<string, unknown>): Prisma.InputJsonValue {
  return { demoPack: DEMO_PACK, ...extra } as Prisma.InputJsonValue;
}

function packJsonFilter(pack: string): Prisma.JsonNullableFilter {
  return { path: "$.demoPack", equals: pack };
}

function demoWhere(tenantId: string, pack: string = DEMO_PACK) {
  return {
    tenantId,
    deletedAt: null,
    customFields: packJsonFilter(pack),
  };
}

async function nextSeqNo(
  tenantId: string,
  sequenceKey: string,
  prefix: string,
  aggregate: () => Promise<number>,
) {
  return prisma.$transaction(async (tx) => {
    const minNext = (await aggregate()) + 1;
    let seq = await tx.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId, sequenceKey } },
    });
    if (!seq) {
      await tx.numberSequence.create({
        data: {
          tenantId,
          sequenceKey,
          prefix,
          nextValue: minNext + 1,
          padding: 5,
        },
      });
      return minNext;
    }
    const n = Math.max(seq.nextValue, minNext);
    await tx.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId, sequenceKey } },
      data: { nextValue: n + 1 },
    });
    return n;
  });
}

async function nextLeadNo(tenantId: string) {
  return nextSeqNo(tenantId, "LEAD", "ENQ-", async () => {
    const row = await prisma.lead.aggregate({
      where: { tenantId },
      _max: { leadNo: true },
    });
    return row._max.leadNo ?? 0;
  });
}

async function nextTicketNo(tenantId: string) {
  return nextSeqNo(tenantId, "TICKET", "TKT-", async () => {
    const row = await prisma.ticket.aggregate({
      where: { tenantId },
      _max: { ticketNo: true },
    });
    return row._max.ticketNo ?? 0;
  });
}

async function nextInvoiceNo(tenantId: string) {
  const year = new Date().getFullYear();
  const key = `INV-${year}`;
  const n = await nextSeqNo(tenantId, key, `INV-${year}-`, async () => {
    const rows = await prisma.invoice.findMany({
      where: { tenantId, invoiceNumber: { startsWith: `INV-${year}-` } },
      select: { invoiceNumber: true },
      take: 200,
    });
    let max = 0;
    for (const r of rows) {
      const m = r.invoiceNumber.match(/(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  });
  return `INV-${year}-${String(n).padStart(4, "0")}`;
}

async function countTeamDemoMessages(tenantId: string) {
  return prisma.teamMessage.count({
    where: {
      tenantId,
      deletedAt: null,
      body: { startsWith: TEAM_MSG_MARKER },
    },
  });
}

export async function demoDataCounts(tenantId: string): Promise<DemoCounts> {
  const base = demoWhere(tenantId);
  const [
    accounts,
    contacts,
    customerAssets,
    leads,
    tickets,
    activities,
    deals,
    invoices,
    vendors,
    sparePartItems,
    spareStockTxns,
    stockUnits,
    teamMessages,
  ] = await Promise.all([
    prisma.account.count({ where: base }),
    prisma.contact.count({ where: base }),
    prisma.customerAsset.count({ where: base }),
    prisma.lead.count({ where: base }),
    prisma.ticket.count({ where: base }),
    prisma.activity.count({ where: base }),
    prisma.deal.count({ where: base }),
    prisma.invoice.count({ where: base }),
    prisma.vendor.count({ where: base }),
    prisma.sparePartItem.count({ where: base }),
    prisma.spareStockTxn.count({ where: base }),
    prisma.stockUnit.count({ where: base }),
    countTeamDemoMessages(tenantId),
  ]);
  return {
    accounts,
    contacts,
    customerAssets,
    leads,
    tickets,
    activities,
    deals,
    invoices,
    vendors,
    sparePartItems,
    spareStockTxns,
    stockUnits,
    teamMessages,
  };
}

export async function demoDataStatus(tenantId: string) {
  const counts = await demoDataCounts(tenantId);
  const loaded = counts.accounts >= TARGET_CUSTOMERS;
  return { loaded, counts, pack: DEMO_PACK, targetCustomers: TARGET_CUSTOMERS };
}

async function softDeletePack(tenantId: string, pack: string) {
  const now = new Date();
  const soft = { deletedAt: now };
  const base = demoWhere(tenantId, pack);

  const demoTickets = await prisma.ticket.findMany({
    where: base,
    select: { id: true },
  });
  const ticketIds = demoTickets.map((t) => t.id);
  if (ticketIds.length) {
    await prisma.ticketMessage.deleteMany({
      where: { tenantId, ticketId: { in: ticketIds } },
    });
  }

  const demoInvoices = await prisma.invoice.findMany({
    where: base,
    select: { id: true },
  });
  const invoiceIds = demoInvoices.map((i) => i.id);
  if (invoiceIds.length) {
    await prisma.invoiceLine.deleteMany({
      where: { tenantId, invoiceId: { in: invoiceIds } },
    });
    await prisma.payment.updateMany({
      where: { tenantId, invoiceId: { in: invoiceIds }, deletedAt: null },
      data: soft,
    });
  }

  await prisma.teamMessage.updateMany({
    where: {
      tenantId,
      deletedAt: null,
      body: { startsWith: `[[demoPack:${pack}]]` },
    },
    data: soft,
  });

  await prisma.spareStockTxn.updateMany({ where: base, data: soft });
  await prisma.sparePartItem.updateMany({ where: base, data: soft });
  await prisma.stockUnit.updateMany({ where: base, data: soft });
  await prisma.activity.updateMany({ where: base, data: soft });
  await prisma.ticket.updateMany({ where: base, data: soft });
  await prisma.lead.updateMany({ where: base, data: soft });
  await prisma.deal.updateMany({ where: base, data: soft });
  await prisma.invoice.updateMany({ where: base, data: soft });
  await prisma.customerAsset.updateMany({ where: base, data: soft });
  await prisma.contact.updateMany({ where: base, data: soft });
  await prisma.account.updateMany({ where: base, data: soft });
  await prisma.vendor.updateMany({ where: base, data: soft });
}

async function ensureBrandsIfMissing(tenantId: string) {
  const n = await prisma.brand.count({ where: { tenantId, deletedAt: null } });
  if (n > 0) return;
  for (const b of [
    { code: "RETSOL", name: "RETSOL" },
    { code: "SMART", name: "SMART" },
    { code: "ISTHA", name: "ISTHA" },
  ]) {
    try {
      await prisma.brand.create({
        data: { id: newId(), tenantId, code: b.code, name: b.name, isActive: true },
      });
    } catch {
      /* unique race */
    }
  }
}

async function ensureDemoStockUnits(tenantId: string, userId: string): Promise<number> {
  const product = await prisma.product.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, sku: true, attributes: true },
  });
  if (!product) return 0;

  const existing = await prisma.stockUnit.count({
    where: { ...demoWhere(tenantId), productId: product.id },
  });
  if (existing >= 4) return existing;

  const wh = await getWarehouseByCode(tenantId, "MAIN");
  if (!wh) return 0;

  const fam = familyCodeFromProduct(product.attributes, product.sku);
  const year = new Date().getFullYear();
  const seqKey = sequenceKeyForFamily(year, fam);
  let seq = await prisma.numberSequence.findUnique({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey: seqKey } },
  });
  if (!seq) {
    seq = await prisma.numberSequence.create({
      data: {
        tenantId,
        sequenceKey: seqKey,
        prefix: `${year}-${fam}-`,
        nextValue: 9001,
        padding: 4,
      },
    });
  }

  const toCreate = 4 - existing;
  for (let i = 0; i < toCreate; i++) {
    const seqNo = seq.nextValue + i;
    const hmsUniqId = formatHmsUniqId(year, fam, seqNo);
    const serialNo = `DEMO-HMS-${DEMO_PACK}-${hmsUniqId}`;
    try {
      await prisma.stockUnit.create({
        data: {
          id: newId(),
          tenantId,
          productId: product.id,
          warehouseId: wh.id,
          serialNo,
          hmsUniqId,
          status: "IN_STOCK",
          notes: "Demo pack sample unit",
          customFields: demoTag({ seededBy: userId }),
        },
      });
    } catch {
      /* serial collision */
    }
  }
  await prisma.numberSequence.update({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey: seqKey } },
    data: { nextValue: seq.nextValue + toCreate },
  });
  return prisma.stockUnit.count({ where: demoWhere(tenantId) });
}

export async function loadDemoData(tenantId: string, userId: string) {
  const status = await demoDataStatus(tenantId);
  if (status.loaded) {
    return { ...status, alreadyLoaded: true as const };
  }

  // Clear partial / legacy demo packs so the demo always shows a clean Chennai set
  for (const pack of LEGACY_PACKS) {
    await softDeletePack(tenantId, pack);
  }

  await ensureBrandsIfMissing(tenantId);
  await ensureSpareStockTables();

  const [leadSource, wonStage, quoteStage, engineer, product] = await Promise.all([
    prisma.leadSource.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.pipelineStage.findFirst({
      where: { tenantId, isWon: true, isActive: true },
    }),
    prisma.pipelineStage.findFirst({
      where: { tenantId, code: "QUOTATION", isActive: true },
    }),
    prisma.user.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        status: "ACTIVE",
        OR: [
          { email: "engineer@hmsenterprises.in" },
          { email: { contains: "engineer" } },
        ],
      },
      select: { id: true },
    }),
    prisma.product.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, salePrice: true },
    }),
  ]);

  const assigneeId = engineer?.id ?? userId;
  const now = new Date();
  const inDays = (d: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + d);
    return x;
  };

  for (let i = 0; i < CHENNAI_CUSTOMERS.length; i++) {
    const c = CHENNAI_CUSTOMERS[i];
    const accountId = newId();
    const contactId = newId();
    const identity = await allocateCustomerIdentity(tenantId);
    const phoneNorm = normalizePhone(`91${c.ownerPhone}`)!;

    await prisma.account.create({
      data: {
        id: accountId,
        tenantId,
        name: c.shop,
        accountType: c.accountType,
        industry: c.industry,
        phone: c.phone,
        email: c.email,
        city: "Chennai",
        state: "Tamil Nadu",
        billingAddress: {
          line1: `${20 + i}, ${c.area} Main Road`,
          city: "Chennai",
          state: "Tamil Nadu",
          postalCode: String(600001 + i * 11),
        },
        ownerUserId: userId,
        description: `Demo customer — ${c.area}, Chennai.`,
        customFields: demoTag({ segment: c.accountType.toLowerCase(), area: c.area }),
      },
    });

    await prisma.contact.create({
      data: {
        id: contactId,
        tenantId,
        customerNo: identity.customerNo,
        customerCode: identity.customerCode,
        accountId,
        name: c.owner,
        email: c.ownerEmail,
        mobile: c.ownerPhone,
        phone: c.ownerPhone,
        phoneNormalized: phoneNorm,
        area: c.area,
        street: `${c.area} Main Road`,
        doorNo: String(20 + i),
        pincode: String(600001 + i * 11),
        city: "Chennai",
        state: "Tamil Nadu",
        ownerUserId: userId,
        customFields: demoTag({ role: "owner", area: c.area }),
      },
    });

    const assetIds: string[] = [];
    for (let mi = 0; mi < c.machines.length; mi++) {
      const m = c.machines[mi];
      const assetId = newId();
      assetIds.push(assetId);
      const amc = m.servicePlan === "AMC";
      await prisma.customerAsset.create({
        data: {
          id: assetId,
          tenantId,
          contactId,
          machineType: m.machineType,
          name: m.name,
          capacity: m.capacity ?? null,
          accuracy: m.accuracy ?? null,
          model: m.model,
          serialNo: m.serialNo,
          origin: m.origin,
          servicePlan: m.servicePlan,
          amcStartDate: amc ? inDays(-90 - i * 7) : null,
          amcEndDate: amc ? inDays(275 - i * 5) : null,
          nextServiceDueDate: amc ? inDays(10 + i * 3) : null,
          warrantyEndDate: m.servicePlan === "GC" ? inDays(40 + i * 5) : null,
          stampingDate: m.machineType === "WEIGHING" ? inDays(-180 + i * 10) : null,
          nextDueDate: m.machineType === "WEIGHING" ? inDays(20 + i * 8) : null,
          notes: `${c.area} site — demo machine`,
          customFields: demoTag({ area: c.area }),
        },
      });
    }

    const ticketNo = await nextTicketNo(tenantId);
    const ticketId = newId();
    const paid =
      c.ticket.paymentStatus === "PAID"
        ? inDays(-2 - (i % 5))
        : c.ticket.status === "RESOLVED" || c.ticket.status === "CLOSED"
          ? inDays(-1)
          : null;
    await prisma.ticket.create({
      data: {
        id: ticketId,
        tenantId,
        ticketNo,
        subject: c.ticket.subject,
        description: c.ticket.description,
        priority: c.ticket.priority,
        status: c.ticket.status,
        contactId,
        accountId,
        assetId: assetIds[0] ?? null,
        assignedToId: assigneeId,
        slaDueAt: c.ticket.status === "OPEN" || c.ticket.status === "IN_PROGRESS" ? inDays(1) : null,
        paymentTotal: c.ticket.paymentTotal ?? 0,
        advanceAmount: c.ticket.advanceAmount ?? 0,
        paymentStatus: c.ticket.paymentStatus ?? "UNPAID",
        paidAt: c.ticket.paymentStatus === "PAID" ? paid : null,
        resolvedAt:
          c.ticket.status === "RESOLVED" || c.ticket.status === "CLOSED" ? inDays(-1) : null,
        closedAt: c.ticket.status === "CLOSED" ? inDays(0) : null,
        customFields: demoTag({
          category: c.ticket.category,
          city: "Chennai",
          area: c.area,
          ...(c.ticket.status === "CLOSED"
            ? {
                serviceReport: {
                  summary: "Demo service completed — machine working normally.",
                  workDone: "Inspection, cleaning, and functional test.",
                  partsUsed: [],
                },
              }
            : {}),
        }),
      },
    });

    await prisma.ticketMessage.create({
      data: {
        id: newId(),
        tenantId,
        ticketId,
        content: `Demo note: job logged for ${c.shop} (${c.area}).`,
        isInternal: true,
        authorUserId: userId,
        authorName: "Demo Desk",
      },
    });

    await prisma.activity.create({
      data: {
        id: newId(),
        tenantId,
        type: i % 2 === 0 ? "CALL" : "VISIT",
        title: i % 2 === 0 ? `Call — ${c.shop}` : `Site visit — ${c.area}`,
        description: `Follow-up for ${c.ticket.subject}`,
        status: i % 3 === 0 ? "COMPLETED" : "PENDING",
        completedAt: i % 3 === 0 ? inDays(-1) : null,
        scheduledAt: i % 3 === 0 ? null : inDays(1 + (i % 4)),
        contactId,
        accountId,
        assignedToId: assigneeId,
        customFields: demoTag({ area: c.area }),
      },
    });

    if (c.lead) {
      const leadNo = await nextLeadNo(tenantId);
      const leadId = newId();
      await prisma.lead.create({
        data: {
          id: leadId,
          tenantId,
          leadNo,
          name: c.lead.name,
          email: c.ownerEmail,
          phone: c.ownerPhone,
          phoneNormalized: phoneNorm,
          company: c.lead.company,
          area: c.area,
          city: "Chennai",
          state: "Tamil Nadu",
          sourceId: leadSource?.id ?? null,
          status: c.lead.status,
          score: 50 + i * 4,
          assignedToId: userId,
          createdById: userId,
          description: c.lead.description,
          customFields: demoTag({
            area: c.area,
            demoDailyUpdates: [
              {
                dayNumber: 1,
                note: `Spoke with ${c.owner} at ${c.area}.`,
                updateDate: inDays(-2).toISOString().slice(0, 10),
                authorName: "Sales Demo",
                at: inDays(-2).toISOString(),
              },
            ],
          }),
        },
      });

      await prisma.activity.create({
        data: {
          id: newId(),
          tenantId,
          type: "TASK",
          title: `Follow up — ${c.lead.company}`,
          status: "PENDING",
          scheduledAt: inDays(2 + (i % 3)),
          leadId,
          assignedToId: userId,
          customFields: demoTag(),
        },
      });
    }

    // Deals + invoices for every other customer (keeps pipeline & billing populated)
    if (i % 2 === 0 && (wonStage || quoteStage)) {
      const stage = i % 4 === 0 && wonStage ? wonStage : quoteStage ?? wonStage!;
      const amount = 18000 + i * 2500;
      await prisma.deal.create({
        data: {
          id: newId(),
          tenantId,
          name: `${c.shop} — scale package`,
          amount,
          stageId: stage.id,
          probability: stage.isWon ? 100 : 50,
          expectedCloseDate: inDays(14 + i),
          closedAt: stage.isWon ? inDays(-5) : null,
          contactId,
          accountId,
          ownerUserId: userId,
          description: `Demo deal for ${c.area} site`,
          customFields: demoTag({ area: c.area }),
        },
      });

      if (product && stage.isWon) {
        const invNo = await nextInvoiceNo(tenantId);
        const invId = newId();
        const sub = amount;
        const tax = Math.round(sub * 0.18);
        const grand = sub + tax;
        await prisma.invoice.create({
          data: {
            id: invId,
            tenantId,
            invoiceNumber: invNo,
            accountId,
            contactId,
            status: "PAID",
            invoiceDate: inDays(-10 + i),
            dueDate: inDays(-3 + i),
            subtotal: sub,
            taxTotal: tax,
            grandTotal: grand,
            amountPaid: grand,
            createdById: userId,
            notes: "Demo invoice — Chennai customer pack",
            customFields: demoTag({ area: c.area }),
          },
        });
        await prisma.invoiceLine.create({
          data: {
            id: newId(),
            tenantId,
            invoiceId: invId,
            productId: product.id,
            description: product.name || "Weighing scale package",
            quantity: 1,
            unitPrice: sub,
            taxPercent: 18,
            lineTotal: grand,
          },
        });
        await prisma.payment.create({
          data: {
            id: newId(),
            tenantId,
            paymentNumber: `PAY-DEMO-${Date.now().toString(36)}-${i + 1}`,
            invoiceId: invId,
            accountId,
            direction: "INBOUND",
            method: "UPI",
            amount: grand,
            paidAt: inDays(-8 + i),
            referenceNo: `UPIDEMO${1000 + i}`,
            createdById: userId,
            notes: "Demo payment",
          },
        });
      }
    }
  }

  const vendorCount = await prisma.vendor.count({ where: { tenantId, deletedAt: null } });
  if (vendorCount === 0) {
    await prisma.vendor.create({
      data: {
        id: newId(),
        tenantId,
        name: "HMS Demo Parts Supplier",
        email: "parts-supplier@demo.hms.local",
        phone: "04426661999",
        paymentTerms: "Net 15",
        address: { city: "Chennai", state: "Tamil Nadu" },
        customFields: demoTag(),
      },
    });
  }

  const existingSpare = await prisma.sparePartItem.count({ where: demoWhere(tenantId) });
  if (existingSpare === 0) {
    const sparePartId = newId();
    await prisma.sparePartItem.create({
      data: {
        id: sparePartId,
        tenantId,
        machineFamily: "WEIGHING",
        name: "Demo pack — Load cell 30kg",
        partCode: "DEMO-LC-30",
        customFields: demoTag(),
      },
    });
    const txnDate = new Date(now.toISOString().slice(0, 10) + "T12:00:00");
    await prisma.spareStockTxn.create({
      data: {
        id: newId(),
        tenantId,
        sparePartId,
        txnType: "IN",
        quantity: 25,
        txnDate,
        supplierName: "HMS Demo Parts Supplier",
        invoiceDate: txnDate,
        invoiceNo: "DEMO-INV-CHENNAI-001",
        notes: "Opening stock for Chennai demo",
        createdById: userId,
        customFields: demoTag(),
      },
    });
  }

  await ensureDemoStockUnits(tenantId, userId);
  await ensureDefaultChannels(tenantId, userId);

  for (const text of [
    "Chennai demo pack ready — 10 customers with machines, service jobs, leads & billing.",
    "Tip: open Customers, Workqueue, and Service reports to walk through the demo.",
  ]) {
    await postTeamChatBySlug({
      tenantId,
      slug: "general",
      senderId: userId,
      body: `${TEAM_MSG_MARKER}\n${text}`,
    });
  }

  const finalStatus = await demoDataStatus(tenantId);
  return { ...finalStatus, alreadyLoaded: false as const };
}

export async function removeDemoData(tenantId: string) {
  for (const pack of LEGACY_PACKS) {
    await softDeletePack(tenantId, pack);
  }
  return demoDataStatus(tenantId);
}
