import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors.js";
import { env } from "../../config/env.js";

/** Map HMS role codes → Attendance roles (used when Attendance sync_role is on). */
export function mapAttendanceRole(hmsRoleCode: string | undefined): "admin" | "manager" | "employee" {
  const code = (hmsRoleCode ?? "").toUpperCase();
  if (code === "ADMIN") return "admin";
  if (code === "MANAGER") return "manager";
  return "employee";
}

export type AttendanceLaunchResult = {
  url: string;
  expiresInSeconds: number;
  attendanceSlug: string;
};

/**
 * Mint a one-time SSO ticket and return the Attendance /sso URL.
 * Secret stays on the HMS backend — never sent to the browser except inside the JWT.
 */
/** Only allow return URLs back to known Meister frontends (open-redirect guard). */
export function sanitizeHostReturnUrl(
  raw: unknown,
  allowedOrigins: string[],
): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (!allowedOrigins.includes(u.origin)) return undefined;
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return undefined;
  }
}

export async function buildAttendanceLaunchUrl(opts: {
  tenantId: string;
  userId: string;
  email: string;
  name: string;
  roleCode?: string;
  redirect?: string;
  embed?: boolean;
  /** Absolute Meister URL to restore after Attendance (Back to dashboard). */
  returnUrl?: string;
}): Promise<AttendanceLaunchResult> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: opts.tenantId, deletedAt: null },
    select: {
      attendanceEnabled: true,
      attendanceTenantId: true,
      attendanceSlug: true,
      attendanceSsoIssuer: true,
      attendanceSsoSecret: true,
    },
  });

  if (!tenant?.attendanceEnabled) {
    throw new AppError("Attendance is not enabled for this company", 403);
  }
  if (!tenant.attendanceSsoIssuer || !tenant.attendanceSsoSecret) {
    throw new AppError("Attendance SSO is not configured for this company", 503);
  }
  if (!tenant.attendanceSlug && !tenant.attendanceTenantId) {
    throw new AppError("Attendance tenant is not linked for this company", 503);
  }

  const expiresInSeconds = 120;
  const role = mapAttendanceRole(opts.roleCode);
  const ticket = jwt.sign(
    {
      email: opts.email,
      name: opts.name,
      role,
    },
    tenant.attendanceSsoSecret,
    {
      algorithm: "HS256",
      issuer: tenant.attendanceSsoIssuer,
      audience: env.ATTENDANCE_SSO_AUDIENCE,
      subject: opts.userId,
      jwtid: randomUUID(),
      expiresIn: expiresInSeconds,
    },
  );

  const appUrl = env.ATTENDANCE_APP_URL.replace(/\/$/, "");
  const url = new URL("/sso", appUrl);
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("redirect", opts.redirect?.startsWith("/") ? opts.redirect : "/");
  if (opts.embed) url.searchParams.set("embed", "1");
  if (opts.returnUrl) url.searchParams.set("returnUrl", opts.returnUrl);

  return {
    url: url.toString(),
    expiresInSeconds,
    attendanceSlug: tenant.attendanceSlug ?? "hms",
  };
}
