import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { pagination, pageResult } from "../../common/utils/pagination.js";
import { allPool } from "../../common/utils/concurrency.js";
import { AppError, notFound } from "../../common/errors.js";
import {
  notifyAdmins,
  createNotifications,
  expireEntityNotifications,
  userIdsByRoleCodes,
} from "../notifications/notify.service.js";
import type { Request } from "express";

const OPEN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED"] as const;

let tableReady = false;

function mapSaleMachineType(
  attrs: unknown,
  weighing: boolean,
): "WEIGHING" | "BILLING" | "CCM" | "OTHER" {
  if (weighing) return "WEIGHING";
  if (attrs && typeof attrs === "object") {
    const a = attrs as Record<string, unknown>;
    const kind = String(a.catalogKind ?? a.familyCode ?? a.catalogFamily ?? "").toUpperCase();
    if (kind.includes("CCM") || kind === "CASH_COUNTING") return "CCM";
    if (kind.includes("BILL") || kind.includes("POS") || kind.includes("TOUCH")) return "BILLING";
  }
  return "BILLING";
}

/** Serial for customer register / DC: billing = supplier serial; weighing = HMS Unique ID. */
function saleIdentityFromUnit(opts: {
  weighing: boolean;
  serialNo?: string | null;
  hmsUniqId?: string | null;
}) {
  const serial = String(opts.serialNo ?? "").trim().toUpperCase() || null;
  const hms = String(opts.hmsUniqId ?? "").trim().toUpperCase() || null;
  if (opts.weighing) {
    const id = hms || serial;
    return { serialNo: id, hmsUniqId: id, displaySerial: id };
  }
  return {
    serialNo: serial || hms,
    hmsUniqId: hms,
    displaySerial: serial || hms,
  };
}

/**
 * Put the reduced unit onto the customer Machines tab (serial / HMS).
 * Idempotent by stockUnitId or matching serial on that contact.
 */
/** Create / update customer Machines register after a sale (fulfill or PI). Exported for invoices. */
export async function ensureCustomerMachineFromSale(opts: {
  tenantId: string;
  contactId: string;
  product: { id: string; name: string; sku?: string | null; attributes?: unknown };
  unit: {
    id: string;
    serialNo?: string | null;
    hmsUniqId?: string | null;
    stampingDate?: Date | null;
    productId: string;
  };
  nextDueDate?: Date | null;
  weighing: boolean;
  reqNumber: string;
  requisitionId?: string | null;
}): Promise<string | null> {
  const { hmsSoldCoverage } = await import("../../common/hmsCoverage.js");
  const soldAt = new Date();
  const coverage = hmsSoldCoverage(soldAt, opts.weighing);
  const identity = saleIdentityFromUnit({
    weighing: opts.weighing,
    serialNo: opts.unit.serialNo,
    hmsUniqId: opts.unit.hmsUniqId,
  });
  if (!identity.serialNo && !identity.hmsUniqId) {
    console.warn(
      `[requisitions] No serial/HMS for unit ${opts.unit.id} on ${opts.reqNumber} — skipping Machines register`,
    );
    return null;
  }

  const attrs =
    opts.product.attributes && typeof opts.product.attributes === "object"
      ? (opts.product.attributes as Record<string, unknown>)
      : {};

  const existing = await prisma.customerAsset.findMany({
    where: { tenantId: opts.tenantId, contactId: opts.contactId, deletedAt: null },
    select: {
      id: true,
      serialNo: true,
      customFields: true,
      stampingDate: true,
      nextDueDate: true,
      servicePlan: true,
      warrantyEndDate: true,
    },
  });

  const match = existing.find((a) => {
    const acf =
      a.customFields && typeof a.customFields === "object" && !Array.isArray(a.customFields)
        ? (a.customFields as Record<string, unknown>)
        : {};
    if (String(acf.stockUnitId ?? "") === opts.unit.id) return true;
    const aSerial = String(a.serialNo ?? "").trim().toUpperCase();
    const aHms = String(acf.hmsUniqId ?? "").trim().toUpperCase();
    if (identity.serialNo && aSerial && aSerial === identity.serialNo) return true;
    if (identity.hmsUniqId && (aHms === identity.hmsUniqId || aSerial === identity.hmsUniqId)) {
      return true;
    }
    return false;
  });

  const capacity = attrs.capacity ? String(attrs.capacity) : null;
  const accuracy = attrs.accuracy ? String(attrs.accuracy) : null;
  const platformSize = attrs.platform ? String(attrs.platform) : attrs.platformSize
    ? String(attrs.platformSize)
    : null;
  const model = attrs.model
    ? String(attrs.model)
    : opts.product.sku
      ? String(opts.product.sku)
      : null;

  const prevCf =
    match?.customFields && typeof match.customFields === "object" && !Array.isArray(match.customFields)
      ? (match.customFields as Record<string, unknown>)
      : {};

  const customFields = {
    ...prevCf,
    hmsUniqId: identity.hmsUniqId,
    stockUnitId: opts.unit.id,
    productId: opts.product.id,
    sku: opts.product.sku ?? null,
    salesRequisitionId: opts.requisitionId ?? null,
    reqNumber: opts.reqNumber,
    boughtFromSale: true,
    soldAt: soldAt.toISOString(),
    weighing: opts.weighing,
    catalogFamily: attrs.catalogFamily ?? attrs.familyCode ?? null,
    stampingQuarter: coverage.stampingQuarter,
    stampingQuarterYear: coverage.stampingQuarterYear,
  };

  if (match) {
    await prisma.customerAsset.update({
      where: { id: match.id },
      data: {
        serialNo: identity.serialNo ?? match.serialNo,
        name: opts.product.name,
        model: model ?? undefined,
        capacity,
        accuracy,
        platformSize,
        stampingDate: opts.weighing
          ? (match.stampingDate ?? coverage.stampingDate)
          : match.stampingDate,
        nextDueDate: opts.weighing
          ? (match.nextDueDate ?? coverage.nextDueDate)
          : match.nextDueDate,
        origin: "SOLD_BY_US",
        servicePlan: match.servicePlan === "AMC" ? "AMC" : "GC",
        warrantyEndDate: match.warrantyEndDate ?? coverage.warrantyEndDate,
        notes: `Bought via sale ${opts.reqNumber}`,
        customFields: customFields as Prisma.InputJsonValue,
      },
    });
    return match.id;
  }

  const asset = await prisma.customerAsset.create({
    data: {
      id: newId(),
      tenantId: opts.tenantId,
      contactId: opts.contactId,
      machineType: mapSaleMachineType(opts.product.attributes, opts.weighing),
      name: opts.product.name,
      model,
      capacity,
      accuracy,
      platformSize,
      serialNo: identity.serialNo,
      origin: "SOLD_BY_US",
      servicePlan: "GC",
      warrantyEndDate: coverage.warrantyEndDate,
      stampingDate: coverage.stampingDate,
      nextDueDate: coverage.nextDueDate,
      notes: `Bought via sale ${opts.reqNumber}`,
      customFields: customFields as Prisma.InputJsonValue,
    },
  });
  return asset.id;
}

