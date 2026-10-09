import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { AppError } from "../../common/errors.js";
import {
  allocateCustomerIdentity,
  assertContactIdentityAvailable,
} from "./customerIdentity.js";
import {
  defaultNextAmcService,
  defaultWarrantyEndFromToday,
  normalizeServicePlan,
} from "../../common/hmsCoverage.js";

const MACHINE_TYPES = new Set([
  "WEIGHING",
  "BILLING",
  "CCM",
  "CCTV",
  "BIOMETRIC",
  "PAPER_SHREDDER",
  "PAPER_ROLL",
  "OTHER",
]);

export type ImportMachineInput = {
  name?: string | null;
  machineType?: string | null;
  serialNo?: string | null;
  model?: string | null;
  capacity?: string | null;
  accuracy?: string | null;
  platformSize?: string | null;
  origin?: string | null;
  servicePlan?: string | null;
  warrantyEndDate?: string | null;
  amcStartDate?: string | null;
  amcEndDate?: string | null;
  nextServiceDueDate?: string | null;
  stampingDate?: string | null;
  nextDueDate?: string | null;
  notes?: string | null;
  /** How many identical units (same model, no serial). Capped. Ignored when serialNo is set. */
  quantity?: number | string | null;
};

export type ImportRowInput = {
  name?: string | null;
  phone?: string | null;
  mobile?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  doorNo?: string | null;
  street?: string | null;
  buildingName?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  description?: string | null;
  machine?: ImportMachineInput | null;
};

function clean(v: unknown) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseDate(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function mapMachineType(raw: string | null | undefined) {
  if (!raw) return "WEIGHING";
  const u = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (MACHINE_TYPES.has(u)) return u;
  if (/weigh/i.test(raw)) return "WEIGHING";
  if (/bill|pos|software/i.test(raw)) return "BILLING";
  if (/cctv|camera/i.test(raw)) return "CCTV";
  if (/bio|finger|face/i.test(raw)) return "BIOMETRIC";
  if (/ccm|cash.?count/i.test(raw)) return "CCM";
  if (/shred/i.test(raw)) return "PAPER_SHREDDER";
  if (/paper.?roll/i.test(raw)) return "PAPER_ROLL";
  return "OTHER";
}

function mapOrigin(
  raw: string | null | undefined,
  fallback: "SOLD_BY_US" | "THIRD_PARTY" = "SOLD_BY_US",
) {
  if (!raw) return fallback;
  if (/third|outside|repair|other.?brand/i.test(raw)) return "THIRD_PARTY";
  if (/sold|hms|us\b/i.test(raw)) return "SOLD_BY_US";
  return fallback;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function mergeImportSources(existing: unknown, source?: "SALES" | "SERVICE") {
  const prev = Array.isArray(existing) ? existing.map(String) : [];
  if (source && !prev.includes(source)) prev.push(source);
  return prev;
}

function mapServicePlan(raw: string | null | undefined) {
  return normalizeServicePlan(raw);
}

type AddMachineResult = { added: number; duplicate: boolean };

/**
 * Machine identity:
 * - With serial → unique physical unit (re-import of same serial = skip, not a new machine).
 * - Without serial → each row / quantity creates separate units (qty 2 of same model = 2 machines).
 * Never treat "same model name" alone as a duplicate.
 */
async function addMachine(
  tenantId: string,
  contactId: string,
  machine: ImportMachineInput,
  source?: "SALES" | "SERVICE",
): Promise<AddMachineResult> {
  const name = clean(machine.name);
  if (!name) return { added: 0, duplicate: false };

  const serialRaw = clean(machine.serialNo);
  const serialNo = serialRaw?.toUpperCase() ?? null;
  if (serialNo) {
    const existingSerial = await prisma.customerAsset.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ serialNo }, ...(serialRaw && serialRaw !== serialNo ? [{ serialNo: serialRaw }] : [])],
      },
      select: { id: true },
    });
    if (existingSerial) return { added: 0, duplicate: true };
  }

  const plan = mapServicePlan(clean(machine.servicePlan));
  const amcStart = plan === "AMC" ? parseDate(clean(machine.amcStartDate) ?? undefined) : null;
  const amcEnd = plan === "AMC" ? parseDate(clean(machine.amcEndDate) ?? undefined) : null;
  const warrantyEnd =
    plan === "GC"
      ? parseDate(clean(machine.warrantyEndDate) ?? undefined) ?? defaultWarrantyEndFromToday()
      : parseDate(clean(machine.warrantyEndDate) ?? undefined);
  const nextService =
    plan === "AMC"
      ? parseDate(clean(machine.nextServiceDueDate) ?? undefined) ?? defaultNextAmcService(amcStart)
      : parseDate(clean(machine.nextServiceDueDate) ?? undefined);

  // Serial = one physical unit. No serial + quantity N = N separate units of the same model.
  const rawQty = Number(machine.quantity);
  const quantity =
    serialNo || !Number.isFinite(rawQty) || rawQty < 1 ? 1 : Math.min(20, Math.floor(rawQty));

  const base = {
    tenantId,
    contactId,
    machineType: mapMachineType(clean(machine.machineType)) as
      | "WEIGHING"
      | "BILLING"
      | "CCM"
      | "CCTV"
      | "BIOMETRIC"
      | "PAPER_SHREDDER"
      | "PAPER_ROLL"
      | "OTHER",
    name,
    capacity: clean(machine.capacity),
    accuracy: clean(machine.accuracy),
    platformSize: clean(machine.platformSize),
    model: clean(machine.model),
    origin: mapOrigin(clean(machine.origin), "SOLD_BY_US") as "SOLD_BY_US" | "THIRD_PARTY",
    servicePlan: plan,
    warrantyEndDate: warrantyEnd,
    amcStartDate: amcStart,
    amcEndDate: amcEnd,
    nextServiceDueDate: nextService,
    remindersEnabled: true,
    stampingDate: parseDate(clean(machine.stampingDate) ?? undefined),
    nextDueDate: parseDate(clean(machine.nextDueDate) ?? undefined),
    notes: clean(machine.notes),
    customFields: source
      ? ({ importRegister: source } as object)
      : undefined,
  };

  for (let i = 0; i < quantity; i++) {
    await prisma.customerAsset.create({
      data: {
        id: newId(),
        ...base,
        // Only the first copy keeps the serial when quantity>1 would be invalid; serial path forces qty=1.
        serialNo: i === 0 ? serialNo : null,
      },
    });
  }
  return { added: quantity, duplicate: false };
}

