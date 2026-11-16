/**
 * Harish 2026-11-14: "we aren't sending any WhatsApp update to any customer and we haven't created any
 * account for HMS, so WhatsApp should not interrupt anywhere." Switches HMS's WhatsApp module off and
 * marks its leftover Meta Cloud integration row (no credentials of its own) as disconnected.
 * Re-enable later: Settings / platform → modules → WhatsApp on, then connect HMS's own account.
 *   npx tsx --env-file=.env scripts/whatsapp-off-hms-2026-11-14.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const T = "25393a78-d3d2-483b-b141-3f4345ff4572";
const before = await prisma.tenantModule.findMany({ where: { tenantId: T, moduleKey: "engagement.whatsapp" }, select: { id: true, isEnabled: true } });
const integ = await prisma.integration.findMany({ where: { tenantId: T }, select: { id: true, provider: true, status: true } });
console.log("before:", JSON.stringify({ module: before, integrations: integ }));
const m = await prisma.tenantModule.updateMany({ where: { tenantId: T, moduleKey: "engagement.whatsapp" }, data: { isEnabled: false } });
const i = await prisma.integration.updateMany({ where: { tenantId: T, provider: { in: ["META_CLOUD", "ASKMEISTER"] } }, data: { status: "DISCONNECTED" } });
console.log(`WhatsApp module rows switched off: ${m.count}; integrations disconnected: ${i.count}`);
await prisma.$disconnect();
