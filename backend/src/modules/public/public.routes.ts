import { Router } from "express";
import { prisma } from "../../config/database.js";
import { success } from "../../common/utils/response.js";
import { notFound } from "../../common/errors.js";
import { normalizeBranding, isReservedLoginSlug } from "../../common/branding.js";

/** Unauthenticated workspace branding for /login/:slug */
export const publicRouter = Router();

const WORKSPACE_SLUG_ALIASES: Record<string, string> = {
  hms: "precision-scales-india",
  "hms-enterprises": "precision-scales-india",
  hmsenterprises: "precision-scales-india",
};

publicRouter.get("/workspace/:slug", async (q, r) => {
  const raw = String(q.params.slug ?? "")
    .toLowerCase()
    .trim();
  const slug = WORKSPACE_SLUG_ALIASES[raw] || raw;
  if (!slug || slug.length > 64 || isReservedLoginSlug(slug)) throw notFound("Workspace");

  const tenant = await prisma.tenant.findFirst({
    where: {
      slug,
      deletedAt: null,
      status: { in: ["ACTIVE", "TRIAL"] },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      code: true,
      status: true,
      logoUrl: true,
      branding: true,
      city: true,
    },
  });
  if (!tenant) throw notFound("Workspace");

  return success(r, {
    name: tenant.name,
    slug: tenant.slug,
    code: tenant.code,
    status: tenant.status,
    logoUrl: tenant.logoUrl,
    city: tenant.city,
    branding: normalizeBranding(tenant.branding),
  });
});