/**
 * Bulk import customers (+ optional machine(s) per row).
 * Customer identity = normalized phone (merge machines onto existing contact).
 * Machine identity = serial when present; otherwise each unit is new (supports qty / multi-row).
 */
export async function importCustomers(
  tenantId: string,
  rows: ImportRowInput[],
  opts?: { source?: "SALES" | "SERVICE" },
) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError("No rows to import", 422);
  }
  if (rows.length > 500) {
    throw new AppError("Import up to 500 rows per batch. Split the file and upload again.", 422);
  }

  const source = opts?.source;
  const summary = {
    created: 0,
    merged: 0,
    machinesAdded: 0,
    machinesSkippedDuplicate: 0,
    skipped: 0,
    errors: [] as Array<{ row: number; message: string }>,
  };

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const row = rows[i] ?? {};
    try {
      const name = clean(row.name);
      const phoneRaw = clean(row.mobile) || clean(row.phone) || clean(row.whatsapp);
      const phoneNormalized = phoneRaw ? normalizePhone(phoneRaw) : null;
      const email = clean(row.email)?.toLowerCase() ?? null;

      if (!name) {
        summary.skipped += 1;
        summary.errors.push({ row: rowNum, message: "Customer name is required" });
        continue;
      }
      if (!phoneNormalized) {
        summary.skipped += 1;
        summary.errors.push({ row: rowNum, message: "Phone / mobile is required" });
        continue;
      }

      const customFields: Record<string, unknown> = {};
      const building = clean(row.buildingName);
      const whatsapp = clean(row.whatsapp) || phoneRaw;
      if (building) customFields.building_name = building;
      if (whatsapp) customFields.whatsapp = whatsapp;

      const existing = await prisma.contact.findFirst({
        where: { tenantId, deletedAt: null, phoneNormalized },
      });

      let contactId: string;
      if (existing) {
        contactId = existing.id;
        summary.merged += 1;
        const prevCf = asRecord(existing.customFields);
        const nextCf = {
          ...prevCf,
          ...customFields,
          importSources: mergeImportSources(prevCf.importSources, source),
          lastImportSource: source ?? prevCf.lastImportSource ?? null,
        };
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            email: existing.email || email,
            mobile: existing.mobile || clean(row.mobile) || existing.mobile,
            doorNo: existing.doorNo || clean(row.doorNo),
            street: existing.street || clean(row.street),
            area: existing.area || clean(row.area),
            pincode: existing.pincode || clean(row.pincode),
            location: existing.location || clean(row.landmark),
            city: existing.city || clean(row.city),
            state: existing.state || clean(row.state),
            description: existing.description || clean(row.description),
            customFields: nextCf as object,
          },
        });
      } else {
        let safeEmail = email;
        try {
          await assertContactIdentityAvailable(tenantId, {
            phone: phoneRaw,
            mobile: clean(row.mobile) || phoneRaw,
            email: safeEmail,
            requirePhone: true,
          });
        } catch (err) {
          // Same phone should have hit existing above; email clash → drop email and continue
          const msg = err instanceof Error ? err.message : "";
          if (/email already used/i.test(msg) && safeEmail) {
            safeEmail = null;
          } else {
            throw err;
          }
        }
        const identityCheck = await assertContactIdentityAvailable(tenantId, {
          phone: phoneRaw,
          mobile: clean(row.mobile) || phoneRaw,
          email: safeEmail,
          requirePhone: true,
        });
        const created = await prisma.$transaction(async (tx) => {
          const identity = await allocateCustomerIdentity(tenantId, tx);
          return tx.contact.create({
            data: {
              id: newId(),
              tenantId,
              customerNo: identity.customerNo,
              customerCode: identity.customerCode,
              name,
              email: identityCheck.email,
              phone: phoneRaw,
              mobile: clean(row.mobile) || phoneRaw,
              phoneNormalized: identityCheck.phoneNormalized,
              doorNo: clean(row.doorNo),
              street: clean(row.street),
              area: clean(row.area),
              pincode: clean(row.pincode),
              location: clean(row.landmark),
              city: clean(row.city),
              state: clean(row.state),
              country: "IN",
              description: clean(row.description),
              customFields: {
                ...customFields,
                importSources: mergeImportSources([], source),
                lastImportSource: source ?? null,
              } as object,
            },
          });
        });
        contactId = created.id;
        summary.created += 1;
      }

      if (row.machine) {
        const machineResult = await addMachine(tenantId, contactId, row.machine, source);
        summary.machinesAdded += machineResult.added;
        if (machineResult.duplicate) summary.machinesSkippedDuplicate += 1;
      }
    } catch (err) {
      summary.skipped += 1;
      summary.errors.push({
        row: rowNum,
        message: err instanceof Error ? err.message : "Import failed for this row",
      });
    }
  }

  return summary;
}
