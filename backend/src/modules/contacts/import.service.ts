import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { normalizePhone } from "../../common/utils/phone.js";
import { AppError } from "../../common/errors.js";
import {
  allocateCustomerIdentity,
  assertContactIdentityAvailable,
} from "./customerIdentity.js";

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
  stampingDate?: string | null;
  nextDueDate?: string | null;
  notes?: string | null;
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

function mapOrigin(raw: string | null | undefined) {
  if (!raw) return "SOLD_BY_US";
  if (/third|outside|repair|other.?brand/i.test(raw)) return "THIRD_PARTY";
  return "SOLD_BY_US";
}

function mapServicePlan(raw: string | null | undefined) {
  if (!raw) return "NON_AMC";
  if (/^amc$/i.test(raw.trim()) || /under.?amc|with.?amc/i.test(raw)) return "AMC";
  return "NON_AMC";
}

async function addMachine(tenantId: string, contactId: string, machine: ImportMachineInput) {
  const name = clean(machine.name);
  if (!name) return false;
  await prisma.customerAsset.create({
    data: {
      id: newId(),
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
      serialNo: clean(machine.serialNo),
      origin: mapOrigin(clean(machine.origin)) as "SOLD_BY_US" | "THIRD_PARTY",
      servicePlan: mapServicePlan(clean(machine.servicePlan)) as "AMC" | "NON_AMC",
      remindersEnabled: true,
      stampingDate: parseDate(clean(machine.stampingDate) ?? undefined),
      nextDueDate: parseDate(clean(machine.nextDueDate) ?? undefined),
      notes: clean(machine.notes),
    },
  });
  return true;
}

/**
 * Bulk import customers (+ optional one machine per row).
 * Existing phone → merge machine onto that customer (skip duplicate contact).
 */
export async function importCustomers(tenantId: string, rows: ImportRowInput[]) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError("No rows to import", 422);
  }
  if (rows.length > 500) {
    throw new AppError("Import up to 500 rows per batch. Split the file and upload again.", 422);
  }

  const summary = {
    created: 0,
    merged: 0,
    machinesAdded: 0,
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
        select: { id: true, customerCode: true, name: true },
      });

      let contactId: string;
      if (existing) {
        contactId = existing.id;
        summary.merged += 1;
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
              customFields: Object.keys(customFields).length
                ? (customFields as object)
                : undefined,
            },
          });
        });
        contactId = created.id;
        summary.created += 1;
      }

      if (row.machine && (await addMachine(tenantId, contactId, row.machine))) {
        summary.machinesAdded += 1;
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
