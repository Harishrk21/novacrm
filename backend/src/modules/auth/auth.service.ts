import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";
import { resolveInventoryAreas } from "../../common/inventoryAreas.js";
import {
  loadTenantEnabledModuleKeys,
  resolveAllowedModules,
} from "../../common/userModules.js";
import { newId } from "../../common/utils/id.js";
import { tenantSlugCandidates } from "../../common/tenantSlugs.js";
import { wakeAttendanceApi } from "../attendance/attendance.service.js";
type Meta = { userAgent?: string; ip?: string };
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;
/** "12h" → ms. Validated by env schema; falls back to 12h. */
function durationMs(value: string): number {
  const match = value.match(/^(\d+)([dhm])$/);
  if (!match) return 12 * UNIT_MS.h;
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
/** Absolute end of a session that starts now (fixed at login, never extended by refresh). */
const sessionEndFromNow = () => new Date(Date.now() + durationMs(env.SESSION_MAX_AGE));
function accessToken(payload: object) { return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions["expiresIn"] }); }
async function issueRefresh(
  subject: { userId?: string; platformAdminId?: string },
  meta: Meta,
  expiresAt: Date = sessionEndFromNow(),
) {
  const id = newId();
  const expiresInSec = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const token = jwt.sign({ kind: "refresh", tokenId: id }, env.JWT_REFRESH_SECRET, { expiresIn: expiresInSec, jwtid: id });
  await prisma.refreshToken.create({ data: { id, ...subject, tokenHash: hash(token), expiresAt, userAgent: meta.userAgent?.slice(0, 255), ipAddress: meta.ip } });
  return token;
}

/** Legacy Precision demo emails → HMS Enterprises (single-company dashboard). */
const LEGACY_STAFF_EMAILS: Record<string, string> = {
  "demo@precisionscales.in": "admin@hmsenterprises.in",
  "desk@precisionscales.in": "desk@hmsenterprises.in",
  "engineer@precisionscales.in": "engineer@hmsenterprises.in",
  "warehouse@precisionscales.in": "warehouse@hmsenterprises.in",
  "sales@precisionscales.in": "sales@hmsenterprises.in",
  "karthik@precisionscales.in": "karthik@hmsenterprises.in",
  "priya@precisionscales.in": "priya@hmsenterprises.in",
  "arun@precisionscales.in": "arun@hmsenterprises.in",
};

function loginEmailCandidates(email: string): string[] {
  const e = email.trim().toLowerCase();
  const set = new Set<string>([e]);
  if (LEGACY_STAFF_EMAILS[e]) set.add(LEGACY_STAFF_EMAILS[e]);
  for (const [legacy, modern] of Object.entries(LEGACY_STAFF_EMAILS)) {
    if (modern === e) set.add(legacy);
  }
  return [...set];
}

