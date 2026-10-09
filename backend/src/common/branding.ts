/** Per-tenant UI color kit controlled by platform admin. */
export const BRAND_PALETTES = [
  "ocean",
  "emerald",
  "violet",
  "amber",
  "rose",
  "slate",
] as const;

export type BrandPalette = (typeof BRAND_PALETTES)[number];

export type TenantBranding = {
  /** Named kit — drives accent, sidebar, wash, charts */
  palette: BrandPalette;
  /** When true, company users cannot switch palette in Appearance */
  locked: boolean;
  /** Optional hex overrides (platform fine-tune) */
  accent?: string;
  accentHover?: string;
  sidebarBg?: string;
  /** Optional login hero line shown on /login/:slug */
  loginTagline?: string;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

const RESERVED_SLUGS = new Set([
  "admin",
  "platform",
  "login",
  "api",
  "www",
  "app",
  "console",
  "meister",
]);

export function isReservedLoginSlug(slug: string) {
  return RESERVED_SLUGS.has(slug.toLowerCase().trim());
}

export function isBrandPalette(v: unknown): v is BrandPalette {
  return typeof v === "string" && (BRAND_PALETTES as readonly string[]).includes(v);
}

export function normalizeBranding(
  input: unknown,
  fallback: BrandPalette = "violet",
): TenantBranding {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const palette = isBrandPalette(raw.palette) ? raw.palette : fallback;
  const accent = typeof raw.accent === "string" && HEX.test(raw.accent) ? raw.accent : undefined;
  const accentHover =
    typeof raw.accentHover === "string" && HEX.test(raw.accentHover) ? raw.accentHover : undefined;
  const sidebarBg =
    typeof raw.sidebarBg === "string" && HEX.test(raw.sidebarBg) ? raw.sidebarBg : undefined;
  const loginTagline =
    typeof raw.loginTagline === "string" && raw.loginTagline.trim()
      ? raw.loginTagline.trim().slice(0, 160)
      : undefined;
  return {
    palette,
    locked: raw.locked === true,
    ...(accent ? { accent } : {}),
    ...(accentHover ? { accentHover } : {}),
    ...(sidebarBg ? { sidebarBg } : {}),
    ...(loginTagline ? { loginTagline } : {}),
  };
}

export function mergeBranding(prev: unknown, patch: unknown): TenantBranding {
  const base = normalizeBranding(prev);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  return normalizeBranding({ ...base, ...(patch as Record<string, unknown>) }, base.palette);
}
