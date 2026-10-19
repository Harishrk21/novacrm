/**
 * Phase 1 — one-time map: HMS Enterprises → Attendance tenant slug `hms`.
 *
 * Reads Attendance SSO secret from ATTENDANCE_SSO_SECRET or HMS_ATT server/.env
 * (SEED_SSO_SECRET) so local launch can mint tickets against the local API.
 *
 * Usage (from nova_crm/backend):
 *   npx tsx scripts/map-attendance-hms.ts
 *
 * Env overrides:
 *   ATTENDANCE_TENANT_ID   default 955fa2a6-74b0-4d49-b7e7-9f87b7b68bd3
 *   ATTENDANCE_SLUG        default hms
 *   ATTENDANCE_SSO_ISSUER  default hms-dashboard
 *   ATTENDANCE_SSO_SECRET  required unless readable from ../HMS_ATT/server/.env
 *   HMS_TENANT_SLUG        default precision-scales-india
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSeedSecretFromAttendanceEnv(): string | null {
  const candidates = [
    process.env.ATTENDANCE_SERVER_ENV,
    path.resolve(__dirname, "../../../HMS_ATT/server/.env"),
    path.resolve(__dirname, "../../../../HMS_ATT/server/.env"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const m = text.match(/^SEED_SSO_SECRET=(.+)$/m);
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* try next */
    }
  }
  return null;
}

async function main() {
  const attendanceTenantId =
    process.env.ATTENDANCE_TENANT_ID ?? "955fa2a6-74b0-4d49-b7e7-9f87b7b68bd3";
  const attendanceSlug = process.env.ATTENDANCE_SLUG ?? "hms";
  const attendanceSsoIssuer = process.env.ATTENDANCE_SSO_ISSUER ?? "hms-dashboard";
  const attendanceSsoSecret =
    process.env.ATTENDANCE_SSO_SECRET ?? readSeedSecretFromAttendanceEnv();
  const hmsSlug = process.env.HMS_TENANT_SLUG ?? "precision-scales-india";

  if (!attendanceSsoSecret) {
    throw new Error(
      "Missing ATTENDANCE_SSO_SECRET (or SEED_SSO_SECRET in HMS_ATT/server/.env)",
    );
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: hmsSlug, deletedAt: null },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    throw new Error(`HMS tenant not found for slug=${hmsSlug}`);
  }

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      attendanceEnabled: true,
      attendanceTenantId,
      attendanceSlug,
      attendanceSsoIssuer,
      attendanceSsoSecret,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      attendanceEnabled: true,
      attendanceTenantId: true,
      attendanceSlug: true,
      attendanceSsoIssuer: true,
    },
  });

  console.log("Mapped HMS client → Attendance tenant:");
  console.log(JSON.stringify(updated, null, 2));
  console.log("(SSO secret stored; not printed)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
