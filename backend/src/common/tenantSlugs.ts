/**
 * Login-slug aliases.
 *
 * HMS Enterprises was seeded as `precision-scales-india` (old demo name) and is being
 * renamed to `hms`. Every name in a group resolves to the same tenant, so old bookmarks,
 * typed variants, and the DB before *or* after the rename all keep working.
 */
const ALIAS_GROUPS: string[][] = [
  ["hms", "precision-scales-india", "hms-enterprises", "hmsenterprises", "hms-enterprises-in"],
];

/** Slugs to try for a login / workspace lookup, e.g. `hms` → [hms, precision-scales-india, …]. */
export function tenantSlugCandidates(raw: string): string[] {
  const slug = raw.trim().toLowerCase();
  if (!slug) return [];
  const group = ALIAS_GROUPS.find((g) => g.includes(slug));
  return group ? [slug, ...group.filter((s) => s !== slug)] : [slug];
}

/** True for HMS Enterprises under any of its names. */
export function isHmsTenantSlug(slug: string | null | undefined): boolean {
  return Boolean(slug) && ALIAS_GROUPS[0].includes(String(slug).toLowerCase());
}
