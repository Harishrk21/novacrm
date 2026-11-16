import { prisma } from "../config/database.js";

/**
 * Per-company WhatsApp switch = the "engagement.whatsapp" module (Settings / platform plan).
 * When it is off, nothing is sent to customers or staff, no "WhatsApp sent" activity is logged and no
 * wa.me fallback link is offered — e.g. HMS has no WhatsApp Business account of its own, so the
 * platform's number must never message HMS customers.
 */
const cache = new Map<string, { on: boolean; at: number }>();
const TTL_MS = 60_000;

export async function whatsappOn(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.on;
  const row = await prisma.tenantModule.findFirst({
    where: { tenantId, moduleKey: "engagement.whatsapp" },
    select: { isEnabled: true },
  });
  const on = Boolean(row?.isEnabled);
  cache.set(tenantId, { on, at: Date.now() });
  return on;
}

/** Call after a module change so the switch applies at once. */
export function forgetWhatsappSwitch(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
