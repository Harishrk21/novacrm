import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors.js";
import { env } from "../../config/env.js";

type PlatformTokenCache = { token: string; expiresAt: number };
let tokenCache: PlatformTokenCache | null = null;

export type AttendanceProvisionResult = {
  action: "created" | "linked" | "already_linked" | "disabled" | "skipped";
  attendanceTenantId?: string;
  attendanceSlug?: string;
  inviteUrl?: string | null;
  message: string;
};

function attendanceApiBase(): string {
  return env.ATTENDANCE_API_URL.replace(/\/$/, "");
}

function allowedOrigins(): string[] {
  const fromClient = env.CLIENT_URL.split(",").map((s) => s.trim()).filter(Boolean);
  const extras = (process.env.ATTENDANCE_SSO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromClient, ...extras, "http://localhost:5190"])];
}

/** Attendance workspace slug from HMS client slug (must match Attendance Slug regex). */
export function attendanceSlugFromHms(slug: string): string {
  const base = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (base.length >= 2) return base;
  return `client-${Date.now().toString(36)}`.slice(0, 40);
}

function ssoIssuerForSlug(attendanceSlug: string): string {
  // Phase 1 HMS Enterprises uses bare `hms-dashboard`; new clients get a unique issuer.
  if (attendanceSlug === "hms") return env.ATTENDANCE_SSO_ISSUER_PREFIX;
  return `${env.ATTENDANCE_SSO_ISSUER_PREFIX}:${attendanceSlug}`;
}

async function platformLogin(): Promise<string> {
  if (env.ATTENDANCE_PLATFORM_TOKEN) {
    return env.ATTENDANCE_PLATFORM_TOKEN;
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const email = env.ATTENDANCE_PLATFORM_EMAIL;
  const password = env.ATTENDANCE_PLATFORM_PASSWORD;
  if (!email || !password) {
    throw new AppError(
      "Attendance platform credentials missing — set ATTENDANCE_PLATFORM_EMAIL/PASSWORD or ATTENDANCE_PLATFORM_TOKEN",
      503,
    );
  }
  const res = await fetch(`${attendanceApiBase()}/v1/platform/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    message?: string;
    error?: string;
  };
  if (!res.ok || !body.token) {
    throw new AppError(
      `Attendance platform login failed: ${body.message || body.error || res.status}`,
      502,
    );
  }
  // Platform tokens typically last ACCESS_TOKEN_TTL (e.g. 12h) — cache 11h
  tokenCache = { token: body.token, expiresAt: Date.now() + 11 * 3600_000 };
  return body.token;
}

async function attendanceFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const token = init.token ?? (await platformLogin());
  const { token: _drop, ...rest } = init;
  const res = await fetch(`${attendanceApiBase()}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg = body.message || body.error || `Attendance API ${res.status}`;
    throw new AppError(msg, res.status >= 400 && res.status < 500 ? res.status : 502);
  }
  return body;
}

async function resolveAdminContact(tenantId: string): Promise<{ name: string; email: string }> {
  const adminRole = await prisma.role.findFirst({
    where: { tenantId, code: "ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (adminRole) {
    const adminUser = await prisma.user.findFirst({
      where: {
        tenantId,
        roleId: adminRole.id,
        deletedAt: null,
        status: { in: ["ACTIVE", "INVITED"] },
      },
      select: { name: true, email: true },
      orderBy: { createdAt: "asc" },
    });
    if (adminUser) return { name: adminUser.name, email: adminUser.email };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { name: true, email: true },
  });
  const email = tenant?.email?.trim();
  if (email) return { name: tenant!.name, email };
  throw new AppError("Cannot provision Attendance — client has no admin email", 400);
}

/**
 * Create Attendance tenant + SSO when Attendance is first enabled for an HMS client.
 * Idempotent if attendance_tenant_id already set.
 */
export async function provisionAttendanceForHmsTenant(
  tenantId: string,
): Promise<AttendanceProvisionResult> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      plan: true,
      status: true,
      attendanceEnabled: true,
      attendanceTenantId: true,
      attendanceSlug: true,
      attendanceSsoIssuer: true,
      attendanceSsoSecret: true,
    },
  });
  if (!tenant) throw new AppError("Tenant not found", 404);

  // Already fully linked (Phase 1 map or prior provision)
  if (tenant.attendanceTenantId && tenant.attendanceSsoSecret && tenant.attendanceSsoIssuer) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { attendanceEnabled: true },
    });
    try {
      await syncAttendanceGeofence(tenantId);
    } catch {
      /* optional */
    }
    return {
      action: "already_linked",
      attendanceTenantId: tenant.attendanceTenantId,
      attendanceSlug: tenant.attendanceSlug ?? undefined,
      message: "Attendance already linked — enabled",
    };
  }

  // Linked tenant id but missing SSO — create SSO only
  if (tenant.attendanceTenantId && !tenant.attendanceSsoSecret) {
    const slug = tenant.attendanceSlug || attendanceSlugFromHms(tenant.slug);
    const issuer = tenant.attendanceSsoIssuer || ssoIssuerForSlug(slug);
    const sso = await attendanceFetch<{ sharedSecret: string }>(
      `/v1/platform/tenants/${tenant.attendanceTenantId}/sso`,
      {
        method: "POST",
        body: JSON.stringify({
          issuer,
          allowedOrigins: allowedOrigins(),
          defaultRole: "employee",
          autoProvision: true,
          syncRole: true,
        }),
      },
    );
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        attendanceEnabled: true,
        attendanceSlug: slug,
        attendanceSsoIssuer: issuer,
        attendanceSsoSecret: sso.sharedSecret,
      },
    });
    return {
      action: "linked",
      attendanceTenantId: tenant.attendanceTenantId,
      attendanceSlug: slug,
      message: "Attendance SSO configured",
    };
  }

  const admin = await resolveAdminContact(tenantId);
  // Prefer existing Phase-1 slug `hms` only when already stored; else derive from HMS slug
  let slug =
    tenant.attendanceSlug ||
    (tenant.slug === "precision-scales-india" ? "hms" : attendanceSlugFromHms(tenant.slug));

  const status =
    tenant.status === "ACTIVE" || tenant.status === "TRIAL" ? "active" : "trial";

  let created: {
    tenant: { id: string; slug: string };
    invite?: { url?: string };
  };
  try {
    created = await attendanceFetch(`/v1/platform/tenants`, {
      method: "POST",
      body: JSON.stringify({
        name: tenant.name,
        slug,
        timezone: tenant.timezone || "Asia/Kolkata",
        status: status === "active" ? "active" : "trial",
        plan: "starter",
        seatLimit: null,
        contactName: admin.name,
        contactEmail: admin.email,
        branchName: "Head Office",
        admin,
      }),
    });
  } catch (err) {
    // Slug taken — retry once with unique suffix (except protected seed slug `hms`)
    if (err instanceof AppError && /taken|SLUG/i.test(err.message) && slug !== "hms") {
      slug = `${slug}`.slice(0, 34) + "-" + Date.now().toString(36).slice(-5);
      created = await attendanceFetch(`/v1/platform/tenants`, {
        method: "POST",
        body: JSON.stringify({
          name: tenant.name,
          slug,
          timezone: tenant.timezone || "Asia/Kolkata",
          status: status === "active" ? "active" : "trial",
          plan: "starter",
          seatLimit: null,
          contactName: admin.name,
          contactEmail: admin.email,
          branchName: "Head Office",
          admin,
        }),
      });
    } else if (
      err instanceof AppError &&
      /taken|SLUG/i.test(err.message) &&
      slug === "hms"
    ) {
      // Seed tenant exists — look up by listing (platform) is heavy; use known Phase-1 id if slug is hms
      throw new AppError(
        "Attendance tenant slug `hms` already exists — map it with scripts/map-attendance-hms.ts instead of re-provisioning",
        409,
      );
    } else {
      throw err;
    }
  }

  const attendanceTenantId = created.tenant.id;
  const issuer = ssoIssuerForSlug(created.tenant.slug);
  const sso = await attendanceFetch<{ sharedSecret: string }>(
    `/v1/platform/tenants/${attendanceTenantId}/sso`,
    {
      method: "POST",
      body: JSON.stringify({
        issuer,
        allowedOrigins: allowedOrigins(),
        defaultRole: "employee",
        autoProvision: true,
        syncRole: true,
      }),
    },
  );

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      attendanceEnabled: true,
      attendanceTenantId,
      attendanceSlug: created.tenant.slug,
      attendanceSsoIssuer: issuer,
      attendanceSsoSecret: sso.sharedSecret,
    },
  });

  try {
    await syncAttendanceGeofence(tenantId);
  } catch {
    /* geofence sync is best-effort; client can re-save settings */
  }

  return {
    action: "created",
    attendanceTenantId,
    attendanceSlug: created.tenant.slug,
    inviteUrl: created.invite?.url ?? null,
    message: "Attendance tenant provisioned",
  };
}

