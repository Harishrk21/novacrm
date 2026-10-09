import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError, notFound } from "../../common/errors.js";

function brandCode(name: string) {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

export async function listBrands(tenantId: string, opts?: { includeInactive?: boolean }) {
  return prisma.brand.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(opts?.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, isActive: true, createdAt: true, updatedAt: true },
  });
}

export async function createBrand(tenantId: string, body: { name: string; code?: string | null }) {
  const name = String(body.name ?? "").trim();
  if (!name) throw new AppError("Brand name is required", 422);
  const code = (body.code?.trim() ? brandCode(body.code) : brandCode(name)) || "BRAND";
  const dup = await prisma.brand.findFirst({
    where: { tenantId, deletedAt: null, OR: [{ code }, { name }] },
  });
  if (dup) throw new AppError(`Brand ${dup.name} already exists`, 409);
  return prisma.brand.create({
    data: { id: newId(), tenantId, name, code, isActive: true },
    select: { id: true, name: true, code: true, isActive: true, createdAt: true, updatedAt: true },
  });
}

export async function updateBrand(
  tenantId: string,
  id: string,
  body: { name?: string; code?: string | null; isActive?: boolean },
) {
  const existing = await prisma.brand.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!existing) throw notFound("Brand");

  const name = body.name != null ? String(body.name).trim() : existing.name;
  if (!name) throw new AppError("Brand name is required", 422);
  const code =
    body.code !== undefined
      ? body.code?.trim()
        ? brandCode(body.code)
        : brandCode(name)
      : existing.code;

  const dup = await prisma.brand.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      id: { not: id },
      OR: [{ code }, { name }],
    },
  });
  if (dup) throw new AppError(`Brand ${dup.name} already exists`, 409);

  return prisma.brand.update({
    where: { id },
    data: {
      name,
      code: code || existing.code,
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
    },
    select: { id: true, name: true, code: true, isActive: true, createdAt: true, updatedAt: true },
  });
}

export async function deleteBrand(tenantId: string, id: string) {
  const existing = await prisma.brand.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!existing) throw notFound("Brand");
  const inUse = await prisma.stockUnit.count({
    where: { tenantId, brandId: id, deletedAt: null },
  });
  if (inUse > 0) {
    throw new AppError(
      `Cannot delete brand used on ${inUse} stock unit(s) — deactivate it instead`,
      409,
    );
  }
  await prisma.brand.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  return null;
}

export async function getBrand(tenantId: string, id: string) {
  const row = await prisma.brand.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw notFound("Brand");
  return row;
}
