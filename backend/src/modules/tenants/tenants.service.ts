import { prisma } from "../../config/database.js";
import { notFound } from "../../common/errors.js";

export async function get(tenantId: string) {
  const row = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  if (!row) throw notFound("Tenant");
  return row;
}

export const modules = (tenantId: string) =>
  prisma.tenantModule.findMany({
    where: { tenantId, isEnabled: true },
    orderBy: { sortOrder: "asc" },
  });

export async function update(tenantId: string, data: Record<string, unknown>) {
  const current = await get(tenantId);
  const patch: Record<string, unknown> = { ...data };

  if (data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)) {
    const prev =
      current.settings && typeof current.settings === "object" && !Array.isArray(current.settings)
        ? (current.settings as Record<string, unknown>)
        : {};
    patch.settings = { ...prev, ...(data.settings as Record<string, unknown>) };
  }

  if (data.branding && typeof data.branding === "object" && !Array.isArray(data.branding)) {
    const prev =
      current.branding && typeof current.branding === "object" && !Array.isArray(current.branding)
        ? (current.branding as Record<string, unknown>)
        : {};
    patch.branding = { ...prev, ...(data.branding as Record<string, unknown>) };
  }

  if (data.terminology && typeof data.terminology === "object" && !Array.isArray(data.terminology)) {
    const prev =
      current.terminology && typeof current.terminology === "object" && !Array.isArray(current.terminology)
        ? (current.terminology as Record<string, unknown>)
        : {};
    patch.terminology = { ...prev, ...(data.terminology as Record<string, unknown>) };
  }

  await prisma.tenant.update({ where: { id: tenantId }, data: patch });
  return get(tenantId);
}