function nextDueFromStamping(stampingDate?: Date | null): Date | null {
  if (!stampingDate) return null;
  const d = new Date(stampingDate);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Ensure sales_requisitions exists (fixes admin Requisitions 500 when migrate wasn't run). */
export async function ensureSalesRequisitionsTable() {
  if (tableReady) return;
  try {
    await prisma.$queryRawUnsafe("SELECT 1 FROM sales_requisitions LIMIT 1");
    tableReady = true;
    return;
  } catch {
    /* create below */
  }
  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS \`sales_requisitions\` (
  \`id\` CHAR(36) NOT NULL,
  \`tenant_id\` CHAR(36) NOT NULL,
  \`req_number\` VARCHAR(40) NOT NULL,
  \`lead_id\` CHAR(36) NOT NULL,
  \`contact_id\` CHAR(36) NULL,
  \`deal_id\` CHAR(36) NULL,
  \`product_id\` CHAR(36) NULL,
  \`stock_unit_id\` CHAR(36) NULL,
  \`serial_no\` VARCHAR(80) NULL,
  \`product_name\` VARCHAR(191) NULL,
  \`qty\` DECIMAL(15, 3) NOT NULL DEFAULT 1,
  \`advance_amount\` DECIMAL(15, 2) NOT NULL DEFAULT 0,
  \`payment_notes\` TEXT NULL,
  \`status\` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  \`requested_by_id\` CHAR(36) NOT NULL,
  \`approved_by_id\` CHAR(36) NULL,
  \`approved_at\` DATETIME(3) NULL,
  \`rejected_reason\` VARCHAR(500) NULL,
  \`invoice_id\` CHAR(36) NULL,
  \`shipped_at\` DATETIME(3) NULL,
  \`notes\` TEXT NULL,
  \`custom_fields\` JSON NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  \`deleted_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`sales_requisitions_tenant_id_req_number_key\` (\`tenant_id\`, \`req_number\`),
  KEY \`sales_requisitions_tenant_id_status_created_at_idx\` (\`tenant_id\`, \`status\`, \`created_at\`),
  KEY \`sales_requisitions_tenant_id_lead_id_idx\` (\`tenant_id\`, \`lead_id\`),
  KEY \`sales_requisitions_tenant_id_stock_unit_id_idx\` (\`tenant_id\`, \`stock_unit_id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  tableReady = true;
}

function leadCf(lead: { customFields: unknown }) {
  return lead.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
    ? (lead.customFields as Record<string, unknown>)
    : {};
}

/** Mirror inventory release + stamping onto the sale lead for sales desk full page. */
async function syncSaleReleaseToLead(
  t: string,
  leadId: string,
  reqRow: {
    id: string;
    reqNumber: string;
    status: string;
    productName?: string | null;
    serialNo?: string | null;
    stockUnitId?: string | null;
    shippedAt?: Date | null;
    invoiceId?: string | null;
    customFields?: unknown;
  },
) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId: t, deletedAt: null },
  });
  if (!lead) return;

  const cf =
    reqRow.customFields && typeof reqRow.customFields === "object" && !Array.isArray(reqRow.customFields)
      ? (reqRow.customFields as Record<string, unknown>)
      : {};

  const stampLines = Array.isArray(cf.stampLines)
    ? (cf.stampLines as Array<Record<string, unknown>>)
    : [];
  const releaseLines = Array.isArray(cf.releaseLines)
    ? (cf.releaseLines as Array<Record<string, unknown>>)
    : [];

  /** Build product cards for sales UI — Product 1, Product 2… */
  let products: Array<Record<string, unknown>> = [];
  if (stampLines.length) {
    products = stampLines.map((l, i) => {
      const rel = releaseLines[i] ?? releaseLines.find((r) => String(r.label) === String(l.label));
      return {
        index: i + 1,
        label: String(l.label ?? `Product ${i + 1}`),
        stampingRequired: Boolean(l.stampingRequired),
        stampingDate: l.stampingDate ? String(l.stampingDate) : null,
        nextDueDate: l.nextDueDate ? String(l.nextDueDate) : null,
        confirmed: Boolean(l.confirmed),
        serialNo: rel?.serialNo ? String(rel.serialNo) : null,
        hmsUniqId: rel?.hmsUniqId ? String(rel.hmsUniqId) : null,
        stockReduced: Boolean(rel?.stockUnitId),
        weighing: Boolean(rel?.weighing),
      };
    });
  } else if (releaseLines.length) {
    products = releaseLines.map((r, i) => ({
      index: i + 1,
      label: String(r.label ?? `Product ${i + 1}`),
      stampingRequired: null,
      stampingDate: null,
      nextDueDate: null,
      confirmed: true,
      serialNo: r.serialNo ? String(r.serialNo) : null,
      hmsUniqId: r.hmsUniqId ? String(r.hmsUniqId) : null,
      stockReduced: true,
      weighing: Boolean(r.weighing),
    }));
  } else if (reqRow.productName) {
    const parts = String(reqRow.productName)
      .split(/[,;/|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    products = (parts.length ? parts : [String(reqRow.productName)]).map((label, i) => ({
      index: i + 1,
      label,
      stampingRequired:
        typeof cf.stampingRequired === "boolean" ? Boolean(cf.stampingRequired) : null,
      stampingDate: cf.stampingDate ? String(cf.stampingDate) : null,
      nextDueDate: cf.nextDueDate ? String(cf.nextDueDate) : null,
      confirmed: Boolean(cf.stampingConfirmedAt || cf.stampingDone || cf.stampingSkipped),
    }));
  }

  const saleDeliveryChallan = cf.saleDeliveryChallan ?? null;

  const release = {
    requisitionId: reqRow.id,
    reqNumber: reqRow.reqNumber,
    status: reqRow.status,
    productName: reqRow.productName ?? null,
    serialNo: reqRow.serialNo ?? null,
    stockUnitId: reqRow.stockUnitId ?? null,
    hmsUniqId: cf.hmsUniqId ?? null,
    inventoryNotifiedAt: cf.inventoryNotifiedAt ?? null,
    stampingConfirmedAt: cf.stampingConfirmedAt ?? null,
    stampingRequired: typeof cf.stampingRequired === "boolean" ? cf.stampingRequired : null,
    stampingDate: cf.stampingDate ?? null,
    nextDueDate: cf.nextDueDate ?? null,
    stockReducedAt: cf.stockReducedAt ?? null,
    shippedAt: reqRow.shippedAt ? reqRow.shippedAt.toISOString() : null,
    invoiceId: reqRow.invoiceId ?? null,
    invoiceNumber: cf.invoiceNumber ?? null,
    saleDcNo: cf.saleDcNo ?? null,
    saleDeliveryChallan,
    products,
    stampLines,
    releaseLines,
    updatedAt: new Date().toISOString(),
  };

  const lcf = leadCf(lead);
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      customFields: {
        ...lcf,
        inventoryRelease: release,
        // Flat aliases for older UI / search
        inventoryStampProducts: products,
        inventoryStampingConfirmedAt: release.stampingConfirmedAt,
        inventorySerialNo: release.serialNo,
        inventoryReqNumber: release.reqNumber,
        ...(saleDeliveryChallan
          ? {
              saleDeliveryChallan,
              saleDcNo: cf.saleDcNo ?? null,
              saleDcDate: cf.saleDcDate ?? null,
              saleDcAt: cf.saleDcAt ?? null,
            }
          : {}),
      } as Prisma.InputJsonValue,
    },
  });
}

async function nextReqNumber(t: string, tx: Prisma.TransactionClient = prisma) {
  let seq = await tx.numberSequence.findUnique({
    where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "SALES_REQ" } },
  });
  if (!seq) {
    seq = await tx.numberSequence.create({
      data: {
        tenantId: t,
        sequenceKey: "SALES_REQ",
        prefix: "REQ-",
        nextValue: 1,
        padding: 5,
      },
    });
  }
  const allocated = await tx.numberSequence.update({
    where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "SALES_REQ" } },
    data: { nextValue: { increment: 1 } },
  });
  return `${allocated.prefix}${String(allocated.nextValue - 1).padStart(allocated.padding, "0")}`;
}

const leadSelect = {
  id: true,
  name: true,
  company: true,
  phone: true,
  email: true,
  city: true,
  state: true,
  area: true,
  leadNo: true,
  status: true,
} as const;

const contactSelect = {
  id: true,
  name: true,
  customerCode: true,
  phone: true,
  mobile: true,
  email: true,
  city: true,
  state: true,
  area: true,
  street: true,
  doorNo: true,
  pincode: true,
} as const;

/** Batch-load related rows for a list page (avoids N×5 pool stampede). */
export async function hydrateRequisitions(tenantId: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return [];

  const leadIds = [...new Set(rows.map((r) => (r.leadId ? String(r.leadId) : "")).filter(Boolean))];
  const contactIds = [...new Set(rows.map((r) => (r.contactId ? String(r.contactId) : "")).filter(Boolean))];
  const productIds = [...new Set(rows.map((r) => (r.productId ? String(r.productId) : "")).filter(Boolean))];
  const userIds = [
    ...new Set(
      rows.flatMap((r) =>
        [r.requestedById, r.approvedById].map((id) => (id ? String(id) : "")).filter(Boolean),
      ),
    ),
  ];

  const [leads, contacts, products, users] = await allPool(
    [
      () =>
        leadIds.length
          ? prisma.lead.findMany({
              where: { tenantId, id: { in: leadIds } },
              select: leadSelect,
            })
          : Promise.resolve([]),
      () =>
        contactIds.length
          ? prisma.contact.findMany({
              where: { tenantId, id: { in: contactIds } },
              select: contactSelect,
            })
          : Promise.resolve([]),
      () =>
        productIds.length
          ? prisma.product.findMany({
              where: { tenantId, id: { in: productIds } },
              select: { id: true, name: true, sku: true, attributes: true },
            })
          : Promise.resolve([]),
      () =>
        userIds.length
          ? prisma.user.findMany({
              where: { tenantId, id: { in: userIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
    ],
    3,
  );

  const leadMap = Object.fromEntries(leads.map((l) => [l.id, l]));
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return rows.map((row) => {
    const leadId = row.leadId ? String(row.leadId) : "";
    const contactId = row.contactId ? String(row.contactId) : "";
    const productId = row.productId ? String(row.productId) : "";
    const requestedById = row.requestedById ? String(row.requestedById) : "";
    const approvedById = row.approvedById ? String(row.approvedById) : "";
    return {
      ...row,
      advanceAmount: Number(row.advanceAmount ?? 0),
      qty: Number(row.qty ?? 1),
      lead: leadId ? leadMap[leadId] ?? null : null,
      contact: contactId ? contactMap[contactId] ?? null : null,
      product: productId ? productMap[productId] ?? null : null,
      requestedByName: requestedById ? userMap[requestedById]?.name ?? null : null,
      approvedByName: approvedById ? userMap[approvedById]?.name ?? null : null,
    };
  });
}

export async function serializeRequisition(row: Record<string, unknown>) {
  const [hydrated] = await hydrateRequisitions(String(row.tenantId), [row]);
  return hydrated!;
}

export async function list(t: string, q: Record<string, unknown>) {
  await ensureSalesRequisitionsTable();
  const p = pagination(q);
  const where: Prisma.SalesRequisitionWhereInput = { tenantId: t, deletedAt: null };
  if (q.status) {
    const raw = String(q.status)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (raw.length === 1) where.status = raw[0] as Prisma.SalesRequisitionWhereInput["status"];
    else if (raw.length > 1) {
      where.status = { in: raw as Array<"PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "FULFILLED" | "CANCELLED" | "DRAFT"> };
    }
  }
  if (q.leadId) where.leadId = String(q.leadId);
  if (q.queue === "pending") where.status = "PENDING_APPROVAL";
  if (q.queue === "approved") where.status = "APPROVED";
  if (q.queue === "fulfill") {
    where.status = { in: ["APPROVED", "FULFILLED"] };
    where.shippedAt = null;
  }
  if (q.queue === "shipped") {
    where.status = { in: ["APPROVED", "FULFILLED"] };
    where.shippedAt = { not: null };
  }

  try {
    const [items, total] = await Promise.all([
      prisma.salesRequisition.findMany({
        where,
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.salesRequisition.count({ where }),
    ]);

    // Batch hydrate — never Promise.all per row (that was N×5 queries)
    const serialized = await hydrateRequisitions(
      t,
      items as unknown as Array<Record<string, unknown>>,
    );
    return pageResult(serialized, total, p.page, p.limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("sales_requisitions") || msg.includes("P2021") || msg.includes("does not exist")) {
      tableReady = false;
      await ensureSalesRequisitionsTable();
      return pageResult([], 0, p.page, p.limit);
    }
    throw err;
  }
}

export async function get(t: string, id: string) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  return serializeRequisition(row as unknown as Record<string, unknown>);
}

export async function getByLead(t: string, leadId: string) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: {
      tenantId: t,
      leadId,
      deletedAt: null,
      status: { in: [...OPEN_STATUSES, "FULFILLED", "REJECTED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  // Keep lead.inventoryRelease mirror fresh for sales progress bar
  try {
    await syncSaleReleaseToLead(t, leadId, row);
  } catch {
    /* non-fatal */
  }
  return serializeRequisition(row as unknown as Record<string, unknown>);
}

type SubmitInput = {
  leadId: string;
  productId?: string | null;
  stockUnitId?: string | null;
  serialNo?: string | null;
  productName?: string | null;
  qty?: number;
  advanceAmount?: number;
  paymentNotes?: string | null;
  notes?: string | null;
};

export async function submit(t: string, userId: string, data: SubmitInput, req?: Request) {
  await ensureSalesRequisitionsTable();
  const lead = await prisma.lead.findFirst({
    where: { id: data.leadId, tenantId: t, deletedAt: null },
  });
  if (!lead) throw notFound("Lead");
  if (["LOST", "UNQUALIFIED"].includes(lead.status)) {
    throw new AppError("Cannot raise requisition for a closed / junk enquiry", 400);
  }

  const cf = leadCf(lead);
  const contactId =
    lead.convertedContactId ??
    (cf.contact_id ? String(cf.contact_id) : null);
  if (!contactId) {
    throw new AppError(
      "Link or convert a customer on this sale before requesting stock release",
      400,
    );
  }

  const existingOpen = await prisma.salesRequisition.findFirst({
    where: {
      tenantId: t,
      leadId: lead.id,
      deletedAt: null,
      status: { in: [...OPEN_STATUSES] },
    },
  });
  if (existingOpen) {
    throw new AppError("An open requisition already exists for this sale", 409, {
      requisitionId: existingOpen.id,
      reqNumber: existingOpen.reqNumber,
      status: existingOpen.status,
    });
  }

  let productId = data.productId ? String(data.productId) : "";
  let stockUnitId = data.stockUnitId ? String(data.stockUnitId) : "";
  let serialNo = data.serialNo?.trim() || "";
  let productName = data.productName?.trim() || "";

  if (!stockUnitId && cf.demoStockUnitId) stockUnitId = String(cf.demoStockUnitId);
  if (!productId && (cf.demoProductId || cf.interested_product_id)) {
    productId = String(cf.demoProductId ?? cf.interested_product_id);
  }
  if (!serialNo && cf.demoSerialNo) serialNo = String(cf.demoSerialNo);
  if (!productName && (cf.demoProductName || cf.interested_product_name)) {
    productName = String(cf.demoProductName ?? cf.interested_product_name);
  }

  if (stockUnitId) {
    const unit = await prisma.stockUnit.findFirst({
      where: { id: stockUnitId, tenantId: t, deletedAt: null },
    });
    if (!unit) throw notFound("Stock unit");
    if (unit.status !== "IN_STOCK" && unit.status !== "DEMO") {
      throw new AppError(`Serial ${unit.serialNo} is not available (${unit.status})`, 409);
    }
    productId = productId || unit.productId;
    serialNo = serialNo || unit.serialNo;
    if (!productName) {
      const p = await prisma.product.findFirst({
        where: { id: unit.productId, tenantId: t },
        select: { name: true },
      });
      productName = p?.name ?? "";
    }
  }

  if (!productId && !stockUnitId) {
    throw new AppError("Select a product or serial before submitting the requisition", 400);
  }

  if (productId) {
    const p = await prisma.product.findFirst({
      where: { id: productId, tenantId: t, deletedAt: null },
    });
    if (!p) throw notFound("Product");
    if (!productName) productName = p.name;
  }

  const leadTotal = Number(cf.salePaymentTotal ?? cf.budget ?? 0) || 0;
  const leadAdvance = Number(cf.saleAdvanceAmount ?? 0) || 0;
  const advanceAmount =
    data.advanceAmount != null && Number.isFinite(Number(data.advanceAmount))
      ? Number(data.advanceAmount)
      : leadAdvance;
  const paymentTotal =
    leadTotal > 0 ? leadTotal : Math.max(0, advanceAmount);

  const row = await prisma.$transaction(async (tx) => {
    const reqNumber = await nextReqNumber(t, tx);
    return tx.salesRequisition.create({
      data: {
        id: newId(),
        tenantId: t,
        reqNumber,
        leadId: lead.id,
        contactId,
        dealId: lead.convertedDealId,
        productId: productId || null,
        stockUnitId: stockUnitId || null,
        serialNo: serialNo || null,
        productName: productName || null,
        qty: data.qty ?? 1,
        advanceAmount,
        paymentNotes: data.paymentNotes?.trim() || null,
        notes: data.notes?.trim() || null,
        status: "PENDING_APPROVAL",
        requestedById: userId,
        customFields: {
          submittedAt: new Date().toISOString(),
          leadNo: lead.leadNo,
          customerName: lead.name,
          salePaymentTotal: paymentTotal || null,
          saleAdvanceAmount: advanceAmount || null,
          saleDueAmount: Math.max(0, paymentTotal - advanceAmount),
        },
      },
    });
  });

  await notifyAdmins(
    t,
    {
      title: "Sales requisition pending approval",
      message: `${row.reqNumber} — ${lead.name}${productName ? ` · ${productName}` : ""}${serialNo ? ` · S/No ${serialNo}` : ""}. Sign to release stock.`,
      type: "REQUISITION_PENDING",
      entityType: "sales_requisition",
      entityId: row.id,
    },
    req,
  );

  return serializeRequisition(row as unknown as Record<string, unknown>);
}

export async function approve(t: string, id: string, userId: string, req?: Request) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "PENDING_APPROVAL") {
    throw new AppError(`Only pending requisitions can be approved (now ${row.status})`, 409);
  }

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: userId,
      approvedAt: new Date(),
      rejectedReason: null,
    },
  });

  // Pending-approval alerts expire — task is done
  await expireEntityNotifications(
    {
      tenantId: t,
      entityType: "sales_requisition",
      entityId: updated.id,
      types: ["REQUISITION_PENDING"],
      mode: "remove",
    },
    req,
  );
  if (updated.leadId) {
    await expireEntityNotifications(
      {
        tenantId: t,
        entityType: "lead",
        entityId: updated.leadId,
        types: ["LEAD_CONVERT_REQUISITION", "LEAD_DEMO_READY_REQUISITION"],
        mode: "remove",
      },
      req,
    );
  }

  // Notify sales (requestor) — they then notify inventory when ready
  if (updated.requestedById) {
    await createNotifications(
      [
        {
          tenantId: t,
          userId: updated.requestedById,
          title: "Requisition approved",
          message: `${updated.reqNumber} signed by admin. Notify inventory to release stock / prepare delivery.`,
          type: "REQUISITION_APPROVED",
          entityType: "sales_requisition",
          entityId: updated.id,
        },
      ],
      req,
    );
  }

  await notifyAdmins(
    t,
    {
      title: "Requisition signed",
      message: `${updated.reqNumber} approved — waiting for sales to notify inventory.`,
      type: "REQUISITION_APPROVED",
      entityType: "sales_requisition",
      entityId: updated.id,
    },
    req,
  );

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

export async function reject(
  t: string,
  id: string,
  userId: string,
  reason: string,
  req?: Request,
) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "PENDING_APPROVAL") {
    throw new AppError(`Only pending requisitions can be rejected (now ${row.status})`, 409);
  }
  if (!reason.trim()) throw new AppError("Rejection reason is required", 400);

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      status: "REJECTED",
      approvedById: userId,
      approvedAt: new Date(),
      rejectedReason: reason.trim().slice(0, 500),
    },
  });

  await expireEntityNotifications(
    {
      tenantId: t,
      entityType: "sales_requisition",
      entityId: updated.id,
      types: ["REQUISITION_PENDING"],
      mode: "remove",
    },
    req,
  );
  if (updated.leadId) {
    await expireEntityNotifications(
      {
        tenantId: t,
        entityType: "lead",
        entityId: updated.leadId,
        types: ["LEAD_CONVERT_REQUISITION", "LEAD_DEMO_READY_REQUISITION"],
        mode: "remove",
      },
      req,
    );
  }

  if (updated.requestedById) {
    await createNotifications(
      [
        {
          tenantId: t,
          userId: updated.requestedById,
          title: "Requisition rejected",
          message: `${updated.reqNumber}: ${reason.trim().slice(0, 120)}`,
          type: "REQUISITION_REJECTED",
          entityType: "sales_requisition",
          entityId: updated.id,
        },
      ],
      req,
    );
  }

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

/** Sales notifies warehouse after admin signed the requisition */
export async function notifyInventory(t: string, id: string, userId: string, req?: Request) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "APPROVED" && row.status !== "FULFILLED") {
    throw new AppError("Admin must approve the requisition before notifying inventory", 409);
  }

  const lead = await prisma.lead.findFirst({
    where: { id: row.leadId, tenantId: t },
    select: { id: true, name: true, phone: true, leadNo: true, company: true },
  });
  const contact = row.contactId
    ? await prisma.contact.findFirst({
        where: { id: row.contactId, tenantId: t },
        select: { name: true, customerCode: true, phone: true },
      })
    : null;

  const warehouseIds = await userIdsByRoleCodes(t, ["WAREHOUSE", "ADMIN", "MANAGER"]);
  const title = `New sale for inventory — ${row.reqNumber}`;
  const message = [
    contact?.name ?? lead?.name ?? "Customer",
    row.productName ? String(row.productName) : null,
    row.serialNo ? `S/No ${row.serialNo}` : null,
    "Open Approved releases → Confirm stamping (Yes/No) → Reduce stock → Ready to ship",
  ]
    .filter(Boolean)
    .join(" · ");

  if (warehouseIds.length) {
    await createNotifications(
      warehouseIds.map((uid) => ({
        tenantId: t,
        userId: uid,
        title,
        message,
        type: "REQUISITION_INVENTORY",
        entityType: "sales_requisition",
        entityId: row.id,
      })),
      req,
    );
  }

  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};
  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      customFields: {
        ...cf,
        inventoryNotifiedAt: new Date().toISOString(),
        inventoryNotifiedById: userId,
      } as Prisma.InputJsonValue,
    },
  });

  await syncSaleReleaseToLead(t, row.leadId, updated);

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

type StampLineInput = {
  label: string;
  stampingRequired: boolean;
  stampingDate?: string | null;
  nextDueDate?: string | null;
};

/** Inventory confirms stamping required yes/no (weighing usually yes; billing no). Physical stamp is manual. */
export async function recordStamping(
  t: string,
  id: string,
  userId: string,
  body: {
    stockUnitId?: string | null;
    stampingRequired?: boolean;
    stampingDate?: string | null;
    nextDueDate?: string | null;
    vcNumber?: string | null;
    plateNo?: string | null;
    lines?: StampLineInput[];
  },
) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "APPROVED") {
    throw new AppError("Only approved requisitions can confirm stamping", 409);
  }

  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};

  let stampLines: Array<{
    label: string;
    stampingRequired: boolean;
    stampingDate: string | null;
    nextDueDate: string | null;
    confirmed: boolean;
  }>;

  if (body.lines?.length) {
    stampLines = body.lines.map((l) => {
      const required = Boolean(l.stampingRequired);
      const date = l.stampingDate?.trim() || null;
      if (required && !date) {
        throw new AppError(`Stamping date required for "${l.label}"`, 400);
      }
      return {
        label: l.label.trim(),
        stampingRequired: required,
        stampingDate: required ? date : null,
        nextDueDate: required && l.nextDueDate?.trim() ? l.nextDueDate.trim() : null,
        confirmed: true,
      };
    });
  } else if (typeof body.stampingRequired === "boolean") {
    const required = body.stampingRequired;
    const date = body.stampingDate?.trim() || null;
    if (required && !date) {
      throw new AppError("Stamping date is required when stamping is Yes", 400);
    }
    const label = row.productName?.trim() || "Product";
    stampLines = [
      {
        label,
        stampingRequired: required,
        stampingDate: required ? date : null,
        nextDueDate: required && body.nextDueDate?.trim() ? body.nextDueDate.trim() : null,
        confirmed: true,
      },
    ];
  } else {
    throw new AppError("Confirm stamping required: Yes or No", 400);
  }

  const anyRequired = stampLines.some((l) => l.stampingRequired);
  const primaryDate = stampLines.find((l) => l.stampingRequired)?.stampingDate ?? null;
  const primaryEnd = stampLines.find((l) => l.stampingRequired)?.nextDueDate ?? null;

  // Optionally attach dates to the selected serial when stamping is required
  const unitId = body.stockUnitId?.trim() || row.stockUnitId;
  let serialNo = row.serialNo;
  let stockUnitId = row.stockUnitId;
  let productId = row.productId;
  let hmsUniqId: string | null =
    typeof cf.hmsUniqId === "string" ? cf.hmsUniqId : null;

  if (anyRequired && unitId && primaryDate) {
    const unit = await prisma.stockUnit.findFirst({
      where: { id: unitId, tenantId: t, deletedAt: null },
    });
    if (!unit) throw notFound("Stock unit");
    if (unit.status !== "IN_STOCK" && unit.status !== "DEMO") {
      throw new AppError(`Serial ${unit.serialNo} is not available (${unit.status})`, 409);
    }
    const stamped = await prisma.stockUnit.update({
      where: { id: unit.id },
      data: {
        stampingDate: new Date(primaryDate),
        // nextDueDate lives on CustomerAsset / requisition CF — not on StockUnit
        customFields: {
          ...((unit.customFields as Record<string, unknown>) ?? {}),
          vcNumber: body.vcNumber?.trim() || null,
          plateNo: body.plateNo?.trim() || null,
          stampedForRequisitionId: row.id,
          stampedAt: new Date().toISOString(),
          stampedById: userId,
          ...(primaryEnd ? { nextDueDate: primaryEnd } : {}),
        } as Prisma.InputJsonValue,
      },
    });
    serialNo = stamped.serialNo;
    stockUnitId = stamped.id;
    productId = row.productId || stamped.productId;
    hmsUniqId = stamped.hmsUniqId ?? null;
  }

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      ...(stockUnitId ? { stockUnitId } : {}),
      ...(serialNo ? { serialNo } : {}),
      ...(productId ? { productId } : {}),
      customFields: {
        ...cf,
        stampingConfirmedAt: new Date().toISOString(),
        stampingConfirmedById: userId,
        stampingRequired: anyRequired,
        stampingSkipped: !anyRequired,
        stampingDone: anyRequired,
        stampingDate: primaryDate,
        nextDueDate: primaryEnd,
        stampLines,
        vcNumber: body.vcNumber?.trim() || null,
        plateNo: body.plateNo?.trim() || null,
        hmsUniqId,
      } as Prisma.InputJsonValue,
    },
  });

  await syncSaleReleaseToLead(t, row.leadId, updated);

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

function stampingConfirmed(cf: Record<string, unknown>): boolean {
  if (cf.stampingConfirmedAt) return true;
  if (Array.isArray(cf.stampLines) && cf.stampLines.length) {
    return (cf.stampLines as Array<{ confirmed?: boolean }>).every((l) => l.confirmed);
  }
  // Legacy: older flow only set stampingDone
  return Boolean(cf.stampingDone) || Boolean(cf.stampingSkipped);
}

async function notifySalesReadyToShip(
  t: string,
  row: {
    id: string;
    reqNumber: string;
    requestedById: string;
    serialNo?: string | null;
    productName?: string | null;
    customFields?: unknown;
  },
  req?: Request,
) {
  const salesIds = await userIdsByRoleCodes(t, ["SALES_EXECUTIVE", "AGENT", "ADMIN", "MANAGER"]);
  const ids = new Set<string>([...salesIds, row.requestedById].filter(Boolean));
  if (!ids.size) return;
  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};
  const stampSummary = Array.isArray(cf.stampLines)
    ? (cf.stampLines as Array<{ label?: string; stampingRequired?: boolean; stampingDate?: string | null }>)
        .map(
          (l, i) =>
            `P${i + 1} ${l.label ?? "Product"}: stamp ${
              l.stampingRequired ? `Yes ${l.stampingDate ?? ""}`.trim() : "No"
            }`,
        )
        .join(" · ")
    : null;
  await createNotifications(
    [...ids].map((uid) => ({
      tenantId: t,
      userId: uid,
      title: `Ready to ship — ${row.reqNumber}`,
      message: [
        row.productName ? String(row.productName) : null,
        row.serialNo ? `S/No ${row.serialNo}` : null,
        stampSummary,
        "Open sale page for Product 1 / Product 2 stamping details. Raise PI / follow payment.",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 512),
      type: "REQUISITION_SHIPPED",
      entityType: "sales_requisition",
      entityId: row.id,
    })),
    req,
  );
}

export async function fulfill(
  t: string,
  id: string,
  userId: string,
  body: {
    unitPrice?: number;
    taxPercent?: number;
    notes?: string | null;
    markShipped?: boolean;
    stockUnitId?: string | null;
  } = {},
  req?: Request,
) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "APPROVED" && row.status !== "FULFILLED") {
    throw new AppError("Only approved requisitions can be fulfilled by inventory", 409);
  }
  if (!row.contactId) throw new AppError("Requisition has no customer contact", 400);

  const stockUnitId = body.stockUnitId?.trim() || row.stockUnitId;
  if (!stockUnitId) {
    throw new AppError(
      "Pick the exact stock unit for this machine (Billing: serial + HMS · Weighing: HMS only)",
      400,
    );
  }

  const unit = await prisma.stockUnit.findFirst({
    where: { id: stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");
  if (unit.status !== "IN_STOCK" && unit.status !== "DEMO") {
    throw new AppError(
      `Unit ${unit.hmsUniqId || unit.serialNo} is not available (${unit.status})`,
      409,
    );
  }

  // Always use the product of the picked unit (multi-machine sales)
  const product = await prisma.product.findFirst({
    where: { id: unit.productId, tenantId: t, deletedAt: null },
  });
  if (!product) throw notFound("Product");

  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};
  if (!stampingConfirmed(cf)) {
    throw new AppError(
      "Confirm stamping first (Yes + date, or No if not required) before reducing stock",
      400,
    );
  }
  if (cf.stampingRequired === true && !cf.stampingDate && !unit.stampingDate) {
    throw new AppError("Stamping was marked Yes — save stamping date before reducing stock", 400);
  }

  const existingRelease = Array.isArray(cf.releaseLines)
    ? (cf.releaseLines as Array<Record<string, unknown>>)
    : [];
  if (existingRelease.some((l) => String(l.stockUnitId) === unit.id)) {
    throw new AppError("This unit was already reduced for this sale", 409);
  }

  const contact = await prisma.contact.findFirst({
    where: { id: row.contactId, tenantId: t, deletedAt: null },
  });
  if (!contact) throw notFound("Contact");

  const { isWeighingProduct } = await import("../inventory/hmsUniqId.js");
  const weighing = isWeighingProduct(product.attributes, product.sku);
  const hmsUniq = unit.hmsUniqId ? String(unit.hmsUniqId) : "";
  const reduceNotes = [
    body.notes?.trim() || null,
    `Sale release ${row.reqNumber}`,
    contact.name ? `Customer: ${contact.name}` : null,
    contact.customerCode ? String(contact.customerCode) : null,
    product.name,
    !weighing && unit.serialNo ? `S/No ${unit.serialNo}` : null,
    hmsUniq ? `HMS ${hmsUniq}` : null,
    Number(row.advanceAmount) > 0 ? `Advance noted: ${row.advanceAmount}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const { reduceStockUnit } = await import("../inventory/inventory.service.js");
  const reduced = await reduceStockUnit(t, userId, unit.id, {
    notes: reduceNotes,
    reason: `Sale release ${row.reqNumber}`,
  });

  const reducedCf =
    reduced.customFields && typeof reduced.customFields === "object" && !Array.isArray(reduced.customFields)
      ? (reduced.customFields as Record<string, unknown>)
      : {};
  await prisma.stockUnit.update({
    where: { id: unit.id },
    data: {
      contactId: contact.id,
      customFields: {
        ...reducedCf,
        salesRequisitionId: row.id,
        reqNumber: row.reqNumber,
        reducedForSaleAt: new Date().toISOString(),
        customerName: contact.name,
        customerCode: contact.customerCode ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  const identity = saleIdentityFromUnit({
    weighing,
    serialNo: unit.serialNo,
    hmsUniqId: hmsUniq || unit.hmsUniqId,
  });

  // Customer Machines tab — serial / HMS must appear after reduce
  let assetId: string | null = null;
  try {
    assetId = await ensureCustomerMachineFromSale({
      tenantId: t,
      contactId: contact.id,
      product,
      unit: {
        id: unit.id,
        serialNo: unit.serialNo,
        hmsUniqId: hmsUniq || unit.hmsUniqId,
        stampingDate: unit.stampingDate,
        productId: unit.productId,
      },
      nextDueDate: nextDueFromStamping(unit.stampingDate),
      weighing,
      reqNumber: row.reqNumber,
      requisitionId: row.id,
    });
  } catch (err) {
    console.error(
      `[requisitions] Failed to add machine to customer ${contact.id} for ${row.reqNumber}:`,
      err,
    );
  }

  const releaseLine = {
    label: product.name,
    productId: product.id,
    stockUnitId: unit.id,
    serialNo: identity.serialNo,
    hmsUniqId: identity.hmsUniqId,
    weighing,
    assetId,
    reducedAt: new Date().toISOString(),
  };
  const releaseLines = [...existingRelease, releaseLine];
  const nameParts = String(row.productName || "")
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const needed = Math.max(
    1,
    Array.isArray(cf.stampLines) && cf.stampLines.length > 0
      ? cf.stampLines.length
      : 0,
    typeof cf.machinesNeeded === "number" ? Number(cf.machinesNeeded) : 0,
    Number(row.qty) || 0,
    nameParts.length,
  );
  const allDone = releaseLines.length >= needed;

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      status: allDone ? "FULFILLED" : "APPROVED",
      productId: product.id,
      stockUnitId: unit.id,
      serialNo: identity.displaySerial || row.serialNo,
      productName: row.productName || product.name,
      shippedAt: body.markShipped && allDone ? new Date() : row.shippedAt,
      customFields: {
        ...cf,
        fulfilledAt: allDone ? new Date().toISOString() : cf.fulfilledAt ?? null,
        fulfilledById: userId,
        stockReducedAt: new Date().toISOString(),
        hmsUniqId: identity.hmsUniqId,
        serialNo: identity.serialNo,
        customerName: contact.name,
        customerCode: contact.customerCode ?? null,
        releaseLines,
        machinesReduced: releaseLines.length,
        machinesNeeded: needed,
        awaitingSalesPi: allDone,
      } as Prisma.InputJsonValue,
    },
  });

  if (allDone) {
    await expireEntityNotifications(
      {
        tenantId: t,
        entityType: "sales_requisition",
        entityId: row.id,
        types: [
          "REQUISITION_APPROVED",
          "REQUISITION_INVENTORY",
          "REQUISITION_PENDING",
        ],
        mode: "remove",
      },
      req,
    );
    // Demo-out alert for this serial (if any) is done once sold
    await expireEntityNotifications(
      {
        tenantId: t,
        entityType: "stock_unit",
        entityId: unit.id,
        types: ["DEMO_ISSUE"],
        mode: "remove",
      },
      req,
    );
  }

  if (row.leadId) {
    try {
      const { markDemoSold } = await import("../inventory/inventory.service.js");
      await markDemoSold(t, userId, row.leadId);
    } catch {
      /* non-fatal */
    }
    await syncSaleReleaseToLead(t, row.leadId, updated);
  }

  if (allDone && body.markShipped) {
    await notifySalesReadyToShip(
      t,
      {
        id: row.id,
        reqNumber: row.reqNumber,
        requestedById: row.requestedById,
        serialNo: unit.serialNo || hmsUniq,
        productName: row.productName || product.name,
        customFields: updated.customFields,
      },
      req,
    );
  } else if (row.requestedById) {
    const salesIds = await userIdsByRoleCodes(t, ["SALES_EXECUTIVE", "AGENT", "ADMIN", "MANAGER"]);
    const ids = new Set<string>([...salesIds, row.requestedById].filter(Boolean));
    await createNotifications(
      [...ids].map((uid) => ({
        tenantId: t,
        userId: uid,
        title: allDone
          ? `Stock reduced — ${row.reqNumber}`
          : `Machine ${releaseLines.length}/${needed} reduced — ${row.reqNumber}`,
        message: [
          product.name,
          weighing ? null : unit.serialNo ? `S/No ${unit.serialNo}` : null,
          hmsUniq ? `HMS ${hmsUniq}` : null,
          "Saved on customer Machines.",
          allDone
            ? "All machines out — mark ready to ship when packed."
            : "Reduce the next machine from Approved releases.",
        ]
          .filter(Boolean)
          .join(" · "),
        type: "REQUISITION_FULFILLED",
        entityType: "sales_requisition",
        entityId: row.id,
      })),
      req,
    );
  }

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

/** One-click sale delivery challan — auto-fills from reduced units + customer. */
export async function createSaleDeliveryChallan(
  t: string,
  id: string,
  userId: string,
  body: { notes?: string | null } = {},
  req?: Request,
) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "FULFILLED" && row.status !== "APPROVED") {
    throw new AppError("Approve the sale release before creating a delivery challan", 409);
  }

  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};

  const existingDc =
    cf.saleDeliveryChallan && typeof cf.saleDeliveryChallan === "object"
      ? (cf.saleDeliveryChallan as Record<string, unknown>)
      : null;
  const hasFullDc =
    Boolean(cf.saleDcNo && existingDc?.number) &&
    typeof existingDc?.saleTotal === "number" &&
    Array.isArray(existingDc?.lines) &&
    (existingDc.lines as unknown[]).length > 0;
  if (hasFullDc) {
    // Idempotent — return existing complete DC
    return serializeRequisition(row as unknown as Record<string, unknown>);
  }
  // Reuse number if regenerating an older incomplete DC (no amounts / lines)
  const reuseDcNo = cf.saleDcNo ? String(cf.saleDcNo) : null;

  let releaseLines = Array.isArray(cf.releaseLines)
    ? (cf.releaseLines as Array<Record<string, unknown>>)
    : [];
  if (!releaseLines.length && !row.stockUnitId && !row.serialNo) {
    throw new AppError("Reduce stock for at least one machine before creating the delivery challan", 400);
  }

  // Hydrate serial / HMS from stock units so DC always prints identities
  const unitIds = [
    ...new Set(
      releaseLines
        .map((r) => (r.stockUnitId ? String(r.stockUnitId) : ""))
        .filter(Boolean)
        .concat(row.stockUnitId ? [String(row.stockUnitId)] : []),
    ),
  ];
  const stockUnits = unitIds.length
    ? await prisma.stockUnit.findMany({
        where: { tenantId: t, id: { in: unitIds }, deletedAt: null },
        select: {
          id: true,
          serialNo: true,
          hmsUniqId: true,
          productId: true,
          stampingDate: true,
        },
      })
    : [];
  const unitById = Object.fromEntries(stockUnits.map((u) => [u.id, u]));
  if (releaseLines.length) {
    releaseLines = releaseLines.map((r) => {
      const u = r.stockUnitId ? unitById[String(r.stockUnitId)] : null;
      if (!u) return r;
      const weighing = Boolean(r.weighing);
      const identity = saleIdentityFromUnit({
        weighing,
        serialNo: r.serialNo ? String(r.serialNo) : u.serialNo,
        hmsUniqId: r.hmsUniqId ? String(r.hmsUniqId) : u.hmsUniqId,
      });
      return {
        ...r,
        serialNo: identity.serialNo,
        hmsUniqId: identity.hmsUniqId,
        productId: r.productId ?? u.productId,
      };
    });
  }

  const productIds = [
    ...new Set(
      releaseLines
        .map((r) => (r.productId ? String(r.productId) : ""))
        .filter(Boolean)
        .concat(row.productId ? [String(row.productId)] : []),
    ),
  ];

  const [lead, contact, tenant, creator, products] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: row.leadId, tenantId: t },
      select: {
        id: true,
        name: true,
        company: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        area: true,
        customFields: true,
      },
    }),
    row.contactId
      ? prisma.contact.findFirst({
          where: { id: row.contactId, tenantId: t, deletedAt: null },
          select: {
            id: true,
            name: true,
            phone: true,
            mobile: true,
            email: true,
            customerCode: true,
            city: true,
            state: true,
            street: true,
            doorNo: true,
            area: true,
            pincode: true,
          },
        })
      : null,
    prisma.tenant.findFirst({
      where: { id: t },
      select: {
        name: true,
        phone: true,
        email: true,
        gstin: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
      },
    }),
    prisma.user.findFirst({
      where: { id: userId, tenantId: t },
      select: { id: true, name: true },
    }),
    productIds.length
      ? prisma.product.findMany({
          where: { tenantId: t, id: { in: productIds }, deletedAt: null },
          select: { id: true, name: true, sku: true, salePrice: true, attributes: true },
        })
      : Promise.resolve([]),
  ]);

  // Backfill customer Machines if reduce missed them
  if (contact && releaseLines.length) {
    for (const r of releaseLines) {
      const uid = r.stockUnitId ? String(r.stockUnitId) : "";
      const u = uid ? unitById[uid] : null;
      const pid = r.productId ? String(r.productId) : u?.productId ? String(u.productId) : "";
      const prod = pid ? products.find((p) => p.id === pid) : null;
      if (!u || !prod) continue;
      try {
        await ensureCustomerMachineFromSale({
          tenantId: t,
          contactId: contact.id,
          product: prod,
          unit: u,
          nextDueDate: nextDueFromStamping(u.stampingDate),
          weighing: Boolean(r.weighing),
          reqNumber: row.reqNumber,
          requisitionId: row.id,
        });
      } catch (err) {
        console.error(`[requisitions] DC backfill machine failed for ${row.reqNumber}:`, err);
      }
    }
  }

  const dcDate = new Date().toISOString().slice(0, 10);
  const issuedAt = new Date().toISOString();

  let dcNumber = reuseDcNo;
  if (!dcNumber) {
    let seq = await prisma.numberSequence.findUnique({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "SALE_DC" } },
    });
    if (!seq) {
      seq = await prisma.numberSequence.create({
        data: {
          tenantId: t,
          sequenceKey: "SALE_DC",
          prefix: "SDC-",
          nextValue: 1,
          padding: 5,
        },
      });
    }
    const allocated = await prisma.numberSequence.update({
      where: { tenantId_sequenceKey: { tenantId: t, sequenceKey: "SALE_DC" } },
      data: { nextValue: { increment: 1 } },
    });
    dcNumber = `${allocated.prefix}${String(allocated.nextValue - 1).padStart(allocated.padding, "0")}`;
  }

  const stampByLabel = new Map(
    (Array.isArray(cf.stampLines) ? (cf.stampLines as Array<Record<string, unknown>>) : []).map(
      (l) => [String(l.label ?? ""), l],
    ),
  );
  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  const leadCf =
    lead?.customFields && typeof lead.customFields === "object" && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {};

  type DcLine = {
    productName: string;
    productId?: string | null;
    productSku?: string | null;
    serialNo: string | null;
    hmsUniqId: string | null;
    qty: number;
    weighing: boolean;
    stampingDate: string | null;
    unitPrice: number;
    amount: number;
  };

  let lines: DcLine[] =
    releaseLines.length > 0
      ? releaseLines.map((r) => {
          const stamp = stampByLabel.get(String(r.label ?? ""));
          const pid = r.productId ? String(r.productId) : row.productId ? String(row.productId) : "";
          const prod = pid ? productById[pid] : null;
          const unitPrice = Math.max(0, Number(prod?.salePrice ?? 0));
          const qty = 1;
          const weighing = Boolean(r.weighing);
          const identity = saleIdentityFromUnit({
            weighing,
            serialNo: r.serialNo ? String(r.serialNo) : null,
            hmsUniqId: r.hmsUniqId ? String(r.hmsUniqId) : null,
          });
          return {
            productName: String(r.label ?? prod?.name ?? row.productName ?? "Product"),
            productId: pid || null,
            productSku: prod?.sku ? String(prod.sku) : null,
            serialNo: identity.serialNo,
            hmsUniqId: identity.hmsUniqId,
            qty,
            weighing,
            stampingDate:
              stamp?.stampingDate != null
                ? String(stamp.stampingDate)
                : cf.stampingDate
                  ? String(cf.stampingDate)
                  : null,
            unitPrice,
            amount: unitPrice * qty,
          };
        })
      : [
          (() => {
            const pid = row.productId ? String(row.productId) : "";
            const prod = pid ? productById[pid] : null;
            const qty = Math.max(1, Number(row.qty) || 1);
            const unitPrice = Math.max(0, Number(prod?.salePrice ?? 0));
            const u = row.stockUnitId ? unitById[String(row.stockUnitId)] : null;
            const identity = saleIdentityFromUnit({
              weighing: false,
              serialNo: row.serialNo ?? u?.serialNo ?? null,
              hmsUniqId: cf.hmsUniqId
                ? String(cf.hmsUniqId)
                : u?.hmsUniqId ?? null,
            });
            return {
              productName: String(row.productName ?? prod?.name ?? "Product"),
              productId: pid || null,
              productSku: prod?.sku ? String(prod.sku) : null,
              serialNo: identity.serialNo,
              hmsUniqId: identity.hmsUniqId,
              qty,
              weighing: false,
              stampingDate: cf.stampingDate ? String(cf.stampingDate) : null,
              unitPrice,
              amount: unitPrice * qty,
            };
          })(),
        ];

  // Customer order: alphabetical product list (stable for multi-machine DCs)
  lines = [...lines].sort((a, b) =>
    a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" }),
  );

  const catalogSubtotal = lines.reduce((s, l) => s + l.amount, 0);
  const saleTotalQuoted = Math.max(
    0,
    Number(leadCf.salePaymentTotal ?? leadCf.budget ?? cf.salePaymentTotal ?? 0),
  );
  // Prefer quoted sale total from sales desk; else sum of catalog sale prices
  let saleTotal = saleTotalQuoted > 0 ? saleTotalQuoted : catalogSubtotal;
  // If quote exists but line prices are 0, spread evenly across lines for the print table
  if (saleTotalQuoted > 0 && catalogSubtotal <= 0 && lines.length > 0) {
    const per = Math.round((saleTotalQuoted / lines.length) * 100) / 100;
    let allocatedAmt = 0;
    lines = lines.map((l, i) => {
      const amount =
        i === lines.length - 1
          ? Math.round((saleTotalQuoted - allocatedAmt) * 100) / 100
          : per;
      allocatedAmt += i === lines.length - 1 ? 0 : per;
      const unitPrice = Math.round((amount / Math.max(1, l.qty)) * 100) / 100;
      return { ...l, unitPrice, amount };
    });
    saleTotal = saleTotalQuoted;
  } else if (catalogSubtotal > 0 && saleTotalQuoted <= 0) {
    saleTotal = catalogSubtotal;
  }

  const advanceAmount = Math.max(
    0,
    Number(row.advanceAmount ?? leadCf.saleAdvanceAmount ?? cf.saleAdvanceAmount ?? 0),
  );
  const balanceDue = Math.max(0, saleTotal - advanceAmount);

  const sellerAddress = [
    tenant?.addressLine1,
    tenant?.city,
    tenant?.state,
    tenant?.postalCode,
    tenant?.country,
  ]
    .filter(Boolean)
    .join(", ");

  const customerName = contact?.name ?? lead?.name ?? "Customer";
  const customerCode = contact?.customerCode ? String(contact.customerCode) : null;
  const phone = contact?.phone ?? contact?.mobile ?? lead?.phone ?? null;
  const email = contact?.email ?? lead?.email ?? null;
  const city = contact?.city ?? lead?.city ?? null;
  const state = contact?.state ?? lead?.state ?? null;
  const area = contact?.area ?? lead?.area ?? null;
  const addressLine =
    [
      contact?.doorNo,
      contact?.street,
      area,
      city,
      state,
      contact?.pincode,
    ]
      .filter(Boolean)
      .join(", ") || null;

  const deliveryChallan = {
    number: dcNumber,
    date: dcDate,
    issuedAt,
    purpose: "SALE" as const,
    customerName,
    customerCode,
    company: lead?.company ?? null,
    phone,
    email,
    city,
    state,
    addressLine,
    productName: lines.map((l) => l.productName).join(", "),
    productSku: lines[0]?.productSku ?? null,
    serialNo: lines[0]?.serialNo || lines[0]?.hmsUniqId || row.serialNo || "—",
    hmsUniqId: lines[0]?.hmsUniqId ?? null,
    qty: lines.reduce((s, l) => s + l.qty, 0),
    lines,
    stampingDate: lines.find((l) => l.stampingDate)?.stampingDate ?? null,
    executiveName: creator?.name ?? null,
    executiveId: creator?.id ?? null,
    leadId: row.leadId,
    requisitionId: row.id,
    reqNumber: row.reqNumber,
    stockUnitId: row.stockUnitId,
    saleTotal,
    advanceAmount,
    balanceDue,
    currency: "INR",
    notes:
      body.notes?.trim() ||
      `Sale delivery · ${row.reqNumber} · ${lines.length} machine(s) · Total ₹${saleTotal.toLocaleString("en-IN")}`,
    sellerName: tenant?.name ?? "HMS Enterprises",
    sellerPhone: tenant?.phone ?? null,
    sellerEmail: tenant?.email ?? null,
    sellerGstin: tenant?.gstin ?? null,
    sellerAddress: sellerAddress || null,
  };

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      serialNo: lines[0]?.serialNo || lines[0]?.hmsUniqId || row.serialNo,
      customFields: {
        ...cf,
        releaseLines: releaseLines.length ? releaseLines : cf.releaseLines,
        saleDcNo: dcNumber,
        saleDcDate: dcDate,
        saleDcAt: issuedAt,
        saleDcById: userId,
        saleDeliveryChallan: deliveryChallan,
      } as Prisma.InputJsonValue,
    },
  });

  await syncSaleReleaseToLead(t, row.leadId, updated);

  // Notify sales only on first DC create (not when upgrading an old incomplete DC)
  if (!reuseDcNo) {
    const salesIds = await userIdsByRoleCodes(t, ["SALES_EXECUTIVE", "AGENT", "ADMIN", "MANAGER"]);
    const ids = new Set<string>(
      [...salesIds, row.requestedById].filter((x): x is string => Boolean(x)),
    );
    if (ids.size) {
      await createNotifications(
        [...ids].map((uid) => ({
          tenantId: t,
          userId: uid,
          title: `Sale DC ${dcNumber}`,
          message: `${row.reqNumber} · ${customerName} · ${lines.length} machine(s) · ₹${saleTotal.toLocaleString("en-IN")} — open sale to view / print DC`,
          type: "REQUISITION_SALE_DC",
          entityType: row.leadId ? "lead" : "sales_requisition",
          entityId: row.leadId || row.id,
        })),
        req,
      );
    }
  }

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

