import { prisma } from "../../config/database.js";
import { roleHasPermission, type Permission } from "../../common/permissions.js";
import { AppError } from "../../common/errors.js";

/**
 * Business registers for HMS — each returns plain rows the web app shows, totals, and exports
 * to Excel / CSV / PDF. Every report is tenant-scoped and gated by the section's view permission.
 */

export type ColType = "text" | "date" | "money" | "number";
export type Column = { key: string; label: string; type?: ColType };
export type ReportResult = {
  key: string;
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, number>;
  dateFilter: boolean;
};
export type ReportParams = {
  from: Date;
  to: Date;
  personId?: string;
  status?: string;
};

type Def = {
  key: string;
  group: "Service" | "Sales" | "Billing" | "Stock" | "Customers" | "History";
  title: string;
  description: string;
  permission: Permission;
  /** false = a "right now" list (stock, dues) — the date range doesn't apply */
  dateFilter: boolean;
  statuses?: Array<{ value: string; label: string }>;
  person?: "engineer" | "salesperson" | "anyone";
  run: (t: string, p: ReportParams) => Promise<Omit<ReportResult, "key" | "title" | "dateFilter">>;
};

const MAX_ROWS = 5000;
const pad = (n: number) => String(n).padStart(2, "0");
/** yyyy-mm-dd in server local time (IST — see config/timezone.ts) */
const ymd = (d: Date | null | undefined) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
const num = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const cf = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const ACRONYMS = new Set(["UPI", "NEFT", "RTGS", "IMPS", "GST", "AMC", "GC", "NGC", "DC"]);
const label = (s: string | null | undefined) =>
  s
    ? ACRONYMS.has(s.toUpperCase())
      ? s.toUpperCase()
      : s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
const sum = (rows: Array<Record<string, unknown>>, key: string) =>
  Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;

async function userNames(t: string) {
  const users = await prisma.user.findMany({ where: { tenantId: t }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}
async function contactMap(t: string, ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map<string, { name: string; phone: string | null; code: string | null; city: string | null }>();
  const rows = await prisma.contact.findMany({
    where: { tenantId: t, id: { in: list } },
    select: { id: true, name: true, phone: true, mobile: true, customerCode: true, city: true },
  });
  return new Map(rows.map((c) => [c.id, { name: c.name, phone: c.mobile || c.phone, code: c.customerCode, city: c.city }]));
}
async function assetMap(t: string, ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map<string, { name: string; serialNo: string | null }>();
  const rows = await prisma.customerAsset.findMany({
    where: { tenantId: t, id: { in: list } },
    select: { id: true, name: true, serialNo: true },
  });
  return new Map(rows.map((a) => [a.id, { name: a.name, serialNo: a.serialNo }]));
}
/** Product a lead is about — same fallbacks the lead page uses */
const leadProduct = (c: Record<string, unknown>) =>
  String(c.demoProductName ?? c.interested_product_name ?? c.product_interest ?? c.requirement ?? c.productName ?? "");
const serviceNo = (n: number | null | undefined) => (n != null ? `SVC-${String(n).padStart(5, "0")}` : "");
const balanceOf = (x: { paymentStatus: string; paymentTotal: unknown; advanceAmount: unknown }) =>
  x.paymentStatus === "PAID" ? 0 : Math.max(0, num(x.paymentTotal) - num(x.advanceAmount));

const TICKET_STATUSES = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "PENDING", label: "Pending" },
  { value: "RESOLVED", label: "Completed (to close)" },
  { value: "CLOSED", label: "Closed" },
];

