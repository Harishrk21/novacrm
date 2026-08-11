import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors.js";
import { normalizePhone } from "../../common/utils/phone.js";

type Db = PrismaClient | Prisma.TransactionClient;

const SEQ_KEY = "CUSTOMER";
const PREFIX = "CUS-";
const PADDING = 5;

export function formatCustomerCode(customerNo: number, prefix = PREFIX, padding = PADDING) {
  return `${prefix}${String(customerNo).padStart(padding, "0")}`;
}

/** Allocate next customer number + display code for this workspace (atomic sequence). */
export async function allocateCustomerIdentity(tenantId: string, db: Db = prisma) {
  let seq = await db.numberSequence.findUnique({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey: SEQ_KEY } },
  });
  if (!seq) {
    seq = await db.numberSequence.create({
      data: {
        tenantId,
        sequenceKey: SEQ_KEY,
        prefix: PREFIX,
        nextValue: 1,
        padding: PADDING,
      },
    });
  }
  await db.numberSequence.update({
    where: { tenantId_sequenceKey: { tenantId, sequenceKey: SEQ_KEY } },
    data: { nextValue: { increment: 1 } },
  });
  const customerNo = seq.nextValue;
  return {
    customerNo,
    customerCode: formatCustomerCode(customerNo, seq.prefix || PREFIX, seq.padding || PADDING),
  };
}

/**
 * Live identity rules (active contacts only):
 * 1. customerCode / customerNo — system-assigned, unique per workspace
 * 2. phone (normalized) — required for new customers; unique among active contacts
 * 3. email — optional; unique among active contacts when provided
 */
export async function assertContactIdentityAvailable(
  tenantId: string,
  opts: {
    phone?: string | null;
    mobile?: string | null;
    email?: string | null;
    excludeId?: string;
    requirePhone?: boolean;
  },
  db: Db = prisma,
) {
  const requirePhone = opts.requirePhone !== false;
  const phoneRaw = (opts.phone || opts.mobile || "").trim();
  const phoneNormalized = normalizePhone(phoneRaw) || null;
  const email = opts.email?.trim().toLowerCase() || null;

  if (requirePhone && !phoneNormalized) {
    throw new AppError("Phone number is required to create or identify a customer", 422);
  }

  if (phoneNormalized) {
    const phoneHit = await db.contact.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        phoneNormalized,
        ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
      },
      select: { id: true, customerCode: true, name: true },
    });
    if (phoneHit) {
      throw new AppError(
        `Phone already used by customer ${phoneHit.customerCode ?? phoneHit.id} (${phoneHit.name})`,
        409,
        { field: "phone", existingId: phoneHit.id, customerCode: phoneHit.customerCode },
      );
    }
  }

  if (email) {
    const emailHit = await db.contact.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        email,
        ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
      },
      select: { id: true, customerCode: true, name: true },
    });
    if (emailHit) {
      throw new AppError(
        `Email already used by customer ${emailHit.customerCode ?? emailHit.id} (${emailHit.name})`,
        409,
        { field: "email", existingId: emailHit.id, customerCode: emailHit.customerCode },
      );
    }
  }

  return { phoneNormalized, email };
}