export async function markShipped(t: string, id: string, userId: string, req?: Request) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (row.status !== "FULFILLED" && row.status !== "APPROVED") {
    throw new AppError("Ship only after approval / fulfill", 409);
  }
  if (row.status === "APPROVED") {
    const releaseLines = Array.isArray(
      row.customFields && typeof row.customFields === "object"
        ? (row.customFields as Record<string, unknown>).releaseLines
        : null,
    )
      ? ((row.customFields as Record<string, unknown>).releaseLines as unknown[])
      : [];
    if (!releaseLines.length) {
      throw new AppError("Reduce stock (stock out) before marking ready to ship", 409);
    }
  }

  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};

  const releaseLines = Array.isArray(cf.releaseLines)
    ? (cf.releaseLines as unknown[])
    : [];
  const nameParts = String(row.productName || "")
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const needed = Math.max(
    1,
    Array.isArray(cf.stampLines) ? cf.stampLines.length : 0,
    typeof cf.machinesNeeded === "number" ? Number(cf.machinesNeeded) : 0,
    Number(row.qty) || 0,
    nameParts.length,
  );
  const allStockOut = releaseLines.length >= needed || Boolean(cf.stockReducedAt);

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      status: allStockOut || row.status === "FULFILLED" ? "FULFILLED" : row.status,
      shippedAt: new Date(),
      customFields: {
        ...cf,
        shippedById: userId,
        readyToShipAt: new Date().toISOString(),
        fulfilledAt: cf.fulfilledAt ?? (allStockOut ? new Date().toISOString() : null),
      },
    },
  });

  await syncSaleReleaseToLead(t, row.leadId, updated);

  await notifySalesReadyToShip(
    t,
    {
      id: row.id,
      reqNumber: row.reqNumber,
      requestedById: row.requestedById,
      serialNo: row.serialNo,
      productName: row.productName,
      customFields: updated.customFields,
    },
    req,
  );

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