/** Push office GPS geofence from Meister tenant → Attendance product. */
export async function syncAttendanceGeofence(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      attendanceTenantId: true,
      attendanceGeofenceEnabled: true,
      attendanceGeofenceLat: true,
      attendanceGeofenceLng: true,
      attendanceGeofenceRadiusM: true,
    },
  });
  if (!tenant?.attendanceTenantId) return;

  const lat =
    tenant.attendanceGeofenceLat != null ? Number(tenant.attendanceGeofenceLat) : null;
  const lng =
    tenant.attendanceGeofenceLng != null ? Number(tenant.attendanceGeofenceLng) : null;

  await attendanceFetch(`/v1/platform/tenants/${tenant.attendanceTenantId}/geofence`, {
    method: "PUT",
    body: JSON.stringify({
      enabled: !!tenant.attendanceGeofenceEnabled,
      lat,
      lng,
      radiusM: tenant.attendanceGeofenceRadiusM || 10,
    }),
  });
}

/** Hide Attendance in HMS and optionally suspend the Attendance company. */
export async function disableAttendanceForHmsTenant(
  tenantId: string,
): Promise<AttendanceProvisionResult> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      attendanceTenantId: true,
      attendanceSlug: true,
    },
  });
  if (!tenant) throw new AppError("Tenant not found", 404);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { attendanceEnabled: false },
  });

  if (tenant.attendanceTenantId && env.ATTENDANCE_SUSPEND_ON_DISABLE) {
    try {
      await attendanceFetch(`/v1/platform/tenants/${tenant.attendanceTenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "suspended" }),
      });
    } catch (err) {
      console.error("[attendance] suspend failed", err);
    }
  }

  return {
    action: "disabled",
    attendanceTenantId: tenant.attendanceTenantId ?? undefined,
    attendanceSlug: tenant.attendanceSlug ?? undefined,
    message: "Attendance disabled for this client",
  };
}

export const ATTENDANCE_MODULE_KEY = "hr.attendance";