const DEFS: Def[] = [
  /* ─── Service ─── */
  {
    key: "service-jobs",
    group: "Service",
    title: "Service job register",
    description: "Every service job created in the period — customer, machine, engineer, status and money.",
    permission: "tickets:view",
    dateFilter: true,
    statuses: TICKET_STATUSES,
    person: "engineer",
    async run(t, p) {
      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: t,
          deletedAt: null,
          createdAt: { gte: p.from, lte: p.to },
          ...(p.status ? { status: p.status as never } : {}),
          ...(p.personId ? { assignedToId: p.personId } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: MAX_ROWS,
      });
      const [names, contacts, assets] = await Promise.all([
        userNames(t),
        contactMap(t, tickets.map((x) => x.contactId)),
        assetMap(t, tickets.map((x) => x.assetId)),
      ]);
      const rows = tickets.map((x) => {
        const c = x.contactId ? contacts.get(x.contactId) : undefined;
        const a = x.assetId ? assets.get(x.assetId) : undefined;
        return {
          jobNo: serviceNo(x.ticketNo),
          date: ymd(x.createdAt),
          customer: c?.name ?? "",
          phone: c?.phone ?? "",
          machine: [a?.name, a?.serialNo ? `S/No ${a.serialNo}` : ""].filter(Boolean).join(" · ") || x.subject,
          category: String(cf(x.customFields).category ?? ""),
          engineer: x.assignedToId ? names.get(x.assignedToId) ?? "" : "Unassigned",
          status: label(x.status),
          payment: label(x.paymentStatus),
          total: num(x.paymentTotal),
          advance: num(x.advanceAmount),
          balance: balanceOf(x),
          completed: ymd(x.resolvedAt ?? x.closedAt),
        };
      });
      return {
        subtitle: `${rows.length} jobs`,
        columns: [
          { key: "jobNo", label: "Job no" },
          { key: "date", label: "Date", type: "date" },
          { key: "customer", label: "Customer" },
          { key: "phone", label: "Phone" },
          { key: "machine", label: "Machine" },
          { key: "category", label: "Type" },
          { key: "engineer", label: "Engineer" },
          { key: "status", label: "Status" },
          { key: "payment", label: "Payment" },
          { key: "total", label: "Total", type: "money" },
          { key: "advance", label: "Advance", type: "money" },
          { key: "balance", label: "Balance", type: "money" },
          { key: "completed", label: "Completed", type: "date" },
        ],
        rows,
        totals: { total: sum(rows, "total"), advance: sum(rows, "advance"), balance: sum(rows, "balance") },
      };
    },
  },
  {
    key: "service-collections",
    group: "Service",
    title: "Service collections",
    description: "Money received on service jobs in the period (fully paid jobs and advances).",
    permission: "tickets:view",
    dateFilter: true,
    person: "engineer",
    async run(t, p) {
      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: t,
          deletedAt: null,
          paymentStatus: { in: ["PAID", "PARTIAL"] },
          ...(p.personId ? { assignedToId: p.personId } : {}),
        },
        orderBy: { updatedAt: "asc" },
        take: MAX_ROWS,
      });
      const at = (x: (typeof tickets)[number]) => x.paidAt ?? x.closedAt ?? x.resolvedAt ?? x.updatedAt;
      const inRange = tickets.filter((x) => {
        const d = at(x);
        return d >= p.from && d <= p.to;
      });
      const [names, contacts] = await Promise.all([userNames(t), contactMap(t, inRange.map((x) => x.contactId))]);
      const rows = inRange.map((x) => ({
        date: ymd(at(x)),
        jobNo: serviceNo(x.ticketNo),
        customer: x.contactId ? contacts.get(x.contactId)?.name ?? "" : "",
        category: String(cf(x.customFields).category ?? ""),
        engineer: x.assignedToId ? names.get(x.assignedToId) ?? "" : "",
        method: label(x.paymentMethod),
        reference: x.paymentReference ?? "",
        type: x.paymentStatus === "PAID" ? "Full payment" : "Advance",
        amount: x.paymentStatus === "PAID" ? num(x.paymentTotal) : num(x.advanceAmount),
      }));
      return {
        subtitle: `${rows.length} receipts`,
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "jobNo", label: "Job no" },
          { key: "customer", label: "Customer" },
          { key: "category", label: "Type" },
          { key: "engineer", label: "Engineer" },
          { key: "method", label: "Mode" },
          { key: "reference", label: "Reference" },
          { key: "type", label: "Receipt" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows,
        totals: { amount: sum(rows, "amount") },
      };
    },
  },
  {
    key: "engineer-performance",
    group: "Service",
    title: "Engineer performance",
    description: "Per engineer: jobs received, completed, still open, average time to complete, SLA misses, money collected.",
    permission: "tickets:view",
    dateFilter: true,
    async run(t, p) {
      const tickets = await prisma.ticket.findMany({
        where: { tenantId: t, deletedAt: null, assignedToId: { not: null }, createdAt: { gte: p.from, lte: p.to } },
        select: {
          assignedToId: true,
          status: true,
          slaBreached: true,
          createdAt: true,
          resolvedAt: true,
          closedAt: true,
          paymentStatus: true,
          paymentTotal: true,
          advanceAmount: true,
        },
      });
      const names = await userNames(t);
      const by = new Map<string, typeof tickets>();
      for (const x of tickets) by.set(x.assignedToId!, [...(by.get(x.assignedToId!) ?? []), x]);
      const rows = [...by.entries()]
        .map(([id, list]) => {
          const done = list.filter((x) => x.status === "RESOLVED" || x.status === "CLOSED");
          const hours = done
            .map((x) => ((x.resolvedAt ?? x.closedAt ?? x.createdAt).getTime() - x.createdAt.getTime()) / 36e5)
            .filter((h) => h >= 0);
          return {
            engineer: names.get(id) ?? "Removed user",
            jobs: list.length,
            completed: done.length,
            open: list.length - done.length,
            avgHours: hours.length ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10 : 0,
            slaMissed: list.filter((x) => x.slaBreached).length,
            collected: list.reduce(
              (s, x) => s + (x.paymentStatus === "PAID" ? num(x.paymentTotal) : x.paymentStatus === "PARTIAL" ? num(x.advanceAmount) : 0),
              0,
            ),
          };
        })
        .sort((a, b) => b.completed - a.completed);
      return {
        subtitle: `${rows.length} engineers · jobs created in the period`,
        columns: [
          { key: "engineer", label: "Engineer" },
          { key: "jobs", label: "Jobs", type: "number" },
          { key: "completed", label: "Completed", type: "number" },
          { key: "open", label: "Open", type: "number" },
          { key: "avgHours", label: "Avg hours to complete", type: "number" },
          { key: "slaMissed", label: "SLA missed", type: "number" },
          { key: "collected", label: "Collected", type: "money" },
        ],
        rows,
        totals: { jobs: sum(rows, "jobs"), completed: sum(rows, "completed"), open: sum(rows, "open"), collected: sum(rows, "collected") },
      };
    },
  },
  {
    key: "unpaid-jobs",
    group: "Service",
    title: "Unpaid service jobs",
    description: "Every job with money still to collect, oldest first — today's outstanding list.",
    permission: "tickets:view",
    dateFilter: false,
    person: "engineer",
    async run(t, p) {
      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: t,
          deletedAt: null,
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
          ...(p.personId ? { assignedToId: p.personId } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: MAX_ROWS,
      });
      const open = tickets.filter((x) => balanceOf(x) > 0);
      const [names, contacts] = await Promise.all([userNames(t), contactMap(t, open.map((x) => x.contactId))]);
      const today = Date.now();
      const rows = open.map((x) => {
        const c = x.contactId ? contacts.get(x.contactId) : undefined;
        return {
          jobNo: serviceNo(x.ticketNo),
          date: ymd(x.createdAt),
          days: Math.floor((today - x.createdAt.getTime()) / 864e5),
          customer: c?.name ?? "",
          phone: c?.phone ?? "",
          engineer: x.assignedToId ? names.get(x.assignedToId) ?? "" : "Unassigned",
          status: label(x.status),
          total: num(x.paymentTotal),
          advance: num(x.advanceAmount),
          balance: balanceOf(x),
        };
      });
      return {
        subtitle: `${rows.length} jobs with balance due`,
        columns: [
          { key: "jobNo", label: "Job no" },
          { key: "date", label: "Job date", type: "date" },
          { key: "days", label: "Days old", type: "number" },
          { key: "customer", label: "Customer" },
          { key: "phone", label: "Phone" },
          { key: "engineer", label: "Engineer" },
          { key: "status", label: "Status" },
          { key: "total", label: "Total", type: "money" },
          { key: "advance", label: "Advance", type: "money" },
          { key: "balance", label: "Balance due", type: "money" },
        ],
        rows,
        totals: { total: sum(rows, "total"), advance: sum(rows, "advance"), balance: sum(rows, "balance") },
      };
    },
  },
  {
    key: "machines-due",
    group: "Service",
    title: "Machines due — service, AMC & stamping",
    description: "Customer machines with service, AMC renewal or government stamping falling due up to the end date (overdue included).",
    permission: "assets:view",
    dateFilter: true,
    async run(t, p) {
      const assets = await prisma.customerAsset.findMany({
        where: {
          tenantId: t,
          deletedAt: null,
          OR: [
            { nextServiceDueDate: { lte: p.to } },
            { nextDueDate: { lte: p.to } },
            { amcEndDate: { lte: p.to } },
          ],
        },
        take: MAX_ROWS,
      });
      const contacts = await contactMap(t, assets.map((a) => a.contactId));
      const due = (d: Date | null) => (d && d <= p.to ? ymd(d) : null);
      const rows = assets
        .map((a) => {
          const c = contacts.get(a.contactId);
          const dates = [a.nextServiceDueDate, a.nextDueDate, a.amcEndDate].filter((d): d is Date => !!d && d <= p.to);
          const first = dates.sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
          return {
            customer: c?.name ?? "",
            code: c?.code ?? "",
            phone: c?.phone ?? "",
            city: c?.city ?? "",
            machine: a.name,
            serialNo: a.serialNo ?? "",
            plan: a.servicePlan.replace("_", "-"),
            serviceDue: due(a.nextServiceDueDate),
            stampingDue: due(a.nextDueDate),
            amcEnds: due(a.amcEndDate),
            firstDue: ymd(first),
          };
        })
        .sort((x, y) => String(x.firstDue).localeCompare(String(y.firstDue)));
      return {
        subtitle: `${rows.length} machines due on or before ${ymd(p.to)}`,
        columns: [
          { key: "firstDue", label: "First due", type: "date" },
          { key: "customer", label: "Customer" },
          { key: "code", label: "Code" },
          { key: "phone", label: "Phone" },
          { key: "city", label: "City" },
          { key: "machine", label: "Machine" },
          { key: "serialNo", label: "Serial no" },
          { key: "plan", label: "Plan" },
          { key: "serviceDue", label: "Service due", type: "date" },
          { key: "stampingDue", label: "Stamping due", type: "date" },
          { key: "amcEnds", label: "AMC ends", type: "date" },
        ],
        rows,
      };
    },
  },

  /* ─── Sales ─── */
  {
    key: "enquiries",
    group: "Sales",
    title: "Sales enquiries",
    description: "Enquiries received in the period with source, salesperson and where each one stands.",
    permission: "leads:view",
    dateFilter: true,
    person: "salesperson",
    statuses: [
      { value: "OPEN", label: "Open" },
      { value: "DEMO", label: "Demo" },
      { value: "CONVERTED", label: "Converted" },
      { value: "LOST", label: "Lost / closed" },
    ],
    async run(t, p) {
      const statusWhere =
        p.status === "OPEN"
          ? { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] as never[] } }
          : p.status === "LOST"
            ? { status: { in: ["LOST", "UNQUALIFIED"] as never[] } }
            : p.status
              ? { status: p.status as never }
              : {};
      const [leads, sources, names] = await Promise.all([
        prisma.lead.findMany({
          where: {
            tenantId: t,
            deletedAt: null,
            createdAt: { gte: p.from, lte: p.to },
            ...statusWhere,
            ...(p.personId ? { assignedToId: p.personId } : {}),
          },
          orderBy: { createdAt: "asc" },
          take: MAX_ROWS,
        }),
        prisma.leadSource.findMany({ where: { tenantId: t }, select: { id: true, name: true } }),
        userNames(t),
      ]);
      const src = new Map(sources.map((s) => [s.id, s.name]));
      const rows = leads.map((l) => {
        const c = cf(l.customFields);
        return {
          enquiryNo: l.leadNo != null ? `ENQ-${String(l.leadNo).padStart(5, "0")}` : "",
          date: ymd(l.createdAt),
          customer: l.name,
          company: l.company ?? "",
          phone: l.phone ?? "",
          city: l.city ?? "",
          product: leadProduct(c),
          source: l.sourceId ? src.get(l.sourceId) ?? "" : "",
          salesperson: l.assignedToId ? names.get(l.assignedToId) ?? "" : "Unassigned",
          status: ["NEW", "CONTACTED", "QUALIFIED"].includes(l.status)
            ? "Open"
            : l.status === "UNQUALIFIED"
              ? "Lost"
              : label(l.status),
          converted: ymd(l.convertedAt),
          saleAmount: l.status === "CONVERTED" ? num(c.salePaymentTotal) : 0,
        };
      });
      return {
        subtitle: `${rows.length} enquiries`,
        columns: [
          { key: "enquiryNo", label: "Enquiry" },
          { key: "date", label: "Date", type: "date" },
          { key: "customer", label: "Customer" },
          { key: "company", label: "Company" },
          { key: "phone", label: "Phone" },
          { key: "city", label: "City" },
          { key: "product", label: "Product" },
          { key: "source", label: "Source" },
          { key: "salesperson", label: "Salesperson" },
          { key: "status", label: "Status" },
          { key: "converted", label: "Converted", type: "date" },
          { key: "saleAmount", label: "Sale amount", type: "money" },
        ],
        rows,
        totals: { saleAmount: sum(rows, "saleAmount") },
      };
    },
  },
  {
    key: "sales",
    group: "Sales",
    title: "Sales closed",
    description: "Enquiries converted to a sale in the period, with amount and salesperson.",
    permission: "leads:view",
    dateFilter: true,
    person: "salesperson",
    async run(t, p) {
      const [leads, names] = await Promise.all([
        prisma.lead.findMany({
          where: {
            tenantId: t,
            deletedAt: null,
            status: "CONVERTED",
            ...(p.personId ? { assignedToId: p.personId } : {}),
          },
          take: MAX_ROWS,
        }),
        userNames(t),
      ]);
      // Sale date = when it was marked complete (same as the "Closed · sold" chip), else converted date
      const at = (l: (typeof leads)[number]) => {
        const done = cf(l.customFields).saleCompletedAt;
        return done ? new Date(String(done)) : l.convertedAt ?? l.updatedAt;
      };
      const sold = await prisma.stockUnit.findMany({
        where: { tenantId: t, deletedAt: null, status: "SOLD", leadId: { in: leads.map((l) => l.id) } },
        select: { leadId: true, serialNo: true },
      });
      const serials = new Map<string, string[]>();
      for (const u of sold) serials.set(u.leadId!, [...(serials.get(u.leadId!) ?? []), u.serialNo]);
      const rows = leads
        .filter((l) => at(l) >= p.from && at(l) <= p.to)
        .sort((a, b) => at(a).getTime() - at(b).getTime())
        .map((l) => {
          const c = cf(l.customFields);
          return {
            date: ymd(at(l)),
            customer: l.name,
            company: l.company ?? "",
            phone: l.phone ?? "",
            product: leadProduct(c),
            serialNo: (serials.get(l.id) ?? []).join(", "),
            salesperson: l.assignedToId ? names.get(l.assignedToId) ?? "" : "",
            amount: num(c.salePaymentTotal),
          };
        });
      return {
        subtitle: `${rows.length} sales`,
        columns: [
          { key: "date", label: "Sale date", type: "date" },
          { key: "customer", label: "Customer" },
          { key: "company", label: "Company" },
          { key: "phone", label: "Phone" },
          { key: "product", label: "Product" },
          { key: "serialNo", label: "Serial no" },
          { key: "salesperson", label: "Salesperson" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows,
        totals: { amount: sum(rows, "amount") },
      };
    },
  },

  /* ─── Billing ─── */
  {
    key: "proformas",
    group: "Billing",
    title: "Proforma invoice register",
    description: "Proforma invoices dated in the period — taxable value, GST, total, received and balance.",
    permission: "invoices:view",
    dateFilter: true,
    statuses: [
      { value: "DRAFT", label: "Draft" },
      { value: "SENT", label: "Sent" },
      { value: "PARTIAL", label: "Part paid" },
      { value: "PAID", label: "Paid" },
      { value: "OVERDUE", label: "Overdue" },
      { value: "VOID", label: "Cancelled" },
    ],
    async run(t, p) {
      const invoices = await prisma.invoice.findMany({
        where: {
          tenantId: t,
          deletedAt: null,
          invoiceDate: { gte: p.from, lte: p.to },
          ...(p.status ? { status: p.status as never } : {}),
        },
        orderBy: { invoiceDate: "asc" },
        take: MAX_ROWS,
      });
      const accounts = await prisma.account.findMany({
        where: { tenantId: t, id: { in: [...new Set(invoices.map((i) => i.accountId))] } },
        select: { id: true, name: true, customFields: true },
      });
      const acc = new Map(accounts.map((a) => [a.id, a]));
      const rows = invoices.map((i) => {
        const a = acc.get(i.accountId);
        const cancelled = i.status === "VOID";
        return {
          number: i.invoiceNumber,
          date: ymd(i.invoiceDate),
          customer: a?.name ?? "",
          gstin: String(cf(a?.customFields).gstin ?? cf(i.customFields).gstin ?? ""),
          taxable: cancelled ? 0 : num(Number(i.subtotal) - Number(i.discountTotal)),
          gst: cancelled ? 0 : num(i.taxTotal),
          total: cancelled ? 0 : num(i.grandTotal),
          received: cancelled ? 0 : num(i.amountPaid),
          balance: cancelled ? 0 : Math.max(0, num(Number(i.grandTotal) - Number(i.amountPaid))),
          status: cancelled ? "Cancelled" : label(i.status),
        };
      });
      return {
        subtitle: `${rows.length} proformas (cancelled shown at ₹0)`,
        columns: [
          { key: "number", label: "Number" },
          { key: "date", label: "Date", type: "date" },
          { key: "customer", label: "Customer" },
          { key: "gstin", label: "GSTIN" },
          { key: "taxable", label: "Taxable", type: "money" },
          { key: "gst", label: "GST", type: "money" },
          { key: "total", label: "Total", type: "money" },
          { key: "received", label: "Received", type: "money" },
          { key: "balance", label: "Balance", type: "money" },
          { key: "status", label: "Status" },
        ],
        rows,
        totals: {
          taxable: sum(rows, "taxable"),
          gst: sum(rows, "gst"),
          total: sum(rows, "total"),
          received: sum(rows, "received"),
          balance: sum(rows, "balance"),
        },
      };
    },
  },
  {
    key: "tally-export",
    group: "Billing",
    title: "Tally export",
    description:
      "Vouchers to enter in Tally for the period: proformas as Sales (taxable value, CGST + SGST or IGST) and money received on service jobs as Receipts.",
    permission: "invoices:view",
    dateFilter: true,
    async run(t, p) {
      const [invoices, jobs] = await Promise.all([
        prisma.invoice.findMany({
          where: { tenantId: t, deletedAt: null, status: { not: "VOID" }, invoiceDate: { gte: p.from, lte: p.to } },
          orderBy: { invoiceDate: "asc" },
          take: MAX_ROWS,
        }),
        prisma.ticket.findMany({
          where: { tenantId: t, deletedAt: null, paymentStatus: { in: ["PAID", "PARTIAL"] } },
          orderBy: { updatedAt: "asc" },
          take: MAX_ROWS,
        }),
      ]);
      const [accounts, lines] = await Promise.all([
        prisma.account.findMany({
          where: { tenantId: t, id: { in: [...new Set(invoices.map((i) => i.accountId))] } },
          select: { id: true, name: true, gstin: true, state: true, customFields: true },
        }),
        prisma.invoiceLine.findMany({
          where: { tenantId: t, invoiceId: { in: invoices.map((i) => i.id) } },
          select: { invoiceId: true, description: true, quantity: true },
        }),
      ]);
      const acc = new Map(accounts.map((a) => [a.id, a]));
      // HMS is in Tamil Nadu: same state → CGST + SGST, other state → IGST
      const intraState = (state: string | null | undefined) => !state || /tamil\s*nadu|^tn$/i.test(state.trim());
      const sales = invoices.map((i) => {
        const a = acc.get(i.accountId);
        const gst = num(i.taxTotal);
        const intra = intraState(a?.state ?? null);
        const items = lines
          .filter((l) => l.invoiceId === i.id)
          .map((l) => `${l.description}${Number(l.quantity) !== 1 ? ` × ${Number(l.quantity)}` : ""}`)
          .join("; ");
        return {
          date: ymd(i.invoiceDate),
          voucher: "Sales",
          number: i.invoiceNumber,
          party: a?.name ?? "",
          gstin: a?.gstin ?? String(cf(a?.customFields).gstin ?? ""),
          particulars: items,
          taxable: num(Number(i.subtotal) - Number(i.discountTotal)),
          cgst: intra ? num(gst / 2) : 0,
          sgst: intra ? num(gst / 2) : 0,
          igst: intra ? 0 : gst,
          total: num(i.grandTotal),
          mode: "",
          reference: "",
          narration: `Proforma ${i.invoiceNumber}`,
        };
      });
      const at = (x: (typeof jobs)[number]) => x.paidAt ?? x.closedAt ?? x.resolvedAt ?? x.updatedAt;
      const paidJobs = jobs.filter((x) => {
        const d = at(x);
        return d >= p.from && d <= p.to;
      });
      const [contacts, assets] = await Promise.all([
        contactMap(t, paidJobs.map((x) => x.contactId)),
        assetMap(t, paidJobs.map((x) => x.assetId)),
      ]);
      const receipts = paidJobs
        .map((x) => {
          const amount = x.paymentStatus === "PAID" ? num(x.paymentTotal) : num(x.advanceAmount);
          const machine = x.assetId ? assets.get(x.assetId) : null;
          return {
            date: ymd(at(x)),
            voucher: "Receipt",
            number: serviceNo(x.ticketNo),
            party: x.contactId ? contacts.get(x.contactId)?.name ?? "" : "",
            gstin: "",
            particulars: [String(cf(x.customFields).category ?? "Service"), machine ? `${machine.name}${machine.serialNo ? ` (${machine.serialNo})` : ""}` : ""]
              .filter(Boolean)
              .join(" — "),
            taxable: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            total: amount,
            mode: label(x.paymentMethod),
            reference: x.paymentReference ?? "",
            narration: `${x.paymentStatus === "PAID" ? "Service charges" : "Service advance"} ${serviceNo(x.ticketNo)}`,
          };
        })
        .filter((r) => r.total > 0);
      const rows = [...sales, ...receipts].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return {
        subtitle: `${sales.length} sales vouchers · ${receipts.length} receipts — free jobs and cancelled proformas left out`,
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "voucher", label: "Voucher type" },
          { key: "number", label: "Voucher no" },
          { key: "party", label: "Party ledger" },
          { key: "gstin", label: "GSTIN" },
          { key: "particulars", label: "Particulars" },
          { key: "taxable", label: "Taxable value", type: "money" },
          { key: "cgst", label: "CGST", type: "money" },
          { key: "sgst", label: "SGST", type: "money" },
          { key: "igst", label: "IGST", type: "money" },
          { key: "total", label: "Total", type: "money" },
          { key: "mode", label: "Mode" },
          { key: "reference", label: "Reference" },
          { key: "narration", label: "Narration" },
        ],
        rows,
        totals: { taxable: sum(rows, "taxable"), cgst: sum(rows, "cgst"), sgst: sum(rows, "sgst"), igst: sum(rows, "igst"), total: sum(rows, "total") },
      };
    },
  },

  /* ─── Stock ─── */
  {
    key: "stock-monthly",
    group: "Stock",
    title: "Stock — opening & closing",
    description:
      "For the period: opening stock, received, out (sold / demo / issued) and closing — every machine model and every spare part. Pick a month for the monthly register.",
    permission: "inventory:view",
    dateFilter: true,
    async run(t, p) {
      const end = p.to;
      const start = p.from;
      // Machines — from the units themselves (complete even for stock added before the movement log)
      const [products, units] = await Promise.all([
        prisma.product.findMany({ where: { tenantId: t, deletedAt: null, productType: "GOODS" }, select: { id: true, name: true, sku: true, attributes: true } }),
        prisma.stockUnit.findMany({
          where: { tenantId: t, deletedAt: null },
          select: { productId: true, status: true, createdAt: true, updatedAt: true, customFields: true },
        }),
      ]);
      const outAt = (u: (typeof units)[number]): Date | null => {
        if (u.status === "IN_STOCK") return null;
        const c = cf(u.customFields);
        const raw = c.soldAt ?? c.reducedAt ?? c.demoIssuedAt;
        const d = raw ? new Date(String(raw)) : u.updatedAt;
        return Number.isNaN(d.getTime()) ? u.updatedAt : d;
      };
      // One pass over the units: in / out times as numbers, grouped by product (was N products × M units × 4)
      const byProduct = new Map<string, Array<{ inAt: number; outAt: number }>>();
      for (const u of units) {
        const o = outAt(u);
        const row = { inAt: u.createdAt.getTime(), outAt: o ? o.getTime() : Number.POSITIVE_INFINITY };
        const list = byProduct.get(u.productId);
        if (list) list.push(row);
        else byProduct.set(u.productId, [row]);
      }
      const s0 = start.getTime();
      const e0 = end.getTime();
      const machineRows = products
        .map((pr) => {
          const mine = byProduct.get(pr.id) ?? [];
          let opening = 0;
          let received = 0;
          let out = 0;
          let closing = 0;
          for (const u of mine) {
            if (u.inAt < s0 && u.outAt >= s0) opening++;
            if (u.inAt >= s0 && u.inAt <= e0) received++;
            if (u.outAt >= s0 && u.outAt <= e0) out++;
            if (u.inAt <= e0 && u.outAt > e0) closing++;
          }
          const kind = String(cf(pr.attributes).catalogFamily ?? cf(pr.attributes).familyCode ?? "");
          return {
            kind: "Machine",
            item: pr.name,
            group: kind ? label(kind.replace(/_/g, " ")) : pr.sku ?? "",
            opening,
            received,
            out,
            closing,
          };
        })
        .filter((r) => r.opening || r.received || r.out || r.closing);

      // Spare parts — from the spare stock ledger (same numbers as Stock → Monthly report)
      const spareStock = await import("../spareStock/spareStock.service.js");
      const spares = await prisma.sparePartItem.findMany({
        where: { tenantId: t, deletedAt: null, isActive: true },
        orderBy: [{ machineFamily: "asc" }, { name: "asc" }],
      });
      const ids = spares.map((s) => s.id);
      const [openMap, closeMap, txns] = await Promise.all([
        ids.length ? spareStock.balancesOf(t, ids, start) : Promise.resolve({} as Record<string, number>),
        ids.length ? spareStock.balancesOf(t, ids, new Date(end.getTime() + 1)) : Promise.resolve({} as Record<string, number>),
        ids.length
          ? prisma.spareStockTxn.findMany({
              where: { tenantId: t, deletedAt: null, sparePartId: { in: ids }, txnDate: { gte: start, lte: end } },
              select: { sparePartId: true, txnType: true, quantity: true },
            })
          : Promise.resolve([]),
      ]);
      const spareRows = spares.map((s) => {
        const mine = txns.filter((x) => x.sparePartId === s.id);
        return {
          kind: "Spare",
          item: s.name,
          group: label(String(s.machineFamily)),
          opening: num((openMap as Record<string, number>)[s.id] ?? 0),
          received: num(mine.filter((x) => x.txnType === "IN").reduce((n, x) => n + Number(x.quantity), 0)),
          out: num(mine.filter((x) => x.txnType === "OUT").reduce((n, x) => n + Number(x.quantity), 0)),
          closing: num((closeMap as Record<string, number>)[s.id] ?? 0),
        };
      });
      const rows = [...machineRows.sort((a, b) => a.item.localeCompare(b.item)), ...spareRows];
      return {
        subtitle: `${machineRows.length} machine models · ${spareRows.length} spare parts — opening ${ymd(start)}, closing ${ymd(end)}`,
        columns: [
          { key: "kind", label: "Type" },
          { key: "item", label: "Item" },
          { key: "group", label: "Category" },
          { key: "opening", label: "Opening", type: "number" },
          { key: "received", label: "Received", type: "number" },
          { key: "out", label: "Out (sold / issued)", type: "number" },
          { key: "closing", label: "Closing", type: "number" },
        ],
        rows,
        totals: { opening: sum(rows, "opening"), received: sum(rows, "received"), out: sum(rows, "out"), closing: sum(rows, "closing") },
      };
    },
  },
  {
    key: "stock-summary",
    group: "Stock",
    title: "Stock summary by product",
    description: "Units per product right now — in stock, on demo, rented, sold — with stock value at cost.",
    permission: "inventory:view",
    dateFilter: false,
    async run(t) {
      const [products, groups, units] = await Promise.all([
        prisma.product.findMany({
          where: { tenantId: t, deletedAt: null, trackInventory: true },
          select: { id: true, name: true, sku: true, purchasePrice: true },
        }),
        prisma.stockUnit.groupBy({
          by: ["productId", "status"],
          where: { tenantId: t, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.stockUnit.findMany({
          where: { tenantId: t, deletedAt: null, status: "IN_STOCK" },
          select: { productId: true, unitCost: true },
        }),
      ]);
      const count = (pid: string, st: string) =>
        groups.find((g) => g.productId === pid && g.status === st)?._count._all ?? 0;
      const rows = products
        .map((pr) => {
          const inStock = count(pr.id, "IN_STOCK");
          // Each in-stock unit at its own cost, or the product's purchase price when none recorded
          const value = num(
            units
              .filter((u) => u.productId === pr.id)
              .reduce((s2, u) => s2 + Number(u.unitCost ?? pr.purchasePrice ?? 0), 0),
          );
          return {
            product: pr.name,
            sku: pr.sku,
            inStock,
            demo: count(pr.id, "DEMO"),
            rented: count(pr.id, "RENTED"),
            sold: count(pr.id, "SOLD"),
            value,
          };
        })
        // every tracked product, zero stock included — "what is out of stock?" must be answerable
        .sort((a, b) => a.product.localeCompare(b.product));
      return {
        subtitle: `${rows.length} products (${rows.filter((r) => r.inStock === 0).length} out of stock)`,
        columns: [
          { key: "product", label: "Product" },
          { key: "sku", label: "SKU" },
          { key: "inStock", label: "In stock", type: "number" },
          { key: "demo", label: "On demo", type: "number" },
          { key: "rented", label: "Rented", type: "number" },
          { key: "sold", label: "Sold", type: "number" },
          { key: "value", label: "Stock value (cost)", type: "money" },
        ],
        rows,
        totals: {
          inStock: sum(rows, "inStock"),
          demo: sum(rows, "demo"),
          rented: sum(rows, "rented"),
          sold: sum(rows, "sold"),
          value: sum(rows, "value"),
        },
      };
    },
  },
  {
    key: "stock-serials",
    group: "Stock",
    title: "Serial number list",
    description: "Every serial-tracked unit with product, status, warehouse and customer (if sold / on demo).",
    permission: "inventory:view",
    dateFilter: false,
    statuses: [
      { value: "IN_STOCK", label: "In stock" },
      { value: "DEMO", label: "On demo" },
      { value: "RENTED", label: "Rented" },
      { value: "SOLD", label: "Sold" },
      { value: "RETURNED", label: "Returned" },
    ],
    async run(t, p) {
      const units = await prisma.stockUnit.findMany({
        where: { tenantId: t, deletedAt: null, ...(p.status ? { status: p.status as never } : {}) },
        orderBy: [{ productId: "asc" }, { serialNo: "asc" }],
        take: MAX_ROWS,
      });
      const [products, warehouses, contacts] = await Promise.all([
        prisma.product.findMany({ where: { tenantId: t }, select: { id: true, name: true, purchasePrice: true } }),
        prisma.warehouse.findMany({ where: { tenantId: t }, select: { id: true, name: true } }),
        contactMap(t, units.map((u) => u.contactId)),
      ]);
      const pn = new Map(products.map((x) => [x.id, x.name]));
      const pp = new Map(products.map((x) => [x.id, Number(x.purchasePrice)]));
      const wn = new Map(warehouses.map((x) => [x.id, x.name]));
      const rows = units.map((u) => ({
        product: pn.get(u.productId) ?? "",
        serialNo: u.serialNo,
        hmsId: u.hmsUniqId ?? "",
        status: label(u.status),
        warehouse: wn.get(u.warehouseId) ?? "",
        customer: u.contactId ? contacts.get(u.contactId)?.name ?? "" : "",
        received: ymd(u.createdAt),
        // Unit's own cost when recorded, else the product's purchase price (same rule as the summary)
        cost: num(u.unitCost ?? pp.get(u.productId) ?? 0),
      }));
      return {
        subtitle: `${rows.length} units`,
        columns: [
          { key: "product", label: "Product" },
          { key: "serialNo", label: "Serial no" },
          { key: "hmsId", label: "HMS id" },
          { key: "status", label: "Status" },
          { key: "warehouse", label: "Warehouse" },
          { key: "customer", label: "Customer" },
          { key: "received", label: "Received", type: "date" },
          { key: "cost", label: "Cost", type: "money" },
        ],
        rows,
        totals: { cost: sum(rows, "cost") },
      };
    },
  },

  /* ─── History ─── */
  {
    key: "history",
    group: "History",
    title: "Closing & activity history",
    description:
      "Every finished or closing step — service jobs completed / closed / paid, sales completed / lost, stock released / sold, proformas, team changes — with who did it, when and the figures at that moment.",
    permission: "reports:view",
    dateFilter: true,
    person: "anyone",
    statuses: [
      { value: "Service", label: "Service" },
      { value: "Sales", label: "Sales" },
      { value: "Stock", label: "Stock" },
      { value: "Billing", label: "Billing" },
      { value: "Team", label: "Team" },
    ],
    async run(t, p) {
      const rows = await prisma.auditLog.findMany({
        where: {
          tenantId: t,
          actorType: "USER",
          createdAt: { gte: p.from, lte: p.to },
          ...(p.personId ? { actorId: p.personId } : {}),
          ...(p.status ? { action: { startsWith: p.status === "Billing" ? "billing." : `${p.status.toLowerCase()}.` } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
      });
      const names = await userNames(t);
      const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
      const out = rows
        .map((r) => {
          const a = cf(r.afterJson);
          if (!a.area) return null; // platform / settings entries are not work history
          const amount = Number(a.total ?? a.saleAmount ?? 0) || 0;
          const skip = new Set(["area", "label", "summary", "customer", "total", "saleAmount"]);
          const detail = Object.entries(a)
            .filter(([k, v]) => !skip.has(k) && v != null && v !== "" && !(Array.isArray(v) && !v.length) && v !== 0)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
            .join(" · ")
            .slice(0, 400);
          return {
            when: fmt.format(r.createdAt),
            area: String(a.area),
            event: String(a.summary ?? r.action),
            record: String(a.label ?? ""),
            customer: String(a.customer ?? ""),
            by: r.actorId ? names.get(r.actorId) ?? "Removed user" : "System",
            amount,
            details: detail,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
      return {
        subtitle: `${out.length} events`,
        columns: [
          { key: "when", label: "When" },
          { key: "area", label: "Area" },
          { key: "event", label: "What happened" },
          { key: "record", label: "Record" },
          { key: "customer", label: "Customer" },
          { key: "by", label: "Done by" },
          { key: "amount", label: "Amount", type: "money" },
          { key: "details", label: "Details" },
        ],
        rows: out,
      };
    },
  },

  /* ─── Customers ─── */
  {
    key: "customers",
    group: "Customers",
    title: "Customer list",
    description: "All customers with contact details, number of machines and open service jobs.",
    permission: "contacts:view",
    dateFilter: false,
    async run(t) {
      const [contacts, assets, openJobs] = await Promise.all([
        prisma.contact.findMany({
          where: { tenantId: t, deletedAt: null },
          orderBy: { name: "asc" },
          take: MAX_ROWS,
          select: { id: true, customerCode: true, name: true, phone: true, mobile: true, email: true, area: true, city: true, createdAt: true },
        }),
        prisma.customerAsset.groupBy({ by: ["contactId"], where: { tenantId: t, deletedAt: null }, _count: { _all: true } }),
        prisma.ticket.groupBy({
          by: ["contactId"],
          where: { tenantId: t, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] } },
          _count: { _all: true },
        }),
      ]);
      const ac = new Map(assets.map((a) => [a.contactId, a._count._all]));
      const oj = new Map(openJobs.map((a) => [a.contactId, a._count._all]));
      const rows = contacts.map((c) => ({
        code: c.customerCode ?? "",
        customer: c.name,
        phone: c.mobile || c.phone || "",
        email: c.email ?? "",
        area: c.area ?? "",
        city: c.city ?? "",
        machines: ac.get(c.id) ?? 0,
        openJobs: oj.get(c.id) ?? 0,
        since: ymd(c.createdAt),
      }));
      return {
        subtitle: `${rows.length} customers`,
        columns: [
          { key: "code", label: "Code" },
          { key: "customer", label: "Customer" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "area", label: "Area" },
          { key: "city", label: "City" },
          { key: "machines", label: "Machines", type: "number" },
          { key: "openJobs", label: "Open jobs", type: "number" },
          { key: "since", label: "Customer since", type: "date" },
        ],
        rows,
        totals: { machines: sum(rows, "machines"), openJobs: sum(rows, "openJobs") },
      };
    },
  },
];

/** Catalogue for the Reports page — only the reports this role may run. */
export async function reportCatalog(t: string, role: string) {
  const people = await prisma.user.findMany({
    where: { tenantId: t, deletedAt: null },
    select: { id: true, name: true, roleId: true },
    orderBy: { name: "asc" },
  });
  const roles = await prisma.role.findMany({ where: { tenantId: t }, select: { id: true, code: true } });
  const code = new Map(roles.map((r) => [r.id, r.code]));
  const engineers = people.filter((u) => /ENGINEER|DESK|ADMIN|MANAGER/.test(code.get(u.roleId) ?? ""));
  const sales = people.filter((u) => /SALES|AGENT|ADMIN|MANAGER/.test(code.get(u.roleId) ?? ""));
  return DEFS.filter((d) => roleHasPermission(role, d.permission)).map((d) => ({
    key: d.key,
    group: d.group,
    title: d.title,
    description: d.description,
    dateFilter: d.dateFilter,
    statuses: d.statuses ?? [],
    people:
      d.person === "engineer"
        ? engineers.map((u) => ({ id: u.id, name: u.name }))
        : d.person === "anyone"
          ? people.map((u) => ({ id: u.id, name: u.name }))
          : d.person === "salesperson"
          ? sales.map((u) => ({ id: u.id, name: u.name }))
          : [],
  }));
}

export async function runReport(t: string, role: string, key: string, p: ReportParams): Promise<ReportResult> {
  const def = DEFS.find((d) => d.key === key);
  if (!def) throw new AppError("Report not found", 404);
  if (!roleHasPermission(role, def.permission)) throw new AppError("You do not have access to this report", 403);
  const out = await def.run(t, p);
  return { key: def.key, title: def.title, dateFilter: def.dateFilter, ...out };
}
