/**
 * One-off: rename HMS Enterprises' tenant slug `precision-scales-india` → `hms`
 * so its login URL is /login/hms everywhere.
 *
 * Safe order: deploy the backend with `common/tenantSlugs.ts` first (it accepts both names),
 * then run this. Old links (/login/precision-scales-india) keep working via the alias.
 *
 *   npx tsx scripts/rename-hms-slug.ts            # dry run (no writes)
 *   npx tsx scripts/rename-hms-slug.ts --apply    # perform the rename
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const FROM = "precision-scales-india";
const TO = "hms";
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const current = await prisma.tenant.findFirst({
    where: { slug: { in: [FROM, TO] }, deletedAt: null },
    select: { id: true, name: true, code: true, slug: true },
  });
  if (!current) throw new Error(`No tenant with slug "${FROM}" or "${TO}"`);
  if (current.slug === TO) {
    console.log(`Already renamed: ${current.name} (${current.code}) slug = "${TO}". Nothing to do.`);
    return;
  }
  const clash = await prisma.tenant.findFirst({ where: { slug: TO, id: { not: current.id } }, select: { id: true, name: true } });
  if (clash) throw new Error(`Slug "${TO}" is already used by ${clash.name} (${clash.id})`);

  console.log(`${apply ? "Renaming" : "[dry run] Would rename"}: ${current.name} (${current.code}) "${current.slug}" → "${TO}"`);
  if (!apply) {
    console.log("Re-run with --apply to write the change.");
    return;
  }
  await prisma.tenant.update({ where: { id: current.id }, data: { slug: TO } });
  console.log("Done. Staff login URL: /login/hms");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
