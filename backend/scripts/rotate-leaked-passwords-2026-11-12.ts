/**
 * 2026-11-12 security fix — replace passwords that are public:
 *  - platform super admin (its password was committed in the public GitHub repo's .env.example)
 *  - every HMS login still on the shared demo password (it was shipped in the login page's JS)
 *
 * Each account gets a new random 16-char password, all its sessions are ended, and the new
 * passwords are written to backups/ (git-ignored) for Harish to hand out.
 *
 * Dry run:  npx tsx --env-file=.env scripts/rotate-leaked-passwords-2026-11-12.ts
 * Apply:    npx tsx --env-file=.env scripts/rotate-leaked-passwords-2026-11-12.ts --apply
 */
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const HMS_TENANT = "25393a78-d3d2-483b-b141-3f4345ff4572";
// The old platform password is passed in, never written here: LEAKED_PLATFORM_PASSWORD=... npx tsx ...
const LEAKED = ["Demo@12345", process.env.LEAKED_PLATFORM_PASSWORD].filter(Boolean) as string[];

function strongPassword(len = 16) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*!?"];
  const all = sets.join("");
  const out = sets.map((s) => s[randomInt(s.length)]!);
  while (out.length < len) out.push(all[randomInt(all.length)]!);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join("");
}

async function usesLeaked(hash: string) {
  for (const pw of LEAKED) if (await bcrypt.compare(pw, hash)) return true;
  return false;
}

const results: Array<{ who: string; email: string; newPassword: string }> = [];

const admins = await prisma.platformAdmin.findMany({ where: { deletedAt: null } });
for (const a of admins) {
  if (!(await usesLeaked(a.passwordHash))) continue;
  const pw = strongPassword();
  results.push({ who: "Platform super admin", email: a.email, newPassword: pw });
  if (apply) {
    await prisma.platformAdmin.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(pw, 10) } });
    await prisma.refreshToken.updateMany({ where: { platformAdminId: a.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

const users = await prisma.user.findMany({ where: { tenantId: HMS_TENANT, deletedAt: null } });
for (const u of users) {
  if (!(await usesLeaked(u.passwordHash))) continue;
  const pw = strongPassword();
  results.push({ who: `HMS · ${u.name}`, email: u.email, newPassword: pw });
  if (apply) {
    await prisma.user.update({
      where: { id: u.id },
      // tempPassword lets the platform admin re-share it if someone loses the note
      data: { passwordHash: await bcrypt.hash(pw, 10), tempPassword: pw },
    });
    await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

console.log(apply ? "APPLIED" : "DRY RUN (add --apply to change passwords)");
for (const r of results) console.log(`- ${r.who} <${r.email}>`);
if (apply && results.length) {
  mkdirSync("backups", { recursive: true });
  const file = `backups/new-passwords-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  writeFileSync(file, results.map((r) => `${r.who}\t${r.email}\t${r.newPassword}`).join("\n") + "\n");
  console.log(`New passwords written to ${file} — share them privately, then delete the file.`);
}
await prisma.$disconnect();