export async function platformLogin(email: string, password: string, meta: Meta) {
  const admin = await prisma.platformAdmin.findFirst({
    where: {
      email: email.trim().toLowerCase(),
      status: "ACTIVE",
      deletedAt: null,
    },
  });
  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw new AppError("Invalid credentials", 401);
  }
  await prisma.platformAdmin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });
  const refreshToken = await issueRefresh({ platformAdminId: admin.id }, meta);
  return {
    accessToken: accessToken({
      kind: "platform",
      adminId: admin.id,
      role: admin.role,
    }),
    refreshToken,
    user: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      kind: "platform",
    },
  };
}
export async function tenantLogin(
  locator: { tenantSlug?: string; tenantCode?: string },
  email: string,
  password: string,
  meta: Meta,
) {
  const emails = loginEmailCandidates(email);

  const slugRaw = locator.tenantSlug?.trim().toLowerCase() || "";
  const codeRaw = locator.tenantCode?.trim() || "";

  // HMS aliases (hms / precision-scales-india / …) all resolve to the same tenant.
  const slugCandidates = tenantSlugCandidates(slugRaw);
  const hasSlug = slugCandidates.length > 0;

  // Parallel first hop: resolve workspace + candidate users (no Prisma User↔Tenant relation).
  const [locatedTenant, candidates] = await Promise.all([
    hasSlug || codeRaw
      ? prisma.tenant.findFirst({
          where: {
            deletedAt: null,
            ...(hasSlug ? { slug: { in: slugCandidates } } : { code: codeRaw }),
            status: { in: ["ACTIVE", "TRIAL"] },
          },
          select: { id: true, slug: true, name: true, branding: true, attendanceEnabled: true },
        })
      : Promise.resolve(null),
    prisma.user.findMany({
      where: { email: { in: emails }, status: "ACTIVE", deletedAt: null },
      take: 20,
    }),
  ]);

  let tenantId = locatedTenant?.id;
  let user =
    tenantId != null
      ? candidates.find((c) => c.tenantId === tenantId) ?? null
      : null;

  let tenantRow = locatedTenant;

  if (!user) {
    if (!candidates.length) throw new AppError("Invalid credentials", 401);
    const tenantIds = [...new Set(candidates.map((c) => c.tenantId))];
    const activeTenants = await prisma.tenant.findMany({
      where: {
        id: { in: tenantIds },
        deletedAt: null,
        status: { in: ["ACTIVE", "TRIAL"] },
      },
      select: { id: true, slug: true, name: true, branding: true, attendanceEnabled: true },
    });
    const activeSet = new Map(activeTenants.map((t) => [t.id, t]));
    const matches = candidates.filter((c) => activeSet.has(c.tenantId));
    if (!matches.length) throw new AppError("Invalid credentials", 401);
    if (matches.length > 1) {
      throw new AppError("Multiple workspaces found for this email. Contact your admin.", 409);
    }
    user = matches[0];
    tenantId = user.tenantId;
    tenantRow = activeSet.get(user.tenantId) ?? null;
  }

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Invalid credentials", 401);
  }

  // Gradually accelerate future logins if hashes were created with cost > 10
  try {
    if (bcrypt.getRounds(user.passwordHash) > 10) {
      void bcrypt.hash(password, 10).then((nextHash) =>
        prisma.user
          .update({ where: { id: user!.id }, data: { passwordHash: nextHash } })
          .catch(() => undefined),
      );
    }
  } catch {
    /* ignore */
  }

  const [role, tenantFresh, refreshToken, tenantModuleKeys] = await Promise.all([
    prisma.role.findFirst({
      where: { id: user.roleId, tenantId: user.tenantId, deletedAt: null },
      select: { code: true },
    }),
    // Reuse located tenant when possible; otherwise fetch branding in parallel with role
    tenantRow
      ? Promise.resolve(tenantRow)
      : prisma.tenant.findFirst({
          where: { id: user.tenantId },
          select: { id: true, slug: true, name: true, branding: true, attendanceEnabled: true },
        }),
    issueRefresh({ userId: user.id }, meta),
    loadTenantEnabledModuleKeys(user.tenantId),
    // Don't block token on lastLogin write
    prisma.user
      // First sign-in done: forget the plaintext starting password (bcrypt hash stays)
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date(), tempPassword: null } })
      .catch(() => undefined),
  ]);
  if (!role) throw new AppError("User role is unavailable", 403);
  wakeAttendanceApi(tenantFresh?.attendanceEnabled);

  return {
    accessToken: accessToken({
      kind: "tenant",
      userId: user.id,
      tenantId: user.tenantId,
      role: role.code,
    }),
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: role.code,
      tenantId: user.tenantId,
      tenantSlug: tenantFresh?.slug,
      tenantName: tenantFresh?.name,
      branding: tenantFresh?.branding ?? null,
      inventoryAreas: resolveInventoryAreas(user.preferences, role.code),
      allowedModules: resolveAllowedModules(user.preferences, role.code, tenantModuleKeys),
      attendanceEnabled: Boolean(tenantFresh?.attendanceEnabled),
      kind: "tenant",
    },
  };
}
export async function refresh(raw: string, meta: Meta) {
  try { jwt.verify(raw, env.JWT_REFRESH_SECRET); } catch { throw new AppError("Session expired — please sign in again", 401); }
  const old = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!old || old.revokedAt || old.expiresAt <= new Date()) throw new AppError("Session expired — please sign in again", 401);
  await prisma.refreshToken.update({ where: { id: old.id }, data: { revokedAt: new Date() } });
  // Rotated token inherits the session end — refreshing never extends the session.
  // Legacy tokens (issued with a 7-day expiry) are also capped to SESSION_MAX_AGE from their issue time.
  const legacyCap = new Date(old.createdAt.getTime() + durationMs(env.SESSION_MAX_AGE));
  const sessionEnd = old.expiresAt < legacyCap ? old.expiresAt : legacyCap;
  if (sessionEnd <= new Date()) throw new AppError("Session expired — please sign in again", 401);
  if (old.platformAdminId) {
    const admin = await prisma.platformAdmin.findFirst({ where: { id: old.platformAdminId, status: "ACTIVE", deletedAt: null } });
    if (!admin) throw new AppError("Account unavailable", 401);
    return { accessToken: accessToken({ kind: "platform", adminId: admin.id, role: admin.role }), refreshToken: await issueRefresh({ platformAdminId: admin.id }, meta, sessionEnd) };
  }
  const user = await prisma.user.findFirst({ where: { id: old.userId ?? "", status: "ACTIVE", deletedAt: null } });
  if (!user) throw new AppError("Account unavailable", 401);
  const role = await prisma.role.findFirst({ where: { id: user.roleId, tenantId: user.tenantId, deletedAt: null } });
  if (!role) throw new AppError("Role unavailable", 401);
  return { accessToken: accessToken({ kind: "tenant", userId: user.id, tenantId: user.tenantId, role: role.code }), refreshToken: await issueRefresh({ userId: user.id }, meta, sessionEnd) };
}
export async function logout(raw: string) { await prisma.refreshToken.updateMany({ where: { tokenHash: hash(raw), revokedAt: null }, data: { revokedAt: new Date() } }); }
export async function me(auth: Express.Request["auth"]) {
  if (!auth) throw new AppError("Authentication required", 401);
  if (auth.kind === "platform") {
    return prisma.platformAdmin.findFirst({
      where: { id: auth.userId, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true },
    });
  }
  const user = await prisma.user.findFirst({
    where: { id: auth.userId, tenantId: auth.tenantId, deletedAt: null },
    select: {
      id: true,
      tenantId: true,
      roleId: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      timezone: true,
      status: true,
      preferences: true,
    },
  });
  if (!user) return null;
  const [tenant, role, tenantModuleKeys] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: user.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        code: true,
        branding: true,
        attendanceEnabled: true,
      },
    }),
    prisma.role.findFirst({
      where: { id: user.roleId, tenantId: user.tenantId, deletedAt: null },
      select: { id: true, code: true, name: true },
    }),
    loadTenantEnabledModuleKeys(user.tenantId),
  ]);
  wakeAttendanceApi(tenant?.attendanceEnabled);
  const { preferences, ...rest } = user;
  return {
    ...rest,
    tenant,
    role,
    inventoryAreas: resolveInventoryAreas(preferences, role?.code),
    allowedModules: resolveAllowedModules(preferences, role?.code, tenantModuleKeys),
    attendanceEnabled: Boolean(tenant?.attendanceEnabled),
  };
}

