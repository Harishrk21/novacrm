import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";
import { newId } from "../../common/utils/id.js";
type Meta = { userAgent?: string; ip?: string };
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const expiryDate = () => { const match = env.JWT_REFRESH_EXPIRY.match(/^(\d+)([dhm])$/); const n = Number(match?.[1] ?? 7); const unit = match?.[2] ?? "d"; return new Date(Date.now() + n * (unit === "d" ? 86400000 : unit === "h" ? 3600000 : 60000)); };
function accessToken(payload: object) { return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions["expiresIn"] }); }
async function issueRefresh(subject: { userId?: string; platformAdminId?: string }, meta: Meta) { const id = newId(); const token = jwt.sign({ kind: "refresh", tokenId: id }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions["expiresIn"], jwtid: id }); await prisma.refreshToken.create({ data: { id, ...subject, tokenHash: hash(token), expiresAt: expiryDate(), userAgent: meta.userAgent?.slice(0,255), ipAddress: meta.ip } }); return token; }
export async function platformLogin(email: string, password: string, meta: Meta) { const admin = await prisma.platformAdmin.findFirst({ where: { email, status: "ACTIVE", deletedAt: null } }); if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) throw new AppError("Invalid credentials", 401); await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }); const refreshToken = await issueRefresh({ platformAdminId: admin.id }, meta); return { accessToken: accessToken({ kind: "platform", adminId: admin.id, role: admin.role }), refreshToken, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, kind: "platform" } }; }
export async function tenantLogin(
  locator: { tenantSlug?: string; tenantCode?: string },
  email: string,
  password: string,
  meta: Meta,
) {
  let tenantId: string | undefined;
  if (locator.tenantSlug || locator.tenantCode) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        deletedAt: null,
        ...(locator.tenantSlug ? { slug: locator.tenantSlug } : { code: locator.tenantCode }),
        status: { in: ["ACTIVE", "TRIAL"] },
      },
    });
    if (!tenant) throw new AppError("Tenant not found or unavailable", 401);
    tenantId = tenant.id;
  } else {
    const candidates = await prisma.user.findMany({
      where: {
        email,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true, tenantId: true, passwordHash: true },
      take: 20,
    });
    const tenantIds = [...new Set(candidates.map((c) => c.tenantId))];
    const activeTenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: {
            id: { in: tenantIds },
            deletedAt: null,
            status: { in: ["ACTIVE", "TRIAL"] },
          },
          select: { id: true },
        })
      : [];
    const activeSet = new Set(activeTenants.map((t) => t.id));
    const matches = candidates.filter((c) => activeSet.has(c.tenantId));
    if (!matches.length) throw new AppError("Invalid credentials", 401);
    if (matches.length > 1) {
      throw new AppError("Multiple workspaces found for this email. Contact your admin.", 409);
    }
    tenantId = matches[0].tenantId;
  }
  const user = await prisma.user.findFirst({
    where: { tenantId, email, status: "ACTIVE", deletedAt: null },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Invalid credentials", 401);
  }
  const role = await prisma.role.findFirst({
    where: { id: user.roleId, tenantId: user.tenantId, deletedAt: null },
  });
  if (!role) throw new AppError("User role is unavailable", 403);
  const tenant = await prisma.tenant.findFirst({
    where: { id: user.tenantId },
    select: { id: true, slug: true, name: true },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const refreshToken = await issueRefresh({ userId: user.id }, meta);
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
      role: role.code,
      tenantId: user.tenantId,
      tenantSlug: tenant?.slug,
      kind: "tenant",
    },
  };
}
export async function refresh(raw: string, meta: Meta) { try { jwt.verify(raw, env.JWT_REFRESH_SECRET); } catch { throw new AppError("Invalid refresh token", 401); } const old = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(raw) } }); if (!old || old.revokedAt || old.expiresAt <= new Date()) throw new AppError("Invalid refresh token", 401); await prisma.refreshToken.update({ where: { id: old.id }, data: { revokedAt: new Date() } }); if (old.platformAdminId) { const admin = await prisma.platformAdmin.findFirst({ where: { id: old.platformAdminId, status: "ACTIVE", deletedAt: null } }); if (!admin) throw new AppError("Account unavailable", 401); return { accessToken: accessToken({ kind: "platform", adminId: admin.id, role: admin.role }), refreshToken: await issueRefresh({ platformAdminId: admin.id }, meta) }; } const user = await prisma.user.findFirst({ where: { id: old.userId ?? "", status: "ACTIVE", deletedAt: null } }); if (!user) throw new AppError("Account unavailable", 401); const role = await prisma.role.findFirst({ where: { id: user.roleId, tenantId: user.tenantId, deletedAt: null } }); if (!role) throw new AppError("Role unavailable", 401); return { accessToken: accessToken({ kind: "tenant", userId: user.id, tenantId: user.tenantId, role: role.code }), refreshToken: await issueRefresh({ userId: user.id }, meta) }; }
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
  const [tenant, role] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: user.tenantId, deletedAt: null },
      select: { id: true, name: true, slug: true, code: true },
    }),
    prisma.role.findFirst({
      where: { id: user.roleId, tenantId: user.tenantId, deletedAt: null },
      select: { id: true, code: true, name: true },
    }),
  ]);
  return { ...user, tenant, role };
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
    patch.preferences = { ...prev, ...data.preferences };
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
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });
  return { ok: true };
}
