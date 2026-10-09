import { prisma } from "../config/database.js";
import { newId } from "./utils/id.js";

type AuditInput = {
  tenantId?: string | null;
  actorType: "PLATFORM_ADMIN" | "USER" | "SYSTEM";
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
};

/** Best-effort audit write — never throws to callers. */
export async function writeAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        id: newId(),
        tenantId: input.tenantId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action.slice(0, 64),
        entityType: input.entityType?.slice(0, 64) ?? null,
        entityId: input.entityId ?? null,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 255) ?? null,
        beforeJson: input.beforeJson as object | undefined,
        afterJson: input.afterJson as object | undefined,
      },
    });
  } catch {
    /* ignore audit failures */
  }
}