export async function updateProfile(
  auth: Express.Request["auth"],
  data: {
    name?: string;
    phone?: string | null;
    avatarUrl?: string | null;
    timezone?: string;
    preferences?: Record<string, unknown>;
  },
) {
  if (!auth || auth.kind !== "tenant" || !auth.userId || !auth.tenantId) {
    throw new AppError("Tenant session required", 403);
  }
  const current = await prisma.user.findFirst({
    where: { id: auth.userId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!current) throw new AppError("User not found", 404);

  const patch: Record<string, unknown> = {};
  if (data.name) patch.name = data.name.trim();
  if ("phone" in data) patch.phone = data.phone;
  if ("avatarUrl" in data) patch.avatarUrl = data.avatarUrl;
  if (data.timezone) patch.timezone = data.timezone;
  if (data.preferences) {
    const prev =
      current.preferences && typeof current.preferences === "object" && !Array.isArray(current.preferences)
        ? (current.preferences as Record<string, unknown>)
        : {};
    // inventoryAreas + allowedModules are admin-assigned only — never overwrite from self-service
    const {
      inventoryAreas: _dropInv,
      allowedModules: _dropMods,
      ...safePrefs
    } = data.preferences as Record<string, unknown>;
    patch.preferences = {
      ...prev,
      ...safePrefs,
      ...(prev.inventoryAreas != null ? { inventoryAreas: prev.inventoryAreas } : {}),
      ...(prev.allowedModules != null ? { allowedModules: prev.allowedModules } : {}),
    };
  }

  await prisma.user.update({ where: { id: current.id }, data: patch });
  return me(auth);
}

export async function changePassword(
  auth: Express.Request["auth"],
  currentPassword: string,
  newPassword: string,
) {
  if (!auth || auth.kind !== "tenant" || !auth.userId || !auth.tenantId) {
    throw new AppError("Tenant session required", 403);
  }
  const user = await prisma.user.findFirst({
    where: { id: auth.userId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!user) throw new AppError("User not found", 404);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError("Current password is incorrect", 400);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      tempPassword: null,
    },
  });
  return { ok: true };
}