export async function addPaymentNote(
  t: string,
  id: string,
  userId: string,
  body: { amount?: number; note: string },
) {
  await ensureSalesRequisitionsTable();
  const row = await prisma.salesRequisition.findFirst({
    where: { id, tenantId: t, deletedAt: null },
  });
  if (!row) throw notFound("Sales requisition");
  if (!body.note?.trim()) throw new AppError("Payment note is required", 400);

  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};
  const notes = Array.isArray(cf.paymentFollowups)
    ? (cf.paymentFollowups as Array<Record<string, unknown>>)
    : [];
  const entry = {
    at: new Date().toISOString(),
    byId: userId,
    amount: body.amount ?? null,
    note: body.note.trim(),
  };
  const advanceAmount =
    body.amount != null && Number.isFinite(body.amount)
      ? Number(row.advanceAmount) + Number(body.amount)
      : row.advanceAmount;

  const updated = await prisma.salesRequisition.update({
    where: { id },
    data: {
      advanceAmount,
      paymentNotes: [row.paymentNotes, body.note.trim()].filter(Boolean).join("\n"),
      customFields: {
        ...cf,
        paymentFollowups: [entry, ...notes].slice(0, 100),
      } as Prisma.InputJsonValue,
    },
  });

  // Mirror advance onto lead CF for sales step bar + due
  const lead = await prisma.lead.findFirst({ where: { id: row.leadId, tenantId: t, deletedAt: null } });
  if (lead) {
    const lcf = leadCf(lead);
    const total = Number(lcf.salePaymentTotal ?? lcf.budget ?? cf.salePaymentTotal ?? 0) || 0;
    const adv = Number(advanceAmount) || 0;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        customFields: {
          ...lcf,
          saleAdvanceAmount: adv,
          saleDueAmount: Math.max(0, total - adv),
          salePaymentNotes: updated.paymentNotes,
          lastPaymentFollowupAt: entry.at,
        } as Prisma.InputJsonValue,
      },
    });
  }

  return serializeRequisition(updated as unknown as Record<string, unknown>);
}

/** Gate for invoice.create — sale/demo serials need approved requisition unless fulfill path */
export async function assertSerialSaleAllowed(
  t: string,
  stockUnitId: string,
  opts?: { fromRequisitionFulfill?: boolean; requisitionId?: string },
) {
  if (opts?.fromRequisitionFulfill) return;

  const unit = await prisma.stockUnit.findFirst({
    where: { id: stockUnitId, tenantId: t, deletedAt: null },
  });
  if (!unit) throw notFound("Stock unit");

  const openReq = await prisma.salesRequisition.findFirst({
    where: {
      tenantId: t,
      deletedAt: null,
      stockUnitId,
      status: { in: ["PENDING_APPROVAL", "APPROVED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (openReq?.status === "PENDING_APPROVAL") {
    throw new AppError(
      `Requisition ${openReq.reqNumber} is waiting for admin approval before stock can leave`,
      409,
      { requisitionId: openReq.id },
    );
  }

  if (openReq?.status === "APPROVED") {
    // Allow PI from invoices UI when approved — caller should mark fulfilled after
    return openReq;
  }

  // Demo / lead-linked serials always need a requisition for sale release
  if (unit.status === "DEMO" || unit.leadId) {
    throw new AppError(
      "Admin must approve a sales requisition before releasing this serial from stock",
      409,
    );
  }
}

export async function markFulfilledFromInvoice(
  t: string,
  requisitionId: string,
  invoiceId: string,
  invoiceNumber: string,
  userId: string,
) {
  const row = await prisma.salesRequisition.findFirst({
    where: { id: requisitionId, tenantId: t, deletedAt: null },
  });
  if (!row) return;
  // Inventory may already have FULFILLED via stock-out — sales PI only links the invoice
  if (row.status !== "APPROVED" && row.status !== "FULFILLED") return;
  const cf =
    row.customFields && typeof row.customFields === "object" && !Array.isArray(row.customFields)
      ? (row.customFields as Record<string, unknown>)
      : {};
  await prisma.salesRequisition.update({
    where: { id: row.id },
    data: {
      status: "FULFILLED",
      invoiceId,
      customFields: {
        ...cf,
        ...(row.status === "APPROVED"
          ? { fulfilledAt: new Date().toISOString(), fulfilledById: userId }
          : {}),
        invoiceNumber,
        awaitingSalesPi: false,
        salesPiAt: new Date().toISOString(),
        salesPiById: userId,
      },
    },
  });
}
